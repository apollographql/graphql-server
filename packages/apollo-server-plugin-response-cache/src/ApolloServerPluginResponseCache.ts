import {
  ApolloServerPlugin,
  GraphQLRequestListener,
} from 'apollo-server-plugin-base';
import { GraphQLRequestContext, GraphQLResponse } from 'apollo-server-types';
import { KeyValueCache, PrefixingKeyValueCache } from 'apollo-server-caching';
import type { CacheHint, ValueOrPromise } from 'apollo-server-types';
import { CacheScope } from 'apollo-server-types';

// XXX This should use createSHA from apollo-server-core in order to work on
// non-Node environments. I'm not sure where that should end up ---
// apollo-server-sha as its own tiny module? apollo-server-env seems bad because
// that would add sha.js to unnecessary places, I think?
import { createHash } from 'crypto';

interface Options<TContext = Record<string, any>> {
  // Underlying cache used to save results. All writes will be under keys that
  // start with 'fqc:' and are followed by a fixed-size cryptographic hash of a
  // JSON object with keys representing the query document, operation name,
  // variables, and other keys derived from the sessionId and extraCacheKeyData
  // hooks. If not provided, use the cache in the GraphQLRequestContext instead
  // (ie, the cache passed to the ApolloServer constructor).
  cache?: KeyValueCache;

  // Define this hook if you're setting any cache hints with scope PRIVATE.
  // This should return a session ID if the user is "logged in", or null if
  // there is no "logged in" user.
  //
  // If a cachable response has any PRIVATE nodes, then:
  // - If this hook is not defined, a warning will be logged and it will not be cached.
  // - Else if this hook returns null, it will not be cached.
  // - Else it will be cached under a cache key tagged with the session ID and
  //   mode "private".
  //
  // If a cachable response has no PRIVATE nodes, then:
  // - If this hook is not defined or returns null, it will be cached under a cache
  //   key tagged with the mode "no session".
  // - Else it will be cached under a cache key tagged with the mode
  //   "authenticated public".
  //
  // When reading from the cache:
  // - If this hook is not defined or returns null, look in the cache under a cache
  //   key tagged with the mode "no session".
  // - Else look in the cache under a cache key tagged with the session ID and the
  //   mode "private". If no response is found in the cache, then look under a cache
  //   key tagged with the mode "authenticated public".
  //
  // This allows the cache to provide different "public" results to anonymous
  // users and logged in users ("no session" vs "authenticated public").
  //
  // A common implementation of this hook would be to look in
  // requestContext.request.http.headers for a specific authentication header or
  // cookie.
  //
  // This hook may return a promise because, for example, you might need to
  // validate a cookie against an external service.
  sessionId?(
    requestContext: GraphQLRequestContext<TContext>,
  ): ValueOrPromise<string | null>;

  // Define this hook if you want the cache key to vary based on some aspect of
  // the request other than the query document, operation name, variables, and
  // session ID. For example, responses that include translatable text may want
  // to return a string derived from
  // requestContext.request.http.headers.get('Accept-Language'). The data may
  // be anything that can be JSON-stringified.
  extraCacheKeyData?(
    requestContext: GraphQLRequestContext<TContext>,
  ): ValueOrPromise<any>;

  // If this hook is defined and returns false, the plugin will not read
  // responses from the cache.
  shouldReadFromCache?(
    requestContext: GraphQLRequestContext<TContext>,
  ): ValueOrPromise<boolean>;

  // If this hook is defined and returns false, the plugin will not write the
  // response to the cache.
  shouldWriteToCache?(
    requestContext: GraphQLRequestContext<TContext>,
  ): ValueOrPromise<boolean>;
}

enum SessionMode {
  NoSession,
  Private,
  AuthenticatedPublic,
}

