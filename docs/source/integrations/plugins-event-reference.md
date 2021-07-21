---
title: Apollo Server plugin event reference
sidebar_title: Event reference
---

> **New in Apollo Server 3:** All plugin lifecycle methods are `async`, _except for [`willResolveField`](#willresolvefield) and [`schemaDidLoadOrUpdate`](#schemadidloadorupdate)_.

This reference describes the lifecycle events that your [custom Apollo Server plugin](./plugins/) can respond to.

Apollo Server fires two types of events that plugins can hook into: **server lifecycle
events** and **request lifecycle events**.

* Server lifecycle events are high-level events related to the lifecycle of Apollo Server itself (e.g., [`serverWillStart`](#serverwillstart)).
* Request lifecycle events are associated with the lifecycle of a specific request.
  * You define responses to these events _within_ the response to a `requestDidStart` event, as described in [Responding to request lifecycle events](./plugins#responding-to-request-lifecycle-events).

> With two exceptions, all plugin methods in Apollo Server 3 are `async`. The first exception is `willResolveField`, which is called much more frequently than other plugin methods. The second exception is `schemaDidLoadOrUpdate`, where making the method `async` would introduce unclear ordering semantics around method executions.

## Server lifecycle events

### `serverWillStart`

The `serverWillStart` event fires when Apollo Server is preparing to start serving GraphQL requests. The server doesn't start until this asynchronous method completes. If it throws (i.e., if the `Promise` it returns is _rejected_), startup _fails_ and your server does not serve GraphQL operations. This helps you make sure all of your server's dependencies are available before attempting to begin serving requests.

This event is fired at different times depending on which [Apollo Server middleware](./middleware/) you're using:

* In `apollo-server`, it's fired from the `listen()` method.
* In non-serverless middleware libraries like `apollo-server-express`, it's fired from the `start()` method.
* In serverless middleware libraries like `apollo-server-lambda`, it's fired in response to the first incoming request.

#### Example

```js
const server = new ApolloServer({
  /* ... other necessary configuration ... */

  plugins: [
    {
      async serverWillStart() {
        console.log('Server starting!');
      }
    }
  ]
})
```

### `serverWillStop`

The `serverWillStop` event fires when Apollo Server is starting to shut down because [`ApolloServer.stop()`](../api/apollo-server/#stop) has been invoked (either explicitly by your code, or by one of the [termination signal handlers](../api/apollo-server/#stoponterminationsignals)). If your plugin is running any background tasks, this is a good place to shut them down.

You define your `serverWillStop` handler in the object returned by your [`serverWillStart`](#serverwillstart) handler, because the two handlers usually interact with the same data. Currently, `serverWillStop` handlers do not take arguments (this might change in the future).

#### Example

```js
const server = new ApolloServer({
  /* ... other necessary configuration ... */

  plugins: [
    {
      async serverWillStart() {
        const interval = setInterval(doSomethingPeriodically, 1000);
        return {
          async serverWillStop() {
            clearInterval(interval);
          }
        }
      }
    }
  ]
})
```

### `renderLandingPage`

This event enables you to serve a [custom landing page](../testing/build-run-queries/#custom-landing-page) from Apollo Server's base URL. The event is fired once by Apollo Server after all `serverWillStart` events run. **At most one installed plugin can define a `renderLandingPage` handler.** Otherwise, Apollo Server throws an error on startup.

You define your plugin's `renderLandingPage` handler in the object returned by your [`serverWillStart`](#serverwillstart) handler, which enables it to read values passed to `serverWillStart`:

```js{5-22}:title=index.js
const server = new ApolloServer({
  // ... other configuration ...

  plugins: [
    {
      async serverWillStart() {
        return {
          async renderLandingPage() {
            const html = `
<!DOCTYPE html>
<html>
  <head>
  </head>
  <body>
    <h1>Hello world!</h1>
  </body>
</html>`;
            return { html };
          }
        }
      }
    }
  ]
});
```

The handler should return an object with a string `html` field. The value of that field is served as HTML for any requests with `accept: text/html` headers.

For more landing page options, see [Changing the landing page](../testing/build-run-queries/#changing-the-landing-page).

#### Example

```js
const server = new ApolloServer({
  /* ... other necessary configuration ... */

  plugins: [
    {
      async serverWillStart() {
        return {
          async renderLandingPage() {
            return { html: `<html><body>Welcome to your server!</body></html>` };
          }
        }
      }
    }
  ]
})
```


### `requestDidStart`

The `requestDidStart` event fires whenever Apollo Server begins fulfilling a GraphQL request.

```typescript
requestDidStart?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'request' | 'context' | 'logger'
  >
): Promise<GraphQLRequestListener<TContext> | void>;
```

This function can optionally return an object that includes functions for responding
to request lifecycle events that might follow `requestDidStart`.

```js
const server = new ApolloServer({
  /* ... other necessary configuration ... */

  plugins: [
    {
      async requestDidStart(requestContext) {
        // Within this returned object, define functions that respond
        // to request-specific lifecycle events.
        return {
          // The `parsingDidStart` request lifecycle event fires
          // when parsing begins. The event is scoped within an
          // associated `requestDidStart` server lifecycle event.
          async parsingDidStart(requestContext) {
            console.log('Parsing started!')
          },
        }
      }
    }
  ],
})
```

If your plugin doesn't need to respond to any request lifecycle events, `requestDidStart`
should not return a value.

### `schemaDidLoadOrUpdate`

The `schemaDidLoadOrUpdate` event fires whenever Apollo Server initially loads the schema or updates the schema. A `schemaDidLoadOrUpdate` handler is given the new API schema and optionally the new core schema (if using a gateway). If you provide a gateway older than FIXME , attempting to register a `schemaDidLoadOrUpdate` handler will fail.

`schemaDidLoadOrUpdate` is a synchronous plugin API (i.e., it does not return a `Promise`).

#### Example

```js
const server = new ApolloServer({
  /* ... other necessary configuration ... */

  plugins: [
    {
      async serverWillStart() {
        return {
          schemaDidLoadOrUpdate({ apiSchema, coreSupergraphSdl }) {
            console.log(`The API schema is ${printSchema(apiSchema)}`);
            if (coreSupergraphSdl) {
              console.log(`The core schema is ${coreSupergraphSdl}`);
            }
          },
        };
      },
    },
  ],
});
```

## Request lifecycle events

> If you're using TypeScript to create your plugin, implement the [ `GraphQLRequestListener` interface](https://github.com/apollographql/apollo-server/blob/main/packages/apollo-server-plugin-base/src/index.ts) from the `apollo-server-plugin-base` module to define functions for request lifecycle events.

When Apollo Server processes a request, these events fire in the order listed (with the exception of `didEncounterErrors`, which might fire in one of a few places depending on when errors occur). [See the flow diagram](./plugins/#request-lifecycle-event-flow)

Note that not every event fires for every request (for example, `parsingDidStart` doesn't fire for an operation that Apollo Server has cached and doesn't need to parse again).

### `didResolveSource`

The `didResolveSource` event is invoked after Apollo Server has determined the
`String`-representation of the incoming operation that it will act upon.  In the
event that this `String` was not directly passed in from the client, this
may be retrieved from a cache store (e.g., Automated Persisted Queries).

At this stage, there is not a guarantee that the operation is not malformed.

```typescript
didResolveSource?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>, 'source' | 'logger'>,
  >,
): Promise<void>;
```

### `parsingDidStart`

The `parsingDidStart` event fires whenever Apollo Server will parse a GraphQL
request to create its associated `document` AST.

If Apollo Server receives a request with a query string that matches a _previous_
request, the associated `document` might already be available in Apollo Server's cache.
In this case, `parsingDidStart` is _not_ called for the request, because parsing
does not occur.

```typescript
parsingDidStart?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'metrics' | 'source' | 'logger'
  >,
): Promise<void | (err?: Error) => Promise<void>>;
```

### `validationDidStart`

The `validationDidStart` event fires whenever Apollo Server will validate a
request's `document` AST against your GraphQL schema.

Like `parsingDidStart`, this event does _not_ fire if a request's `document` is
already available in Apollo Server's cache (only successfully validated `document`s are cached by Apollo Server).

The `document` AST is guaranteed to be
available at this stage, because parsing must succeed for validation to occur.

```typescript
validationDidStart?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'metrics' | 'source' | 'document' | 'logger'
  >,
): Promise<void | (err?: ReadonlyArray<Error>) => Promise<void>>;
```

### `didResolveOperation`

The `didResolveOperation` event fires after the `graphql` library successfully
determines the operation to execute from a request's `document` AST. At this stage,
both the `operationName` string and `operation` AST are available.

This event is _not_ associated with your GraphQL server's _resolvers_. When this event fires, your resolvers have not yet executed (they execute after [`executionDidStart`](#executiondidstart)).

> If the operation is anonymous (i.e., the operation is `query { ... }` instead of `query NamedQuery { ... }`), then `operationName` is `null`.

```typescript
didResolveOperation?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'metrics' | 'source' | 'document' | 'operationName' | 'operation' | 'logger'
  >,
): Promise<void>;
```

### `responseForOperation`

The `responseForOperation` event is fired immediately before GraphQL execution
would take place. If its return value resolves to a non-null `GraphQLResponse`,
that result is used instead of executing the query. Hooks from different plugins
are invoked in series, and the first non-null response is used.

```typescript
responseForOperation?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'metrics' | 'source' | 'document' | 'operationName' | 'operation' | 'logger'
  >,
): Promise<GraphQLResponse | null>;
```

### `executionDidStart`

The `executionDidStart` event fires whenever Apollo Server begins executing the
GraphQL operation specified by a request's `document` AST.

```typescript
executionDidStart?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'metrics' | 'source' | 'document' | 'operationName' | 'operation' | 'logger'
  >,
): Promise<GraphQLRequestExecutionListener | void>;
```

`executionDidStart` may return an object with one or both of the methods `executionDidEnd` and `willResolveField`.  `executionDidEnd` is treated like an end hook: it is called after execution with any errors that occurred. `willResolveField` is documented in the next section. (In Apollo Server 2, `executionDidStart` could return also return an end hook directly.)

### `willResolveField`

The `willResolveField` event fires whenever Apollo Server is about to resolve a single field during the execution of an operation. The handler is passed an object with four fields (`source`, `args`, `context`, and `info`) that correspond to the [four positional arguments passed to resolvers](../data/resolvers/#resolver-arguments). (Note that `source` corresponds to the argument often called `parent` in these docs.)

You provide your `willResolveField` handler in the object returned by your [`executionDidStart`](#executiondidstart) handler.

Your `willResolveField` handler can optionally return an ["end hook"](./plugins/#end-hooks) function that's invoked with the resolver's result (or the error that it throws). The end hook is called when your resolver has _fully_ resolved (e.g., if the resolver returns a Promise, the hook is called with the Promise's eventual resolved result).

`willResolveField` and its end hook are synchronous plugin APIs (i.e., they do not return `Promise`s).

#### Example

```js
const server = new ApolloServer({
  /* ... other necessary configuration ... */

  plugins: [
    {
      async requestDidStart(initialRequestContext) {
        return {
          async executionDidStart(executionRequestContext) {
            return {
              willResolveField({source, args, context, info}) {
                const start = process.hrtime.bigint();
                return (error, result) => {
                  const end = process.hrtime.bigint();
                  console.log(`Field ${info.parentType.name}.${info.fieldName} took ${end - start}ns`);
                  if (error) {
                    console.log(`It failed with ${error}`);
                  } else {
                    console.log(`It returned ${result}`);
                  }
                };
              }
            }
          }
        }
      }
    }
  ]
})
```

### `didEncounterErrors`

The `didEncounterErrors` event fires when Apollo Server encounters errors while
parsing, validating, or executing a GraphQL operation.

```typescript
didEncounterErrors?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'metrics' | 'source' | 'errors' | 'logger'
  >,
): Promise<void>;
```

### `willSendResponse`

The `willSendResponse` event fires whenever Apollo Server is about to send a response
for a GraphQL operation. This event fires (and Apollo Server sends a response) even
if the GraphQL operation encounters one or more errors.

```typescript
willSendResponse?(
  requestContext: WithRequired<
    GraphQLRequestContext<TContext>,
    'metrics' | 'response' | 'logger'
  >,
): Promise<void>;
```
