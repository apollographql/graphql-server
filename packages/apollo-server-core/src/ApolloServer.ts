import { addMocksToSchema } from '@graphql-tools/mock';
import { makeExecutableSchema } from '@graphql-tools/schema';
import loglevel from 'loglevel';
import {
  GraphQLSchema,
  GraphQLError,
  ValidationContext,
  FieldDefinitionNode,
  DocumentNode,
  ParseOptions,
  print,
} from 'graphql';
import resolvable, { Resolvable } from '@josephg/resolvable';
import {
  InMemoryLRUCache,
  PrefixingKeyValueCache,
} from 'apollo-server-caching';
import type {
  ApolloServerPlugin,
  GraphQLServiceContext,
  GraphQLServerListener,
  LandingPage,
} from 'apollo-server-plugin-base';

import { GraphQLServerOptions } from './graphqlOptions';

import { Config, Context, ContextFunction, PluginDefinition } from './types';

import { generateSchemaHash } from './utils/schemaHash';
import {
  processGraphQLRequest,
  GraphQLRequestContext,
  GraphQLRequest,
  APQ_CACHE_PREFIX,
} from './requestPipeline';

import { Headers } from 'apollo-server-env';
import { buildServiceDefinition } from '@apollographql/apollo-tools';
import { Logger, SchemaHash, ApolloConfig } from 'apollo-server-types';
import { cloneObject } from './runHttpQuery';
import isNodeLike from './utils/isNodeLike';
import { determineApolloConfig } from './determineApolloConfig';
import {
  ApolloServerPluginSchemaReporting,
  ApolloServerPluginSchemaReportingOptions,
  ApolloServerPluginInlineTrace,
  ApolloServerPluginUsageReporting,
  ApolloServerPluginCacheControl,
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} from './plugin';
import { InternalPluginId, pluginIsInternal } from './internalPlugin';
import { newCachePolicy } from './cachePolicy';
import { SchemaManager } from './utils/schemaManager';

const NoIntrospection = (context: ValidationContext) => ({
  Field(node: FieldDefinitionNode) {
    if (node.name.value === '__schema' || node.name.value === '__type') {
      context.reportError(
        new GraphQLError(
          'GraphQL introspection is not allowed by Apollo Server, but the query contained __schema or __type. To enable introspection, pass introspection: true to ApolloServer in production',
          [node],
        ),
      );
    }
  },
});

function approximateObjectSize<T>(obj: T): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

export type SchemaDerivedData = {
  schema: GraphQLSchema;
  schemaHash: SchemaHash;
  // A store that, when enabled (default), will store the parsed and validated
  // versions of operations in-memory, allowing subsequent parses/validates
  // on the same operation to be executed immediately.
  documentStore?: InMemoryLRUCache<DocumentNode>;
};

type ServerState =
  | { phase: 'initialized'; schemaManager: SchemaManager }
  | {
      phase: 'starting';
      barrier: Resolvable<void>;
      schemaManager: SchemaManager;
    }
  | { phase: 'failed to start'; error: Error; loadedSchema: boolean }
  | {
      phase: 'started';
      schemaManager: SchemaManager;
    }
  | { phase: 'stopping'; barrier: Resolvable<void> }
  | { phase: 'stopped'; stopError: Error | null };

// Throw this in places that should be unreachable (because all other cases have
// been handled, reducing the type of the argument to `never`). TypeScript will
// complain if in fact there is a valid type for the argument.
class UnreachableCaseError extends Error {
  constructor(val: never) {
    super(`Unreachable case: ${val}`);
  }
}

export class ApolloServerBase<
  // The type of the argument to the `context` function for this integration.
  ContextFunctionParams = any,