function sha(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

interface BaseCacheKey {
  source: string;
  operationName: string | null;
  variables: { [name: string]: any };
  extra: any;
}

interface ContextualCacheKey {
  sessionMode: SessionMode;
  sessionId?: string | null;
}

interface CacheValue {
  // Note: we only store data responses in the cache, not errors.
  //
  // There are two reasons we don't cache errors. The user-level reason is that
  // we think that in general errors are less cacheable than real results, since
  // they might indicate something transient like a failure to talk to a
  // backend. (If you need errors to be cacheable, represent the erroneous
  // condition explicitly in data instead of out-of-band as an error.) The
  // implementation reason is that this lets us avoid complexities around
  // serialization and deserialization of GraphQL errors, and the distinction
  // between formatted and unformatted errors, etc.
  data: Record<string, any>;
  cachePolicy: Required<CacheHint>;
  cacheTime: number; // epoch millis, used to calculate Age header
}

type CacheKey = BaseCacheKey & ContextualCacheKey;

function cacheKeyString(key: CacheKey) {
  return sha(JSON.stringify(key));
}

function isGraphQLQuery(requestContext: GraphQLRequestContext<any>) {
  return (
    requestContext.operation && requestContext.operation.operation === 'query'
  );
}

export default function plugin(
  options: Options = Object.create(null),
): ApolloServerPlugin {
  return {
    async requestDidStart(
      outerRequestContext: GraphQLRequestContext<any>,
    ): Promise<GraphQLRequestListener<any>> {
      const cache = new PrefixingKeyValueCache(
        options.cache || outerRequestContext.cache!,
        'fqc:',
      );

      let sessionId: string | null = null;
      let baseCacheKey: BaseCacheKey | null = null;
      let age: number | null = null;

      return {
        async responseForOperation(
          requestContext,
        ): Promise<GraphQLResponse | null> {
          requestContext.metrics.responseCacheHit = false;

          if (!isGraphQLQuery(requestContext)) {
            return null;
          }

          async function cacheGet(
            contextualCacheKeyFields: ContextualCacheKey,
          ): Promise<GraphQLResponse | null> {
            const key = cacheKeyString({
              ...baseCacheKey!,
              ...contextualCacheKeyFields,
            });
            const serializedValue = await cache.get(key);
            if (serializedValue === undefined || serializedValue === null) {
              return null;
            }

            const value: CacheValue = JSON.parse(serializedValue);
            // Use cache policy from the cache (eg, to calculate HTTP response
            // headers).
            requestContext.overallCachePolicy.replace(value.cachePolicy);
            requestContext.metrics.responseCacheHit = true;
            age = Math.round((+new Date() - value.cacheTime) / 1000);
            return { data: value.data };
          }

          // Call hooks. Save values which will be used in willSendResponse as well.
          let extraCacheKeyData: any = null;
          if (options.sessionId) {
            sessionId = await options.sessionId(requestContext);
          }
          if (options.extraCacheKeyData) {
            extraCacheKeyData = await options.extraCacheKeyData(requestContext);
          }

          baseCacheKey = {
            source: requestContext.source!,
            operationName: requestContext.operationName,
            // Defensive copy just in case it somehow gets mutated.
            variables: { ...(requestContext.request.variables || {}) },
            extra: extraCacheKeyData,
          };

          // Note that we set up sessionId and baseCacheKey before doing this
          // check, so that we can still write the result to the cache even if
          // we are told not to read from the cache.
          if (options.shouldReadFromCache) {
            const shouldReadFromCache = await options.shouldReadFromCache(
              requestContext,
            );
            if (!shouldReadFromCache) return null;
          }

          if (sessionId === null) {
            return cacheGet({ sessionMode: SessionMode.NoSession });
          } else {
            const privateResponse = await cacheGet({
              sessionId,
              sessionMode: SessionMode.Private,
            });
            if (privateResponse !== null) {
              return privateResponse;
            }
            return cacheGet({ sessionMode: SessionMode.AuthenticatedPublic });
          }
        },

        async willSendResponse(requestContext) {
          const logger = requestContext.logger || console;

          if (!isGraphQLQuery(requestContext)) {
            return;
          }
          if (requestContext.metrics.responseCacheHit) {
            // Never write back to the cache what we just read from it. But do set the Age header!
            const http = requestContext.response.http;
            if (http && age !== null) {
              http.headers.set('age', age.toString());
            }
            return;
          }

          if (options.shouldWriteToCache) {
            const shouldWriteToCache = await options.shouldWriteToCache(
              requestContext,
            );
            if (!shouldWriteToCache) return;
          }

          const { response } = requestContext;
          const { data } = response;
          const policyIfCacheable =
            requestContext.overallCachePolicy.policyIfCacheable();
          if (response.errors || !data || !policyIfCacheable) {
            // This plugin never caches errors or anything without a cache policy.
            //
            // There are two reasons we don't cache errors. The user-level
            // reason is that we think that in general errors are less cacheable
            // than real results, since they might indicate something transient
            // like a failure to talk to a backend. (If you need errors to be
            // cacheable, represent the erroneous condition explicitly in data
            // instead of out-of-band as an error.) The implementation reason is
            // that this lets us avoid complexities around serialization and
            // deserialization of GraphQL errors, and the distinction between
            // formatted and unformatted errors, etc.
            return;
          }

          // We're pretty sure that any path that calls willSendResponse with a
          // non-error response will have already called our execute hook above,
          // but let's just double-check that, since accidentally ignoring
          // sessionId could be a big security hole.
          if (!baseCacheKey) {
            throw new Error(
              'willSendResponse called without error, but execute not called?',
            );
          }

          const cacheSetInBackground = (
            contextualCacheKeyFields: ContextualCacheKey,
          ): void => {
            const key = cacheKeyString({
              ...baseCacheKey!,
              ...contextualCacheKeyFields,
            });
            const value: CacheValue = {
              data,
              cachePolicy: policyIfCacheable,
              cacheTime: +new Date(),
            };
            const serializedValue = JSON.stringify(value);
            // Note that this function converts key and response to strings before
            // doing anything asynchronous, so it can run in parallel with user code
            // without worrying about anything being mutated out from under it.
            //
            // Also note that the test suite assumes that this asynchronous function
            // still calls `cache.set` synchronously (ie, that it writes to
            // InMemoryLRUCache synchronously).
            cache
              .set(key, serializedValue, { ttl: policyIfCacheable.maxAge })
              .catch(logger.warn);
          };

          const isPrivate = policyIfCacheable.scope === CacheScope.Private;
          if (isPrivate) {
            if (!options.sessionId) {
              logger.warn(
                'A GraphQL response used @cacheControl or setCacheHint to set cache hints with scope ' +
                  "Private, but you didn't define the sessionId hook for " +
                  'apollo-server-plugin-response-cache. Not caching.',
              );
              return;
            }
            if (sessionId === null) {
              // Private data shouldn't be cached for logged-out users.
              return;
            }
            cacheSetInBackground({
              sessionId,
              sessionMode: SessionMode.Private,
            });
          } else {
            cacheSetInBackground({
              sessionMode:
                sessionId === null
                  ? SessionMode.NoSession
                  : SessionMode.AuthenticatedPublic,
            });
          }
        },
      };
    },
  };
}
