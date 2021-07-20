[![npm version](https://badge.fury.io/js/apollo-server-koa.svg)](https://badge.fury.io/js/apollo-server-koa)
[![Build Status](https://circleci.com/gh/apollographql/apollo-server/tree/main.svg?style=svg)](https://circleci.com/gh/apollographql/apollo-server)
[![Join the community forum](https://img.shields.io/badge/join%20the%20community-forum-blueviolet)](https://community.apollographql.com)
[![Read CHANGELOG](https://img.shields.io/badge/read-changelog-blue)](https://github.com/apollographql/apollo-server/blob/HEAD/CHANGELOG.md)


This is the Koa integration of GraphQL Server. Apollo Server is a community-maintained open-source GraphQL server that works with many Node.js HTTP server frameworks. [Read the docs](https://www.apollographql.com/docs/apollo-server/). [Read the CHANGELOG.](https://github.com/apollographql/apollo-server/blob/main/CHANGELOG.md)

```shell
npm install apollo-server-koa graphql
```

## Koa

```js
const Koa = require('koa');
const { ApolloServer, gql } = require('apollo-server-koa');

async function startApolloServer() {
  // Construct a schema, using GraphQL schema language
  const typeDefs = gql`
    type Query {
      hello: String
    }
  `;

  // Provide resolver functions for your schema fields
  const resolvers = {
    Query: {
      hello: () => 'Hello world!',
    },
  };

  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();

  const app = new Koa();
  server.applyMiddleware({ app });
  // alternatively you can get a composed middleware from the apollo server
  // app.use(server.getMiddleware());

  await new Promise(resolve => app.listen({ port: 4000 }, resolve));
  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
  return { server, app };
}
```

Set up subscriptions for apollo-server-koa

```js
const server = new ApolloServer({
  typeDefs,
  resolvers,
  subscriptions: {
    path: "/graphql/",
    onConnect: async (connectionParams) => {
      if (connectionParams.authToken) {
        const userId = await verifyToken(
          connectionParams.authToken
        );
        return { userId };
      }

      throw new Error("Missing auth token!");
    },
  },
  context: async ({ ctx, connection }) => {
    // ws connection context
    if (connection) {
      return connection.context;
    }

    // regular context
    return context;
  }
});

const app = new Koa();
server.applyMiddleware({ app });

const httpServer = app.listen({ port: 4000 }, () =>
  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`),
);
server.installSubscriptionHandlers(httpServer);
```

## Principles

GraphQL Server is built with the following principles in mind:

- **By the community, for the community**: GraphQL Server's development is driven by the needs of developers
- **Simplicity**: by keeping things simple, GraphQL Server is easier to use, easier to contribute to, and more secure
- **Performance**: GraphQL Server is well-tested and production-ready - no modifications needed

Anyone is welcome to contribute to GraphQL Server, just read [CONTRIBUTING.md](https://github.com/apollographql/apollo-server/blob/main/CONTRIBUTING.md), take a look at the [roadmap](https://github.com/apollographql/apollo-server/blob/main/ROADMAP.md) and make your first PR!