> {
  private logger: Logger;
  public graphqlPath: string = '/graphql';
  public requestOptions: Partial<GraphQLServerOptions<any>> =
    Object.create(null);

  private context?: Context | ContextFunction<ContextFunctionParams>;
  private apolloConfig: ApolloConfig;
  protected plugins: ApolloServerPlugin[] = [];

  private parseOptions: ParseOptions;
  private config: Config<ContextFunctionParams>;
  private state: ServerState;
  private toDispose = new Set<() => Promise<void>>();
  private toDisposeLast = new Set<() => Promise<void>>();
  private experimental_approximateDocumentStoreMiB: Config['experimental_approximateDocumentStoreMiB'];
  private landingPage: LandingPage | null = null;

  // The constructor should be universal across all environments. All environment specific behavior should be set by adding or overriding methods
  constructor(config: Config<ContextFunctionParams>) {
    if (!config) throw new Error('ApolloServer requires options.');
    this.config = config;
    const {
      context,
      resolvers,
      schema,
      modules,
      typeDefs,
      parseOptions = {},
      introspection,
      mocks,
      mockEntireSchema,
      plugins,
      gateway,
      experimental_approximateDocumentStoreMiB,
      stopOnTerminationSignals,
      apollo,
      ...requestOptions
    } = config;

    // Setup logging facilities
    if (config.logger) {
      this.logger = config.logger;
    } else {
      // If the user didn't provide their own logger, we'll initialize one.
      const loglevelLogger = loglevel.getLogger('apollo-server');

      // We don't do much logging in Apollo Server right now.  There's a notion
      // of a `debug` flag, which changes stack traces in some error messages,
      // and adds a bit of debug logging to some plugins. `info` is primarily
      // used for startup logging in plugins. We'll default to `info` so you
      // get to see that startup logging.
      if (this.config.debug === true) {
        loglevelLogger.setLevel(loglevel.levels.DEBUG);
      } else {
        loglevelLogger.setLevel(loglevel.levels.INFO);
      }

      this.logger = loglevelLogger;
    }

    this.apolloConfig = determineApolloConfig(apollo);

    if (gateway && (modules || schema || typeDefs || resolvers)) {
      throw new Error(
        'Cannot define both `gateway` and any of: `modules`, `schema`, `typeDefs`, or `resolvers`',
      );
    }

    this.parseOptions = parseOptions;
    this.context = context;

    // Allow tests to override process.env.NODE_ENV. As a bonus, this means
    // we're only reading the env var once in the constructor, which is faster
    // than reading it over and over as each read is a syscall. Note that an
    // explicit `__testing_nodeEnv__: undefined` overrides a set environment
    // variable!
    const nodeEnv =
      '__testing_nodeEnv__' in config
        ? config.__testing_nodeEnv__
        : process.env.NODE_ENV;
    const isDev = nodeEnv !== 'production';

    // if this is local dev, introspection should turned on
    // in production, we can manually turn introspection on by passing {
    // introspection: true } to the constructor of ApolloServer
    if (
      (typeof introspection === 'boolean' && !introspection) ||
      (introspection === undefined && !isDev)
    ) {
      const noIntro = [NoIntrospection];
      requestOptions.validationRules = requestOptions.validationRules
        ? requestOptions.validationRules.concat(noIntro)
        : noIntro;
    }

    if (!requestOptions.cache) {
      requestOptions.cache = new InMemoryLRUCache();
    }

    if (requestOptions.persistedQueries !== false) {
      const { cache: apqCache = requestOptions.cache!, ...apqOtherOptions } =
        requestOptions.persistedQueries || Object.create(null);

      requestOptions.persistedQueries = {
        cache: new PrefixingKeyValueCache(apqCache, APQ_CACHE_PREFIX),
        ...apqOtherOptions,
      };
    } else {
      // the user does not want to use persisted queries, so we remove the field
      delete requestOptions.persistedQueries;
    }

    this.requestOptions = requestOptions as GraphQLServerOptions;

    // Plugins will be instantiated if they aren't already, and this.plugins
    // is populated accordingly.
    this.ensurePluginInstantiation(plugins, isDev);

    // We handle signals if it was explicitly requested, or if we're in Node,
    // not in a test, and it wasn't explicitly turned off.
    if (
      typeof stopOnTerminationSignals === 'boolean'
        ? stopOnTerminationSignals
        : isNodeLike && nodeEnv !== 'test'
    ) {
      const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
      let receivedSignal = false;
      signals.forEach((signal) => {
        // Note: Node only started sending signal names to signal events with
        // Node v10 so we can't use that feature here.
        const handler: NodeJS.SignalsListener = async () => {
          if (receivedSignal) {
            // If we receive another SIGINT or SIGTERM while we're waiting
            // for the server to stop, just ignore it.
            return;
          }
          receivedSignal = true;
          try {
            await this.stop();
          } catch (e) {
            this.logger.error(`stop() threw during ${signal} shutdown`);
            this.logger.error(e);
            // Can't rely on the signal handlers being removed.
            process.exit(1);
          }
          // Note: this.stop will call the toDisposeLast handlers below, so at
          // this point this handler will have been removed and we can re-kill
          // ourself to die with the appropriate signal exit status. this.stop
          // takes care to call toDisposeLast last, so the signal handler isn't
          // removed until after the rest of shutdown happens.
          process.kill(process.pid, signal);
        };
        process.on(signal, handler);
        this.toDisposeLast.add(async () => {
          process.removeListener(signal, handler);
        });
      });
    }

    if (gateway) {
      // ApolloServer has been initialized but we have not yet tried to load the
      // schema from the gateway. That will wait until the user calls
      // `server.start()` or `server.listen()`, or (in serverless frameworks)
      // until the `this._start()` call at the end of this constructor.
      this.state = {
        phase: 'initialized',
        schemaManager: new SchemaManager({
          gateway,
          apolloConfig: this.apolloConfig,
          schemaDerivedDataProvider: this.generateSchemaDerivedData.bind(this),
          logger: this.logger,
        }),
      };

      // The main thing that the Gateway does is replace execution with
      // its own executor. It would be awkward if you always had to pass
      // `gateway: gateway, executor: gateway` to this constructor, so
      // we let specifying `gateway` be a shorthand for the above.
      // (We won't actually invoke the executor until after we're successfully
      // called `gateway.load`.)
      this.requestOptions.executor = gateway.executor;
    } else {
      // We construct the schema synchronously so that we can fail fast if the
      // schema can't be constructed. (This used to be more important because we
      // used to have a 'schema' field that was publicly accessible immediately
      // after construction, though that field never actually worked with
      // gateways.)
      this.state = {
        phase: 'initialized',
        schemaManager: new SchemaManager({
          apiSchema: this.maybeAddMocksToConstructedSchema(
            this.constructSchema(),
          ),
          schemaDerivedDataProvider: this.generateSchemaDerivedData.bind(this),
          logger: this.logger,
        }),
      };
    }

    // The main entry point (createHandler) to serverless frameworks generally
    // needs to be called synchronously from the top level of your entry point,
    // unlike (eg) applyMiddleware, so we can't expect you to `await
    // server.start()` before calling it. So we kick off the start
    // asynchronously from the constructor, and failures are logged and cause
    // later requests to fail (in `_ensureStarted`, called by
    // `graphQLServerOptions` and from the serverless framework handlers).
    // There's no way to make "the whole server fail" separately from making
    // individual requests fail, but that's not entirely unreasonable for a
    // "serverless" model.
    if (this.serverlessFramework()) {
      this._start().catch((e) => this.logStartupError(e));
    }
  }

  // Awaiting a call to `start` ensures that a schema has been loaded and that
  // all plugin `serverWillStart` hooks have been called. If either of these
  // processes throw, `start` will (async) throw as well.
  //
  // If you're using the batteries-included `apollo-server` package, you don't
  // need to call `start` yourself (in fact, it will throw if you do so); its
  // `listen` method takes care of that for you (this is why the actual logic is
  // in the `_start` helper).
  //
  // If instead you're using an integration package for a non-serverless
  // framework (like Express), you must await a call to `start` immediately
  // after creating your `ApolloServer`, before attaching it to your web
  // framework and starting to accept requests. `start` should only be called
  // once; if it throws and you'd like to retry, just create another
  // `ApolloServer`. (Calling `start` was optional in Apollo Server 2, but in
  // Apollo Server 3 the methods like `server.applyMiddleware` use
  // `assertStarted` to throw if `start` hasn't successfully completed.)
  //
  // Serverless integrations like Lambda (which override `serverlessFramework()`
  // to return true) do not support calling `start()`, because their lifecycle
  // doesn't allow you to wait before assigning a handler or allowing the
  // handler to be called. So they call `_start()` at the end of the
  // constructor, and don't really differentiate between startup failures and
  // request failures. This is hopefully appropriate for a "serverless"
  // framework. Serverless startup failures result in returning a redacted error
  // to the end user and logging the more detailed error.
  public async start(): Promise<void> {
    if (this.serverlessFramework()) {
      throw new Error(
        'When using an ApolloServer subclass from a serverless framework ' +
          "package, you don't need to call start(); just call createHandler().",
      );
    }

    return await this._start();
  }

  // This is protected so that it can be called from `apollo-server`. It is
  // otherwise an internal implementation detail.
  protected async _start(): Promise<void> {
    if (this.state.phase !== 'initialized') {
      throw new Error(
        `called start() with surprising state ${this.state.phase}`,
      );
    }
    const schemaManager = this.state.schemaManager;
    const barrier = resolvable();
    this.state = {
      phase: 'starting',
      barrier,
      schemaManager,
    };
    let loadedSchema = false;
    try {
      await schemaManager.start();
      this.toDispose.add(async () => {
        await schemaManager.stop();
      });
      loadedSchema = true;

      const schemaDerivedData = schemaManager.getSchemaDerivedData();
      const service: GraphQLServiceContext = {
        logger: this.logger,
        schema: schemaDerivedData.schema,
        schemaHash: schemaDerivedData.schemaHash,
        apollo: this.apolloConfig,
        serverlessFramework: this.serverlessFramework(),
      };

      // The `persistedQueries` attribute on the GraphQLServiceContext was
      // originally used by the operation registry, which shared the cache with
      // it.  This is no longer the case.  However, while we are continuing to
      // expand the support of the interface for `persistedQueries`, e.g. with
      // additions like https://github.com/apollographql/apollo-server/pull/3623,
      // we don't want to continually expand the API surface of what we expose
      // to the plugin API.   In this particular case, it certainly doesn't need
      // to get the `ttl` default value which are intended for APQ only.
      if (this.requestOptions.persistedQueries?.cache) {
        service.persistedQueries = {
          cache: this.requestOptions.persistedQueries.cache,
        };
      }

      const taggedServerListeners = (
        await Promise.all(
          this.plugins.map(async (plugin) => ({
            serverListener:
              plugin.serverWillStart && (await plugin.serverWillStart(service)),
            installedImplicity:
              isImplicitlyInstallablePlugin(plugin) &&
              plugin.__internal_installed_implicitly__,
          })),
        )
      ).filter(
        (
          maybeTaggedServerListener,
        ): maybeTaggedServerListener is {
          serverListener: GraphQLServerListener;
          installedImplicity: boolean;
        } => typeof maybeTaggedServerListener.serverListener === 'object',
      );

      taggedServerListeners.forEach(
        ({ serverListener: { schemaDidLoadOrUpdate } }) => {
          if (schemaDidLoadOrUpdate) {
            try {
              schemaManager.onSchemaLoadOrUpdate(schemaDidLoadOrUpdate);
            } catch (_) {
              // TODO: Once a gateway version providing the core schema to
              //       callbacks has been released, update this message to state
              //       the specific version needed.
              throw new Error(
                [
                  `One of your plugins uses the 'onSchemaLoadOrUpdate' hook,`,
                  `but your gateway version is too old to support this hook.`,
                  `Please update your gateway version to latest.`,
                ].join(' '),
              );
            }
          }
        },
      );

      const serverWillStops = taggedServerListeners.flatMap((l) =>
        l.serverListener.serverWillStop
          ? [l.serverListener.serverWillStop]
          : [],
      );
      if (serverWillStops.length) {
        this.toDispose.add(async () => {
          await Promise.all(
            serverWillStops.map((serverWillStop) => serverWillStop()),
          );
        });
      }

      // Find the renderLandingPage callback, if one is provided. If the user
      // installed ApolloServerPluginLandingPageDisabled then there may be none
      // found. On the other hand, if the user installed a landingPage plugin,
      // then both the implicit installation of
      // ApolloServerPluginLandingPage*Default and the other plugin will be
      // found; we skip the implicit plugin.
      let taggedServerListenersWithRenderLandingPage =
        taggedServerListeners.filter((l) => l.serverListener.renderLandingPage);
      if (taggedServerListenersWithRenderLandingPage.length > 1) {
        taggedServerListenersWithRenderLandingPage =
          taggedServerListenersWithRenderLandingPage.filter(
            (l) => !l.installedImplicity,
          );
      }
      if (taggedServerListenersWithRenderLandingPage.length > 1) {
        throw Error('Only one plugin can implement renderLandingPage.');
      } else if (taggedServerListenersWithRenderLandingPage.length) {
        this.landingPage = await taggedServerListenersWithRenderLandingPage[0]
          .serverListener.renderLandingPage!();
      } else {
        this.landingPage = null;
      }

      this.state = {
        phase: 'started',
        schemaManager,
      };
    } catch (error) {
      this.state = { phase: 'failed to start', error, loadedSchema };
      throw error;
    } finally {
      barrier.resolve();
    }
  }

  // This method is called at the beginning of each GraphQL request by
  // `graphQLServerOptions`. Most of its logic is only helpful for serverless
  // frameworks: unless you're in a serverless framework, you should have called
  // `await server.start()` before the server got to the point of running
  // GraphQL requests (`assertStarted` calls in the framework integrations
  // verify that) and so the only cases for non-serverless frameworks that this
  // should hit are 'started', 'stopping', and 'stopped'. For serverless
  // frameworks, this lets the server wait until fully started before serving
  // operations.
  //
  // It's also called via `ensureStarted` by serverless frameworks so that they
  // can call `renderLandingPage` (or do other things like call a method on a base
  // class that expects it to be started).
  private async _ensureStarted(): Promise<SchemaDerivedData> {
    while (true) {
      switch (this.state.phase) {
        case 'initialized':
          // This error probably won't happen: serverless frameworks
          // automatically call `_start` at the end of the constructor, and
          // other frameworks call `assertStarted` before setting things up
          // enough to make calling this function possible.
          throw new Error(
            'You need to call `server.start()` before using your Apollo Server.',
          );
        case 'starting':
          await this.state.barrier;
          // continue the while loop
          break;
        case 'failed to start':
          // First we log the error that prevented startup (which means it will
          // get logged once for every GraphQL operation).
          this.logStartupError(this.state.error);
          // Now make the operation itself fail.
          // We intentionally do not re-throw actual startup error as it may contain
          // implementation details and this error will propagate to the client.
          throw new Error(
            'This data graph is missing a valid configuration. More details may be available in the server logs.',
          );
        case 'started':
          return this.state.schemaManager.getSchemaDerivedData();
        case 'stopping':
          throw new Error(
            'Cannot execute GraphQL operations while the server is stopping.',
          );
        case 'stopped':
          throw new Error(
            'Cannot execute GraphQL operations after the server has stopped.',
          );
        default:
          throw new UnreachableCaseError(this.state);
      }
    }
  }

  // For serverless frameworks only. Just like `_ensureStarted` but hides its
  // return value.
  protected async ensureStarted() {
    await this._ensureStarted();
  }

  protected assertStarted(methodName: string) {
    if (this.state.phase !== 'started') {
      throw new Error(
        'You must `await server.start()` before calling `server.' +
          methodName +
          '()`',
      );
    }
    // XXX do we need to do anything special for stopping/stopped?
  }

  // Given an error that occurred during Apollo Server startup, log it with a
  // helpful message. This should only happen with serverless frameworks; with
  // other frameworks, you must `await server.start()` which will throw the
  // startup error directly instead of logging (or `await server.listen()` for
  // the batteries-included `apollo-server`).
  private logStartupError(err: Error) {
    this.logger.error(
      'An error occurred during Apollo Server startup. All GraphQL requests ' +
        'will now fail. The startup error was: ' +
        ((err && err.message) || err),
    );
  }

  private constructSchema(): GraphQLSchema {
    const { schema, modules, typeDefs, resolvers, parseOptions } = this.config;
    if (schema) {
      return schema;
    }

    if (modules) {
      const { schema, errors } = buildServiceDefinition(modules);
      if (errors && errors.length > 0) {
        throw new Error(errors.map((error) => error.message).join('\n\n'));
      }
      return schema!;
    }

    if (!typeDefs) {
      throw Error(
        'Apollo Server requires either an existing schema, modules or typeDefs',
      );
    }

    const augmentedTypeDefs = Array.isArray(typeDefs) ? typeDefs : [typeDefs];

    // For convenience, we allow you to pass a few options that we pass through
    // to a particular version of `@graphql-tools/schema`'s
    // `makeExecutableSchema`. If you want to use more of this function's
    // features or have more control over the version of the packages used, just
    // call it yourself like `new ApolloServer({schema:
    // makeExecutableSchema(...)})`.
    return makeExecutableSchema({
      typeDefs: augmentedTypeDefs,
      resolvers,
      parseOptions,
    });
  }

  private maybeAddMocksToConstructedSchema(
    schema: GraphQLSchema,
  ): GraphQLSchema {
    const { mocks, mockEntireSchema } = this.config;
    if (mocks === false) {
      return schema;
    }
    if (!mocks && typeof mockEntireSchema === 'undefined') {
      return schema;
    }
    return addMocksToSchema({
      schema,
      mocks: mocks === true || typeof mocks === 'undefined' ? {} : mocks,
      preserveResolvers:
        typeof mockEntireSchema === 'undefined' ? false : !mockEntireSchema,
    });
  }

  private generateSchemaDerivedData(schema: GraphQLSchema): SchemaDerivedData {
    const schemaHash = generateSchemaHash(schema!);

    // Initialize the document store.  This cannot currently be disabled.
    const documentStore = this.initializeDocumentStore();

    return {
      schema,
      schemaHash,
      documentStore,
    };
  }

  public async stop() {
    // Calling stop more than once should have the same result as the first time.
    if (this.state.phase === 'stopped') {
      if (this.state.stopError) {
        throw this.state.stopError;
      }
      return;
    }

    // Two parallel calls to stop; just wait for the other one to finish and
    // do whatever it did.
    if (this.state.phase === 'stopping') {
      await this.state.barrier;
      // The cast here is because TS doesn't understand that this.state can
      // change during the await
      // (https://github.com/microsoft/TypeScript/issues/9998).
      const state = this.state as ServerState;
      if (state.phase !== 'stopped') {
        throw Error(`Surprising post-stopping state ${state.phase}`);
      }
      if (state.stopError) {
        throw state.stopError;
      }
      return;
    }

    // Commit to stopping, actually stop, and update the phase.
    this.state = { phase: 'stopping', barrier: resolvable() };
    try {
      // We run shutdown handlers in two phases because we don't want to turn
      // off our signal listeners until we've done the important parts of shutdown
      // like running serverWillStop handlers. (We can make this more generic later
      // if it's helpful.)
      await Promise.all([...this.toDispose].map((dispose) => dispose()));
      await Promise.all([...this.toDisposeLast].map((dispose) => dispose()));
    } catch (stopError) {
      this.state = { phase: 'stopped', stopError };
      return;
    }
    this.state = { phase: 'stopped', stopError: null };
  }

  protected serverlessFramework(): boolean {
    return false;
  }

  private ensurePluginInstantiation(
    userPlugins: PluginDefinition[] = [],
    isDev: boolean,
  ): void {
    this.plugins = userPlugins.map((plugin) => {
      if (typeof plugin === 'function') {
        return plugin();
      }
      return plugin;
    });

    const alreadyHavePluginWithInternalId = (id: InternalPluginId) =>
      this.plugins.some(
        (p) => pluginIsInternal(p) && p.__internal_plugin_id__() === id,
      );

    // Special case: cache control is on unless you explicitly disable it.
    {
      if (!alreadyHavePluginWithInternalId('CacheControl')) {
        this.plugins.push(ApolloServerPluginCacheControl());
      }
    }

    // Special case: usage reporting is on by default (and first!) if you
    // configure an API key.
    {
      const alreadyHavePlugin =
        alreadyHavePluginWithInternalId('UsageReporting');
      if (!alreadyHavePlugin && this.apolloConfig.key) {
        if (this.apolloConfig.graphRef) {
          // Keep this plugin first so it wraps everything. (Unfortunately despite
          // the fact that the person who wrote this line also was the original
          // author of the comment above in #1105, they don't quite understand why this was important.)
          this.plugins.unshift(ApolloServerPluginUsageReporting());
        } else {
          this.logger.warn(
            'You have specified an Apollo key but have not specified a graph ref; usage ' +
              'reporting is disabled. To enable usage reporting, set the `APOLLO_GRAPH_REF` ' +
              'environment variable to `your-graph-id@your-graph-variant`. To disable this ' +
              'warning, install `ApolloServerPluginUsageReportingDisabled`.',
          );
        }
      }
    }

    // Special case: schema reporting can be turned on via environment variable.
    {
      const alreadyHavePlugin =
        alreadyHavePluginWithInternalId('SchemaReporting');
      const enabledViaEnvVar = process.env.APOLLO_SCHEMA_REPORTING === 'true';
      if (!alreadyHavePlugin) {
        if (!this.apolloConfig.key) {
          if (enabledViaEnvVar) {
            throw new Error(
              "You've enabled schema reporting by setting the APOLLO_SCHEMA_REPORTING " +
                'environment variable to true, but you also need to provide your ' +
                'Apollo API key, via the APOLLO_KEY environment ' +
                'variable or via `new ApolloServer({apollo: {key})',
            );
          }
        } else if (enabledViaEnvVar) {
          const options: ApolloServerPluginSchemaReportingOptions = {};
          this.plugins.push(ApolloServerPluginSchemaReporting(options));
        }
      }
    }

    // Special case: inline tracing is on by default for federated schemas.
    {
      const alreadyHavePlugin = alreadyHavePluginWithInternalId('InlineTrace');
      if (!alreadyHavePlugin) {
        // If we haven't explicitly disabled inline tracing via
        // ApolloServerPluginInlineTraceDisabled or explicitly installed our own
        // ApolloServerPluginInlineTrace, we set up inline tracing in "only if
        // federated" mode.  (This is slightly different than the
        // pre-ApolloServerPluginInlineTrace where we would also avoid doing
        // this if an API key was configured and log a warning.)
        this.plugins.push(
          ApolloServerPluginInlineTrace({ __onlyIfSchemaIsFederated: true }),
        );
      }
    }

    // Special case: If we're not in production, show our default landing page.
    //
    // This works a bit differently from the other implicitly installed plugins,
    // which rely entirely on the __internal_plugin_id__ to decide whether the
    // plugin takes effect. That's because we want third-party plugins to be
    // able to provide a landing page that overrides the default landing page,
    // without them having to know about __internal_plugin_id__. So unless we
    // actively disable the default landing page with
    // ApolloServerPluginLandingPageDisabled, we install the default landing
    // page, but with a special flag that _start() uses to ignore it if some
    // other plugin defines a renderLandingPage callback. (We can't just look
    // now to see if the plugin defines renderLandingPage because we haven't run
    // serverWillStart yet.)
    const alreadyHavePlugin = alreadyHavePluginWithInternalId(
      'LandingPageDisabled',
    );
    if (!alreadyHavePlugin) {
      const plugin = isDev
        ? ApolloServerPluginLandingPageLocalDefault()
        : ApolloServerPluginLandingPageProductionDefault();
      if (!isImplicitlyInstallablePlugin(plugin)) {
        throw Error(
          'default landing page plugin should be implicitly installable?',
        );
      }
      plugin.__internal_installed_implicitly__ = true;
      this.plugins.push(plugin);
    }
  }

  private initializeDocumentStore(): InMemoryLRUCache<DocumentNode> {
    return new InMemoryLRUCache<DocumentNode>({
      // Create ~about~ a 30MiB InMemoryLRUCache.  This is less than precise
      // since the technique to calculate the size of a DocumentNode is
      // only using JSON.stringify on the DocumentNode (and thus doesn't account
      // for unicode characters, etc.), but it should do a reasonable job at
      // providing a caching document store for most operations.
      maxSize:
        Math.pow(2, 20) * (this.experimental_approximateDocumentStoreMiB || 30),
      sizeCalculator: approximateObjectSize,
    });
  }

  // This function is used by the integrations to generate the graphQLOptions
  // from an object containing the request and other integration specific
  // options
  protected async graphQLServerOptions(
    // We ought to be able to declare this as taking ContextFunctionParams, but
    // that gets us into weird business around inheritance, since a subclass (eg
    // Lambda subclassing Express) may have a different ContextFunctionParams.
    // So it's the job of the subclass's function that calls this function to
    // make sure that its argument properly matches the particular subclass's
    // context params type.
    integrationContextArgument?: any,
  ): Promise<GraphQLServerOptions> {
    const { schema, schemaHash, documentStore } = await this._ensureStarted();

    let context: Context = this.context ? this.context : {};

    try {
      context =
        typeof this.context === 'function'
          ? await this.context(integrationContextArgument || {})
          : context;
    } catch (error) {
      // Defer context error resolution to inside of runQuery
      context = () => {
        throw error;
      };
    }

    return {
      schema,
      schemaHash,
      logger: this.logger,
      plugins: this.plugins,
      documentStore,
      context,
      parseOptions: this.parseOptions,
      ...this.requestOptions,
    };
  }

  /**
   * This method is primarily meant for testing: it allows you to execute a
   * GraphQL operation via the request pipeline without going through without
   * going through the HTTP layer. Note that this means that any handling you do
   * in your server at the HTTP level will not affect this call!
   *
   * For convenience, you can provide `request.query` either as a string or a
   * DocumentNode, in case you choose to use the gql tag in your tests. This is
   * just a convenience, not an optimization (we convert provided ASTs back into
   * string).
   *
   * If you pass a second argument to this method and your ApolloServer's
   * `context` is a function, that argument will be passed directly to your
   * `context` function. It is your responsibility to make it as close as needed
   * by your `context` function to the integration-specific argument that your
   * integration passes to `context` (eg, for `apollo-server-express`, the
   * `{req: express.Request, res: express.Response }` object) and to keep it
   * updated as you upgrade Apollo Server.
   */
  public async executeOperation(
    request: Omit<GraphQLRequest, 'query'> & {
      query?: string | DocumentNode;
    },
    integrationContextArgument?: ContextFunctionParams,
  ) {
    // Since this function is mostly for testing, you don't need to explicitly
    // start your server before calling it. (That also means you can use it with
    // `apollo-server` which doesn't support `start()`.)
    if (this.state.phase === 'initialized') {
      await this._start();
    }

    const options = await this.graphQLServerOptions(integrationContextArgument);

    if (typeof options.context === 'function') {
      options.context = (options.context as () => never)();
    } else if (typeof options.context === 'object') {
      // TODO: We currently shallow clone the context for every request,
      // but that's unlikely to be what people want.
      // We allow passing in a function for `context` to ApolloServer,
      // but this only runs once for a batched request (because this is resolved
      // in ApolloServer#graphQLServerOptions, before runHttpQuery is invoked).
      // NOTE: THIS IS DUPLICATED IN runHttpQuery.ts' buildRequestContext.
      options.context = cloneObject(options.context);
    }

    const requestCtx: GraphQLRequestContext = {
      logger: this.logger,
      schema: options.schema,
      schemaHash: options.schemaHash,
      request: {
        ...request,
        query:
          request.query && typeof request.query !== 'string'
            ? print(request.query)
            : request.query,
      },
      context: options.context || Object.create(null),
      cache: options.cache!,
      metrics: {},
      response: {
        http: {
          headers: new Headers(),
        },
      },
      debug: options.debug,
      overallCachePolicy: newCachePolicy(),
    };

    return processGraphQLRequest(options, requestCtx);
  }

  // This method is called by integrations after start() (because we want
  // renderLandingPage callbacks to be able to take advantage of the context
  // passed to serverWillStart); it returns the LandingPage from the (single)
  // plugin `renderLandingPage` callback if it exists and returns what it
  // returns to the integration. The integration should serve the HTML page when
  // requested with `accept: text/html`. If no landing page is defined by any
  // plugin, returns null. (Specifically null and not undefined; some serverless
  // integrations rely on this to tell the difference between "haven't called
  // renderLandingPage yet" and "there is no landingß page").
  protected getLandingPage(): LandingPage | null {
    this.assertStarted('getLandingPage');

    return this.landingPage;
  }
}

export type ImplicitlyInstallablePlugin = ApolloServerPlugin & {
  __internal_installed_implicitly__: boolean;
};

export function isImplicitlyInstallablePlugin(
  p: ApolloServerPlugin,
): p is ImplicitlyInstallablePlugin {
  return '__internal_installed_implicitly__' in p;
}
