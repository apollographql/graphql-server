import { GraphQLSchema } from 'graphql';
import {
  ApolloConfig,
  GraphQLSchemaContext,
  Logger,
} from 'apollo-server-types';
import { GatewayInterface, Unsubscriber } from '../types';
import { SchemaDerivedData } from '../ApolloServer';

type SchemaDerivedDataProvider = (
  apiSchema: GraphQLSchema,
) => SchemaDerivedData;

/**
 * An async-safe class for tracking changes in schemas and schema-derived data.
 *
 * Specifically, as long as start() is called (and completes) before stop() is
 * called, any set of executions of public methods is linearizable.
 *
 * Note that linearizability in Javascript is trivial if all public methods are
 * non-async, but increasingly difficult to guarantee if public methods become
 * async. Accordingly, if you believe a public method should be async, think
 * carefully on whether it's worth the mental overhead. (E.g. if you wished that
 * a callback was async, consider instead resolving a Promise in a non-async
 * callback and having your async code wait on the Promise in setTimeout().)
 */
export class SchemaManager {
  private readonly logger: Logger;
  private readonly schemaDerivedDataProvider: SchemaDerivedDataProvider;
  private readonly onSchemaLoadOrUpdateListeners = new Set<
    (schemaContext: GraphQLSchemaContext) => void
  >();
  private isStopped = false;
  private schemaDerivedData?: SchemaDerivedData;
  private schemaContext?: GraphQLSchemaContext;

  // For state that's specific to the mode of operation.
  private readonly modeSpecificState:
    | {
        readonly mode: 'gateway';
        readonly gateway: GatewayInterface;
        readonly apolloConfig: ApolloConfig;
        unsubscribeFromGateway?: Unsubscriber;
      }
    | {
        readonly mode: 'schema';
        readonly apiSchema: GraphQLSchema;
      };

  constructor(
    options: (
      | { gateway: GatewayInterface; apolloConfig: ApolloConfig }
      | { apiSchema: GraphQLSchema }
    ) & {
      logger: Logger;
      schemaDerivedDataProvider: SchemaDerivedDataProvider;
    },
  ) {
    this.logger = options.logger;
    this.schemaDerivedDataProvider = options.schemaDerivedDataProvider;
    if ('gateway' in options) {
      this.modeSpecificState = {
        mode: 'gateway',
        gateway: options.gateway,
        apolloConfig: options.apolloConfig,
      };
    } else {
      this.modeSpecificState = {
        mode: 'schema',
        apiSchema: options.apiSchema,
      };
      // The caller of the constructor expects us to fail early if the schema
      // given is invalid/has errors, so we call the provider here.
      options.schemaDerivedDataProvider(options.apiSchema);
    }
  }

  /**
   * Calling start() will:
   * - Start gateway schema fetching (if a gateway was provided).
   * - Initialize schema-derived data.
   * - Synchronously notify onSchemaLoadOrUpdate() listeners of schema load, and
   *   asynchronously notify them of schema updates.
   */
  public async start(): Promise<void> {
    if (this.modeSpecificState.mode === 'gateway') {
      const gateway = this.modeSpecificState.gateway;
      if (gateway.onSchemaLoadOrUpdate) {
        // Use onSchemaLoadOrUpdate if available, as it reports the core
        // supergraph SDL and always reports the initial schema load.
        this.modeSpecificState.unsubscribeFromGateway =
          gateway.onSchemaLoadOrUpdate((schemaContext) => {
            this.processSchemaLoadOrUpdateEvent(schemaContext);
          });
      } else if (gateway.onSchemaChange) {
        this.modeSpecificState.unsubscribeFromGateway = gateway.onSchemaChange(
          (apiSchema) => {
            this.processSchemaLoadOrUpdateEvent({ apiSchema });
          },
        );
      } else {
        throw new Error(
          "Unexpectedly couldn't find onSchemaChange or onSchemaLoadOrUpdate on gateway",
        );
      }

      const config = await this.modeSpecificState.gateway.load({
        apollo: this.modeSpecificState.apolloConfig,
      });

      // Note that for old gateways that have onSchemaChange() and no
      // onSchemaLoadOrUpdate(), this.schemaDerivedData may not be initialized
      // during gateway.load() (because old gateways don't notify listeners on
      // schema load in some cases), so we must initialize it here if needed.
      if (!this.schemaDerivedData) {
        this.processSchemaLoadOrUpdateEvent({ apiSchema: config.schema });
      }
    } else {
      this.processSchemaLoadOrUpdateEvent({
        apiSchema: this.modeSpecificState.apiSchema,
      });
    }
  }

