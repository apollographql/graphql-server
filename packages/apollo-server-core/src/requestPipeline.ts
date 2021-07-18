import {
  GraphQLSchema,
  GraphQLFieldResolver,
  specifiedRules,
  DocumentNode,
  getOperationAST,
  ExecutionArgs,
  GraphQLError,
  GraphQLFormattedError,
  validate as graphqlValidate,
  parse as graphqlParse,
  execute as graphqlExecute,
  Kind,
  ParseOptions,
} from 'graphql';
import { DataSource } from 'apollo-datasource';
import { PersistedQueryOptions } from './graphqlOptions';
import {
  symbolExecutionDispatcherWillResolveField,
  enablePluginsForSchemaResolvers,
  symbolUserFieldResolver,
} from './utils/schemaInstrumentation';
import {
  ApolloError,
  fromGraphQLError,
  SyntaxError,
  ValidationError,
  PersistedQueryNotSupportedError,
  PersistedQueryNotFoundError,
  formatApolloErrors,
  UserInputError,
} from 'apollo-server-errors';
import {
  GraphQLRequest,
  GraphQLResponse,
  GraphQLRequestContext,
  GraphQLExecutor,
  GraphQLExecutionResult,
  ValidationRule,
} from 'apollo-server-types';
import {
  ApolloServerPlugin,
  GraphQLRequestListener,
  GraphQLRequestContextDidResolveSource,
  GraphQLRequestContextExecutionDidStart,
  GraphQLRequestContextResponseForOperation,
  GraphQLRequestContextDidResolveOperation,
  GraphQLRequestContextParsingDidStart,
  GraphQLRequestContextValidationDidStart,
  GraphQLRequestContextWillSendResponse,
  GraphQLRequestContextDidEncounterErrors,
  GraphQLRequestExecutionListener,
} from 'apollo-server-plugin-base';

import { Dispatcher } from './utils/dispatcher';
import {
  InMemoryLRUCache,
  KeyValueCache,
  PrefixingKeyValueCache,
} from 'apollo-server-caching';

export { GraphQLRequest, GraphQLResponse, GraphQLRequestContext };

import createSHA from './utils/createSHA';
import { HttpQueryError } from './runHttpQuery';
import { Headers } from 'apollo-server-env';

export const APQ_CACHE_PREFIX = 'apq:';

function computeQueryHash(query: string) {
  return createSHA('sha256').update(query).digest('hex');
}

export interface GraphQLRequestPipelineConfig<TContext> {
  schema: GraphQLSchema;

  rootValue?: ((document: DocumentNode) => any) | any;
  validationRules?: ValidationRule[];
  executor?: GraphQLExecutor;
  fieldResolver?: GraphQLFieldResolver<any, TContext>;

  dataSources?: () => DataSources<TContext>;

  persistedQueries?: PersistedQueryOptions;

  formatError?: (error: GraphQLError) => GraphQLFormattedError;
  formatResponse?: (
    response: GraphQLResponse,
    requestContext: GraphQLRequestContext<TContext>,
  ) => GraphQLResponse | null;

  plugins?: ApolloServerPlugin[];
  documentStore?: InMemoryLRUCache<DocumentNode>;

  parseOptions?: ParseOptions;
}

