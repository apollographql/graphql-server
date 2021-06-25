import {
  AnyFunctionMap,
  BaseContext,
  GraphQLServiceContext,
  GraphQLRequestContext,
  GraphQLRequest,
  GraphQLResponse,
  WithRequired,
  GraphQLFieldResolverParams,
  GraphQLRequestContextDidResolveSource,
  GraphQLRequestContextParsingDidStart,
  GraphQLRequestContextValidationDidStart,
  GraphQLRequestContextDidResolveOperation,
  GraphQLRequestContextDidEncounterErrors,
  GraphQLRequestContextResponseForOperation,
  GraphQLRequestContextExecutionDidStart,
  GraphQLRequestContextWillSendResponse,
  GraphQLSchemaContext,
} from 'apollo-server-types';

// We re-export all of these so plugin authors only need to depend on a single
// package.  The overall concept of `apollo-server-types` and this package
// is that they not depend directly on "core", in order to avoid close
// coupling of plugin support with server versions.  They are duplicated
// concepts right now where one package is intended to be for public plugin
// exposure, while the other (`-types`) is meant to be used internally.
// In the future, `apollo-server-types` and `apollo-server-plugin-base` will
// probably roll into the same "types" package, but that is not today!
export {
  BaseContext,
  GraphQLServiceContext,
  GraphQLRequestContext,
  GraphQLRequest,
  GraphQLResponse,
  WithRequired,
  GraphQLFieldResolverParams,
  GraphQLRequestContextDidResolveSource,
  GraphQLRequestContextParsingDidStart,
  GraphQLRequestContextValidationDidStart,
  GraphQLRequestContextDidResolveOperation,
  GraphQLRequestContextDidEncounterErrors,
  GraphQLRequestContextResponseForOperation,
  GraphQLRequestContextExecutionDidStart,
  GraphQLRequestContextWillSendResponse,
  GraphQLSchemaContext,
};

export interface ApolloServerPlugin<
  TContext extends BaseContext = BaseContext,
> {
  serverWillStart?(
    service: GraphQLServiceContext,
  ): Promise<GraphQLServerListener | void>;

  requestDidStart?(
    requestContext: GraphQLRequestContext<TContext>,
  ): Promise<GraphQLRequestListener<TContext> | void>;
}

export interface GraphQLServerListener {
  schemaDidLoadOrUpdate?(schemaContext: GraphQLSchemaContext): void;

  serverWillStop?(): Promise<void>;

  // At most one plugin's serverWillStart may return a GraphQLServerListener
  // with this method. If one does, it is called once on server startup and the
  // page it returns is served to clients with `accept: text/html` headers. This
  // is an intentionally simple API; if you want to do something fancy to serve
  // a landing page, you probably should just define a handler in your web
  // framework.
  renderLandingPage?(): Promise<LandingPage>;
}

// The page served to clients with `accept: text/html` headers.
export interface LandingPage {
  html: string;
}

export type GraphQLRequestListenerParsingDidEnd = (
  err?: Error,
) => Promise<void>;
export type GraphQLRequestListenerValidationDidEnd = (
  err?: ReadonlyArray<Error>,
) => Promise<void>;
export type GraphQLRequestListenerExecutionDidEnd = (
  err?: Error,
) => Promise<void>;
export type GraphQLRequestListenerDidResolveField = (
  error: Error | null,
  result?: any,
) => void;

export interface GraphQLRequestListener<
  TContext extends BaseContext = BaseContext,
> extends AnyFunctionMap {
  didResolveSource?(
    requestContext: GraphQLRequestContextDidResolveSource<TContext>,
  ): Promise<void>;

  parsingDidStart?(
    requestContext: GraphQLRequestContextParsingDidStart<TContext>,
  ): Promise<GraphQLRequestListenerParsingDidEnd | void>;

  validationDidStart?(
    requestContext: GraphQLRequestContextValidationDidStart<TContext>,
  ): Promise<GraphQLRequestListenerValidationDidEnd | void>;

  didResolveOperation?(
    requestContext: GraphQLRequestContextDidResolveOperation<TContext>,
  ): Promise<void>;

  didEncounterErrors?(
    requestContext: GraphQLRequestContextDidEncounterErrors<TContext>,
  ): Promise<void>;

  // If this hook is defined, it is invoked immediately before GraphQL execution
  // would take place. If its return value resolves to a non-null
  // GraphQLResponse, that result is used instead of executing the query.
  // Hooks from different plugins are invoked in series and the first non-null
  // response is used.
  responseForOperation?(
    requestContext: GraphQLRequestContextResponseForOperation<TContext>,
  ): Promise<GraphQLResponse | null>;

  executionDidStart?(
    requestContext: GraphQLRequestContextExecutionDidStart<TContext>,
  ): Promise<GraphQLRequestExecutionListener | void>;

  willSendResponse?(
    requestContext: GraphQLRequestContextWillSendResponse<TContext>,
  ): Promise<void>;
}

export interface GraphQLRequestExecutionListener<
  TContext extends BaseContext = BaseContext,
> extends AnyFunctionMap {
  executionDidEnd?: GraphQLRequestListenerExecutionDidEnd;
  // willResolveField is not async because we've observed that it already has
  // quite a performance impact on execution even without involving the Promise
  // queue. If we can come up with ways to alleviate the burden (eg having an
  // uninstrumented schema and an instrumented schema and only using the
  // instrumented schema for a subset of operations that need detailed
  // performance traces) we could be happier supporting async willResolveField.
  willResolveField?(
    fieldResolverParams: GraphQLFieldResolverParams<any, TContext>,
  ): GraphQLRequestListenerDidResolveField | void;
}
