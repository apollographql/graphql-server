# CHANGELOG

The version headers in this history reflect the versions of Apollo Server itself.  Versions of other packages (e.g., those which are not actual HTTP integrations; packages not prefixed with "`apollo-server`", or just supporting packages) may use different versions.

🆕 **Please Note!**: 🆕 **The `@apollo/federation` and `@apollo/gateway` packages now live in the [`apollographql/federation`](https://github.com/apollographql/federation) repository.**

- [`@apollo/gateway`](https://github.com/apollographql/federation/blob/HEAD/gateway-js/CHANGELOG.md)
- [`@apollo/federation`](https://github.com/apollographql/federation/blob/HEAD/federation-js/CHANGELOG.md)

## vNEXT

## v3.0.2

- `apollo-server-types`: TypeScript typings for `info.cacheControl` are now added to `GraphQLResolveInfo` as part of `apollo-server-types` rather than a nested file in `apollo-server-core`, and the field now has a named type, `ResolveInfoCacheControl`. [PR #5512](https://github.com/apollographql/apollo-server/pull/5512)
- `apollo-server-micro`: Like the other framework integrations, only serve landing pages from the GraphQL path (`/graphql` by default, configurable via the `path` option to `createHandler`). [PR #5516](https://github.com/apollographql/apollo-server/pull/5516)
- `apollo-server-env`: Remove polyfills of `Object.values`, `Object.entries`, and `util.promisify` which were only required for Node 6 support. Remove `ValueOrPromise` and `WithRequired` TypeScript types that are also provided by `apollo-server-types`. [PR #5515](https://github.com/apollographql/apollo-server/pull/5515)
- `apollo-server-core`/`apollo-server-plugin-base`: Add support for `schemaDidLoadOrUpdate` event hooks, to be specified by the `serverWillStart` event hook. Plugins listening for this event will receive the API schema (and core schema for gateways) when the server's schema is initially loaded and when the server's schema is updated. For more information about this plugin event, see [the plugin event reference documentation](https://www.apollographql.com/docs/apollo-server/integrations/plugins-event-reference/). [PR #5187](https://github.com/apollographql/apollo-server/pull/5187)
- `apollo-server-core`: Add support for schema reporting when using Apollo Gateway. Note that your gateway must be at least version FIXME , or else attempts to enable schema reporting will fail. [PR #5187](https://github.com/apollographql/apollo-server/pull/5187)

## v3.0.1

- `apollo-server-core`: The default `maxAge` (which defaults to 0) for a field should only be applied if no dynamic cache control hint is set. Specifically, if you call the (new in 3.0.0) function `info.cacheControl.cacheHint.restrict({ maxAge: 60 })`, it should set `maxAge` to 60 even if the default max age is lower. (This bug fix is the behavior that was intended for 3.0.0, and primarily affects the behavior of functions added in Apollo Server 3. This does mean that checking `info.cacheControl.cacheHint` now only shows explicitly-set `maxAge` and not the default, but this seems like it will be helpful since it lets you differentiate between the two similar circumstances.) [PR #5492](https://github.com/apollographql/apollo-server/pull/5492)
- `apollo-server-lambda`: Fix TypeScript types for `context` function. (In 3.0.0, the TS types for the `context` function were accidentally inherited from `apollo-server-express` instead of using the correct Lambda-specific types). [PR #5481](https://github.com/apollographql/apollo-server/pull/5481)
- `apollo-server-lambda`, `apollo-server-cloud-functions`: Make the default URL path for handling GraphQL be `/` (ie, handle all requests). This is similar to how these packages work in Apollo Server 2. After this change, `apollo-server` and the serverless integrations have a default URL path of `/` (or ignore the path entirely, in the case of `apollo-server-azure-functions`), and the framework integrations have a default URL path of `/graphql`. This is a backwards-incompatible change from 3.0.1 but minimizes the changes from Apollo Server 2 (and this AS3 change was not intended or documented). [PR #5497](https://github.com/apollographql/apollo-server/pull/5497) [Issue #5462](https://github.com/apollographql/apollo-server/issues/5462)

## v3.0.0

### BREAKING CHANGES

Apollo Server 3 contains quite a few breaking changes. Read our [migration guide](https://www.apollographql.com/docs/apollo-server/migration/) for more details on how to update your app.

#### Bumped dependencies

The minimum versions of these dependencies have been bumped to provide an improved foundation for the development of future features.

- Dropped support for Node.js v6, v8 and v10. Apollo Server 3.x is being compiled to ES2020, which maps to Node.js 12+.
  - Note also that we only test Apollo Server on _even-numbered_ versions of Node.js, and we only aim to support Node.js versions that are under [long-term support](https://nodejs.org/en/about/releases/#releases) from the Node.js Foundation.
- Dropped support for versions of the `graphql` library prior to `15.3.0`.
- The `mocks` option of the `ApolloServer` constructor now uses `@graphql-tools/mock` v7 instead of `graphql-tools` v4, which causes some [breaking changes](https://www.graphql-tools.com/docs/mocking#migration-from-v7-and-below).
  - For example, mock functions no longer receive arguments and cannot return `Promise`s.
  - Note that some parts of the v7 migration guide suggest using the `resolvers` argument to `addMocksToSchema`. Apollo Server does not support this option, but you can call `addMocksToSchema` yourself and pass the result to the `schema` option of the `ApolloServer` constructor.

#### Removed functionality

Certain undersupported and underused Apollo Server features have been removed in favor of current or future methods for achieving similar functionality. Many of these features can be manually re-enabled, as listed below.

- Dropped built-in partial support for subscriptions via the `subscriptions-transport-ws` package.
  - This integration did not support many Apollo Server features, and `subscriptions-transport-ws` has not been actively maintained.
  - To re-enable subscriptions in Apollo Server 3 as they're supported in v2, [see the migration guide](https://www.apollographql.com/docs/apollo-server/migration/#Subscriptions).
  - We hope to provide more deeply integrated subscription support in a future release.
- Dropped built-in support for file uploads via the `graphql-upload` package.
  - To re-enable file uploads in Apollo Server 3 as they're supported in v2, [see the migration guide](https://www.apollographql.com/docs/apollo-server/migration/#File-uploads).
- Dropped support for the `graphql-extensions` API (e.g., `GraphQLExtensions`, `extensions`) in favor of the Apollo Server [plugins API](https://www.apollographql.com/docs/apollo-server/integrations/plugins/).
- Dropped support for passing the `schemaDirectives` option to the `ApolloServer` constructor.
  - This option was passed directly to the `graphql-tools` function `makeExecutableSchema`. To continue using it, you can import `makeExecutableSchema` from `@graphql-tools/schema` and call it yourself:

    ```
    new ApolloServer({
      schema: makeExecutableSchema({
        typeDefs,
        resolvers,
        schemaDirectives
      })
    })
    ```

    Note that `graphql-tools` calls this feature ["legacy" schema directives](https://www.graphql-tools.com/docs/legacy-schema-directives/), and you might want to consider the newer [`schemaTransforms`](https://www.graphql-tools.com/docs/schema-directives/) option instead.
- Removed the deprecated `ApolloServer.schema` field, which never worked with federated gateways.
  - To extract your schema from your server, you can make a plugin with `serverWillStart` or register `onSchemaChange` on your gateway.
- `apollo-datasource-rest`: We no longer officially support overriding the `baseURL` property with a getter, because TypeScript 4 does not allow you to do so.
- Removed the automatic addition of the `@cacheControl` directive to schemas.
  - This directive was added in some circumstances but not in others, which caused confusion.
  - If you use `@cacheControl`, you can [define it in your schema as shown in the docs](https://www.apollographql.com/docs/apollo-server/performance/caching/#in-your-schema-static).
- Removed the `tracing` option passed to the `ApolloServer` constructor. The corresponding `apollo-tracing` package has been deprecated and is no longer being published.
  - This package implemented an inefficient JSON format for execution traces returned via the `tracing` GraphQL response extension. This format was only consumed by the deprecated `engineproxy` and GraphQL Playground.
  - If you rely on this trace format, the old version of `apollo-tracing` should still work:

    ```
    new ApolloServer({
      plugins: [
        require('apollo-tracing').plugin()
      ]
    });
    ```
- Removed a redundant mechanism for applying extensions to an `ApolloError`.
  - Applied extensions are now available only on `error.extensions`, and are not _also_ available on `error` itself.
  - For details, see [#5294](https://github.com/apollographql/apollo-server/pull/5294).
  - Relatedly, the `ForbiddenError` and `AuthenticationError` constructors now allow you to pass additional extensions.
- Removed the `cacheControl` option passed to the `ApolloServer` constructor.
  - By default, Apollo Server continues to calculate an overall cache policy for each operation and sets the `Cache-Control` HTTP header. However, this is now implemented directly inside `apollo-server-core` instead of inside a separate `apollo-cache-control` package (this package has been deprecated and is no longer being published).
  - Setting cache control options like `defaultMaxAge` is now done via the newly exported `ApolloServerPluginCacheControl` plugin, instead of as a top-level constructor option. This follows the same pattern as other built-in plugins like usage reporting.
  - The `CacheHint` and `CacheScope` types are now exported from `apollo-server-types`. The `info.cacheControl.cacheHint` object now has additional methods (`replace`, `restrict`, and `policyIfCacheable`), and its fields update when those methods or `setCacheHint` are called. These methods also exist on `requestContext.overallCachePolicy`, which is always defined and which should not be overwritten (use `replace` instead). There is also a new function `info.cacheControl.cacheHintFromType` available.
  - `@cacheControl` directives on type extensions are no longer ignored. Fields returning union types are now treated similarly to fields returning object and interface types (`@cacheControl` directives on the type are honored, the default `maxAge` is applied to them).
  - New feature: `@cacheControl(inheritMaxAge: true)` when applied to a composite type or a field returning a composite type means that the default `maxAge` is not applied to that field (unless it is a root field).
- Due to conflicts with same/similar globals provided by `@types/supertest` (which we use in our testing), some global TypeScript definitions have been removed from `apollo-server-env` including that of, e.g., `fetch`, `RequestInfo`, `Headers`, `Request`, `Response`, `ResponseInit`, and more.  [See the full list prior to removal here](https://github.com/apollographql/apollo-server/blob/32cfdcfdbd44f4f4e826f347f47fdcbc0475b5cc/packages/apollo-server-env/src/global.d.ts).  Internally in the Apollo Server tests, for the time-being, we are relying on the same-named types from TypeScript's `lib.dom.d.ts` — e.g., [its `RequestInfo` type definition](https://github.com/microsoft/TypeScript/blob/3c604f1c0a412ef41f58c3f9b239b25e8d725751/lib/lib.dom.d.ts#L1470).  For more details, [see PR #5165](https://github.com/apollographql/apollo-server/pull/5165).

- Top-level exports have changed. For example:

  - We no longer re-export the entirety of `graphql-tools` (including `makeExecutableSchema`) from all Apollo Server packages. To continue using them, install [`graphql-tools`](https://www.graphql-tools.com/) or one of its sub-packages yourself.
  - The `Upload` scalar is no longer exported as part of  dropping built-in support for file uploads.
- Stopped publishing the deprecated `apollo-server-testing` package. This package is just a wrapper around `server.executeOperation`, which you can use directly.
- `apollo-server-caching`: The test suite helper works differently, and the `TestableKeyValueCache` interface is removed.
- The `engine` constructor option, `ENGINE_API_KEY` environment variable, and `ENGINE_SCHEMA_TAG` environment variables are no longer supported. Use the `apollo` constructor option, `APOLLO_KEY` environment variable, and `APOLLO_GRAPH_VARIANT` environment variable instead, as described in [the `engine` option migration guide from v2.18)[https://www.apollographql.com/docs/apollo-server/v2/migration-engine-plugins/].
- When you supply an Apollo API key via the `APOLLO_KEY` environment variable or `new ApolloServer({apollo: {key}})`, Apollo Server 3 no longer parses the key to guess your Studio graph ID. You must specify it yourself, either via the `APOLLO_GRAPH_ID` environment variable (or `new ApolloServer({apollo: {graphId}})`), or as a graph ref along with the variant (e.g., `your-graph-id@your-graph-variant`) in the `APOLLO_GRAPH_REF` environment variable (or `new ApolloServer({apollo: {graphRef}})`).

#### Modified functionality

- With one exception, all Apollo Server plugin methods (`requestDidStart`, `didResolveOperation`, etc.) are now `async`.
  - Previously, some of these methods were synchronous, others were `async`, and some were "sometimes-`async`" by returning a `ValueOrPromise`.
  - The exception is `willResolveField`, which remains synchronous. This method is called much more often than any other plugin method, and converting it to `async` might affect performance.
  - In a future release, `willResolveField` might become "sometimes-`async`" by returning a `ValueOrPromise`.
- Apollo Server now always fires the `willSendResponse` plugin lifecycle event after firing `didEncounterError`.
  - In certain error cases (mostly related to automated persisted queries), Apollo Server 2 skips firing `willSendResponse`.
- Renamed the `GraphQLService` interface to `GatewayInterface`.
  - This interface is the type used to provide a federated gateway instance to Apollo Server. Its name has been changed to reduce ambiguity.
  - The previous name is still exported for backward compatibility purposes.
- Added support for serving a custom landing page at Apollo Server's base URL.
  - Plugins can define a new `renderLandingPage` hook that returns an HTML page to serve to browsers.
  - New plugins (`ApolloServerPluginLandingPageProductionDefault` and `ApolloServerPluginLandingPageLocalDefault`) are installed by default (the former when `NODE_ENV` is `production`, the latter otherwise) with instructions on how to communicate with the server, links to Apollo Sandbox, etc.
  - A new `ApolloServerPluginLandingPageGraphQLPlayground` plugin can be installed instead to continue to use GraphQL Playground instead. The `playground` option provided to the `ApolloServer` constructor has been removed; to customize GraphQL Playground you can provide an argument to the new playground plugin. By default, no GraphQL Playground settings are overridden, including the endpoint, which now defaults to `window.location.href` (with most query parameters removed). This means you typically don't have to manually configure the endpoint when using GraphQL Playground.
  - To disable all landing pages, install the new `ApolloServerPluginLandingPageDisabled` plugin.
  - Apollo Server packages no longer export `defaultPlaygroundOptions`, `PlaygroundConfig`, or `PlaygroundRenderPageOptions`.
- Bad request errors (invalid JSON, missing body, etc) are more consistent across integrations and consistently return 4xx status codes instead of sometimes returning 5xx status codes.
- Setting `requestContext.response.http.status` now affects successful GraphQL responses, not just errors.

#### Changes to Node.js framework integrations

- When using a non-serverless framework integration (Express, Fastify, Hapi, Koa, Micro, or Cloudflare), you now *must* call `await server.start()` before attaching the server to your framework.
  * This method was introduced in v2.22 but was optional prior to Apollo Server 3.
  * This requirement does not apply to the `apollo-server` library or to _serverless_ framework integrations.
- `apollo-server-express` no longer officially supports using with the `connect` framework.
  - We have not actively removed any `connect` compatibility code, and we do still test that it works with `connect`. However, we reserve the right to break that compatibility without a major version bump of this package (we will certainly note in this changelog if we do so).
- `apollo-server-lambda`: This package is now implemented as a wrapper around `apollo-server-express`. `createHandler`'s argument now has different options:
  - `expressGetMiddlewareOptions`, which includes options like `cors` and is passed through to `apollo-server-express`'s `getMiddleware`
  - `expressAppFromMiddleware`, which lets you customize HTTP processing

  Also, the `context` function now receives an `express: { req, res }` option in addition to `event` and `context`
- `apollo-server-lambda`: The handler returned by `createHandler` can now only be called as an async function returning a `Promise` (it no longer optionally accepts a callback as the third argument).
  - All current Lambda Node runtimes support this invocation mode (so `exports.handler = server.createHandler()` will keep working without any changes).
  - If you've written your _own_ handler that calls the handler returned by `createHandler` with a callback, you'll need to handle its `Promise` return value instead.
- `apollo-server-lambda`: Improved support for running behind an Application Load Balancer (ALB).
- `apollo-server-fastify` is now compatible with Fastify v3 instead of Fastify v2.
- `apollo-server-hapi` is now only tested with Hapi v20.1.2 and higher (the minimum version that supports Node 16).
- The non-serverless integrations now depend on their corresponding web frameworks via peer dependencies rather than direct dependencies.
- All integrations that allow CORS headers to be customized now default to `access-control-allow-origin: *`. This was already the case for `apollo-server`, Express, Fastify, and Hapi; it is now also the same for Koa (which previously reflected the request's origin), Lambda, Cloud Functions, and Azure Functions as well (which did not set CORS by default). Micro and CloudFlare do not have a built-in way of setting CORS headers.

## v2.25.2

- `apollo-server-express`: Update dependencies on `@types/express` and `@types/express-serve-static-core`. [PR #5352](https://github.com/apollographql/apollo-server/pull/5352)

## v2.25.1

- `apollo-server-core`, `apollo-server-express`: Upgrade `subscriptions-transport-ws` dependency and remove unneeded runtime dependency on `ws`. This should enable you to install Apollo Server without depending on versions of `ws` vulnerable to [CVE-2021-32640](https://www.npmjs.com/advisories/1748). Note that the superficial integration of the unmaintained `subscriptions-transport-ws` package will be removed in Apollo Server 3; you can also avoid this vulnerability by disabling the built-in subscription support with `new ApolloServer({subscriptions: false})` and using a maintained package such as `graphql-ws` instead. (Instead of taking this upgrade, you can also upgrade `ws` to `5.2.3`, which was just released.)

## v2.25.0

- `apollo-server-core`: You may now specify your Studio graph as a graph ref (`id@variant`) via the `APOLLO_GRAPH_REF` environment variable or `new ApolloServer({apollo: {graphRef}})` instead of specifying graph ID and graph variant separately. The `apollo` object passed to plugin `serverWillStart` and to gateway `load` now contains a `graphRef` field.
- `apollo-server-core`: Fix a race condition where schema reporting could lead to a delay at process shutdown. [PR #5222](https://github.com/apollographql/apollo-server/pull/5222)
- `apollo-server-core`: Allow the Fetch API implementation to be overridden for the schema reporting and usage reporting plugins via a new `fetcher` option. [PR #5179](https://github.com/apollographql/apollo-server/pull/5179)
- `apollo-server-core`: The `server.executeOperation` method (designed for testing) can now take its `query` as a `DocumentNode` (eg, a `gql`-tagged string) in addition to as a string. (This matches the behavior of the `apollo-server-testing` `createTestClient` function which is now deprecated.) We now recommend this method instead of `apollo-server-testing` in our docs. [Issue #4952](https://github.com/apollographql/apollo-server/issues/4952)
- `apollo-server-testing`: Replace README with a deprecation notice explaining how to use `server.executeOperation` instead. [Issue #4952](https://github.com/apollographql/apollo-server/issues/4952)

## v2.24.1

- `apollo-server-core`: Fix a typo that could lead to TypeScript compilation when combined with a recent version of `@types/node`. (This bug had no runtime effect.) [PR #5149](https://github.com/apollographql/apollo-server/pull/5149)

## v2.24.0

- `apollo-server-core`: Apollo Studio usage reporting uses a more efficient format which sends fewer detailed traces to Apollo's server. This change should not have a major effect on the experience of using Apollo Studio. [PR #4142](https://github.com/apollographql/apollo-server/pull/4142)

## v2.23.0

- `apollo-server-core`: Add optional argument to `ApolloServer.executeOperation` allowing the caller to manually specify an argument to the `config` function analogous to that provided by integration packages. [PR #4166](https://github.com/apollographql/apollo-server/pull/4166) [Issue #2886](https://github.com/apollographql/apollo-server/issues/2886)
- `apollo-server-cache-redis@1.4.0`: New `BaseRedisCache` class which takes an `ioredis`-compatible Redis client as an argument. The existing classes `RedisCache` and `RedisClusterCache` (which pass their arguments to `ioredis` constructors) are now implemented in terms of this class. This allows you to use any of the `ioredis` constructor forms rather than just the ones recognized by our classes. This also fixes a long-standing bug where the Redis cache implementations returned a number from `delete()`; it now returns a number, matching what the `KeyValueCache` interface and the TypeScript types expect. [PR #5034](https://github.com/apollographql/apollo-server/pull/5034) [PR #5088](https://github.com/apollographql/apollo-server/pull/5088) [Issue #4870](https://github.com/apollographql/apollo-server/issues/4870) [Issue #5006](https://github.com/apollographql/apollo-server/issues/5006)
- `apollo-server-core`: Fix type for `formatResponse` function. It never is called with a `null` argument, and is allowed to return `null`. [Issue #5009](https://github.com/apollographql/apollo-server/issues/5009) [PR #5089](https://github.com/apollographql/apollo-server/pull/5089)
- `apollo-server-lambda`: Fix regression in v2.21.2 where thrown errors were replaced by throwing the JS Error class itself. [PR #5085](https://github.com/apollographql/apollo-server/pull/5085)
- `apollo-server-core`: If a client sends a variable of the wrong type, this is now reported as an error with an `extensions.code` of `BAD_USER_INPUT` rather than `INTERNAL_SERVER_ERROR`. [PR #5091](https://github.com/apollographql/apollo-server/pull/5091) [Issue #3498](https://github.com/apollographql/apollo-server/issues/3498)
- `apollo-server-lambda`: Explicitly support API Gateway `payloadFormatVersion` 2.0. Previously some codepaths did appropriate checks to partially support 2.0 and other codepaths could lead to errors like `event.path.endsWith is not a function` (especially since v2.21.1). Note that this changes the TypeScript typing of the `onHealthCheck` callback passed to `createHandler` to indicate that it can receive either type of event. If you are using TypeScript and care about having a precise typing for the argument to your `onHealthCheck` callback, you should determine which payload format you want to support and write `new ApolloServer<APIGatewayProxyEvent>(...)` or `new ApolloServer<APIGatewayProxyEventV2>(...)` (importing these types from `aws-lambda`), or differentiate between the two formats by checking to see if `'path' in event`. [Issue #5084](https://github.com/apollographql/apollo-server/issues/5084) [Issue #5016](https://github.com/apollographql/apollo-server/issues/5016)

## v2.22.2

- `apollo-server-core`: Fix a regression in v2.22.0 where combining `apollo-server-core` v2.22 with an older version of an integration package could lead to startup errors like `called start() with surprising state invoking serverWillStart`. The fix involves changing the semantics of the protected `willStart` method (which is left in only for backwards compatibility). [Issue #5065](https://github.com/apollographql/apollo-server/issues/5065) [Issue #5066](https://github.com/apollographql/apollo-server/issues/5066) [PR #5073](https://github.com/apollographql/apollo-server/pull/5073)

## v2.22.1

- `apollo-server-core`: Fix a regression in v2.22.0 where startup errors could be thrown as part of the GraphQL response instead of redacted in one edge case. [PR #5064](https://github.com/apollographql/apollo-server/pull/5064)

## v2.22.0

- Improve startup error handling by ensuring that your server has loaded its schema and executed its `serverWillStart` handlers successfully before starting an HTTP server. If you're using the `apollo-server` package, no code changes are necessary. If you're using an integration such as `apollo-server-express` that is not a "serverless framework", you can insert [`await server.start()`](https://www.apollographql.com/docs/apollo-server/api/apollo-server/#start) between `server = new ApolloServer()` and `server.applyMiddleware`. (If you don't call `server.start()` yourself, your server will still work, but the previous behavior of starting a web server that may fail to load its schema still applies.) The serverless framework integrations (Lambda, Azure Functions, and Cloud Functions) do not support this functionality. While the protected method `willStart` still exists for backwards compatibility, you should replace calls to it with `start` or the new protected method `ensureStarting`. [PR #4981](https://github.com/apollographql/apollo-server/pull/4981)

## v2.21.2

- `apollo-server-core`: The `SIGINT` and `SIGTERM` signal handlers installed by default (when not disabled by `stopOnTerminationSignals: false`) now stay active (preventing process termination) while the server shuts down, instead of letting a second signal terminate the process. The handlers still re-signal the process after `this.stop()` concludes. Also, if `this.stop()` throws, the signal handlers will now log and exit 1 instead of throwing an uncaught exception. [Issue #4931](https://github.com/apollographql/apollo-server/issues/4931)
- `apollo-server-lambda`: Refactor the handler returned by `server.createHandler` so that if it is not passed a callback, it acts as an [async handler](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html#nodejs-handler-async) instead of a non-async handler. This means you can wrap it in your own async handler without having to create a callback, and makes the code more maintainable. [Issue #1989](https://github.com/apollographql/apollo-server/issues/1989) [PR #5004](https://github.com/apollographql/apollo-server/pull/5004)

## v2.21.1

- `apollo-server-lambda`: The `onHealthCheck` option did not previously work. Additionally, health checks (with `onHealthCheck` or without) didn't work in all Lambda contexts, such as behind Custom Domains; the path check is now more flexible. [Issue #3999](https://github.com/apollographql/apollo-server/issues/3999) [PR #4969](https://github.com/apollographql/apollo-server/pull/4969) [Issue #4891](https://github.com/apollographql/apollo-server/issues/4891) [PR #4892](https://github.com/apollographql/apollo-server/pull/4892)
- The `debug` option to `new ApolloServer` (which adds stack traces to errors) now affects errors that come from requests executed with `server.executeOperation` (and its wrapper `apollo-server-testing`), instead of just errors that come from requests executed over HTTP. [Issue #4107](https://github.com/apollographql/apollo-server/issues/4107) [PR #4948](https://github.com/apollographql/apollo-server/pull/4948)
- Bump version of `@apollographql/graphql-playground-html` to v1.6.27 and `@apollographql/graphql-playground-react` to v1.7.39 to resolve incorrectly rendered CDN URL when Playground `version` was `false`-y.  [PR #4932](https://github.com/apollographql/apollo-server/pull/4932) [PR #4955](https://github.com/apollographql/apollo-server/pull/4955) [Issue #4937](https://github.com/apollographql/apollo-server/issues/4937)

## v2.21.0

- Apollo Server can now be installed with `graphql@15` without causing peer dependency errors or warnings. (Apollo Server has a [file upload](https://www.apollographql.com/docs/apollo-server/data/file-uploads/) feature which was implemented as a wrapper around the `graphql-upload` package. We have been unable to upgrade our dependency on that package due to backwards-incompatible changes in later versions, and the version we were stuck on did not allow `graphql@15` as a peer dependency. We have now switched to a fork of that old version called `@apollographql/graphql-upload-8-fork` that allows `graphql@15`.) Also bump the `graphql-tools` dependency from 4.0.0 to 4.0.8 for `graphql@15` support. [Issue #4865](https://github.com/apollographql/apollo-server/issues/4865)

## v2.20.0

- `apollo-server`: Previously, `ApolloServer.stop()` functioned like `net.Server.close()` in that it did not close idle connections or close active connections after a grace period. This meant that trying to `await ApolloServer.stop()` could hang indefinitely if there are open connections. Now, this method closes idle connections, and closes active connections after 10 seconds. The grace period can be adjusted by passing the new `stopGracePeriodMillis` option to `new ApolloServer`, or disabled by passing `Infinity` (though it will still close idle connections). Note that this only applies to the "batteries-included" `ApolloServer` in the `apollo-server` package with its own built-in Express and HTTP servers. [PR #4908](https://github.com/apollographql/apollo-server/pull/4908) [Issue #4097](https://github.com/apollographql/apollo-server/issues/4097)
- `apollo-server-core`: When used with `ApolloGateway`, `ApolloServer.stop` now invokes `ApolloGateway.stop`. (This makes sense because `ApolloServer` already invokes `ApolloGateway.load` which is what starts the behavior stopped by `ApolloGateway.stop`.) Note that `@apollo/gateway` 0.23 will expect to be stopped in order for natural program shutdown to occur. [PR #4907](https://github.com/apollographql/apollo-server/pull/4907) [Issue #4428](https://github.com/apollographql/apollo-server/issues/4428)
- `apollo-server-core`: Avoid instrumenting schemas for the old `graphql-extensions` library unless extensions are provided. [PR #4893](https://github.com/apollographql/apollo-server/pull/4893) [Issue #4889](https://github.com/apollographql/apollo-server/issues/4889)
- `apollo-server-plugin-response-cache@0.6.0`: The `shouldReadFromCache` and `shouldWriteToCache` hooks were always documented as returning `ValueOrPromise<boolean>` (ie, that they could be either sync or async), but they actually only worked if they returned a bool. Now they can be either sync or async as intended. [PR #4890](https://github.com/apollographql/apollo-server/pull/4890) [Issue #4886](https://github.com/apollographql/apollo-server/issues/4886)
- `apollo-datasource-rest@0.10.0`: The `RESTDataSource.trace` method is now `protected` instead of `private` to allow more control over logging and metrics. [PR #3940](https://github.com/apollographql/apollo-server/pull/3940)

## v2.19.2

- `apollo-server-express`: types: Export `ExpressContext` from main module. [PR #4821](https://github.com/apollographql/apollo-server/pull/4821) [Issue #3699](https://github.com/apollographql/apollo-server/issues/3699)
- `apollo-server-env`: types: The first parameter to `fetch` is now marked as required, as intended and in accordance with the Fetch API specification. [PR #4822](https://github.com/apollographql/apollo-server/pull/4822) [Issue #4741](https://github.com/apollographql/apollo-server/issues/4741)
- `apollo-server-core`: Update `graphql-tag` package to `latest`, now with its `graphql-js` `peerDependencies` expanded to include `^15.0.0` [PR #4833](https://github.com/apollographql/apollo-server/pull/4833)

## v2.19.1

- `apollo-server-core`: The `debugPrintReports` option to `ApolloServerPluginUsageReporting` now prints traces as well. [PR #4805](https://github.com/apollographql/apollo-server/pull/4805)

## v2.19.0

- `apollo-server-testing`: types: Allow generic `variables` usage of `query` and `mutate` functions. [PR #4383](https://github.com/apollograpqh/apollo-server/pull/4383)
- `apollo-server-express`: Export the `GetMiddlewareOptions` type. [PR #4599](https://github.com/apollograpqh/apollo-server/pull/4599)
- `apollo-server-lambda`: Fix file uploads - ignore base64 decoding for multipart queries. [PR #4506](https://github.com/apollographql/apollo-server/pull/4506)
- `apollo-server-core`: Do not send  operation documents that cannot be executed to Apollo Studio. Instead, information about these operations will be combined into one "operation" for parse failures, one for validation failures, and one for unknown operation names.

## v2.18.2

- `apollo-server-core`: Explicitly include `lru-cache` dependency in `apollo-server-core`'s dependencies. [PR #4600](https://github.com/apollographql/apollo-server/pull/4600)

## v2.18.1

- `apollo-server-core`: Fix support for legacy option `engine: {logger}`, broken in v2.18.0. [PR #4588](https://github.com/apollographql/apollo-server/pull/4588)

- `apollo-server-plugin-base`: The `ApolloServerPlugin` TypeScript type does not need to extend `AnyFunctionMap`, which was an unnecessary change in v2.18.0. [PR #4588](https://github.com/apollographql/apollo-server/pull/4588)

- `apollo-server-core`: Improve a usage reporting error which occurs when you use Apollo Server in an unsupported way. [PR #4588](https://github.com/apollographql/apollo-server/pull/4588)

- `apollo-server-core`: Fix typo in error message for unparsable/invalid schemas provided via `overrideReportedSchema`. [PR #4581](https://github.com/apollographql/apollo-server/pull/4581)

## v2.18.0

- `apollo-server-core`: When Apollo Server is configured with an Apollo API key, the URLs it uses to connect to Apollo's servers have changed. If the environment in which you run your servers requires you to explicitly allow connections by domain, you will need to add the new domain names. Usage reporting previously connected to https://engine-report.apollodata.com/ and now connects to https://usage-reporting.api.apollographql.com/; schema reporting previously connected to https://edge-server-reporting.api.apollographql.com/ and now connects to https://schema-reporting.api.apollographql.com/ . [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- Apollo Server's support for communicating with Apollo’s commercial products has been refactored into three separate plugins exported from `apollo-server-core` (for usage reporting, schema reporting, and inline tracing), configured using the standard `plugins` option. The `engine` option continues to work for backwards compatibility in the 2.x series; support for `engine` will be deprecated in Apollo Server 3.x. Full details are available in [the migration guide](https://www.apollographql.com/docs/apollo-server/v2/migration-engine-plugins/). [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- To consistently support tracing, inline tracing is enabled by default on federated implementing services, even when an Apollo API key is provided.  Previously it was not enabled when an API key was provided. You can disable it with `ApolloServerPluginInlineTraceDisabled`. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- The `apollo-engine-reporting` npm package has been obsoleted and will no longer receive updates. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- The `apollo-engine-reporting-protobuf` package has been renamed to `apollo-reporting-protobuf`.  No new versions of the old package will be published. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- Implementations of `ApolloServer` for serverless frameworks such as Lambda now override the `serverlessFramework()` method to return true.  We have changed our own integrations, but other implementations that extend `ApolloServer` which need this behavior should do the same.  Support for `engine.sendReportsImmediately` will be dropped in Apollo Server 3.x. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- The `GraphQLServiceContext` type passed to the plugin serverWillStart method now contains `apollo` and `serverlessFramework` values. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- `apollo-server-core` / `apollo-server-plugin-base`: The request pipeline plugin API now supports a `serverWillStop` lifecycle hook. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- `apollo-server-core`: Previously, the usage reporting functionality registered one-shot handlers for the `SIGINT` and `SIGTERM` signals, which it used to send one final usage report before re-sending the signal to itself to continue shutdown. These signals handlers were installed by default if you enabled usage or schema reporting, and could be disabled by passing `engine.handleSignals: false`. Now, termination signal handling is the responsibility of Apollo Server as a whole rather than something specific to usage reporting. Apollo Server itself now registers these one-shot signal handlers, which trigger `ApolloServer.stop()`. This allows any plugin that implements the new `serverWillStop` callback to hook into shutdown logic, not just the usage reporting code. Similarly to before, these signal handlers are registered by default but can be disabled by via an option. We've changed the option name to `stopOnTerminationSignals: false` as it is more explicit about the behavior. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- `apollo-server-core`: The default logger implementation (if you don't specify your own `logger` or specify `debug`) now logs at the INFO level instead of the WARN level. The main effect is on a few built-in plugins which log one INFO message at startup; if a custom plugin logs at the INFO level then those messages will be visible by default as well. [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- `apollo-server-core`: Parse and validate any schema passed via `overrideReportedSchema` to the schema reporting plugin, and throw accordingly on unparsable or invalid schemas.

- Using Apollo Server from TypeScript now requires TypeScript 3.8 due to the use of the `import type` and `export type` directives. (If this proves to be a major problem we can revert this choice, but it makes it easier for us to ensure that certain large dependencies are only loaded when needed.) [PR #4453](https://github.com/apollographql/apollo-server/pull/4453)

- Updated `@apollographql/graphql-playground-react` to 1.7.33 to include [an upstream fix](https://github.com/apollographql/graphql-playground/commit/1c102692bfbb717688827204186c15cb92629b3a). [PR #4550](https://github.com/apollographql/apollo-server/pull/4550)

## v2.17.0

- subscriptions: Fix bug which prevented `installSubscriptionHandlers` from accepting a `websocket.Server` (as intended in [PR #1966](https://github.com/apollographql/apollo-server/pull/1966)) and also added support for other `http.Server` variations (e.g., Tls). [Issue #4198](https://github.com/apollographql/apollo-server/issues/4198) [PR #4200](https://github.com/apollographql/apollo-server/pull/4200)

## v2.16.1

- This release only includes patch updates to dependencies.

## v2.16.0

- `apollo-server-fastify`: Pass Fastify's `request` and `reply` objects into the `context` function, which previously had been receiving nothing. [Issue #3156](https://github.com/apollographql/apollo-server/issues/3156) [PR #3895(https://github.com/apollographql/apollo-server/pull/3895)
- `apollo-server-lamdbda`: Automatically decode payloads which are Base64-encoded when the `isBase64Encoded` boolean is present on Lambda `event` payloads. [PR #4311](https://github.com/apollographql/apollo-server/pull/4311)

## v2.15.1

- The default branch of the repository has been changed to `main`.  As this changed a number of references in the repository's `package.json` and `README.md` files (e.g., for badges, links, etc.), this necessitates a release to publish those changes to npm. [PR #4302](https://github.com/apollographql/apollo-server/pull/4302)

## v2.15.0

- `apollo-engine-reporting`: Added a `reportTiming` API to allow trace reporting to be enabled or disabled on a per request basis. The option takes either a boolean or a predicate function that takes a [`GraphQLRequestContextDidResolveOperation`](https://github.com/apollographql/apollo-server/blob/a926b7eedbb87abab2ec70fb03d71743985cb18d/packages/apollo-server-types/src/index.ts#L185-L190) or [`GraphQLRequestContextDidEncounterErrors`](https://github.com/apollographql/apollo-server/blob/a926b7eedbb87abab2ec70fb03d71743985cb18d/packages/apollo-server-types/src/index.ts#L191-L195) and returns a boolean. If the boolean is false the request will not be instrumented for tracing and no trace will be sent to Apollo Graph Manager.  The default is `true` so all traces will get instrumented and sent, which is the same as the previous default behavior. [PR #3918](https://github.com/apollographql/apollo-server/pull/3918)
- `apollo-engine-reporting`: Removed `GraphQLServerOptions.reporting`. It isn't known whether a trace will be reported at the beginning of the request because of the above change. We believe this field was only used internally within Apollo Server; let us know if this is a problem and we can suggest alternatives. Additionally, the field `requestContext.metrics.captureTraces` is now initialized later in the request pipeline.  [PR #3918](https://github.com/apollographql/apollo-server/pull/3918)
- `apollo-engine-reporting`: Make Apollo Server throw if schema reporting is enabled for a gateway or federated service. [PR #4246](https://github.com/apollographql/apollo-server/pull/4246)
- `apollo-engine-reporting`: Remove the `experimental_` prefix from schema reporting options, and specifically rename `experimental_schemaReporting` option name to `reportSchema`. (The old option names remain functional, but are deprecated.) [PR #4236](https://github.com/apollographql/apollo-server/pull/4236)

## v2.14.5

- `apollo-engine-reporting`: Make Apollo Server throw if schema reporting is enabled for a gateway or federated service. [PR #4246](https://github.com/apollographql/apollo-server/pull/4246)

## v2.14.4

- `apollo-engine-reporting`: Add environment variable `APOLLO_SCHEMA_REPORTING` that can enable schema reporting. If `experimental__schemaReporting` is set it will override the environment variable. [PR #4206](https://github.com/apollographql/apollo-server/pull/4206)
- `apollo-engine-reporting`: The schema reporting URL has been changed to use the new dedicated sub-domain `https://edge-server-reporting.api.apollographql.com`. [PR #4232](https://github.com/apollographql/apollo-server/pull/4232)
- `apollo-server-core`: Though Apollo Server **is not affected** due to the way it is integrated, in response to [an upstream security advisory for GraphQL Playground](https://github.com/prisma-labs/graphql-playground/security/advisories/GHSA-4852-vrh7-28rf) we have published [the same patch](https://github.com/prisma-labs/graphql-playground/commit/bf1883db538c97b076801a60677733816cb3cfb7) on our `@apollographql/graphql-playground-html` fork and bumped Apollo Server to use it.  Again, this was done out of an **abundance of caution** since the way that Apollo Server utilizes `renderPlaygroundPage` is _not_ vulnerable as it does not allow per-request Playground configuration that could allow interpolation of user-input. [PR #4231](https://github.com/apollographql/apollo-server/pull/4231)

## v2.14.3

- This release only includes patch updates to dependencies.

## v2.14.2

> **Note:** This release is is related to a GitHub Security Advisory published by the Apollo Server team.  Please read the attached advisory to understand the impact.

- ⚠️ **SECURITY:** Pass all schema validation rules to the subscription server, including validation rules that restrict introspection when introspection is meant to be disabled. **[Read the full GitHub Security Advisory for details](https://github.com/apollographql/apollo-server/security/advisories/GHSA-w42g-7vfc-xf37)**.

## v2.14.1

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/2da65ef9204027e43baedf9ce385bb3794fd0c9b)

- `apollo-server-testing`: Ensure that user-provided context is cloned when using `createTestClient`, per the instructions in the [intergration testing]() section of the Apollo Server documentation.  [Issue #4170](https://github.com/apollographql/apollo-server/issues/4170) [PR #4175](https://github.com/apollographql/apollo-server/pull/4175)

## v2.14.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/d159e320879f594ba2d04036e3e1aa0653ff164d)

- `apollo-server-core` / `apollo-server-plugin-base`: Add support for `willResolveField` and corresponding end-handler within `executionDidStart`.  This brings the remaining bit of functionality that was previously only available from `graphql-extensions` to the new plugin API.  The `graphql-extensions` API (which was never documented) will be deprecated in Apollo Server 3.x.  To see the documentation for the request pipeline API, see [its documentation](https://www.apollographql.com/docs/apollo-server/integrations/plugins/).  For more details, see the attached PR.  [PR #3988](https://github.com/apollographql/apollo-server/pull/3988)
- `apollo-server-core`: Deprecate `graphql-extensions`.  All internal usages of the `graphql-extensions` API have been migrated to the request pipeline plugin API.  For any implementor-supplied `extensions`, a deprecation warning will be printed once per-extension, per-server-startup, notifying of the intention to deprecate.  Extensions should migrate to the plugin API, which is outlined in [its documentation](https://www.apollographql.com/docs/apollo-server/integrations/plugins/). [PR #4135](https://github.com/apollographql/apollo-server/pull/4135)
- `apollo-engine-reporting`: **Currently only for non-federated graphs.**
  Added an _experimental_ schema reporting option,
  `experimental_schemaReporting`, for Apollo Graph Manager users. **During
  this experiment, we'd appreciate testing and feedback from current and new
  users of the schema registry!**

  Prior to the introduction of this feature, the only way to get schemas into
  the schema registry in Apollo Graph Manager was to use the CLI and run
  `apollo schema:push`. _Apollo schema reporting protocol_ is a *new*
  specification for GraphQL servers to automatically report schemas to the
  Apollo Graph Manager schema registry.

  **To enable schema reporting,** provide a Graph Manager API key (available
  free from [Apollo Graph Manager](https://engine.apollographql.com/)) in the
  `APOLLO_KEY` environment variable *and* set the `experimental_schemaReporting`
  option to `true` in the Apollo Server constructor options, like so:

  ```js
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    engine: {
      experimental_schemaReporting: true,
      /* Other existing options can remain the same. */
    },
  });
  ```

  > When enabled, a schema reporter is initiated by the `apollo-engine-reporting` agent.  It will loop until the `ApolloServer` instance is stopped, periodically calling back to Apollo Graph Manager to send information.  The life-cycle of this reporter is managed by the agent.

  For more details on the implementation of this new protocol, see the PR which
  introduced it to Apollo Server and the [preview documentation](https://github.com/apollographql/apollo-schema-reporting-preview-docs).

  [PR #4084](https://github.com/apollographql/apollo-server/pull/4084)
- `apollo-engine-reporting`: The underlying integration of this plugin, which instruments and traces the graph's resolver performance and transmits these metrics to [Apollo Graph Manager](https://engine.apollographql.com/), has been changed from the (soon to be deprecated) `graphql-extensions` API to the new [request pipeline `plugins` API](https://www.apollographql.com/docs/apollo-server/integrations/plugins/). [PR #3998](https://github.com/apollographql/apollo-server/pull/3998)

  _This change should be purely an implementation detail for a majority of users_.  There are, however, some special considerations which are worth noting:

    - The federated tracing plugin's `ftv1` response on `extensions` (which is present on the response from an implementing service to the gateway) is now placed on the `extensions` _after_ the `formatResponse` hook.  Anyone leveraging the `extensions`.`ftv1` data from the `formatResponse` hook will find that it is no longer present at that phase.
- `apollo-tracing`: This package's internal integration with Apollo Server has been switched from using the soon-to-be-deprecated `graphql-extensions` API to using [the request pipeline plugin API](https://www.apollographql.com/docs/apollo-server/integrations/plugins/).  Behavior should remain otherwise the same.  [PR #3991](https://github.com/apollographql/apollo-server/pull/3991)
- `apollo-cache-control`: This package's internal integration with Apollo Server has been switched from using the soon-to-be-deprecated `graphql-extensions` API to using [the request pipeline plugin API](https://www.apollographql.com/docs/apollo-server/integrations/plugins/).  Behavior should remain otherwise the same.  [PR #3997](https://github.com/apollographql/apollo-server/pull/3997)

## v2.13.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/e37384a49b2bf474eed0de3e9f4a1bebaeee64c7)

- Allow passing a `WebSocket.Server` to `ApolloServer.installSubscriptionHandlers`. [PR #2314](https://github.com/apollographql/apollo-server/pull/2314)
- `apollo-server-lambda`: Support file uploads on AWS Lambda [Issue #1419](https://github.com/apollographql/apollo-server/issues/1419) [Issue #1703](https://github.com/apollographql/apollo-server/issues/1703) [PR #3926](https://github.com/apollographql/apollo-server/pull/3926)
- `apollo-engine-reporting`: Fix inadvertant conditional formatting which prevented automated persisted query (APQ) hits and misses from being reported to Apollo Graph Manager. [PR #3986](https://github.com/apollographql/apollo-server/pull/3986)
- `apollo-engine-reporting`: Deprecate the `ENGINE_API_KEY` environment variable in favor of its new name, `APOLLO_KEY`.  Continued use of `ENGINE_API_KEY` will result in deprecation warnings and support for it will be removed in a future major version. [#3923](https://github.com/apollographql/apollo-server/pull/3923)
- `apollo-engine-reporting`: Deprecated the `APOLLO_SCHEMA_TAG` environment variable in favor of its new name, `APOLLO_GRAPH_VARIANT`.  Similarly, within the `engine` configuration object, the `schemaTag` property has been renamed `graphVariant`.  The functionality remains otherwise unchanged, but their new names mirror the name used within Apollo Graph Manager.  Continued use of the now-deprecated names will result in deprecation warnings and support will be dropped completely in the next "major" update.  To avoid misconfiguration, a runtime error will be thrown if _both_ new and deprecated names are set. [PR #3855](https://github.com/apollographql/apollo-server/pull/3855)
- `apollo-engine-reporting-protobuf`: __(This is a breaking change only if you directly depend on `apollo-engine-reporting-protobuf`.)__ Drop legacy fields that were never used by `apollo-engine-reporting`. Added new fields `StatsContext` to allow `apollo-server` to send summary stats instead of full traces, and renamed `FullTracesReport` to `Report` and `Traces` to `TracesAndStats` since reports now can include stats as well as traces.

## v2.12.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/71a3863f59f4ab2c9052c316479d94c6708c4309)

- `apollo-server-core`: Support providing a custom logger implementation (e.g. [`winston`](https://npm.im/winston), [`bunyan`](https://npm.im/bunyan), etc.) to capture server console messages.  Though there has historically been limited output from Apollo Server, some messages are important to capture in the larger context of production logging facilities or can benefit from using more advanced structure, like JSON-based logging.  This also introduces a `logger` property to the `GraphQLRequestContext` that is exposed to plugins, making it possible for plugins to leverage the same server-level logger, and allowing implementors to create request-specific log contexts, if desired.  When not provided, these will still output to `console`. [PR #3894](https://github.com/apollographql/apollo-server/pull/3894)
- `apollo-server-core`: When operating in gateway mode using the `gateway` property of the Apollo Server constructor options, the failure to initialize a schema during initial start-up, e.g. connectivity problems, will no longer result in the federated executor from being assigned when the schema eventually becomes available.  This precludes a state where the gateway may never become available to serve federated requests, even when failure conditions are no longer present. [PR #3811](https://github.com/apollographql/apollo-server/pull/3811)
- `apollo-server-core`: Prevent a condition which prefixed an error message on each request when the initial gateway initialization resulted in a Promise-rejection which was memoized and re-prepended with `Invalid options provided to ApolloServer:` on each request. [PR #3811](https://github.com/apollographql/apollo-server/pull/3811)
- `apollo-server-express`: Disable the automatic inclusion of the `x-powered-by: express` header. [PR #3821](https://github.com/apollographql/apollo-server/pull/3821)
- `apollo-engine-reporting`: Avoid creating new arrays when building trace trees. [PR #3479](https://github.com/apollographql/apollo-server/pull/3479)
- `apollo-server-core`: Bump `graphql` `peerDependencies` range to include `^15.0.0`. [PR #3944](https://github.com/apollographql/apollo-server/pull/3944)

## v2.11.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/056f083ddaf116633e6f759a2b3d69248bb18f66)

- The range of accepted `peerDepedencies` versions for `graphql` has been widened to include `graphql@^15.0.0-rc.2` so as to accommodate the latest release-candidate of the `graphql@15` package, and an intention to support it when it is finally released on the `latest` npm tag.  While this change will subdue peer dependency warnings for Apollo Server packages, many dependencies from outside of this repository will continue to raise similar warnings until those packages own `peerDependencies` are updated.  It is unlikely that all of those packages will update their ranges prior to the final version of `graphql@15` being released, but if everything is working as expected, the warnings can be safely ignored. [PR #3825](https://github.com/apollographql/apollo-server/pull/3825)

## v2.10.1

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/dba97895485d6444535a684d4646f1363954f698)

- `apollo-server-core`: Update GraphQL Playground to latest version to remove a rogue curly-brace appearing in the top-right corner of the interface under certain conditions. [PR #3702](https://github.com/apollographql/apollo-server/pull/3702) [Playground PR](https://github.com/apollographql/graphql-playground/pull/21)
- `apollo-server-core`: Typings: Allow the `cache` property inside `persistedQueries` to be optional.  This was already optional at runtime where it defaults to the top-level global cache when unspecified, but with the introduction of the `ttl` property, it now makes sense that one may be provided without the other. [#3671](https://github.com/apollographql/apollo-server/pull/3671)

## v2.10.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/9c0aa1e661ccc2c5a1471b781102637dd47e21b1)

- `apollo-server-express`: Support `CorsOptionsDelegate` type on `cors` parameter to `applyMiddleware`, to align with the supported type of the underlying [`cors`](https://npm.im/cors) middleware [itself](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/31483b781ac30f98bdf4d40a517e921f2fc2ce37/types/cors/index.d.ts#L32). [#3613](https://github.com/apollographql/apollo-server/pull/3613)
- `apollo-server-core`: Allow asynchronous initialization of datasources: the `initialize` method on datasources may now return a Promise, which will be settled before any resolvers are called. [#3639](https://github.com/apollographql/apollo-server/pull/3639)
- `apollo-server-core`: experimental: Allow configuration of the parsed/validated document store by introducing an `experimental_approximateDocumentStoreMiB` property to the `ApolloServer` constructor options which overrides the default cache size of 30MiB. [#3755](https://github.com/apollographql/apollo-server/pull/3755)

## v2.9.16

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/4d1a75e318897c335674c7ee046c0baec7df4a9b)

- `apollo-server-core`: Update apollo-tooling dependencies, resolve TS build error (missing types for node-fetch) [#3662](https://github.com/apollographql/apollo-server/pull/3662)

## v2.9.15

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/0743d6b2f1737758cf09e80d2086917772bc00c9)

- `apollo-engine-reporting`: Fix regression introduced by [#3614](https://github.com/apollographql/apollo-server/pull/3614) which caused `PersistedQueryNotFoundError`, `PersistedQueryNotSupportedError` and `InvalidGraphQLRequestError` errors to be triggered before the `requestDidStart` handler triggered `treeBuilder`'s `startTiming` method. This fix preserves the existing behavior by special-casing these specific errors.  [#3638](https://github.com/apollographql/apollo-server/pull/3638) fixes [#3627](https://github.com/apollographql/apollo-server/issues/3627)
- `apollo-server-cloud-functions`: Transmit CORS headers on `OPTIONS` request. [#3557](https://github.com/apollographql/apollo-server/pull/3557)
- `apollo-server-caching`: De-compose options interface for `KeyValueCache.prototype.set` to accommodate better TSDoc annotations for its properties (e.g. to specify that `ttl` is defined in _seconds_). [#3619](https://github.com/apollographql/apollo-server/pull/3619)
- `apollo-server-core`, `apollo-server-caching`: Introduce a `ttl` property, specified in seconds, on the options for automated persisted queries (APQ) which applies specific TTL settings to the cache `set`s during APQ registration.  Previously, all APQ cache records were set to 300 seconds.  Additionally, this adds support (to the underlying `apollo-server-caching` mechanisms) for a time-to-live (TTL) value of `null` which, when supported by the cache implementation, skips the assignment of a TTL value altogether.  This allows the cache's controller to determine when eviction happens (e.g. cache forever, and purge least recently used when the cache is full), which may be desireable for network cache stores (e.g. Memcached, Redis). [#3623](https://github.com/apollographql/apollo-server/pull/3623)
- `apollo-server-core`: Upgrade TS to 3.7.3 [#3618](https://github.com/apollographql/apollo-server/pull/3618)

## v2.9.14

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/ad5eac5ea1741142122e4cb8fd34a9748be31e89)

- `apollo-server-core`: Ensure that plugin's `didEncounterErrors` hooks are invoked for known automated persisted query (APQ) errors. [#3614](https://github.com/apollographql/apollo-server/pull/3614)
- `apollo-server-plugin-base`: Move `TContext` generic from `requestDidStart` method to `ApolloServerPlugin` Interface. [#3525](https://github.com/apollographql/apollo-server/pull/3525)

## v2.9.13

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/a0a60e73e04e913d388de8324f7d17e4406deea2)

- `@apollo/gateway`: Add `@types/node-fetch` as a regular dependency to avoid missing dependency for TypeScript consumers. [#3546](https://github.com/apollographql/apollo-server/pull/3546) fixes [#3471](https://github.com/apollographql/apollo-server/issues/3471)
- `apollo-engine-reporting`: Declare acceptable `graphql` versions ranges in `peerDependencies` rather than allowing it to occur implicitly (and less ideally) via its consumers (e.g. most `apollo-server-*` packages). [#3496](https://github.com/apollographql/apollo-server/pull/3496)

## v2.9.12

- Reinstate [#3530](https://github.com/apollographql/apollo-server/pull/3530) via [#3539](https://github.com/apollographql/apollo-server/pull/3539) - after a patch release of the `@apollo/protobufjs` fork, the build issue for consumers should be resolved.

## v2.9.11

- Revert [#3530](https://github.com/apollographql/apollo-server/pull/3530) via [#3535](https://github.com/apollographql/apollo-server/pull/3535)- the introduction of the `@apollo/protobufjs` fork is causing TS errors in consumer projects. Reverting this change for now, and will reintroduce it after the issue is resolved within the forked package.

## v2.9.10

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/2a4c654986a158aaccf947ee56a4bfc48a3173c7)

- `apollo-engine-reporting`: Swap usage of `protobufjs` for a newly published fork located at [`@apollo/protobufjs`](https://npm.im/@apollo/protobufjs). This is to account for the [relative uncertainty](https://github.com/protobufjs/protobuf.js/issues/1199) into the continued on-going maintenance of the official `protobuf.js` project. This should immediately resolve a bug that affected `Long` types in `apollo-engine-reporting` and other non-Apollo projects that rely on `protobuf.js`'s `Long` type. [#3530](https://github.com/apollographql/apollo-server/pull/3530)

## v2.9.9

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/93002737d53dd9a50b473ab9cef14849b3e539aa)

- `apollo-server-core`: Don't try parsing `variables` and `extensions` as JSON if they are defined but empty strings. [#3501](https://github.com/apollographql/apollo-server/pull/3501)
- `apollo-server-lambda`: Introduce `onHealthCheck` on `createHandler` in the same fashion as implemented in other integrations. [#3458](https://github.com/apollographql/apollo-server/pull/3458)
- `apollo-server-core`: Use `graphql`'s `isSchema` to more defensively check the user-specified schema's type at runtime and prevent unexpected errors. [#3462](https://github.com/apollographql/apollo-server/pull/3462)

## v2.9.8

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/3cdde1b7a71ace6411fbacf82a1a61bf737444a6)

- `apollo-server-core`: Provide accurate type for `formatResponse` rather than generic `Function` type. [#3431](https://github.com/apollographql/apollo-server/pull/3431)
- `apollo-server-core`: Pass complete request context to `formatResponse`, rather than just `context`. [#3431](https://github.com/apollographql/apollo-server/pull/3431)

## v2.9.7

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/5d94e986f04457ec17114791ee6db3ece4213dd8)

- `apollo-server-errors`: Fix `ApolloError` bug and `GraphQLError` spec compliance [#3408](https://github.com/apollographql/apollo-server/pull/3408)

## v2.9.6

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/fc7462ec5f8604bd6cba99aa9a377a9b8e045566)

- `@apollo/gateway`, `@apollo/federation`, `apollo-engine-reporting`: Update `apollo-graphql` dependency to bring in [`apollo-tooling`'s #1551](https://github.com/apollographql/apollo-tooling/pull/1551) which resolve runtime errors when its source is minified.  While this fixes a particular minification bug when Apollo Server packages are minified, we _do not_ recommend minification of server code in most cases. [#3387](https://github.com/apollographql/apollo-server/pull/3387) fixes [#3335](https://github.com/apollographql/apollo-server/issues/3335)
- `apollo-server-koa`: Correctly declare dependency on `koa-compose`. [#3356](https://github.com/apollographql/apollo-server/pull/3356)
- `apollo-server-core`: Preserve any `extensions` that have been placed on the response when pre-execution errors occur. [#3394](https://github.com/apollographql/apollo-server/pull/3394)

## v2.9.3

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/a1fbf95fc01739d5cbaa59919149bb85c563fdaa)

- `apollo-server-express`: Add direct dependency on `express` to allow for usage of `express.Router` for `getMiddleware` functionality (from [#2435](https://github.com/apollographql/apollo-server/pull/2435)).  Previously, unlike other server integration packages, `apollo-server-express` did not directly need `express` as a dependency since it only relied on `express` for TypeScript typings. [#3239](https://github.com/apollographql/apollo-server/pull/3239) fixes [#3238](https://github.com/apollographql/apollo-server/issues/3238)
- `apollo-server-lambda`: Add `@types/aws-lambda` as a direct dependency to `apollo-server-express` to allow usage of its typings without needing to separately install it. [#3242](https://github.com/apollographql/apollo-server/pull/3242) fixes [#2351](https://github.com/apollographql/apollo-server/issue/2351)

## v2.9.2

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/92ea402a90bf9817c9b887707abbd77dcf5edcb4)

- `apollo-server-koa`: **Drop support for Node.js v6 within the Apollo Server Koa integration in order to update `koa-bodyparser` dependency from `v3.0.0` to `v4.2.1`.** [#3229](https://github.com/apollographql/apollo-server/pull/3229) fixes [#3050](https://github.com/apollographql/apollo-server/issues/3050)
- `apollo-server-express`: Use explicit return type for new `getMiddleware` method. [#3230](https://github.com/apollographql/apollo-server/pull/3230) (hopefully) fixes [#3222](https://github.com/apollographql/apollo-server/issues/3222)

## v2.9.1

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/029c8dca3af812ee70589cdb6de749df3d2843d8)

- `apollo-server-core`: Make `formatError` available to subscriptions in the same spirit as the existing `formatResponse`. [#2942](https://github.com/apollographql/apollo-server/pull/2942)
- `apollo-engine-reporting`: The behavior of the `engine.maxAttempts` parameter previously did not match its documentation. It is documented as being the max number of attempts *including* the initial attempt, but until this release it was actually the number of retries *excluding* the initial attempt. The behavior has been changed to match the documentation (and the literal reading of the option name). [#3218](https://github.com/apollographql/apollo-server/pull/3218)
- `apollo-engine-reporting`: When sending the report fails with a server-side 5xx error, include the full error from the server in the logs. [#3218](https://github.com/apollographql/apollo-server/pull/3218)
- `apollo-server-core`: Fix regression which prevented the resizing of the schema panel in GraphQL Playground. [#3224](https://github.com/apollographql/apollo-server/pull/3224) and [upstream](https://github.com/apollographql/graphql-playground/pull/19)

## v2.9.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/6037f6e80fdaa53b50b99ae94d93c724c382c23c)

- `apollo-server-express`, `apollo-server-koa`: A new `getMiddleware` method has been introduced, which accepts the same parameters as `applyMiddleware` with the exception of the `app` property.  This allows implementors to obtain the middleware directly and "`use`" it within an existing `app`.  In the near-term, this should ease some of the pain points with the previous technique.  Longer-term, we are exploring what we consider to be a much more natural approach by introducing an "HTTP transport" in Apollo Server 3.x.  See [this proposal issue](https://github.com/apollographql/apollo-server/issues/3184) for more information.  [#2435](https://github.com/apollographql/apollo-server/pull/2435)
- `@apollo/federation`: `buildFederatedSchema`'s `typeDefs` parameter now accepts arrays of `DocumentNode`s (i.e. type definitions wrapped in `gql`) and `resolvers` to make the migration from a single service into a federated service easier for teams previously utilizing this pattern. [#3188](https://github.com/apollographql/apollo-server/pull/3188)

## v2.8.2

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/99f78c6782bce170186ba6ef311182a8c9f281b7)

- `apollo-server-koa`: Update dependency koa to v2.8.1. [PR #3175](https://github.com/apollographql/apollo-server/pull/3175)
- `apollo-server-express`: Update types exported by the ASE package. [PR #3173](https://github.com/apollographql/apollo-server/pull/3175) [PR #3172](https://github.com/apollographql/apollo-server/pull/3172)

## v2.8.1

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/84d80eba10d87663dab60af4a1cd46bccf30513f)

- `apollo-engine-reporting`: Fix reporting errors which have non-array `path` fields (eg, non-GraphQLError errors). [PR #3112](https://github.com/apollographql/apollo-server/pull/3112)
- `apollo-engine-reporting`: Add missing `apollo-server-caching` dependency. [PR #3054](https://github.com/apollographql/apollo-server/pull/3054)
- `apollo-server-hapi`: Revert switch from `accept` and `boom` which took place in v2.8.0. [PR #3089](https://github.com/apollographql/apollo-server/pull/3089)
- `@apollo/gateway`: Change the `setInterval` timer, which is used to continuously check for updates to a federated graph from the Apollo Graph Manager, to be an `unref`'d timer.  Without this change, the server wouldn't terminate properly once polling had started since the event-loop would continue to have unprocessed events on it. [PR #3105](https://github.com/apollographql/apollo-server/pull/3105)
- Switch to using community `@types/graphql-upload` types.
- `apollo-server-fastify`: Change the typing of the HTTP `response` from `OutgoingMessage` to `ServerResponse`. [Commit](https://github.com/apollographql/apollo-server/commit/7638f643fa0445f5f8151ef884da779d85fb954c)
- `apollo-server-hapi`: Pass the `raw` request and response objects to `graphql-upload`s `processRequest` method to align on the same TypeScript types. [Commit](https://github.com/apollographql/apollo-server/commit/8e49b288a6aecd0e134637e64ef4ed751aa8d304)

## v2.8.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/ddeb71f8d6a0f3c91646aa0c7c99d2003b5bf73f)

- `@apollo/federation`: Add support for "value types", which are type definitions which live on multiple services' types, inputs, unions or interfaces.  These common types must be identical by name, kind and field across all services. [PR #3063](https://github.com/apollographql/apollo-server/pull/3063)
- `apollo-server-express`: Use the Express `send` method, rather than calling `net.Socket.prototype.end`. [PR #2842](https://github.com/apollographql/apollo-server/pull/2842)
- `apollo-server-hapi`: Update internal dependencies to use scoped packages `@hapi/accept` and `@hapi/boom`, in place of `accept` and `boom` respectively. [PR #3089](https://github.com/apollographql/apollo-server/pull/3089)

## v2.7.2

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/d0b33f20ba4731c071d6fd8cfaeca1a1f3d83e4b)

- `apollo-engine-reporting`: Fix reporting errors from backend. (The support for federated metrics introduced in v2.7.0 did not properly handle GraphQL errors from the backend; all users of federated metrics should upgrade to this version.) [PR #3056](https://github.com/apollographql/apollo-server/pull/3056) [Issue #3052](https://github.com/apollographql/apollo-server/issues/3052)
- `apollo-engine-reporting`: Clean up `SIGINT` and `SIGTERM` handlers when `EngineReportingAgent` is stopped; fixes 'Possible EventEmitter memory leak detected' log. [PR #3090](https://github.com/apollographql/apollo-server/pull/3090)

## v2.7.1

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/2f87e4af9a6f1e3c8f4c51b4f77860bd3150c8c6)

- `apollo-engine-reporting`: If an error is thrown by a custom variable transform function passed into the reporting option `sendVariableValues: { transform: ... }`, all variable values will be replaced with the string `[PREDICATE_FUNCTION_ERROR]`.
- `apollo-server-express`: Typing fix for the `connection` property, which was missing from the `ExpressContext` interface.  [PR #2959](https://github.com/apollographql/apollo-server/pull/2959)
- `@apollo/gateway`: Ensure execution of correct document within multi-operation documents by including the `operationName` in the cache key used when caching query plans used in federated execution. [PR #3084](https://github.com/apollographql/apollo-server/pull/3084)

## v2.7.0

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/1d44f3d4756d43123eb01bf293e65f4a3c2e64c8)

- `apollo-engine-reporting`: **Behavior change**: By default, send no GraphQL variable values to Apollo's servers instead of sending all variable values. Adding the new EngineReportingOption `sendVariableValues` to send some or all variable values, possibly after transforming them. This replaces the `privateVariables` option, which is now deprecated. [PR #2931](https://github.com/apollographql/apollo-server/pull/2931)

  To maintain the previous behavior of transmitting **all** GraphQL variable values, unfiltered, to Apollo Engine, configure `engine`.`sendVariableValues` as follows:

  ```js
  engine: {
    sendVariableValues: { all: true }
  }
  ```
- `apollo-engine-reporting`: **Behavior change**: By default, send no GraphQL request headers and values to Apollo's servers instead of sending all. Adding the new EngineReportingOption `sendHeaders` to send some or all header values. This replaces the `privateHeaders` option, which is now deprecated. [PR #2931](https://github.com/apollographql/apollo-server/pull/2931)

   To maintain the previous behavior of transmitting  **all** GraphQL request headers and values, configure `engine`.`sendHeaders` as following:
     ```js
     engine: {
       sendHeaders: { all: true }
     }
     ```
- `apollo-engine-reporting`: **Behavior change**: If the error returned from the `engine.rewriteError` hook has an `extensions` property, that property will be used instead of the original error's extensions. Document that changes to most other `GraphQLError` fields by `engine.rewriteError` are ignored. [PR #2932](https://github.com/apollographql/apollo-server/pull/2932)
- `apollo-engine-reporting`: **Behavior change**: The `engine.maskErrorDetails` option, deprecated by `engine.rewriteError` in v2.5.0, now behaves a bit more like the new option: while all error messages will be redacted, they will still show up on the appropriate nodes in a trace. [PR #2932](https://github.com/apollographql/apollo-server/pull/2932)
- `apollo-server-core`, `@apollo/gateway`: **Introduced managed federation support**.  For more information on managed federation, see [the blog post](https://blog.apollographql.com/announcing-managed-federation-265c9f0bc88e) or jump to the [documentation for managed federation](https://www.apollographql.com/docs/platform/federation/).
- `@apollo/gateway@0.7.1`: Don't print a warning about an unspecified "graph variant" (previously, and in many ways still, known as "schema tag") every few seconds.  We do highly recommend specifying one when using the Apollo Platform features though! [PR #3043](https://github.com/apollographql/apollo-server/pull/3043)
- `graphql-playground`: Update to resolve incorrect background color on tabs when using the `light` theme. [PR #2989](https://github.com/apollographql/apollo-server/pull/2989) [Issue #2979](https://github.com/apollographql/apollo-server/issues/2979)
- `graphql-playground`: Fix "Query Planner" and "Tracing" panels which were off the edge of the viewport.
- `apollo-server-plugin-base`: Fix `GraphQLRequestListener` type definitions to allow `return void`. [PR #2368](https://github.com/apollographql/apollo-server/pull/2368)

## v2.6.7

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/183de5f112324def375a45c239955e1bf1608fae)

- `apollo-server-core`: Guard against undefined property access in `isDirectiveDefined` which resulted in "Cannot read property 'some' of undefined" error. [PR #2924](https://github.com/apollographql/apollo-server/pull/2924) [Issue #2921](https://github.com/apollographql/apollo-server/issues/2921)

## v2.6.6

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/26db63cbd5adf54b07a5b67c0e0fbff8e61c79aa)

- `apollo-server-core`: Avoid duplicate `cacheControl` directives being added via `isDirectiveDefined`, re-landing the implementation reverted in v2.6.1 which first surfaced in v2.6.0. [PR #2762](https://github.com/apollographql/apollo-server/pull/2762) [Reversion PR #2754](https://github.com/apollographql/apollo-server/pull/2754) [Original PR #2428](https://github.com/apollographql/apollo-server/pull/2428)
- `apollo-server-testing`: Add TypeScript types for `apollo-server-testing` client. [PR #2871](https://github.com/apollographql/apollo-server/pull/2871)
- `apollo-server-plugin-response-cache`: Fix undefined property access attempt which occurred when an incomplete operation was received. [PR #2792](https://github.com/apollographql/apollo-server/pull/2792) [Issue #2745](https://github.com/apollographql/apollo-server/issues/2745)

## v2.6.5

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/a2b2a0d8f013826d08433129a69834035e04f1d5)

- `apollo-engine-reporting`: Simplify the technique for capturing `operationName`. [PR #2899](https://github.com/apollographql/apollo-server/pull/2899)
- `apollo-server-core`: Fix regression in 2.6.0 which caused `engine: false` not to disable Engine when the `ENGINE_API_KEY` environment variable was set. [PR #2850](https://github.com/apollographql/apollo-server/pull/2850)
- `@apollo/federation`: Introduced a `README.md`. [PR #2883](https://github.com/apollographql/apollo-server/pull/2883)
- `@apollo/gateway`: Introduced a `README.md`. [PR #2883](https://github.com/apollographql/apollo-server/pull/2883)

## v2.6.4

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/596e2f20e090d2f860d238058118d860a72b3be4)

- `@apollo/gateway`: Pass `context` through to the `graphql` command in `LocalGraphQLDataSource`'s `process` method. [PR #2821](https://github.com/apollographql/apollo-server/pull/2821)
- `@apollo/gateway`: Fix gateway not sending needed variables for subqueries not at the root level. [PR #2867](https://github.com/apollographql/apollo-server/pull/2867)
- `@apollo/federation`: Allow matching enums/scalars in separate services and validate that enums have matching values. [PR #2829](https://github.com/apollographql/apollo-server/pull/2829).
- `@apollo/federation`: Strip `@external` fields from interface extensions. [PR #2848](https://github.com/apollographql/apollo-server/pull/2848)
- `@apollo/federation`: Add support for list type keys in federation. [PR #2841](https://github.com/apollographql/apollo-server/pull/2841)
- `@apollo/federation`: Deduplicate variable definitions for sub-queries. [PR #2840](https://github.com/apollographql/apollo-server/pull/2840)

## v2.6.3

> [See complete versioning details.](https://github.com/apollographql/apollo-server/commit/bdf634d4884774fa81fb22475aa4bd8178025762)

- `apollo-engine-reporting`: Set `forbiddenOperation` and `registeredOperation` later in the request lifecycle. [PR #2828](https://github.com/apollographql/apollo-server/pull/2828)
- `apollo-server-core`: Add `queryHash` to `GraphQLExecutor` for federation. [PR #2822](https://github.com/apollographql/apollo-server/pull/2822)
- `@apollo/federation`: Preserve descriptions from SDL of federated services. [PR #2830](https://github.com/apollographql/apollo-server/pull/2830)

## v2.6.2

- `apollo-engine-reporting-protobuf`: Update protobuf to include `forbiddenOperations` and `registeredOperations`. [PR #2768](https://github.com/apollographql/apollo-server/pull/2768)
- `apollo-server-core`: Add `forbiddenOperation` and `registeredOperation` to `GraphQLRequestMetrics` type. [PR #2768](https://github.com/apollographql/apollo-server/pull/2768)
- `apollo-engine-reporting`: Set `forbiddenOperation` and `registeredOperation` on trace if the field is true on `requestContext.metrics`. [PR #2768](https://github.com/apollographql/apollo-server/pull/2768)
- `apollo-server-lambda`: Remove `Object.fromEntries` usage. [PR #2787](https://github.com/apollographql/apollo-server/pull/2787)

## v2.6.1

- Revert: Don't add `cacheControl` directive if one has already been defined. Presently, although the TypeScript don't suggest it, passing a `String` as `typeDefs` to `ApolloServer` is supported and this would be a breaking change for non-TypeScript users. [PR #2428](https://github.com/apollographql/apollo-server/pull/2428)

## v2.6.0

- `apollo-server-core`: Introduce new `didEncounterErrors` life-cycle hook which has access to unformatted `errors` property on the `requestContext`, which is the first positional parameter that this new request life-cycle receives.  [PR #2719](https://github.com/apollographql/apollo-server/pull/2719)
- `apollo-server-core`: Allow request pipeline life-cycle hooks (i.e. plugins) to modify the response's `http.status` code (an integer) in the event of an error.  When combined with the new `didEncounterErrors` life-cycle hook (see above), this will allow modifying the HTTP status code in the event of an error.  [PR #2714](https://github.com/apollographql/apollo-server/pull/2714)
- `apollo-server-lambda`: Set `callbackWaitsForEmptyEventLoop` to `false` for `OPTIONS` requests to return as soon as the `callback` is triggered instead of waiting for the event loop to empty. [PR #2638](https://github.com/apollographql/apollo-server/pull/2638)
- `apollo-server`: Support `onHealthCheck` in the `ApolloServer` constructor in the same way as `cors` is supported.  This contrasts with the `-express`, `-hapi`, etc. variations which accept this parameter via their `applyMiddleware` methods and will remain as-is.  [PR #2672](https://github.com/apollographql/apollo-server/pull/2672)
- core: Expose SHA-512 hex hash digest of the Engine API key to plugins, when available, as `engine.apiKeyHash`. [PR #2685](https://github.com/apollographql/apollo-server/pull/2685) [PR #2736](https://github.com/apollographql/apollo-server/pull/2736)
- `apollo-datasource-rest`: If another `Content-type` is already set on the response, don't overwrite it with `application/json`, allowing the user's initial `Content-type` to prevail. [PR #2520](https://github.com/apollographql/apollo-server/issues/2035)
- Don't add `cacheControl` directive if one has already been defined. [PR #2428](https://github.com/apollographql/apollo-server/pull/2428)
- `apollo-cache-control`: Do not respond with `Cache-control` headers if the HTTP response contains `errors`. [PR #2715](https://github.com/apollographql/apollo-server/pull/2715)
- `apollo-server-core`: Skip loading `util.promisify`, `Array.flat`, `Array.flatMap`, and `Object.fromEntries` polyfills, none of which are needed in Node 12+. [PR #2278](https://github.com/apollographql/apollo-server/pull/2278) [PR #5244](https://github.com/apollographql/apollo-server/pull/5244)
- `apollo-server-core`: Lazy load `subscriptions-transport-ws` in core [PR #2278](https://github.com/apollographql/apollo-server/pull/2278)
- `apollo-server-cache-redis`: **BREAKING FOR USERS OF `apollo-server-cache-redis`** (This is a package that must be updated separately but shares the same `CHANGELOG.md` with Apollo Server itself.)  A new **major** version of this package has been published and updated to support Redis Standalone, Cluster and Sentinel modes.  This is a breaking change since it is now based on [`ioredis`](https://github.com/luin/ioredis) instead of [`node_redis`](https://github.com/NodeRedis/node_redis).  Although this update is compatible with the most common uses of `apollo-server-cache-redis`, please check the [options supported by `ioredis`](https://github.com/luin/ioredis/blob/master/API.md#new-redisport-host-options) while updating to this version.  The constructor options are passed directly from `RedisCache` to the new Redis adapter.  The pre-1.0 versions should continue to work with Apollo Server without modification. [PR #1770](https://github.com/apollographql/apollo-server/pull/1770)

## v2.5.1

- Upgrade GraphQL Playground to the latest upstream release.  This release also includes a new "Query Plan" panel for displaying the query planning results when running the Apollo Gateway.

## v2.5.0

### New

- New plugin package `apollo-server-plugin-response-cache` implementing a full query response cache based on `apollo-cache-control` hints. The implementation added a few hooks and context fields; see the PR for details. There is a slight change to `cacheControl` object: previously, `cacheControl.stripFormattedExtensions` defaulted to false if you did not provide a `cacheControl` option object, but defaulted to true if you provided (eg) `cacheControl: {defaultMaxAge: 10}`. Now `stripFormattedExtensions` defaults to false unless explicitly provided as `true`, or if you use the legacy boolean `cacheControl: true`. For more information, [read the documentation](https://www.apollographql.com/docs/apollo-server/features/caching).  [PR #2437](https://github.com/apollographql/apollo-server/pull/2437)
- Add `rewriteError` option to `EngineReportingOptions` (i.e. the `engine` property of the `ApolloServer` constructor).  When defined as a `function`, it will receive an `err` property as its first argument which can be used to manipulate (e.g. redaction) an error prior to sending it to Apollo Engine by modifying, e.g., its `message` property.  The error can also be suppressed from reporting entirely by returning an explicit `null` value.  For more information, [read the documentation](https://www.apollographql.com/docs/apollo-server/features/errors#for-apollo-engine-reporting) and the [`EngineReportingOptions` API reference](https://www.apollographql.com/docs/apollo-server/api/apollo-server#enginereportingoptions). `maskErrorDetails` is now deprecated. [PR #1639](https://github.com/apollographql/apollo-server/pull/1639)
- `apollo-server-azure-functions`: Support `@azure/functions` to enable Apollo Server [Typescript development in Azure Functions](https://azure.microsoft.com/en-us/blog/improving-the-typescript-support-in-azure-functions/). [PR #2487](https://github.com/apollographql/apollo-server/pull/2487)
- Allow `GraphQLRequestListener` callbacks in plugins to depend on `this`. [PR #2470](https://github.com/apollographql/apollo-server/pull/2470)
- `apollo-server-testing`: Add `variables` and `operationName` to `Query` and `Mutation` types. [PR #2307](https://github.com/apollographql/apollo-server/pull/2307) [Issue #2172](https://github.com/apollographql/apollo-server/issue/2172)

### Bug fixes

- Add `cache-control: no-cache` header to both `PersistedQueryNotSupportedError` and `PersistedQueryNotFoundError` responses as these should never be cached. [PR #2452](https://github.com/apollographql/apollo-server/pull/2452)
- `apollo-datasource-rest`: Don't attempt to parse "204 No Content" responses as JSON. [PR #2446](https://github.com/apollographql/apollo-server/pull/2446)
- `apollo-server-express`: Fix Playground URL when Apollo Server is mounted inside of another Express app by utilizing `req.originalUrl`. [PR #2451](https://github.com/apollographql/apollo-server/pull/2451)
- `apollo-datasource-rest`: Correctly allow a TTL value of `0` to represent "not-cacheable". [PR #2588](https://github.com/apollographql/apollo-server/pull/2588)
- `apollo-datasource-rest`: Fix `Invalid argument` in IE11, when `this.headers` is `undefined`. [PR #2607](https://github.com/apollographql/apollo-server/pull/2607)

## v2.4.8

- No functional changes in this version.  The patch version has been bumped to fix the `README.md` displayed on the [npm package for `apollo-server`](https://npm.im/apollo-server) as a result of a broken publish.  Apologies for the additional noise!

## v2.4.7

- Fix typings which incorrectly included `cors` as part of the constructor options for `apollo-server-express` (it should be defined via `applyMiddleware`) but, conversely, inadvertently omitted the perfectly valid `cors` option from the `apollo-server` constructor (where `applyMiddleware` is not used/available). [PR #2373](https://github.com/apollographql/apollo-server/pull/2373) [Issue #1882](https://github.com/apollographql/apollo-server/issues/1882)

## v2.4.6

- Allow Node.js-like runtimes to identify as Node.js as well. [PR #2357](https://github.com/apollographql/apollo-server/pull/2357) [Issue #2356](https://github.com/apollographql/apollo-server/issue/2356)

## v2.4.5

- `apollo-server-express`: Export `ExpressContext` [PR #2352](https://github.com/apollographql/apollo-server/pull/2352)

## v2.4.4

- Fix typing for ContextFunction incorrectly requiring the context object the function produces to match the parameters of the function [PR #2350](https://github.com/apollographql/apollo-server/pull/2350)

## v2.4.3

- `apollo-server-lambda`: Fix typings which triggered "Module has no default export" errors. [PR #2230](https://github.com/apollographql/apollo-server/pull/2230)
- `apollo-server-koa`: Support OPTIONS requests [PR #2288](https://github.com/apollographql/apollo-server/pull/2288)
- Add `req` and `res` typings to the `ContextFunction` argument for apollo-server and apollo-server-express. Update `ContextFunction` return type to allow returning a value syncronously. [PR #2330](https://github.com/apollographql/apollo-server/pull/2330)
- Type the `formatError` function to accept an GraphQLError as an argument and return a GraphQLFormattedError [PR #2343](https://github.com/apollographql/apollo-server/pull/2343)

## v2.4.2

- `apollo-server-fastify` is now on Apollo Server and lives within the `apollo-server` repository.  This is being introduced in a _patch_ version, however it's a _major_ version bump from the last time `apollo-server-fastify` was published under `1.0.2`.  [PR #1971](https://github.com/apollostack/apollo-server/pull/1971)
- Move `apollo-graphql` package to the `apollo-tooling` repository [PR #2316](https://github.com/apollographql/apollo-server/pull/2316)

## v2.4.1

- Fix inaccurate total duration in apollo-tracing [PR #2298](https://github.com/apollographql/apollo-server/pull/2298)
- Avoid importing entire `crypto` dependency tree if not in Node.js. [PR #2304](https://github.com/apollographql/apollo-server/pull/2304)
- Allow passing `parseOptions` to `ApolloServerBase` constructor. [PR #2289](https://github.com/apollographql/apollo-server/pull/2289)
- Rename `azureFunctions.d.ts` to `azureFunctions.ts`. [PR #2287](https://github.com/apollographql/apollo-server/pull/2287)
- Require `apollo-engine-reporting` only if `EngineReportingAgent` used. [PR #2305](https://github.com/apollographql/apollo-server/pull/2305)

## v2.4.0

- Implement an in-memory cache store to save parsed and validated documents and provide performance benefits for repeat executions of the same document. [PR #2111](https://github.com/apollographql/apollo-server/pull/2111) (`>=2.4.0-alpha.0`)
- Fix: Serialize arrays as JSON on fetch in `RESTDataSource`. [PR #2219](https://github.com/apollographql/apollo-server/pull/2219)
- Fix: The `privateHeaders` configuration for `apollo-engine-reporting` now allows headers to be specified using any case and lower-cases them prior to comparison. [PR #2276](https://github.com/apollographql/apollo-server/pull/2276)
- Fix broken `apollo-server-azure-functions` TypeScript definitions. [PR #2287](https://github.com/apollographql/apollo-server/pull/2287)

## v2.3.3

- `apollo-server` (only): Stop double-invocation of `serverWillStart` life-cycle event.  (More specific integrations - e.g. Express, Koa, Hapi, etc. - were unaffected.) [PR #2239](https://github.com/apollographql/apollo-server/pull/2239)
- Avoid traversing `graphql-upload` module tree in run-time environments which aren't Node.js. [PR #2235](https://github.com/apollographql/apollo-server/pull/2235)

## v2.3.2

- Switch from `json-stable-stringify` to `fast-json-stable-stringify`. [PR #2065](https://github.com/apollographql/apollo-server/pull/2065)
- Fix cache hints of `maxAge: 0` to mean "uncachable". [#2197](https://github.com/apollographql/apollo-server/pull/2197)
- Apply `defaultMaxAge` to scalar fields on the root object. [#2210](https://github.com/apollographql/apollo-server/pull/2210)
- Don't write to the persisted query cache until execution will begin. [PR #2227](https://github.com/apollographql/apollo-server/pull/2227)

- `apollo-server-azure-functions`: Added Azure Functions documentation and deployment examples [PR #2131](https://github.com/apollographql/apollo-server/pull/2131),
[Issue #2092](https://github.com/apollographql/apollo-server/issues/2092)

## v2.3.1

- Provide types for `graphql-upload` in a location where they can be accessed by TypeScript consumers of `apollo-server` packages. [ccf935f9](https://github.com/apollographql/apollo-server/commit/ccf935f9) [Issue #2092](https://github.com/apollographql/apollo-server/issues/2092)

## v2.3.0

- **BREAKING FOR NODE.JS <= 8.5.0 ONLY**: To continue using Apollo Server 2.x in versions of Node.js prior to v8.5.0, file uploads must be disabled by setting `uploads: false` on the `ApolloServer` constructor options.  Without explicitly disabling file-uploads, the server will `throw` at launch (with instructions and a link to our documentation).

  This early deprecation is due to changes in the third-party `graphql-upload` package which Apollo Server utilizes to implement out-of-the-box file upload functionality.  While, in general, Apollo Server 2.x aims to support all Node.js versions which were under an LTS policy at the time of its release, we felt this required an exception.  By `throw`-ing when `uploads` is not explicitly set to `false`, we aim to make it clear immediately (rather than surprisingly) that this deprecation has taken effect.

  While Node.js 6.x is covered by a [Long Term Support agreement by the Node.js Foundation](https://github.com/nodejs/Release#release-schedule) until April 2019, there are substantial performance (e.g. [V8](https://v8.dev/) improvements) and language changes (e.g. "modern" ECMAScript support) offered by newer Node.js engines (e.g. 8.x, 10.x).  We encourage _all users_ of Apollo Server to update to newer LTS versions of Node.js prior to the "end-of-life" dates for their current server version.

  **We intend to drop support for Node.js 6.x in the next major version of Apollo Server.**

  For more information, see [PR #2054](https://github.com/apollographql/apollo-server/pull/2054) and [our documentation](https://www.apollographql.com/docs/apollo-server/v2/migration-file-uploads.html).

## v2.2.7

- `apollo-engine-reporting`: When multiple instances of `apollo-engine-reporting` are loaded (an uncommon edge case), ensure that `encodedTraces` are handled only once rather than once per loaded instance. [PR #2040](https://github.com/apollographql/apollo-server/pull/2040)

## v2.2.6

- `apollo-server-micro`: Set the `Content-type` to `text/html` for GraphQL Playground. [PR #2026](https://github.com/apollographql/apollo-server/pull/2026)

## v2.2.5

- Follow-up on the update to `graphql-playground-html` in previous release by also bumping the minor version of the `graphql-playground-react` dependency to `1.7.10` — which is the version requested from the from the CDN bundle by `graphql-playground-html`. [PR #2037](https://github.com/apollographql/apollo-server/pull/2037)

## v2.2.4

- Fix GraphQL Playground documentation scrolling bug in Safari by updating to latest (rebased) fork of `graphql-playground-html`. [PR #2037](https://github.com/apollographql/apollo-server/pull/2037)

## v2.2.3

- When `generateClientInfo` is not used to define the client name, client version and
client reference ID, Apollo Server will now default to the values present in the HTTP headers
of the request (`apollographql-client-name`, `apollographql-client-reference-id` and
`apollographql-client-version` respectively).  As a last resort, when those headers are not set,
the query extensions' `clientInfo` values will be used. [PR #1960](https://github.com/apollographql/apollo-server/pull/1960)

## v2.2.2

- Fixed TypeScript 2.2 compatibility via updated `apollo-tooling` dependency. [Issue #1951](https://github.com/apollographql/apollo-server/issues/1951) [`26d6c739`](https://github.com/apollographql/apollo-server/commit/26d6c739505b3112694e641c272c748ce38ba86b)
- Throw a more specific error when asynchronous introspection query behavior is detected. [PR #1955](https://github.com/apollographql/apollo-server/pull/1955)

## v2.2.1

- Added support for an array of `modules` on the `ApolloServer` constructor options.  Each element of the `modules` can point to a module which exports `typeDefs` and `resolvers`.  These modules can be used in lieu of, or in combination with, directly specifying `schema` or `typeDefs`/`resolvers` on the constructor options.  This provides greater modularity and improved organization for logic which might be limited to a specific service. [`8f6481e6`](https://github.com/apollographql/apollo-server/commit/8f6481e60f8418738f9ebbe9d5ab5e7e2ce4d319).
- Added `resolveObject` support to query execution.  [`bb67584`](https://github.com/apollographql/apollo-server/commit/bb67584a224843a5b2509c2ebdd94e616fe6227c).
- Fix broken `apollo-server-cloud-functions` in 2.2.0 caused by missing TypeScript project references which resulted in the package not being published to npm in compiled form. [PR #1948](https://github.com/apollographql/apollo-server/pull/1948)

## v2.2.0

- New request pipeline, including support for plugins which can implement lifecycle hooks at various stages of a request. [PR #1795](https://github.com/apollographql/apollo-server/pull/1795).
- Introduce new `apollo-server-testing` utilities. [PR #1909](https://github.com/apollographql/apollo-server/pull/1909)
- Fix mocks configuration to allow disabling of mocks by using `mocks: false`, even if `mockEntireSchema` is `true`. [PR #1835](https://github.com/apollographql/apollo-server/pull/1835)
- Update `graphql-playground-html` to 1.7.8. [PR #1855](https://github.com/apollographql/apollo-server/pull/1855)
- Bring back Azure functions support [Issue #1752](https://github.com/apollographql/apollo-server/issue/1752) [PR #1753](https://github.com/apollographql/apollo-server/pull/1753)
- Allow an optional function to resolve the `rootValue`, passing the `DocumentNode` AST to determine the value. [PR #1555](https://github.com/apollographql/apollo-server/pull/1555)
- Follow-up on the work in [PR #1516](https://github.com/apollographql/apollo-server/pull/1516) to also fix missing insertion cursor/caret when a custom GraphQL configuration is specified which doesn't specify its own `cursorShape` property. [PR #1607](https://github.com/apollographql/apollo-server/pull/1607)
- Azure functions support [Issue #1752](https://github.com/apollographql/apollo-server/issue/1752) [PR #1753](https://github.com/apollographql/apollo-server/pull/1753) [PR #1948](https://github.com/apollographql/apollo-server/pull/1948)
- Allow JSON parsing in `RESTDataSource` of Content Type `application/hal+json`. [PR #185](https://github.com/apollographql/apollo-server/pull/1853)
- Add support for a `requestAgent` configuration parameter within the `engine` configuration.  This can be utilized when a proxy is necessary to transmit tracing and metrics data to Apollo Engine.  It accepts either an [`http.Agent`](https://nodejs.org/docs/latest-v8.x/api/http.html#http_class_http_agent) or [`https.Agent`](https://nodejs.org/docs/latest-v8.x/api/https.html#https_class_https_agent) and behaves the same as the `agent` parameter to Node.js' [`http.request`](https://nodejs.org/docs/latest-v8.x/api/http.html#http_http_request_options_callback). [PR #1879](https://github.com/apollographql/apollo-server/pull/1879)
- Allow an optional parameter to the `RESTDataSource` constructor which takes a `node-fetch`-compatible `fetch` implementation that will be used for HTTP calls instead of the default fetch. [PR #1807](https://github.com/apollographql/apollo-server/pull/1807)

## v2.1.0

- Updated the google-cloud-functions package to handle null paths [PR #1674](https://github.com/apollographql/apollo-server/pull/1674)
- Update link inside Authentication Docs [PR #1682](https://github.com/apollographql/apollo-server/pull/1682)
- Fix making sure all headers are getting reported to Engine properly when using `privateHeaders` [PR #1689](https://github.com/apollographql/apollo-server/pull/1689)
- _(experimental, subject to change/removal)_ Provide ability to specify client info in traces [#1631](https://github.com/apollographql/apollo-server/pull/1631)

## v2.0.8

- Reporting: Catch Error if JSON.Stringify Fails for Engine Trace [PR #1668](https://github.com/apollographql/apollo-server/pull/1668)
- Core: Allow context to be passed to all GraphQLExtension methods. [PR #1547](https://github.com/apollographql/apollo-server/pull/1547)

## v2.0.7

- Fix [#1581](https://github.com/apollographql/apollo-server/issues/1581) `apollo-server-micro` top level error response [#1619](https://github.com/apollographql/apollo-server/pull/1619)
- Switch `ApolloServerBase.schema` from private access to protected access. [#1610](https://github.com/apollographql/apollo-server/pull/1610)
- Add toggle for including error messages in reports [#1615](https://github.com/apollographql/apollo-server/pull/1615)
- Fix `apollo-server-cloud-functions` tests [#1611](https://github.com/apollographql/apollo-server/pull/1611/)

## v2.0.6

- Update `graphql-playground-html` to 1.7.4 [#1586](https://github.com/apollographql/apollo-server/pull/1586)
- Add support for `graphql-js` v14 by augmenting typeDefs with the `@cacheControl` directive so SDL validation doesn't fail [#1595](https://github.com/apollographql/apollo-server/pull/1595)
- Add `node-fetch` extensions typing to `RequestInit` [#1602](https://github.com/apollographql/apollo-server/pull/1602)

## v2.0.5

- Google Cloud Function support [#1402](https://github.com/apollographql/apollo-server/issues/1402) [#1446](https://github.com/apollographql/apollo-server/pull/1446)
- Switch to a fork of `apollo-upload-server` to fix missing `core-js` dependency. [#1556](https://github.com/apollographql/apollo-server/pull/1556)

## v2.0.4

- apollo-server: Release due to failed build and install

## v2.0.3

- apollo-server: failed publish
- pass payload into context function for subscriptions [#1513](https://github.com/apollographql/apollo-server/pull/1513)
- Add option to mock the entire schema(i.e. sets preserveResolvers) [PR #1546](https://github.com/apollographql/apollo-server/pull/1546)

## v2.0.2

- Release with Lerna 3 due
- Hapi: Allow additional route options to be passed to Hapi.js plugin. [PR #1384](https://github.com/apollographql/apollo-server/pull/1384)
- express, koa: remove next after playground [#1436](https://github.com/apollographql/apollo-server/pull/1436)
- Hapi: Pass the response toolkit to the context function. [#1407](https://github.com/apollographql/apollo-server/pull/1407)
- update apollo-engine-reporting-protobuf to non-beta [#1429](https://github.com/apollographql/apollo-server/pull/1429)
- playground would use its own settings as default [#1516](https://github.com/apollographql/apollo-server/pull/1516)
- Lambda: Look in event.path first when picking endpoint for GraphQL Playground [#1527](https://github.com/apollographql/apollo-server/pull/1527)
- Fix to allow enabling GraphQL Playground in production with custom config [#1495](https://github.com/apollographql/apollo-server/pull/1495)

## v2.0.1

- This version failed to publish fully/correctly and should not be used.

## v2.0.0-rc.10

- Fix and Export Extension and Playground Types [#1360](https://github.com/apollographql/apollo-server/pull/1360)
- Pin internal dependencies [#1361](https://github.com/apollographql/apollo-server/pull/1361)

## v2.0.0-rc.9

- This version failed to publish fully/correctly and should not be used.

## v2.0.0-rc.8

- export GraphQLUpload from integrations [#1322](https://github.com/apollographql/apollo-server/pull/1322)
- add `cors` to vanilla [#1335](https://github.com/apollographql/apollo-server/pull/1335)
- export `bodyParser.Options` to koa [#1334](https://github.com/apollographql/apollo-server/pull/1334)
- add and use playground in ApolloServer constructor [#1297](https://github.com/apollographql/apollo-server/pull/1297)
- **breaking**: remove calculate headers as function [#1337](https://github.com/apollographql/apollo-server/pull/1337)
- **breaking**: remove `formatParams` [#1331](https://github.com/apollographql/apollo-server/pull/1331)

## v2.0.0-rc.7

- enable engine reporting from lambda [#1313](https://github.com/apollographql/apollo-server/pull/1313)
- remove flattening of errors [#1288](https://github.com/apollographql/apollo-server/pull/1288)
- dynamic url in datasourece ([#1277](https://github.com/apollographql/apollo-server/pull/1277))

## v2.0.0-rc.6

- BREAKING: errors are passed to user extensions, then engine reporting, and finally `formatError` ([#1272](https://github.com/apollographql/apollo-server/pull/1272))
- `formatError` only called once on validation errors ([#1272](https://github.com/apollographql/apollo-server/pull/1272))
- BREAKING: apollo-server-env does place types in global namespace ([#1259](https://github.com/apollographql/apollo-server/pull/1259))
- export Request from apollo-datasource-rest and graphql-extensions (53d7a75 c525818)
- Use scoped graphql-playground and centralize version (8ea36d8, 84233d2)
- fix dependencies + exports ([#1257](https://github.com/apollographql/apollo-server/pull/1257))
- fix data source + context cloning (7e35305)
- use fetch instead of Node request for engine-reporting ([#1274](https://github.com/apollographql/apollo-server/pull/1274))

## v2.0.0-rc.5

- fix formatError to keep prototype of Error ([#1235](https://github.com/apollographql/apollo-server/pull/1235))

## v2.0.0-rc.4

- Add trailing slash to data source
- allow body passed to data source
- new apollo-engine-reporting agent

## v2.0.0-rc.3

- graphql as peerDependency ([#1232](https://github.com/apollographql/apollo-server/pull/1232))
- APQ in batches ([#1234](https://github.com/apollographql/apollo-server/pull/1234))
- APQ hits/misses in traces

## v2.0.0-rc.2

- Missing apollo-upload-server dependency ([#1221](https://github.com/apollographql/apollo-server/pull/1221))
- encode trace report over each request in apollo-engine-reporting

## v2.0.0-rc.1

- BREAKING: remove logFunction ([71a403d](https://github.com/apollographql/apollo-server/pull/1125/commits/71a403dfa38ee050606d3fa32630005e0a98016f)), see [this commit](https://github.com/apollographql/apollo-server/blob/8914b135df9840051fe81cc9224b444cfc5b61ab/packages/apollo-server-core/src/logging.ts) for an implementation
- move upload option to constructor ([#1204](https://github.com/apollographql/apollo-server/pull/1204))
- fixed hapi gui bugs ([#1211](https://github.com/apollographql/apollo-server/pull/1211))
- remove requirement for exModuleInterop ([#1210](https://github.com/apollographql/apollo-server/pull/1210))
- change BadUserInputError to UserInputError ([#1208](https://github.com/apollographql/apollo-server/pull/1208))
- add cache-control headers for CDN integration ([#1138](https://github.com/apollographql/apollo-server/pull/1138))
- Lambda support (thanks to @adnsio, @bwlt, and @gragio [#1138](https://github.com/apollographql/apollo-server/pull/1138))

Data sources

- add memcache and redis support ([#1191](https://github.com/apollographql/apollo-server/pull/1191))
- add patch method ([#1190](https://github.com/apollographql/apollo-server/pull/1190))

## v2.0.0-rc.0

- Breaking: `registerServer` changed to `server.applyMiddleware` ([3279991](https://github.com/apollographql/apollo-server/pull/1125/commits/327999174cfbcecaa4e401ffd7b2d7148ba0fd65))
- Breaking: subscriptions enabled with `installSubscriptionHandlers`
- Add Data Sources ([#1163](https://github.com/apollographql/apollo-server/pull/1163))

## v2.0.0-beta.4

- Bug fix to allow async context ([#1129](https://github.com/apollographql/apollo-server/pull/1129))
- logFunction is now an extension ([#1128](https://github.com/apollographql/apollo-server/pull/1128))
- Allow user defined extensions and include engine reporting ([#1105](https://github.com/apollographql/apollo-server/pull/#105))

## v2.0.0-beta.3

- remove registerServer configuration from `apollo-server`'s listen ([#1090](https://github.com/apollographql/apollo-server/pull/1090))
- move healthcheck into variants ([#1086](https://github.com/apollographql/apollo-server/pull/1086))
- Add file uploads, **breaking** requires removing `scalar Upload` from the typeDefs ([#1071](https://github.com/apollographql/apollo-server/pull/1071))
- Add reporting to Engine as apollo-engine-reporting ([#1105](https://github.com/apollographql/apollo-server/pull/1105))
- Allow users to define extensions ([#1105](https://github.com/apollographql/apollo-server/pull/1105))

## v2.0.0-beta.2

ListenOptions:

- `engine` -> `engineProxy`
- `port`, `host`, and other http options moved under `http` key ([#1080](https://github.com/apollographql/apollo-server/pull/1080))

- `subscriptions` moved to `server.listen` ([#1059](https://github.com/apollographql/apollo-server/pull/1059))
- Add mocks to server constructor ([#1017](https://github.com/apollographql/apollo-server/pull/1017))
- Add `bodyParserConfig` parameter to `registerServer` in apollo-server ([#1059](https://github.com/apollographql/apollo-server/pull/1059)) [commit](https://github.com/apollographql/apollo-server/pull/1063/commits/d08f862063b60f35d92f903c9ac52702150c10f6)
- Hapi variant ([#1058](https://github.com/apollographql/apollo-server/pull/1058)) ([#1082](https://github.com/apollographql/apollo-server/pull/1082))
- Remove tests and guaranteed support for Node 4 [PR #1024](https://github.com/apollographql/apollo-server/pull/1024)
- Cleanup docs [PR #1233](https://github.com/apollographql/apollo-server/pull/1233/files)

## 1.4.0

- [Issue #626] Integrate apollo-fastify plugin. [PR #1013](https://github.com/apollographql/apollo-server/pull/1013)
- add hapi 16 next() invocation [PR #743](https://github.com/apollographql/apollo-server/pull/743)
- Add skipValidation option [PR #839](https://github.com/apollographql/apollo-server/pull/839)
- `apollo-server-module-graphiql`: adds an option to the constructor to disable url rewriting when editing a query [PR #1047](https://github.com/apollographql/apollo-server/pull/1047)
- Upgrade `subscription-transport-ws` to 0.9.9 for Graphiql

## v1.3.6

- Recognize requests with Apollo Persisted Queries and return `PersistedQueryNotSupported` to the client instead of a confusing error. [PR #982](https://github.com/apollographql/apollo-server/pull/982)

## v1.3.5

- `apollo-server-adonis`: The `Content-type` of an operation response will now be correctly set to `application/json`. [PR #842](https://github.com/apollographql/apollo-server/pull/842) [PR #910](https://github.com/apollographql/apollo-server/pull/910)
- `apollo-server-azure-functions`: Fix non-functional Azure Functions implementation and update examples in Azure Functions' `README.md`. [PR #753](https://github.com/apollographql/apollo-server/pull/753) [Issue #684](https://github.com/apollographql/apollo-server/issues/684)
- Fix `TypeError` on GET requests with missing `query` parameter. [PR #964](https://github.com/apollographql/apollo-server/pull/964)
- The typing on the context of `GraphQLServerOptions` now matches the equivilent type used by `graphql-tools`. [PR #919](https://github.com/apollographql/apollo-server/pull/919)
- Middleware handlers now used named (rather than anonymous) functions to enable easier identification during debugging/profiling. [PR #827](https://github.com/apollographql/apollo-server/pull/827)
- The `npm-check-updates` package has been removed as a "dev dependency" which was resulting in an _older_ version of `npm` being used during testing. [PR #959](https://github.com/apollographql/apollo-server/pull/959)
- The typing on `HttpQueryRequest`'s `query` attribute now enforces that its object properties' keys be `String`s. [PR #834](https://github.com/apollographql/apollo-server/pull/834)
- TypeScript types have been updated via updates to `@types/node`, `@types/connect`, `@types/koa` and `@types/aws-lambda`.

## v1.3.4

- Upgrade to `apollo-cache-control@0.1.0` and allow you to specify options to it (such as the new `defaultMaxAge`) by passing `cacheControl: {defaultMaxAge: 5}` instead of `cacheControl: true`.

## v1.3.3

- Updated peer dependencies to support `graphql@0.13.x`.
- `apollo-server-express`: The `GraphQLOptions` type is now exported from `apollo-server-express` in order to facilitate type checking when utilizing `graphqlExpress`, `graphiqlExpress`, `graphqlConnect` and `graphiqlConnect`. [PR #871](https://github.com/apollographql/apollo-server/pull/871)
- Update GraphiQL version to 0.11.11. [PR #914](https://github.com/apollographql/apollo-server/pull/914)

## v1.3.2

- Updated peer dependencies and tests to support `graphql@0.12`.
- Fix issue where the core `runQuery` method broke the ability to use the Node `async_hooks` feature's call stack. [PR #733](https://github.com/apollographql/apollo-server/pull/733)
- Hoist declarations of rarely used functions out of `doRunQuery` to improve performance. [PR# 821](https://github.com/apollographql/apollo-server/pull/821)

## v1.3.1

- Fixed a fatal execution error with the new `graphql@0.12`.

## v1.3.0

- **Breaking:** `apollo-server-hapi`: now supports Hapi v17, and no longer supports Hapi v16.  For information on running Apollo Server 1.x with Hapi v16, [check this documentation](https://www.apollographql.com/docs/apollo-server/v1/servers/hapi.html#Hapi-16).
- **New package**: `apollo-server-adonis` supporting the Adonis framework!
- The `graphqlOptions` parameter to server GraphQL integration functions now accepts context as a function and as an object with a prototype. [PR #679](https://github.com/apollographql/apollo-server/pull/679)
- `apollo-server-express`: Send Content-Length header.
- `apollo-server-micro`: Allow Micro 9 in `peerDependencies`. [PR #671](https://github.com/apollographql/apollo-server/pull/671)
- GraphiQL integration:
  - Recognize Websocket endpoints with secure `wss://` URLs.
  - Only include truthy values in GraphiQL URL.

## v1.2.0

- **New feature**: Add support for Apollo Cache Control. Enable `apollo-cache-control` by passing `cacheControl: true` to your server's GraphQL integration function.
- Include README.md in published npm packages.

## v1.1.7

- Added support for the vhost option for Hapi [PR #611](https://github.com/apollographql/apollo-server/pull/611)
- Fix dependency on `apollo-tracing` to be less strict.

## v1.1.6

- GraphiQL integration: add support for `websocketConnectionParams` for subscriptions. [#452](https://github.com/apollographql/apollo-server/issues/452) [PR 548](https://github.com/apollographql/apollo-server/pull/548)

(v1.1.4 had a major bug and was immediately unpublished. v1.1.5 was identical to v1.1.6.)

## v1.1.3

- GraphiQL integration: Fixes bug where CORS would not allow `Access-Control-Allow-Origin: *` with credential 'include', changed to 'same-origin' [Issue #514](https://github.com/apollographql/apollo-server/issues/514)
- Updated peer dependencies to support `graphql@0.11`.

## v1.1.2

- Fixed bug with no URL query params with GraphiQL on Lambda [Issue #504](https://github.com/apollographql/apollo-server/issues/504) [PR #512](https://github.com/apollographql/apollo-server/pull/503)

## v1.1.1

- Added support for Azure Functions [#503](https://github.com/apollographql/apollo-server/pull/503)

## v1.1.0

- Added ability to provide custom default field resolvers [#482](https://github.com/apollographql/apollo-server/pull/482)
- Add `tracing` option to collect and expose trace data in the [Apollo Tracing format](https://github.com/apollographql/apollo-tracing)
- Add support for GraphiQL editor themes in [#484](https://github.com/apollographql/apollo-server/pull/484) as requested in [#444](https://github.com/apollographql/apollo-server/issues/444)
- Add support for full websocket using GraphiQL [#491](https://github.com/apollographql/graphql-server/pull/491)
- Updated restify lib ([@yucun](https://github.com/liyucun/)) in [#472](https://github.com/apollographql/apollo-server/issues/472)
- Updated package apollo-server-micro, updated micro in devDependencies and peerDependencies to ^8.0.1

## v1.0.3

- Revert [#463](https://github.com/apollographql/graphql-server/pull/463),
  because it's a breaking change that shouldn't have been a patch update.

## v1.0.2

- Rename packages from graphql-server- to apollo-server- [#465](https://github.com/apollographql/apollo-server/pull/465). We'll continue to publish `graphql-server-` packages that depend on the renamed `apollo-server-` packages for the time being, to ensure backwards compatibility.

## v1.0.1

- Fix Express package not calling the callback on completion ([@chemdrew](https://github.com/chemdrew)) in [#463](https://github.com/apollographql/graphql-server/pull/463)

## v1.0.0

- Add package readmes for Express, Hapi, Koa, Restify ([@helfer](https://github.com/helfer)) in [#442](https://github.com/apollographql/graphql-server/pull/442)
- Updated & fixed typescript typings ([@helfer](https://github.com/helfer)) in [#440](https://github.com/apollographql/graphql-server/pull/440)

## v0.9.0

- Allow GraphiQLOptions to be a function ([@NeoPhi](https://github.com/NeoPhi)) on [#426](https://github.com/apollographql/graphql-server/pull/426)

## v0.8.5

- Fix: graphql-server-micro now properly returns response promises [#401](https://github.com/apollographql/graphql-server/pull/401)

## v0.8.4

## v0.8.3

## v0.8.2

- Fix issue with auto-updating dependencies that caused fibers to update accidentally ([@helfer](https://github.com/helfer)) on [#425](https://github.com/apollographql/graphql-server/pull/425)

## v0.8.1

- **Security Fix** Ensure queries submitted via HTTP GET run through validation ([@DxCx](https://github.com/DxCx)) on [#424](https://github.com/apollographql/graphql-server/pull/424)

## v0.8.0

- Persist `window.location.hash` on URL updates [#386](https://github.com/apollographql/graphql-server/issues/386)
- Added support for `graphql-js` > 0.10.0 [#407](https://github.com/apollographql/graphql-server/pull/407)
- Updated `subscriptions-transport-ws` for GraphiQL with subscriptions [#407](https://github.com/apollographql/graphql-server/pull/407)

## v0.7.2

- Fix include passHeader field that was accidentally removed

## v0.7.1

- Fix graphiql fetcher to use endpointURL parameter instead of hardcoded URI.[#365](https://github.com/apollographql/graphql-server/issues/356)

## v0.7.0

- Add Zeit Micro Integration [#324](https://github.com/apollographql/graphql-server/issues/324)
- add support for subscriptionURL to GraphiQL ([@urigo](https://github.com/urigo) on [#320](https://github.com/apollostack/graphql-server/pull/320)
- Restify: Fix for calling next() ([@jadkap](https://github.com/jadkap)) on [#285](https://github.com/apollostack/graphql-server/pull/285)
- **Breaking:** Update all dependencies [#329](https://github.com/apollographql/graphql-server/issues/329)

## v0.6.0

- Add AWS Lambda Integration [PR #247](https://github.com/apollostack/graphql-server/pull/247)
- Update GraphiQL to version 0.9.1 ([@ephemer](https://github.com/ephemer)) on [#293](https://github.com/apollostack/graphql-server/pull/293)
- **Restify integration** ([@joelgriffith](https://github.com/joelgriffith)) on [#189](https://github.com/apollostack/graphql-server/pull/189)
- run batched requests in parallel ([@DxCx](https://github.com/DxCx)) on [#273](https://github.com/apollostack/graphql-server/pull/273)
- Fix GraphiQL options variables. Issue #193. ([@alanchristensen](https://github.com/alanchristensen)) on
  [PR #255](https://github.com/apollostack/apollo-server/pull/255)
- Allow graphql@0.9.0 as peerDependency ([@Chris-R3](https://github.com/Chris-R3)) on [PR #278](https://github.com/apollostack/graphql-server/pull/278)

## v0.5.1

- add support for HTTP GET Method ([@DxCx](https://github.com/DxCx)) on [#180](https://github.com/apollostack/graphql-server/pull/180)

## v0.5.0

- Switch graphql typings for typescript to @types/graphql [#260](https://github.com/apollostack/graphql-server/pull/260)

## v0.4.4

- Update GraphiQL to version 0.8.0 ([@DxCx](https://github.com/DxCx)) on [#192](https://github.com/apollostack/graphql-server/pull/192)
- Upgrade to GraphQL-js 0.8.1.

## v0.4.2

- **Restructure Apollo Server into 6 new packages, and rename to GraphQL Server** ([@DxCx](https://github.com/DxCx)) and ([@stubailo](https://github.com/stubailo)) in [#183](https://github.com/apollostack/graphql-server/pull/183) and [#164](https://github.com/apollostack/graphql-server/pull/183).
- There are now 6 packages that make up the GraphQL server family:
  - `graphql-server-core`
  - `graphql-module-graphiql`
  - `graphql-module-operation-store`
  - `graphql-server-express`
  - `graphql-server-hapi`
  - `graphql-server-koa`
- Exports have been renamed. Everything that used to export `apollo*` now exports `graphql*`, for example `apolloExpress` has become `graphqlExpress`.
- The repository is now managed using [Lerna](https://github.com/lerna/lerna).

## v0.3.3

- Fix passHeader option in GraphiQL (Both Hapi and Koa)
- Pass `ctx` instead of `ctx.request` to options function in Koa integration ([@HriBB](https://github.com/HriBB)) in [PR #154](https://github.com/apollostack/apollo-server/pull/154)
- Manage TypeScript declaration files using npm. ([@od1k](https:/github.com/od1k) in [#162](https://github.com/apollostack/apollo-server/pull/162))
- Fix connect example in readme. ([@conrad-vanl](https://github.com/conrad-vanl) in [#165](https://github.com/apollostack/apollo-server/pull/165))
- Add try/catch to formatError. ([@nicolaslopezj](https://github.com/nicolaslopezj) in [#174](https://github.com/apollostack/apollo-server/pull/174))
- Clone context object for each query in a batch.

## v0.3.2

- Added missing exports for hapi integration ([@nnance](https://github.com/nnance)) in [PR #152](https://github.com/apollostack/apollo-server/pull/152)

## v0.3.1

- Fixed dependency issue with boom package that affected the hapi integration. ([@sammkj](https://github.com/sammkj) in [#150](https://github.com/apollostack/apollo-server/pull/150))

## v0.3.0

- Refactor Hapi integration to improve the API and make the plugins more idiomatic. ([@nnance](https://github.com/nnance)) in
  [PR #127](https://github.com/apollostack/apollo-server/pull/127)
- Fixed query batching with Hapi integration. Issue #123 ([@nnance](https://github.com/nnance)) in
  [PR #127](https://github.com/apollostack/apollo-server/pull/127)
- Add support for route options in Hapi integration. Issue #97. ([@nnance](https://github.com/nnance)) in
  [PR #127](https://github.com/apollostack/apollo-server/pull/127)
- Camelcase Hapi. Issue #129. ([@nnance](https://github.com/nnance)) in
  [PR #132](https://github.com/apollostack/apollo-server/pull/132)
- Fix error handling when parsing variables parameter. Issue #130. ([@nnance](https://github.com/nnance)) in
  [PR #131](https://github.com/apollostack/apollo-server/pull/131)
- Improve logging function. Issue #79. ([@nnance](https://github.com/nnance)) in
  [PR #136](https://github.com/apollostack/apollo-server/pull/136)
- Output stack trace for errors in debug mode. Issue #111. ([@nnance](https://github.com/nnance)) in
  [PR #137](https://github.com/apollostack/apollo-server/pull/137)
- Allow to pass custom headers in GraphiQL ([@nicolaslopezj](https://github.com/nicolaslopezj) in [#133](https://github.com/apollostack/apollo-server/pull/133)).

## v0.2.6

- Expose the OperationStore as part of the public API. ([@nnance](https://github.com/nnance))
- Support adding parsed operations to the OperationStore. ([@nnance](https://github.com/nnance))
- Expose ApolloOptions as part of the public API.

## v0.2.5

- Made promise compatible with fibers ([@benjamn](https://github.com/benjamn) in [#92](https://github.com/apollostack/apollo-server/pull/92))

## v0.2.2

- Log server events such as request start etc. with logFunction ([@helfer](https://github.com/helfer) in [#78](https://github.com/apollostack/apollo-server/pull/78))

## v0.2.1

- Complete refactor of Apollo Server using TypeScript. PR [#41](https://github.com/apollostack/apollo-server/pull/41)
- Added Hapi integration ([@nnance](https://github.com/nnance) in [#46](https://github.com/apollostack/apollo-server/pull/46))
- Added Koa integration ([@HriBB](https://github.com/HriBB) in [#59](https://github.com/apollostack/apollo-server/pull/59))
- Changed express integration to support connect as well ([@helfer](https://github.com/helfer) in [#58](https://github.com/apollostack/apollo-server/pull/58))
- Dropped express-graphql dependency
- Dropped support for GET requests, only POST requests are allowed now
- Split GraphiQL into a separate middleware
- Factored out core to support Hapi, Koa and connect implementations
- Added support for query batching
- Added support for query whitelisting / stored queries
- Removed body parsing from express integration. Body must be parsed outside of apollo now
- Added `formatRequest` and `formatResponse` functions to apollo options.
- Removed support for shorthand schema definitions, connectors and mocks (use `graphql-tools` instead)

## v0.1.5

- BUG: Fixed a spelling error with `tracer.submit()` from PR [#26](https://github.com/apollostack/apollo-server/pull/26)
  in PR [#31](https://github.com/apollostack/apollo-server/pull/31)

## v.0.1.4

- BUG: Fixed a bug with tracer mocks that would throw a TypeError when using Ava [#26](https://github.com/apollostack/apollo-server/pull/26)

## v0.1.3

- Updated graphql dependency to 0.6.0
