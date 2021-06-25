import type { Request, Response } from 'apollo-server-env';
import type {
  GraphQLSchema,
  ValidationContext,
  ASTVisitor,
  GraphQLFormattedError,
  OperationDefinitionNode,
  DocumentNode,
  GraphQLError,
  GraphQLResolveInfo,
  GraphQLCompositeType,
} from 'graphql';

// This seems like it could live in this package too.
import type { KeyValueCache } from 'apollo-server-caching';
import type { Trace } from 'apollo-reporting-protobuf';

export type BaseContext = Record<string, any>;

export type ValueOrPromise<T> = T | Promise<T>;
export type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * It is not recommended to use this `AnyFunction` type further.
 *
 * This is a legacy type which aims to do what its name suggests (be the type
 * for _any_ function) but it should be replaced with something from the
 * TypeScript standard lib.  It doesn't truly cover "any" function right now,
 * and in particular doesn't consider `this`.  For now, it has been brought
 * here from the Apollo Server `Dispatcher`, where it was first utilized.
 */
export type AnyFunction = (...args: any[]) => any;

/**
 * A map of `AnyFunction`s which are the interface for our plugin API's
 * request listeners. (e.g. `GraphQLRequestListener`s).
 */
export type AnyFunctionMap = { [key: string]: AnyFunction | undefined };

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

// By default, TypeScript uses structural typing (as opposed to nominal typing)
// Put another way, if it looks like the type and walks like that type, then
// TypeScript lets it be a type.
//
// That's often okay, but it leaves a lot to be desired since a `string` of one
// type can just be passed in as `string` for that type and TypeScript won't
// complain.  Flow offers opaque types which solve this, but TypeScript doesn't
// offer this (yet?).  This Faux-paque type can be used to gain nominal-esque
// typing, which is incredibly beneficial during re-factors!
type Fauxpaque<K, T> = K & { __fauxpaque: T };

export type SchemaHash = Fauxpaque<string, 'SchemaHash'>;

// Configuration for how Apollo Server talks to the Apollo registry, as passed
// to the ApolloServer constructor. Each field can also be provided as an
// environment variable.
export interface ApolloConfigInput {
  // Your Apollo API key. Environment variable: APOLLO_KEY.
  key?: string;
  // The graph ref for your graph, eg `my-graph@my-variant` or `my-graph` to use
  // your graph's default variant. Environment variable: APOLLO_GRAPH_REF. For
  // backwards compatibility, may alternatively specify the ref as graphId and
  // graphVariant separately.
  graphRef?: string;
  // The graph ID of your graph, eg `my-graph`. Environment variable:
  // APOLLO_GRAPH_ID.
  graphId?: string;
  // Your graph's variant name, eg `my-variant`. Environment variable:
  // APOLLO_GRAPH_VARIANT.
  graphVariant?: string;
}

// Configuration for how Apollo Server talks to the Apollo registry, with
// some defaults filled in from the ApolloConfigInput passed to the constructor.
export interface ApolloConfig {
  key?: string;
  keyHash?: string;
  graphRef?: string;
}

export interface GraphQLServiceContext {
  logger: Logger;
  schema: GraphQLSchema;
  schemaHash: SchemaHash;
  apollo: ApolloConfig;
  persistedQueries?: {
    cache: KeyValueCache;
  };
  serverlessFramework: boolean;
}

export interface GraphQLSchemaContext {
  apiSchema: GraphQLSchema;
  coreSupergraphSdl?: string;
}

export interface GraphQLRequest {
  query?: string;
  operationName?: string;
  variables?: VariableValues;
  extensions?: Record<string, any>;
  http?: Pick<Request, 'url' | 'method' | 'headers'>;
}

export type VariableValues = { [name: string]: any };

export interface GraphQLResponse {
  data?: Record<string, any> | null;
  errors?: ReadonlyArray<GraphQLFormattedError>;
  extensions?: Record<string, any>;
  http?: Pick<Response, 'headers'> & Partial<Pick<Mutable<Response>, 'status'>>;
}

export interface GraphQLRequestMetrics {
  captureTraces?: boolean;
  persistedQueryHit?: boolean;
  persistedQueryRegister?: boolean;
  responseCacheHit?: boolean;
  forbiddenOperation?: boolean;
  registeredOperation?: boolean;
  startHrTime?: [number, number];
  queryPlanTrace?: Trace.QueryPlanNode;
}

export interface GraphQLRequestContext<TContext = Record<string, any>> {
  readonly request: GraphQLRequest;
  readonly response?: GraphQLResponse;

  logger: Logger;

  readonly schema: GraphQLSchema;
  readonly schemaHash: SchemaHash;

  readonly context: TContext;
  readonly cache: KeyValueCache;

  readonly queryHash?: string;

  readonly document?: DocumentNode;
  readonly source?: string;

  // `operationName` is set based on the operation AST, so it is defined even if
  // no `request.operationName` was passed in.  It will be set to `null` for an
  // anonymous operation, or if `requestName.operationName` was passed in but
  // doesn't resolve to an operation in the document.
  readonly operationName?: string | null;
  readonly operation?: OperationDefinitionNode;

  /**
   * Unformatted errors which have occurred during the request. Note that these
   * are present earlier in the request pipeline and differ from **formatted**
   * errors which are the result of running the user-configurable `formatError`
   * transformation function over specific errors.
   */
  readonly errors?: ReadonlyArray<GraphQLError>;