export type DataSources<TContext> = {
  [name: string]: DataSource<TContext>;
};

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export async function processGraphQLRequest<TContext>(
  config: GraphQLRequestPipelineConfig<TContext>,
  requestContext: Mutable<GraphQLRequestContext<TContext>>,
): Promise<GraphQLResponse> {
  // For legacy reasons, this exported method may exist without a `logger` on
  // the context.  We'll need to make sure we account for that, even though
  // all of our own machinery will certainly set it now.
  const logger = requestContext.logger || console;

  // If request context's `metrics` already exists, preserve it, but _ensure_ it
  // exists there and shorthand it for use throughout this function.
  const metrics = (requestContext.metrics =
    requestContext.metrics || Object.create(null));

  const dispatcher = await initializeRequestListenerDispatcher();
  await initializeDataSources();

  const request = requestContext.request;

  let { query, extensions } = request;

  let queryHash: string;

  let persistedQueryCache: KeyValueCache | undefined;
  metrics.persistedQueryHit = false;
  metrics.persistedQueryRegister = false;

  if (extensions && extensions.persistedQuery) {
    // It looks like we've received a persisted query. Check if we
    // support them.
    if (!config.persistedQueries || !config.persistedQueries.cache) {
      return await sendErrorResponse(new PersistedQueryNotSupportedError());
    } else if (extensions.persistedQuery.version !== 1) {
      return await sendErrorResponse(
        new GraphQLError('Unsupported persisted query version'),
      );
    }

    // We'll store a reference to the persisted query cache so we can actually
    // do the write at a later point in the request pipeline processing.
    persistedQueryCache = config.persistedQueries.cache;

    // This is a bit hacky, but if `config` came from direct use of the old
    // apollo-server 1.0-style middleware (graphqlExpress etc, not via the
    // ApolloServer class), it won't have been converted to
    // PrefixingKeyValueCache yet.
    if (!(persistedQueryCache instanceof PrefixingKeyValueCache)) {
      persistedQueryCache = new PrefixingKeyValueCache(
        persistedQueryCache,
        APQ_CACHE_PREFIX,
      );
    }

    queryHash = extensions.persistedQuery.sha256Hash;

    if (query === undefined) {
      query = await persistedQueryCache.get(queryHash);
      if (query) {
        metrics.persistedQueryHit = true;
      } else {
        return await sendErrorResponse(new PersistedQueryNotFoundError());
      }
    } else {
      const computedQueryHash = computeQueryHash(query);

      // The provided hash must exactly match the SHA-256 hash of
      // the query string. This prevents hash hijacking, where a
      // new and potentially malicious query is associated with
      // an existing hash.
      if (queryHash !== computedQueryHash) {
        return await sendErrorResponse(
          new GraphQLError('provided sha does not match query'),
        );
      }

      // We won't write to the persisted query cache until later.
      // Deferring the writing gives plugins the ability to "win" from use of
      // the cache, but also have their say in whether or not the cache is
      // written to (by interrupting the request with an error).
      metrics.persistedQueryRegister = true;
    }
  } else if (query) {
    // TODO: We'll compute the APQ query hash to use as our cache key for
    // now, but this should be replaced with the new operation ID algorithm.
    queryHash = computeQueryHash(query);
  } else {
    return await sendErrorResponse(
      new GraphQLError(
        'GraphQL operations must contain a non-empty `query` or a `persistedQuery` extension.',
      ),
    );
  }

  requestContext.queryHash = queryHash;
  requestContext.source = query;

  // Let the plugins know that we now have a STRING of what we hope will
  // parse and validate into a document we can execute on.  Unless we have
  // retrieved this from our APQ cache, there's no guarantee that it is
  // syntactically correct, so this string should not be trusted as a valid
  // document until after it's parsed and validated.
  await dispatcher.invokeHook(
    'didResolveSource',
    requestContext as GraphQLRequestContextDidResolveSource<TContext>,
  );

  // If we're configured with a document store (by default, we are), we'll
  // utilize the operation's hash to lookup the AST from the previously
  // parsed-and-validated operation.  Failure to retrieve anything from the
  // cache just means we're committed to doing the parsing and validation.
  if (config.documentStore) {
    try {
      requestContext.document = await config.documentStore.get(queryHash);
    } catch (err) {
      logger.warn(
        'An error occurred while attempting to read from the documentStore. ' +
          (err && err.message) || err,
      );
    }
  }

  // If we still don't have a document, we'll need to parse and validate it.
  // With success, we'll attempt to save it into the store for future use.
  if (!requestContext.document) {
    const parsingDidEnd = await dispatcher.invokeDidStartHook(
      'parsingDidStart',
      requestContext as GraphQLRequestContextParsingDidStart<TContext>,
    );

    try {
      requestContext.document = parse(query, config.parseOptions);
      parsingDidEnd();
    } catch (syntaxError) {
      await parsingDidEnd(syntaxError);
      return await sendErrorResponse(syntaxError, SyntaxError);
    }

    const validationDidEnd = await dispatcher.invokeDidStartHook(
      'validationDidStart',
      requestContext as GraphQLRequestContextValidationDidStart<TContext>,
    );

    const validationErrors = validate(requestContext.document);

    if (validationErrors.length === 0) {
      await validationDidEnd();
    } else {
      await validationDidEnd(validationErrors);
      return await sendErrorResponse(validationErrors, ValidationError);
    }

    if (config.documentStore) {
      // The underlying cache store behind the `documentStore` returns a
      // `Promise` which is resolved (or rejected), eventually, based on the
      // success or failure (respectively) of the cache save attempt.  While
      // it's certainly possible to `await` this `Promise`, we don't care about
      // whether or not it's successful at this point.  We'll instead proceed
      // to serve the rest of the request and just hope that this works out.
      // If it doesn't work, the next request will have another opportunity to
      // try again.  Errors will surface as warnings, as appropriate.
      //
      // While it shouldn't normally be necessary to wrap this `Promise` in a
      // `Promise.resolve` invocation, it seems that the underlying cache store
      // is returning a non-native `Promise` (e.g. Bluebird, etc.).
      Promise.resolve(
        config.documentStore.set(queryHash, requestContext.document),
      ).catch((err) =>
        logger.warn(
          'Could not store validated document. ' + (err && err.message) || err,
        ),
      );
    }
  }

  // TODO: If we want to guarantee an operation has been set when invoking
  // `willExecuteOperation` and executionDidStart`, we need to throw an
  // error here and not leave this to `buildExecutionContext` in
  // `graphql-js`.
  const operation = getOperationAST(
    requestContext.document,
    request.operationName,
  );

  requestContext.operation = operation || undefined;
  // We'll set `operationName` to `null` for anonymous operations.
  requestContext.operationName =
    (operation && operation.name && operation.name.value) || null;

  try {
    await dispatcher.invokeHook(
      'didResolveOperation',
      requestContext as GraphQLRequestContextDidResolveOperation<TContext>,
    );
  } catch (err) {
    return await sendErrorResponse(err);
  }

  // Now that we've gone through the pre-execution phases of the request
  // pipeline, and given plugins appropriate ability to object (by throwing
  // an error) and not actually write, we'll write to the cache if it was
  // determined earlier in the request pipeline that we should do so.
  if (metrics.persistedQueryRegister && persistedQueryCache) {
    // While it shouldn't normally be necessary to wrap this `Promise` in a
    // `Promise.resolve` invocation, it seems that the underlying cache store
    // is returning a non-native `Promise` (e.g. Bluebird, etc.).
    Promise.resolve(
      persistedQueryCache.set(
        queryHash,
        query,
        config.persistedQueries &&
          typeof config.persistedQueries.ttl !== 'undefined'
          ? {
              ttl: config.persistedQueries.ttl,
            }
          : Object.create(null),
      ),
    ).catch(logger.warn);
  }

  let response: GraphQLResponse | null =
    await dispatcher.invokeHooksUntilNonNull(
      'responseForOperation',
      requestContext as GraphQLRequestContextResponseForOperation<TContext>,
    );
  if (response == null) {
    // This execution dispatcher code is duplicated in `pluginTestHarness`
    // right now.

    const executionListeners: GraphQLRequestExecutionListener<TContext>[] = [];
    (
      await dispatcher.invokeHook(
        'executionDidStart',
        requestContext as GraphQLRequestContextExecutionDidStart<TContext>,
      )
    ).forEach((executionListener) => {
      if (executionListener) {
        executionListeners.push(executionListener);
      }
    });
    executionListeners.reverse();

    const executionDispatcher = new Dispatcher(executionListeners);

    // Create a callback that will trigger the execution dispatcher's
    // `willResolveField` hook.  We will attach this to the context on a
    // symbol so it can be invoked by our `wrapField` method during execution.
    const invokeWillResolveField: GraphQLRequestExecutionListener<TContext>['willResolveField'] =
      (...args) =>
        executionDispatcher.invokeSyncDidStartHook('willResolveField', ...args);

    Object.defineProperty(
      requestContext.context,
      symbolExecutionDispatcherWillResolveField,
      { value: invokeWillResolveField },
    );

    // If the user has provided a custom field resolver, we will attach
    // it to the context so we can still invoke it after we've wrapped the
    // fields with `wrapField` within `enablePluginsForSchemaResolvers` of
    // the `schemaInstrumentation` module.
    if (config.fieldResolver) {
      Object.defineProperty(requestContext.context, symbolUserFieldResolver, {
        value: config.fieldResolver,
      });
    }

    // If the schema is already enabled, this is a no-op.  Otherwise, the
    // schema will be augmented so it is able to invoke willResolveField.
    enablePluginsForSchemaResolvers(config.schema);

    try {
      const result = await execute(
        requestContext as GraphQLRequestContextExecutionDidStart<TContext>,
      );

      // The first thing that execution does is coerce the request's variables
      // to the types declared in the operation, which can lead to errors if
      // they are of the wrong type. We change any such errors into
      // UserInputError so that their code doesn't end up being
      // INTERNAL_SERVER_ERROR, since these are client errors.
      const resultErrors = result.errors?.map((e) => {
        if (
          e.nodes?.length === 1 &&
          e.nodes[0].kind === Kind.VARIABLE_DEFINITION &&
          e.message.startsWith(
            `Variable "$${e.nodes[0].variable.name.value}" got invalid value `,
          )
        ) {
          return fromGraphQLError(e, {
            errorClass: UserInputError,
          });
        } else if (
          e.nodes?.length === 1 &&
          e.nodes[0].kind === Kind.VARIABLE_DEFINITION &&
          e.nodes[0].type.kind === Kind.NON_NULL_TYPE &&
          e.nodes[0].type.type.kind === Kind.NAMED_TYPE &&
          e.message.startsWith(
            `Variable "$${e.nodes[0].variable.name.value}" of required type "${e.nodes[0].type.type.name.value}!" was not provided.`,
          )
        ) {
          return fromGraphQLError(e, {
            errorClass: UserInputError,
          });
        } else if (
          e.nodes?.length === 1 &&
          e.nodes[0].kind === Kind.VARIABLE_DEFINITION &&
          e.nodes[0].type.kind === Kind.NON_NULL_TYPE &&
          e.nodes[0].type.type.kind === Kind.NAMED_TYPE &&
          e.message.startsWith(
            `Variable "$${e.nodes[0].variable.name.value}" of non-null type "${e.nodes[0].type.type.name.value}!" must not be null.`,
          )
        ) {
          return fromGraphQLError(e, {
            errorClass: UserInputError,
          });
        }
        return e;
      });

      if (resultErrors) {
        await didEncounterErrors(resultErrors);
      }

      response = {
        ...result,
        errors: resultErrors ? formatErrors(resultErrors) : undefined,
      };

      await executionDispatcher.invokeHook('executionDidEnd');
    } catch (executionError) {
      await executionDispatcher.invokeHook(
        'executionDidEnd',
        executionError,
      );
      return await sendErrorResponse(executionError);
    }
  }

  if (config.formatResponse) {
    const formattedResponse: GraphQLResponse | null = config.formatResponse(
      response,
      requestContext,
    );
    if (formattedResponse != null) {
      response = formattedResponse;
    }
  }

  return sendResponse(response);

  function parse(query: string, parseOptions?: ParseOptions): DocumentNode {
    return graphqlParse(query, parseOptions);
  }

  function validate(document: DocumentNode): ReadonlyArray<GraphQLError> {
    let rules = specifiedRules;
    if (config.validationRules) {
      rules = rules.concat(config.validationRules);
    }

    return graphqlValidate(config.schema, document, rules);
  }

  async function execute(
    requestContext: GraphQLRequestContextExecutionDidStart<TContext>,
  ): Promise<GraphQLExecutionResult> {
    const { request, document } = requestContext;

    const executionArgs: ExecutionArgs = {
      schema: config.schema,
      document,
      rootValue:
        typeof config.rootValue === 'function'
          ? config.rootValue(document)
          : config.rootValue,
      contextValue: requestContext.context,
      variableValues: request.variables,
      operationName: request.operationName,
      fieldResolver: config.fieldResolver,
    };

    if (config.executor) {
      // XXX Nothing guarantees that the only errors thrown or returned
      // in result.errors are GraphQLErrors, even though other code
      // (eg usage reporting) assumes that.
      return await config.executor(requestContext);
    } else {
      return await graphqlExecute(executionArgs);
    }
  }

  async function sendResponse(
    response: GraphQLResponse,
  ): Promise<GraphQLResponse> {
    requestContext.response = {
      ...requestContext.response,
      errors: response.errors,
      data: response.data,
      extensions: response.extensions,
    };
    if (response.http) {
      if (!requestContext.response.http) {
        requestContext.response.http = {
          headers: new Headers(),
        };
      }
      if (response.http.status) {
        requestContext.response.http.status = response.http.status;
      }
      for (const [name, value] of response.http.headers) {
        requestContext.response.http.headers.set(name, value);
      }
    }
    await dispatcher.invokeHook(
      'willSendResponse',
      requestContext as GraphQLRequestContextWillSendResponse<TContext>,
    );
    return requestContext.response;
  }

  // Note that we ensure that all calls to didEncounterErrors are followed by
  // calls to willSendResponse. (The usage reporting plugin depends on this.)
  async function didEncounterErrors(errors: ReadonlyArray<GraphQLError>) {
    requestContext.errors = errors;

    return await dispatcher.invokeHook(
      'didEncounterErrors',
      requestContext as GraphQLRequestContextDidEncounterErrors<TContext>,
    );
  }

  async function sendErrorResponse(
    errorOrErrors: ReadonlyArray<GraphQLError> | GraphQLError,
    errorClass?: typeof ApolloError,
  ) {
    // If a single error is passed, it should still be encapsulated in an array.
    const errors = Array.isArray(errorOrErrors)
      ? errorOrErrors
      : [errorOrErrors];

    await didEncounterErrors(errors);

    const response: GraphQLResponse = {
      errors: formatErrors(
        errors.map((err) =>
          err instanceof ApolloError && !errorClass
            ? err
            : fromGraphQLError(
                err,
                errorClass && {
                  errorClass,
                },
              ),
        ),
      ),
    };

    // Persisted query errors (especially "not found") need to be uncached,
    // because hopefully we're about to fill in the APQ cache and the same
    // request will succeed next time. We also want a 200 response to avoid any
    // error handling that may mask the contents of an error response.
    if (
      errors.every(
        (err) =>
          err instanceof PersistedQueryNotSupportedError ||
          err instanceof PersistedQueryNotFoundError,
      )
    ) {
      response.http = {
        status: 200,
        headers: new Headers({
          'Cache-Control': 'private, no-cache, must-revalidate',
        }),
      };
    } else if (errors.length === 1 && errors[0] instanceof HttpQueryError) {
      response.http = {
        status: errors[0].statusCode,
        headers: new Headers(errors[0].headers),
      };
    }

    return sendResponse(response);
  }

  function formatErrors(
    errors: ReadonlyArray<GraphQLError>,
  ): ReadonlyArray<GraphQLFormattedError> {
    return formatApolloErrors(errors, {
      formatter: config.formatError,
      debug: requestContext.debug,
    });
  }

  async function initializeRequestListenerDispatcher(): Promise<
    Dispatcher<GraphQLRequestListener<TContext>>
  > {
    const requestListeners: GraphQLRequestListener<TContext>[] = [];
    if (config.plugins) {
      for (const plugin of config.plugins) {
        if (!plugin.requestDidStart) continue;
        const listener = await plugin.requestDidStart(requestContext);
        if (listener) {
          requestListeners.push(listener);
        }
      }
    }
    return new Dispatcher(requestListeners);
  }

  async function initializeDataSources() {
    if (config.dataSources) {
      const context = requestContext.context;

      const dataSources = config.dataSources();

      const initializers: any[] = [];
      for (const dataSource of Object.values(dataSources)) {
        if (dataSource.initialize) {
          initializers.push(
            dataSource.initialize({
              context,
              cache: requestContext.cache,
            }),
          );
        }
      }

      await Promise.all(initializers);

      if ('dataSources' in context) {
        throw new Error(
          'Please use the dataSources config option instead of putting dataSources on the context yourself.',
        );
      }

      (context as any).dataSources = dataSources;
    }
  }
}