  /**
   * Registers a listener for schema load/update events. Note that the latest
   * event is buffered, i.e.
   * - If registered before start(), this method will throw. (We have no need
   *   for registration before start(), but this is easy enough to change.)
   * - If registered after start() but before stop(), the callback will be first
   *   called in this method (for whatever the current schema is), and then
   *   later for updates.
   * - If registered after stop(), the callback will never be called.
   *
   * For gateways, a core supergraph SDL will be provided to the callback. If
   * your gateway is too old to provide a core supergraph SDL, this method will
   * throw.
   *
   * @param callback The listener to execute on schema load/updates.
   */
  public onSchemaLoadOrUpdate(
    callback: (schemaContext: GraphQLSchemaContext) => void,
  ): Unsubscriber {
    if (
      this.modeSpecificState.mode === 'gateway' &&
      !this.modeSpecificState.gateway.onSchemaLoadOrUpdate
    ) {
      // FIXME: Once a gateway version providing the core schema to callbacks
      //        has been released, update this message to state the specific
      //        version needed.
      throw new GatewayIsTooOldError(
        "Your gateway is too old to register a 'onSchemaLoadOrUpdate' listener",
      );
    } else {
      if (!this.schemaContext) {
        throw new Error('You must call start() before onSchemaLoadOrUpdate()');
      }
      if (!this.isStopped) {
        try {
          callback(this.schemaContext);
        } catch (e) {
          this.logger.error(
            [
              "An error was thrown from an 'onSchemaLoadOrUpdate' listener:",
              `${e?.message ?? e}`,
            ].join(' '),
          );
        }
      }
      this.onSchemaLoadOrUpdateListeners.add(callback);
    }

    return () => {
      this.onSchemaLoadOrUpdateListeners.delete(callback);
    };
  }

  /**
   * Get the schema-derived state for the current schema. This throws if called
   * before start() is called.
   */
  public getSchemaDerivedData(): SchemaDerivedData {
    if (!this.schemaDerivedData) {
      throw new Error('You must call start() before getSchemaDerivedData()');
    }
    return this.schemaDerivedData;
  }

  /**
   * Calling stop() will:
   * - Stop gateway schema fetching (if a gateway was provided).
   *   - Note that this specific step may not succeed if gateway is old.
   * - Stop updating schema-derived data.
   * - Stop notifying onSchemaLoadOrUpdate() listeners.
   */
  public async stop(): Promise<void> {
    this.isStopped = true;
    if (this.modeSpecificState.mode === 'gateway') {
      this.modeSpecificState.unsubscribeFromGateway?.();
      await this.modeSpecificState.gateway.stop?.();
    }
  }

  private processSchemaLoadOrUpdateEvent(
    schemaContext: GraphQLSchemaContext,
  ): void {
    if (!this.isStopped) {
      this.schemaDerivedData = this.schemaDerivedDataProvider(
        schemaContext.apiSchema,
      );
      this.schemaContext = schemaContext;
      this.onSchemaLoadOrUpdateListeners.forEach((listener) => {
        try {
          listener(schemaContext);
        } catch (e) {
          this.logger.error(
            [
              "An error was thrown from an 'onSchemaLoadOrUpdate' listener:",
              `${e?.message ?? e}`,
            ].join(' '),
          );
        }
      });
    }
  }
}

export class GatewayIsTooOldError extends Error {
  public constructor(message: string) {
    super(message);
  }
}
