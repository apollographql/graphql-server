---
title: Metrics and logging
description: How to monitor Apollo Server's performance
---

Apollo Server integrates seamlessly with Apollo Studio to help you monitor the execution of your GraphQL operations. It also provides configurable mechanisms for logging each phase of a GraphQL operation.

> Using Federation? Check out the documentation for [federated tracing](https://www.apollographql.com/docs/federation/metrics/).

## Sending metrics to Apollo Studio

[Apollo Studio](https://www.apollographql.com/docs/studio/) provides an integrated hub for all of your GraphQL performance data. It [aggregates and displays information](https://www.apollographql.com/docs/studio/performance/) for your schema, queries, requests, and errors. You can also configure alerts that support [Slack](https://www.apollographql.com/docs/studio/slack-integration/) and [Datadog](https://www.apollographql.com/docs/studio/datadog-integration/) integrations.

### Connecting to Apollo Studio

To connect Apollo Server to Apollo Studio, first [obtain a graph API key](https://www.apollographql.com/docs/studio/setup-analytics/#pushing-traces-from-apollo-server). To provide this key to Apollo Server, assign it to the `APOLLO_KEY` environment variable in your server's environment.

Then associate your server instance with a particular graph ID and [graph variant](https://www.apollographql.com/docs/studio/schema/registry/#managing-environments-with-variants) by  setting the `APOLLO_GRAPH_REF` environment variable.

You can set environment variable values on the command line as seen below, or with the [`dotenv` npm package](https://www.npmjs.com/package/dotenv) (or similar).

```bash
# Replace the example values below with values specific to your use case.
# This example associates your server with the `my-variant` variant of
# the `my-graph` graph.
$ APOLLO_KEY=YOUR_API_KEY APOLLO_GRAPH_REF=my-graph@my-variant \
  node start-server.js
```

### Identifying distinct clients

Apollo Studio's [client awareness feature](https://www.apollographql.com/docs/studio/client-awareness/) enables you to view metrics for distinct versions
of your clients. To enable this, your clients need to include some or all of the following identifying information in the headers of GraphQL requests they
send to Apollo Server:

| Identifier | Header Name (default) | Example Value |
|----|----|----|
| Client name | `apollographql-client-name` | `iOS Native` |
| Client version | `apollographql-client-version` | `1.0.1` |

Each of these fields can have any string value that's useful for your application. To simplify the browsing and sorting of your client data in Studio, a three-part version number (such as `1.0.1`) is recommended for client versions.

> Client version is **not** tied to your current version of Apollo Client (or any other client library). You define this value and are responsible for updating it whenever meaningful changes are made to your client.

#### Setting client awareness headers in Apollo Client

If you're using Apollo Client, you can set default values for client name and
version in the [`ApolloClient` constructor](https://www.apollographql.com/docs/react/api/apollo-client/#the-apolloclient-constructor). All requests to Apollo Server will automatically include these values in the appropriate headers.

#### Using custom headers

For more advanced cases, or to use headers other than the default headers, pass a `generateClientInfo` function into the [usage reporting plugin](../api/plugin/usage-reporting/):

```js{9-24}
const { ApolloServer } = require("apollo-server");
const { ApolloServerPluginUsageReporting } = require("apollo-server-core");

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
    ApolloServerPluginUsageReporting({
      generateClientInfo: ({
        request
      }) => {
        const headers = request.http && request.http.headers;
        if(headers) {
          return {
            clientName: headers['apollographql-client-name'],
            clientVersion: headers['apollographql-client-version'],
          };
        } else {
          return {
            clientName: "Unknown Client",
            clientVersion: "Unversioned",
          };
        }
      },
    }),
  ],
});

server.listen().then(({ url }) => {
  console.log(`🚀  Server ready at ${url}`);
});
```

## OpenTelemetry

[OpenTelemetry](https://opentelemetry.io/) is an open-source framework for configuring and collecting distributed telemetry data (such as metrics and logs) from back-end systems. Its generic APIs enable multiple unrelated systems to report telemetry data in a consistent way.

> Note that [Apollo Studio](https://www.apollographql.com/docs/studio/) does _not_ currently ingest OpenTelemetry data. To report metrics to Studio, [see above](#sending-metrics-to-apollo-studio).

### Required libraries

To enable OpenTelemetry reporting in Apollo Server, first install the following required libraries:

| Name | Description |
|------|-------------|
| [`@opentelemetry/instrumentation-http`](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-instrumentation-http) | Instrumentation for the `http` and `https` libraries. |
| [`@opentelemetry/instrumentation-graphql`](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-graphql) | Instrumentation for the `graphql` library.  |
| [`opentelemetry-instrumentation-express`](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-express) | Instrumentation for Express. Required only if you're using `apollo-server` or `apollo-server-express`. |

> If you're using Apollo Server with [Node.js middleware](../integrations/middleware/) _besides_ `apollo-server-express`, an OpenTelemetry plugin might be available for that middleware as well. [See available plugins](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node)

### Setup



## Logging

You can set up fine-grained operation logging in Apollo Server by defining a custom **plugin**. Apollo Server plugins enable you to perform actions in response to individual phases of the GraphQL request lifecycle, such as whenever a GraphQL request is received from a client.

The example below defines a plugin that responds to three different operation events. As it shows, you provide an array of your defined `plugins` to the `ApolloServer` constructor.

For a list of available lifecycle events and their descriptions, see [Plugins](../integrations/plugins/).

```js
const myPlugin = {
  // Fires whenever a GraphQL request is received from a client.
  async requestDidStart(requestContext) {
    console.log('Request started! Query:\n' +
      requestContext.request.query);

    return {
      // Fires whenever Apollo Server will parse a GraphQL
      // request to create its associated document AST.
      async parsingDidStart(requestContext) {
        console.log('Parsing started!');
      },

      // Fires whenever Apollo Server will validate a
      // request's document AST against your GraphQL schema.
      async validationDidStart(requestContext) {
        console.log('Validation started!');
      },

    }
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
    myPlugin
  ]
});
```

## OpenTelemetry support

See [OpenTelemetry in Apollo Server](https://www.apollographql.com/docs/federation/opentelemetry/).
