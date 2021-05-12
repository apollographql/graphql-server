import http from 'http';
import request from 'supertest';
import { createMockServer } from './mockServer';
import { Config, gql } from 'apollo-server-core';
import { ApolloServer } from '../ApolloServer';
import type { GetMiddlewareOptions } from 'apollo-server-express';
import {
  createServerInfo,
  testApolloServer,
} from 'apollo-server-integration-testsuite';

const typeDefs = gql`
  type Query {
    hello: String
  }
`;

const resolvers = {
  Query: {
    hello: () => 'hi',
  },
};

describe('apollo-server-lambda', () => {
  let server: ApolloServer;
  let httpServer: http.Server;
  testApolloServer(
    async (config: Config) => {
      server = new ApolloServer(config);
      // Ignore suppressStartCall because serverless ApolloServers don't
      // get `start`ed.
      const lambdaHandler = server.createHandler();
      const httpHandler = createMockServer(lambdaHandler);
      httpServer = new http.Server(httpHandler);
      await new Promise<void>((resolve) => {
        httpServer.listen({ port: 0 }, () => resolve());
      });
      return createServerInfo(server, httpServer);
    },
    async () => {
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      if (server) await server.stop();
    },
    { serverlessFramework: true },
  );

  const createLambda = (
    expressGetMiddlewareOptions: Partial<GetMiddlewareOptions> = {},
  ) => {
    const server = new ApolloServer({
      typeDefs,
      resolvers,
    });
    const handler = server.createHandler({ expressGetMiddlewareOptions });
    return createMockServer(handler);
  };

  describe('healthchecks', () => {
    it('creates a healthcheck endpoint', async () => {
      const app = createLambda();

      const req = request(app).get('/.well-known/apollo/server-health');

      return req.then((res: any) => {
        expect(res.status).toEqual(200);
        expect(res.body).toEqual({ status: 'pass' });
        expect(res.headers['content-type']).toEqual(
          'application/health+json; charset=utf-8',
        );
      });
    });

    it('provides a callback for the healthcheck', async () => {
      const app = createLambda({
        onHealthCheck: async () => {
          return new Promise((resolve) => {
            return resolve('Success!');
          });
        },
      });

      const req = request(app).get('/.well-known/apollo/server-health');

      return req.then((res: any) => {
        expect(res.status).toEqual(200);
        expect(res.body).toEqual({ status: 'pass' });
        expect(res.headers['content-type']).toEqual(
          'application/health+json; charset=utf-8',
        );
      });
    });

    it('returns a 503 if healthcheck fails', async () => {
      const app = createLambda({
        onHealthCheck: async () => {
          return new Promise(() => {
            throw new Error('Failed to connect!');
          });
        },
      });

      const req = request(app).get('/.well-known/apollo/server-health');

      return req.then((res: any) => {
        expect(res.status).toEqual(503);
        expect(res.body).toEqual({ status: 'fail' });
        expect(res.headers['content-type']).toEqual(
          'application/health+json; charset=utf-8',
        );
      });
    });
  });
});