  readonly metrics: GraphQLRequestMetrics;

  debug?: boolean;

  readonly overallCachePolicy: CachePolicy;
}

export type ValidationRule = (context: ValidationContext) => ASTVisitor;

export type GraphQLExecutor<TContext = Record<string, any>> = (
  requestContext: GraphQLRequestContextExecutionDidStart<TContext>,
) => Promise<GraphQLExecutionResult>;

export type GraphQLExecutionResult = {
  data?: Record<string, any> | null;
  errors?: ReadonlyArray<GraphQLError>;
  extensions?: Record<string, any>;
};

export type Logger = {
  // Ordered from least-severe to most-severe.
  debug(message?: any): void;
  info(message?: any): void;
  warn(message?: any): void;
  error(message?: any): void;
};

/**
 * This is an object form of the parameters received by typical
 * `graphql-js` resolvers.  The function type is `GraphQLFieldResolver`
 * and normally uses positional parameters.  In order to facilitate better
 * ergonomics in the Apollo Server plugin API, these have been converted to
 * named properties on the object using their names from the upstream
 * `GraphQLFieldResolver` type signature.  Ergonomic wins, in this case,
 * include not needing to have three unused variables in scope just because
 * there was a need to access the `info` property in a wrapped plugin.
 */
export type GraphQLFieldResolverParams<
  TSource,
  TContext,
  TArgs = { [argName: string]: any },
> = {
  source: TSource;
  args: TArgs;
  context: TContext;
  info: GraphQLResolveInfo;
};

export type GraphQLRequestContextDidResolveSource<TContext> = WithRequired<
  GraphQLRequestContext<TContext>,
  'metrics' | 'source' | 'queryHash'
>;
export type GraphQLRequestContextParsingDidStart<TContext> =
  GraphQLRequestContextDidResolveSource<TContext>;
export type GraphQLRequestContextValidationDidStart<TContext> =
  GraphQLRequestContextParsingDidStart<TContext> &
    WithRequired<GraphQLRequestContext<TContext>, 'document'>;
export type GraphQLRequestContextDidResolveOperation<TContext> =
  GraphQLRequestContextValidationDidStart<TContext> &
    WithRequired<
      GraphQLRequestContext<TContext>,
      'operation' | 'operationName'
    >;
export type GraphQLRequestContextDidEncounterErrors<TContext> = WithRequired<
  GraphQLRequestContext<TContext>,
  'metrics' | 'errors'
>;
export type GraphQLRequestContextResponseForOperation<TContext> = WithRequired<
  GraphQLRequestContext<TContext>,
  'metrics' | 'source' | 'document' | 'operation' | 'operationName'
>;
export type GraphQLRequestContextExecutionDidStart<TContext> =
  GraphQLRequestContextParsingDidStart<TContext> &
    WithRequired<
      GraphQLRequestContext<TContext>,
      'document' | 'operation' | 'operationName'
    >;
export type GraphQLRequestContextWillSendResponse<TContext> =
  GraphQLRequestContextDidResolveSource<TContext> &
    WithRequired<GraphQLRequestContext<TContext>, 'metrics' | 'response'>;

/**
 * CacheHint represents a contribution to an overall cache policy. It can
 * specify a maxAge and/or a scope.
 */
export interface CacheHint {
  maxAge?: number;
  scope?: CacheScope;
}

/**
 * CacheAnnotation represents the contents of a `@cacheControl` directive.
 * (`inheritMaxAge` is part of this interface and not CacheHint, because
 * `inheritMaxAge` isn't a contributing piece of a cache policy: it just means
 * to not apply default values in some contexts.)
 */
export interface CacheAnnotation extends CacheHint {
  inheritMaxAge?: true;
}

export enum CacheScope {
  Public = 'PUBLIC',
  Private = 'PRIVATE',
}

/**
 * CachePolicy is a mutable CacheHint with helpful methods for updating its
 * fields.
 */
export interface CachePolicy extends CacheHint {
  /**
   * Mutate this CachePolicy by replacing each field defined in `hint`. This can
   * make the policy more restrictive or less restrictive.
   */
  replace(hint: CacheHint): void;

  /**
   * Mutate this CachePolicy by restricting each field defined in `hint`. This
   * can only make the policy more restrictive: a previously defined `maxAge`
   * can only be reduced, and a previously Private scope cannot be made Public.
   */
  restrict(hint: CacheHint): void;

  /**
   * If this policy has a positive `maxAge`, then return a copy of itself as a
   * `CacheHint` with both fields defined. Otherwise return null.
   */
  policyIfCacheable(): Required<CacheHint> | null;
}

/**
 * When using Apollo Server with the cache control plugin (on by default), an
 * object of this kind is available to resolvers on `info.cacheControl`.
 */
export interface ResolveInfoCacheControl {
  cacheHint: CachePolicy;
  // Shorthand for `cacheHint.replace(hint)`; also for compatibility with
  // the Apollo Server 2.x API.
  setCacheHint(hint: CacheHint): void;

  cacheHintFromType(t: GraphQLCompositeType): CacheHint | undefined;
}

declare module 'graphql/type/definition' {
  interface GraphQLResolveInfo {
    cacheControl: ResolveInfoCacheControl;
  }
}
