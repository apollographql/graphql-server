import http from 'http';
import { sha256 } from 'js-sha256';
import { URL } from 'url';
import express = require('express');
import bodyParser = require('body-parser');
import loglevel from 'loglevel';

import { Report, Trace } from 'apollo-reporting-protobuf';

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLError,
  ValidationContext,
  FieldDefinitionNode,
  ResponsePath,
} from 'graphql';

// Note that by doing deep imports here we don't need to install React.
import { execute } from '@apollo/client/link/core';
import { createHttpLink } from '@apollo/client/link/http';
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';

import {
  createApolloFetch,
  ApolloFetch,
  GraphQLRequest,
  ParsedResponse,
} from './apolloFetch';
import {
  AuthenticationError,
  UserInputError,
  gql,
  Config,
  ApolloServerBase,
  PluginDefinition,
  GatewayInterface,
  GraphQLExecutor,
  GraphQLServiceConfig,
  ApolloServerPluginInlineTrace,
  ApolloServerPluginUsageReporting,
  ApolloServerPluginUsageReportingOptions,
  ApolloServerPluginLandingPageDisabled,
  ApolloServerPluginLandingPageGraphQLPlayground,
  ApolloError,
  ApolloServerPluginLandingPageLocalDefault,
} from 'apollo-server-core';
import { Headers, fetch } from 'apollo-server-env';
import ApolloServerPluginResponseCache from 'apollo-server-plugin-response-cache';
import {
  BaseContext,
  GraphQLRequestContext,
  GraphQLRequestContextExecutionDidStart,
} from 'apollo-server-types';

import resolvable, { Resolvable } from '@josephg/resolvable';
import FakeTimers from '@sinonjs/fake-timers';
import { AddressInfo } from 'net';
import request from 'supertest';

const quietLogger = loglevel.getLogger('quiet');
quietLogger.setLevel(loglevel.levels.WARN);

export function createServerInfo<AS extends ApolloServerBase>(
  server: AS,
  httpServer: http.Server,
): ServerInfo<AS> {
  const serverInfo: any = {
    ...(httpServer.address() as AddressInfo),
    server,
    httpServer,
  };

  // Convert IPs which mean "any address" (IPv4 or IPv6) into localhost
  // corresponding loopback ip. Note that the url field we're setting is
  // primarily for consumption by our test suite. If this heuristic is wrong for
  // your use case, explicitly specify a frontend host (in the `host` option to
  // ApolloServer.listen).
  let hostForUrl = serverInfo.address;
  if (serverInfo.address === '' || serverInfo.address === '::')
    hostForUrl = 'localhost';

  serverInfo.url = require('url').format({
    protocol: 'http',
    hostname: hostForUrl,
    port: serverInfo.port,
    pathname: server.graphqlPath,
  });

  return serverInfo;
}

const INTROSPECTION_QUERY = `
  {
    __schema {
      directives {
        name
      }
    }
  }
`;

const TEST_STRING_QUERY = `
  {
    testString
  }
`;

const queryType = new GraphQLObjectType({
  name: 'QueryType',
  fields: {
    testString: {
      type: GraphQLString,
      resolve() {
        return 'test string';
      },
    },
  },
});

const schema = new GraphQLSchema({
  query: queryType,
});

const makeGatewayMock = ({
  optionsSpy = (_options) => {},
  unsubscribeSpy = () => {},
  executor = async () => ({}),
}: {
  optionsSpy?: (_options: any) => void;
  unsubscribeSpy?: () => void;
  executor?: GraphQLExecutor;
} = {}) => {
  let resolution: GraphQLServiceConfig | null = null;
  let rejection: Error | null = null;
  const eventuallyAssigned = {
    resolveLoad: (config: GraphQLServiceConfig) => {
      resolution = config;
    },
    rejectLoad: (err: Error) => {
      rejection = err;
    },
    triggerSchemaChange: null as ((newSchema: GraphQLSchema) => void) | null,
  };

  const mockedGateway: GatewayInterface = {
    executor,
    load: async (options) => {
      optionsSpy(options);
      // Make sure it's async
      await new Promise((res) => setImmediate(res));
      if (rejection) {
        throw rejection;
      }
      if (resolution) {
        return resolution;
      }
      throw Error('Neither resolving nor rejecting?');
    },
    onSchemaChange: (callback) => {
      eventuallyAssigned.triggerSchemaChange = callback;
      return unsubscribeSpy;
    },
    stop: async () => {},
  };

  return { gateway: mockedGateway, triggers: eventuallyAssigned };
};

export interface ServerInfo<AS extends ApolloServerBase> {
  address: string;
  family: string;
  url: string;
  port: number | string;
  server: AS;
  httpServer: http.Server;
}

export interface CreateServerFunc<AS extends ApolloServerBase> {
  (
    config: Config,
    options?: { suppressStartCall?: boolean; graphqlPath?: string },
  ): Promise<ServerInfo<AS>>;
}

export interface StopServerFunc {
  (): Promise<void>;
}

export function testApolloServer<AS extends ApolloServerBase>(
  createApolloServer: CreateServerFunc<AS>,
  stopServer: StopServerFunc,
  options: { serverlessFramework?: boolean } = {},
) {
  describe('ApolloServer', () => {
    afterEach(stopServer);

    describe('constructor', () => {
      describe('validation rules', () => {
        it('accepts additional rules', async () => {
          const NoTestString = (context: ValidationContext) => ({
            Field(node: FieldDefinitionNode) {
              if (node.name.value === 'testString') {
                context.reportError(
                  new GraphQLError('Not allowed to use', [node]),
                );
              }
            },
          });

          const formatError = jest.fn((error) => {
            expect(error instanceof Error).toBe(true);
            return error;
          });

          const { url: uri } = await createApolloServer({
            schema,
            validationRules: [NoTestString],
            introspection: false,
            formatError,
          });

          const apolloFetch = createApolloFetch({ uri });

          const introspectionResult = await apolloFetch({
            query: INTROSPECTION_QUERY,
          });
          expect(introspectionResult.data).toBeUndefined();
          expect(introspectionResult.errors).toBeDefined();
          expect(introspectionResult.errors[0].message).toMatch(
            /introspection/,
          );
          expect(formatError.mock.calls.length).toEqual(
            introspectionResult.errors.length,
          );

          const result = await apolloFetch({ query: TEST_STRING_QUERY });
          expect(result.data).toBeUndefined();
          expect(result.errors).toBeDefined();
          expect(result.errors[0].message).toMatch(/Not allowed/);
          expect(formatError.mock.calls.length).toEqual(
            introspectionResult.errors.length + result.errors.length,
          );
        });

        it('allows introspection by default', async () => {
          const { url: uri } = await createApolloServer({
            schema,
            stopOnTerminationSignals: false,
            __testing_nodeEnv__: undefined,
          });

          const apolloFetch = createApolloFetch({ uri });

          const result = await apolloFetch({ query: INTROSPECTION_QUERY });
          expect(result.data).toBeDefined();
          expect(result.errors).toBeUndefined();
        });

        it('prevents introspection by default during production', async () => {
          const { url: uri } = await createApolloServer({
            schema,
            stopOnTerminationSignals: false,
            __testing_nodeEnv__: 'production',
          });

          const apolloFetch = createApolloFetch({ uri });

          const result = await apolloFetch({ query: INTROSPECTION_QUERY });
          expect(result.data).toBeUndefined();
          expect(result.errors).toBeDefined();
          expect(result.errors.length).toEqual(1);
          expect(result.errors[0].extensions.code).toEqual(
            'GRAPHQL_VALIDATION_FAILED',
          );
        });

        it('allows introspection to be enabled explicitly', async () => {
          const { url: uri } = await createApolloServer({
            schema,
            introspection: true,
            stopOnTerminationSignals: false,
            __testing_nodeEnv__: 'production',
          });

          const apolloFetch = createApolloFetch({ uri });

          const result = await apolloFetch({ query: INTROSPECTION_QUERY });
          expect(result.data).toBeDefined();
          expect(result.errors).toBeUndefined();
        });

        it('prohibits providing a gateway in addition to schema/typedefs/resolvers', async () => {
          const { gateway } = makeGatewayMock();

          const incompatibleArgsSpy = jest.fn();
          await createApolloServer({ gateway, schema }).catch((err) =>
            incompatibleArgsSpy(err.message),
          );
          expect(incompatibleArgsSpy.mock.calls[0][0]).toMatch(
            /Cannot define both/,
          );

          await createApolloServer({
            gateway,
            modules: {} as any,
          }).catch((err) => incompatibleArgsSpy(err.message));
          expect(incompatibleArgsSpy.mock.calls[1][0]).toMatch(
            /Cannot define both/,
          );

          await createApolloServer({
            gateway,
            typeDefs: {} as any,
          }).catch((err) => incompatibleArgsSpy(err.message));
          expect(incompatibleArgsSpy.mock.calls[2][0]).toMatch(
            /Cannot define both/,
          );
        });
      });

      it('variable coercion errors', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              hello(x: String): String
            }
          `,
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({
          query: `query ($x:String) {hello(x:$x)}`,
          variables: { x: 2 },
        });
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(result.errors[0].message).toMatch(
          /got invalid value 2; String cannot represent a non string value: 2/,
        );
        expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT');
      });

      it('catches required type variable error and returns UserInputError', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              hello(x: String!): String
            }
          `,
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({
          query: `query ($x:String!) {hello(x:$x)}`,
        });
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(result.errors[0].message).toMatch(
          `Variable "$x" of required type "String!" was not provided.`
        );
        expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT');
      });

      it('catches non-null type variable error and returns UserInputError', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              hello(x: String!): String
            }
          `,
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({
          query: `query ($x:String!) {hello(x:$x)}`,
          variables: { x: null },
        });
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(result.errors[0].message).toMatch(
          `Variable "$x" of non-null type "String!" must not be null.`
        );
        expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT');
      });

      describe('schema creation', () => {
        it('accepts typeDefs and resolvers', async () => {
          const typeDefs = gql`
            type Query {
              hello: String
            }
          `;
          const resolvers = { Query: { hello: () => 'hi' } };
          const { url: uri } = await createApolloServer({
            typeDefs,
            resolvers,
          });

          const apolloFetch = createApolloFetch({ uri });
          const result = await apolloFetch({ query: '{hello}' });

          expect(result.data).toEqual({ hello: 'hi' });
          expect(result.errors).toBeUndefined();
        });

        it("accepts a gateway's schema and calls its executor", async () => {
          const executor = jest.fn();
          executor.mockReturnValue(
            Promise.resolve({ data: { testString: 'hi - but federated!' } }),
          );

          const { gateway, triggers } = makeGatewayMock({ executor });

          triggers.resolveLoad({ schema, executor });

          const { url: uri } = await createApolloServer({
            gateway,
          });

          const apolloFetch = createApolloFetch({ uri });
          const result = await apolloFetch({ query: '{testString}' });

          expect(result.data).toEqual({ testString: 'hi - but federated!' });
          expect(result.errors).toBeUndefined();
          expect(executor).toHaveBeenCalled();
        });

        if (!options.serverlessFramework) {
          // You don't have to call start on serverless frameworks (or in
          // `apollo-server` which does not currently use this test suite).
          it('rejected load promise is thrown by server.start', async () => {
            const { gateway, triggers } = makeGatewayMock();

            const loadError = new Error(
              'load error which should be be thrown by start',
            );
            triggers.rejectLoad(loadError);

            await expect(
              createApolloServer({
                gateway,
              }),
            ).rejects.toThrowError(loadError);
          });

          it('not calling start causes a clear error', async () => {
            await expect(
              createApolloServer(
                { typeDefs: 'type Query{x: ID}' },
                { suppressStartCall: true },
              ),
            ).rejects.toThrow('You must `await server.start()`');
          });
        }

        it('uses schema over resolvers + typeDefs', async () => {
          const typeDefs = gql`
            type Query {
              hello: String
            }
          `;
          const resolvers = { Query: { hello: () => 'hi' } };
          const { url: uri } = await createApolloServer({
            typeDefs,
            resolvers,
            schema,
          });

          const apolloFetch = createApolloFetch({ uri });
          const typeDefResult = await apolloFetch({ query: '{hello}' });

          expect(typeDefResult.data).toBeUndefined();
          expect(typeDefResult.errors).toBeDefined();

          const result = await apolloFetch({ query: '{testString}' });
          expect(result.data).toEqual({ testString: 'test string' });
          expect(result.errors).toBeUndefined();
        });

        it('allows mocks as boolean', async () => {
          const typeDefs = gql`
            type Query {
              hello: String
            }
          `;
          const { url: uri } = await createApolloServer({
            typeDefs,
            mocks: true,
          });

          const apolloFetch = createApolloFetch({ uri });
          const result = await apolloFetch({ query: '{hello}' });
          expect(result.data).toEqual({ hello: 'Hello World' });
          expect(result.errors).toBeUndefined();
        });

        it('allows mocks as an object', async () => {
          const typeDefs = gql`
            type Query {
              hello: String
            }
          `;
          const { url: uri } = await createApolloServer({
            typeDefs,
            mocks: { String: () => 'mock city' },
          });

          const apolloFetch = createApolloFetch({ uri });
          const result = await apolloFetch({ query: '{hello}' });

          expect(result.data).toEqual({ hello: 'mock city' });
          expect(result.errors).toBeUndefined();
        });

        it('allows mocks as an object without overriding the existing resolvers', async () => {
          const typeDefs = gql`
            type User {
              first: String
              last: String
            }
            type Query {
              user: User
            }
          `;
          const resolvers = {
            Query: {
              user: () => ({
                first: 'James',
                last: 'Heinlen',
              }),
            },
          };
          const { url: uri } = await createApolloServer({
            typeDefs,
            resolvers,
            mocks: {
              User: () => ({
                last: () => 'mock city',
              }),
            },
          });

          const apolloFetch = createApolloFetch({ uri });
          const result = await apolloFetch({
            query: '{user{first last}}',
          });
          expect(result.data).toEqual({
            user: { first: 'Hello World', last: 'mock city' },
          });
          expect(result.errors).toBeUndefined();
        });
      });
    });

    describe('Plugins', () => {
      let apolloFetch: ApolloFetch;
      let apolloFetchResponse: ParsedResponse;
      let serverInstance: ApolloServerBase;

      const setupApolloServerAndFetchPairForPlugins = async (
        plugins: PluginDefinition[] = [],
      ) => {
        const { url: uri, server } = await createApolloServer({
          context: { customContext: true },
          typeDefs: gql`
            type Query {
              justAField: String
            }
          `,
          plugins,
        });

        serverInstance = server;

        apolloFetch = createApolloFetch({ uri })
          // Store the response so we can inspect it.
          .useAfter(({ response }, next) => {
            apolloFetchResponse = response;
            next();
          });
      };

      // Test for https://github.com/apollographql/apollo-server/issues/4170
      it('works when using executeOperation', async () => {
        const encounteredFields: ResponsePath[] = [];
        const encounteredContext: BaseContext[] = [];
        await setupApolloServerAndFetchPairForPlugins([
          {
            requestDidStart: async () => ({
              executionDidStart: async () => ({
                willResolveField({ info, context }) {
                  encounteredFields.push(info.path);
                  encounteredContext.push(context);
                },
              }),
            }),
          },
        ]);

        // The bug in 4170 (linked above) was occurring because of a failure
        // to clone context in `executeOperation` in the same way that occurs
        // in `runHttpQuery` prior to entering the request pipeline.  That
        // resulted in the inability to attach a symbol to the context because
        // the symbol already existed on the context.  Of course, a context
        // is only created after the first invocation, so we'll run this twice
        // to encounter the error where it was in the way when we tried to set
        // it the second time.  While we could have tested for the property
        // before assigning to it, that is not the contract we have with the
        // context, which should have been copied on `executeOperation` (which
        // is meant to be used by testing, currently).
        await serverInstance.executeOperation({
          query: '{ justAField }',
        });
        await serverInstance.executeOperation({
          query: '{ justAField }',
        });

        expect(encounteredFields).toStrictEqual([
          { key: 'justAField', prev: undefined, typename: 'Query' },
          { key: 'justAField', prev: undefined, typename: 'Query' },
        ]);

        // This bit is just to ensure that nobody removes `context` from the
        // `setupApolloServerAndFetchPairForPlugins` thinking it's unimportant.
        // When a custom context is not provided, a new one is initialized
        // on each request.
        expect(encounteredContext).toStrictEqual([
          expect.objectContaining({ customContext: true }),
          expect.objectContaining({ customContext: true }),
        ]);
      });

      it('returns correct status code for a normal operation', async () => {
        await setupApolloServerAndFetchPairForPlugins();

        const result = await apolloFetch({ query: '{ justAField }' });
        expect(result.errors).toBeUndefined();
        expect(apolloFetchResponse.status).toEqual(200);
      });

      it('allows setting a custom status code for an error', async () => {
        await setupApolloServerAndFetchPairForPlugins([
          {
            async requestDidStart() {
              return {
                async didResolveOperation() {
                  throw new Error('known_error');
                },
                async willSendResponse({ response: { http, errors } }) {
                  if (errors![0].message === 'known_error') {
                    http!.status = 403;
                  }
                },
              };
            },
          },
        ]);

        const result = await apolloFetch({ query: '{ justAField }' });
        expect(result.errors).toBeDefined();
        expect(apolloFetchResponse.status).toEqual(403);
      });

      it('preserves user-added "extensions" in the response when parsing errors occur', async () => {
        await setupApolloServerAndFetchPairForPlugins([
          {
            async requestDidStart() {
              return {
                async willSendResponse({ response }) {
                  response.extensions = { myExtension: true };
                },
              };
            },
          },
        ]);

        const result = await apolloFetch({ query: '{ 🦠' });
        expect(result.errors).toBeDefined();
        expect(result.extensions).toEqual(
          expect.objectContaining({
            myExtension: true,
          }),
        );
      });

      it('preserves user-added "extensions" in the response when validation errors occur', async () => {
        await setupApolloServerAndFetchPairForPlugins([
          {
            async requestDidStart() {
              return {
                async willSendResponse({ response }) {
                  response.extensions = { myExtension: true };
                },
              };
            },
          },
        ]);

        const result = await apolloFetch({
          query: '{ missingFieldWhichWillNotValidate }',
        });
        expect(result.errors).toBeDefined();
        expect(result.extensions).toEqual(
          expect.objectContaining({
            myExtension: true,
          }),
        );
      });
    });

    describe('formatError', () => {
      it('wraps thrown error from validation rules', async () => {
        const throwError = jest.fn(() => {
          throw new Error('nope');
        });

        const formatError = jest.fn((error) => {
          expect(error instanceof Error).toBe(true);
          expect(error.constructor.name).toEqual('Error');
          return error;
        });

        const { url: uri } = await createApolloServer({
          schema,
          validationRules: [throwError],
          introspection: true,
          formatError,
        });

        const apolloFetch = createApolloFetch({ uri });

        const introspectionResult = await apolloFetch({
          query: INTROSPECTION_QUERY,
        });
        expect(introspectionResult.data).toBeUndefined();
        expect(introspectionResult.errors).toBeDefined();
        expect(formatError).toHaveBeenCalledTimes(1);
        expect(throwError).toHaveBeenCalledTimes(1);

        const result = await apolloFetch({ query: TEST_STRING_QUERY });
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(formatError).toHaveBeenCalledTimes(2);
        expect(throwError).toHaveBeenCalledTimes(2);
      });

      it('works with errors similar to GraphQL errors, such as yup', async () => {
        // https://npm.im/yup is a package that produces a particular type of
        // error that we test compatibility with. This test was first brought
        // with https://github.com/apollographql/apollo-server/pull/1288. We
        // used to use the actual `yup` package to generate the error, but we
        // don't need to actually bundle that dependency just to test
        // compatibility with that particular error shape.  To be honest, it's
        // not clear from the original PR which attribute of this error need be
        // mocked, but for the sake not not breaking anything, all of yup's
        // error properties have been reproduced here.
        const throwError = jest.fn(async () => {
          // Intentionally `any` because this is a custom Error class with
          // various custom properties (like `value` and `params`).
          const yuppieError: any = new Error('email must be a valid email');
          yuppieError.name = 'ValidationError';

          // Set `message` to enumerable, which `yup` does and `Error` doesn't.
          Object.defineProperty(yuppieError, 'message', {
            enumerable: true,
          });

          // Set other properties which `yup` sets.
          yuppieError.path = 'email';
          yuppieError.type = undefined;
          yuppieError.value = { email: 'invalid-email' };
          yuppieError.errors = ['email must be a valid email'];
          yuppieError.inner = [];
          yuppieError.params = {
            path: 'email',
            value: 'invalid-email',
            originalValue: 'invalid-email',
            label: undefined,
            regex: /@/,
          };

          // This stack is fake, but roughly what `yup` generates!
          yuppieError.stack = [
            'ValidationError: email must be a valid email',
            '    at createError (yup/lib/util/createValidation.js:64:35)',
            '    at yup/lib/util/createValidation.js:113:108',
            '    at process._tickCallback (internal/process/next_tick.js:68:7)',
          ].join('\n');

          throw yuppieError;
        });

        const formatError = jest.fn((error) => {
          expect(error instanceof Error).toBe(true);
          expect(error.extensions.code).toEqual('INTERNAL_SERVER_ERROR');
          expect(error.extensions.exception.name).toEqual('ValidationError');
          expect(error.extensions.exception.message).toBeDefined();
          const inputError = new UserInputError('User Input Error');
          return {
            message: inputError.message,
            extensions: inputError.extensions,
          };
        });

        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              fieldWhichWillError: String
            }
          `,
          resolvers: {
            Query: {
              fieldWhichWillError: () => {
                return throwError();
              },
            },
          },
          introspection: true,
          debug: true,
          formatError,
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({
          query: '{fieldWhichWillError}',
        });
        expect(result.data).toEqual({ fieldWhichWillError: null });
        expect(result.errors).toBeDefined();
        expect(result.errors[0].extensions.code).toEqual('BAD_USER_INPUT');
        expect(result.errors[0].message).toEqual('User Input Error');
        expect(formatError).toHaveBeenCalledTimes(1);
        expect(throwError).toHaveBeenCalledTimes(1);
      });
    });

    describe('lifecycle', () => {
      describe('for Apollo usage reporting', () => {
        let reportIngress: MockReportIngress;

        class MockReportIngress {
          private app: express.Application;
          private server?: http.Server;
          private reports: Report[] = [];
          public readonly promiseOfReports: Promise<Report[]>;

          constructor() {
            let reportResolver: (reports: Report[]) => void;
            this.promiseOfReports = new Promise<Report[]>((resolve) => {
              reportResolver = resolve;
            });

            this.app = express();
            this.app.use((req, _res, next) => {
              // body parser requires a content-type
              req.headers['content-type'] = 'text/plain';
              next();
            });
            this.app.use(
              bodyParser.raw({
                inflate: true,
                type: '*/*',
              }),
            );

            this.app.use((req, res) => {
              const report = Report.decode(req.body);
              this.reports.push(report);
              res.end();

              // Resolve any outstanding Promises with our new report data.
              reportResolver(this.reports);
            });
          }

          async listen(): Promise<http.Server> {
            return await new Promise((resolve) => {
              const server = (this.server = this.app.listen(
                0,
                // Intentionally IPv4.
                '127.0.0.1',
                () => {
                  resolve(server);
                },
              ));
            });
          }

          async stop(): Promise<void> {
            if (!this.server) {
              return;
            }

            return new Promise((resolve) => {
              this.server && this.server.close(() => resolve());
            });
          }

          getUrl(): string {
            if (!this.server) {
              throw new Error('must listen before getting URL');
            }
            const { family, address, port } =
              this.server.address() as AddressInfo;

            if (family !== 'IPv4') {
              throw new Error(`The family was unexpectedly ${family}.`);
            }
            return new URL(`http://${address}:${port}`).toString();
          }
        }

        beforeEach(async () => {
          reportIngress = new MockReportIngress();
          return await reportIngress.listen();
        });

        afterEach((done) => {
          (reportIngress.stop() || Promise.resolve()).then(done);
        });

        describe('traces', () => {
          let throwError: jest.Mock;
          let apolloFetch: ApolloFetch;

          beforeEach(async () => {
            throwError = jest.fn();
          });

          const setupApolloServerAndFetchPair = async (
            usageReportingOptions: Partial<
              ApolloServerPluginUsageReportingOptions<any>
            > = {},
            constructorOptions: Partial<CreateServerFunc<AS>> = {},
            plugins: PluginDefinition[] = [],
          ) => {
            const { url: uri } = await createApolloServer({
              typeDefs: gql`
                enum CacheControlScope {
                  PUBLIC
                  PRIVATE
                }

                directive @cacheControl(
                  maxAge: Int
                  scope: CacheControlScope
                ) on FIELD_DEFINITION | OBJECT | INTERFACE

                type Query {
                  fieldWhichWillError: String
                  justAField: String @cacheControl(maxAge: 5, scope: PRIVATE)
                }
              `,
              resolvers: {
                Query: {
                  fieldWhichWillError: () => {
                    throwError();
                  },
                  justAField: () => 'a string',
                },
              },
              apollo: {
                key: 'service:my-app:secret',
                graphRef: 'my-app@current',
              },
              plugins: [
                ApolloServerPluginUsageReporting({
                  endpointUrl: reportIngress.getUrl(),
                  maxUncompressedReportSize: 1,
                  logger: quietLogger,
                  ...usageReportingOptions,
                }),
                ...plugins,
              ],
              debug: true,
              stopOnTerminationSignals: false,
              __testing_nodeEnv__: undefined,
              ...constructorOptions,
            });

            apolloFetch = createApolloFetch({ uri });
          };

          it('cachePolicy', async () => {
            await setupApolloServerAndFetchPair();

            const result = await apolloFetch({
              query: `{justAField}`,
            });
            expect(result.errors).toBeUndefined();
            expect(result.data).toEqual({
              justAField: 'a string',
            });

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);
            const trace = Object.values(reports[0].tracesPerQuery)[0]
              .trace![0] as Trace;

            expect(trace.cachePolicy).toBeDefined();
            expect(trace.cachePolicy?.maxAgeNs).toBe(5e9);
            expect(trace.cachePolicy?.scope).toBe(
              Trace.CachePolicy.Scope.PRIVATE,
            );
          });

          it('does not expose stack', async () => {
            throwError.mockImplementationOnce(() => {
              throw new Error('how do I stack up?');
            });

            await setupApolloServerAndFetchPair();

            const result = await apolloFetch({
              query: `{fieldWhichWillError}`,
            });
            expect(result.data).toEqual({
              fieldWhichWillError: null,
            });
            expect(result.errors).toBeDefined();

            // The original error message should still be sent to the client.
            expect(result.errors[0].message).toEqual('how do I stack up?');
            expect(throwError).toHaveBeenCalledTimes(1);

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);
            const trace = Object.values(reports[0].tracesPerQuery)[0]
              .trace![0] as Trace;

            // There should be no error at the root, our error is a child.
            expect(trace.root!.error).toStrictEqual([]);

            // There should only be one child.
            expect(trace.root!.child!.length).toBe(1);

            // The error should not have the stack in it.
            expect(trace.root!.child![0].error![0]).not.toHaveProperty('stack');
            expect(
              JSON.parse(trace.root!.child![0].error![0].json!),
            ).not.toHaveProperty('stack');
          });

          it('sets the trace key to operationName when it is defined', async () => {
            await setupApolloServerAndFetchPair();

            const result = await apolloFetch({
              query: `query AnOperationName {justAField}`,
            });
            expect(result.data).toEqual({
              justAField: 'a string',
            });
            expect(result.errors).not.toBeDefined();

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);

            expect(Object.keys(reports[0].tracesPerQuery)[0]).toMatch(
              /^# AnOperationName\n/,
            );
          });

          it('sets the trace key to unknown operation for missing operation', async () => {
            await setupApolloServerAndFetchPair();

            await apolloFetch({
              query: `query notQ {justAField}`,
              operationName: 'q',
            });

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);

            expect(Object.keys(reports[0].tracesPerQuery)[0]).toBe(
              '## GraphQLUnknownOperationName\n',
            );
          });

          it('sets the trace key to parse failure when non-parseable gql', async () => {
            await setupApolloServerAndFetchPair();

            await apolloFetch({
              query: `{nonExistentField`,
            });

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);

            expect(Object.keys(reports[0].tracesPerQuery)[0]).toBe(
              '## GraphQLParseFailure\n',
            );
          });

          it('sets the trace key to validation failure when invalid operation', async () => {
            await setupApolloServerAndFetchPair();

            await apolloFetch({
              query: `{nonExistentField}`,
            });

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);

            expect(Object.keys(reports[0].tracesPerQuery)[0]).toBe(
              '## GraphQLValidationFailure\n',
            );
          });

          it('sets the trace key to "-" when operationName is undefined', async () => {
            await setupApolloServerAndFetchPair();

            const result = await apolloFetch({
              query: `{justAField}`,
            });
            expect(result.data).toEqual({
              justAField: 'a string',
            });
            expect(result.errors).not.toBeDefined();

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);

            expect(Object.keys(reports[0].tracesPerQuery)[0]).toMatch(/^# -\n/);
          });

          it("doesn't resort to query body signature on `didResolveOperation` error", async () => {
            await setupApolloServerAndFetchPair({}, {}, [
              {
                async requestDidStart() {
                  return {
                    didResolveOperation() {
                      throw new Error('known_error');
                    },
                  };
                },
              },
            ]);

            const result = await apolloFetch({
              query: `{ aliasedField: justAField }`,
            });

            expect(result.errors).toBeDefined();
            expect(result.errors[0].extensions).toBeDefined();
            expect(result.errors[0].message).toEqual('known_error');

            const reports = await reportIngress.promiseOfReports;
            expect(reports.length).toBe(1);

            expect(Object.keys(reports[0].tracesPerQuery)[0]).not.toEqual(
              '# -\n{ aliasedField: justAField }',
            );
          });

          it("doesn't internal server error on an APQ", async () => {
            await setupApolloServerAndFetchPair();

            const TEST_STRING_QUERY = `
              { onlyForThisApqTest${
                Math.random().toString().split('.')[1]
              }: justAField }
            `;
            const hash = sha256.create().update(TEST_STRING_QUERY).hex();

            const result = await apolloFetch({
              extensions: {
                persistedQuery: {
                  version: 1,
                  sha256Hash: hash,
                },
              },
            });

            // Having a persisted query not found error is fine.
            expect(result.errors).toContainEqual(
              expect.objectContaining({
                extensions: expect.objectContaining({
                  code: 'PERSISTED_QUERY_NOT_FOUND',
                }),
              }),
            );

            // However, having an internal server error is not okay!
            expect(result.errors).not.toContainEqual(
              expect.objectContaining({
                extensions: expect.objectContaining({
                  code: 'INTERNAL_SERVER_ERROR',
                }),
              }),
            );
          });

          describe('error munging', () => {
            describe('rewriteError', () => {
              it('new error', async () => {
                throwError.mockImplementationOnce(() => {
                  throw new Error('rewriteError nope');
                });

                await setupApolloServerAndFetchPair({
                  rewriteError: () =>
                    new GraphQLError('rewritten as a new error'),
                });

                const result = await apolloFetch({
                  query: `{fieldWhichWillError}`,
                });
                expect(result.data).toEqual({
                  fieldWhichWillError: null,
                });
                expect(result.errors).toBeDefined();

                // The original error message should be sent to the client.
                expect(result.errors[0].message).toEqual('rewriteError nope');
                expect(throwError).toHaveBeenCalledTimes(1);

                const reports = await reportIngress.promiseOfReports;
                expect(reports.length).toBe(1);
                const trace = Object.values(reports[0].tracesPerQuery)[0]
                  .trace![0] as Trace;
                // There should be no error at the root, our error is a child.
                expect(trace.root!.error).toStrictEqual([]);

                // There should only be one child.
                expect(trace.root!.child!.length).toBe(1);

                // The child should maintain the path, but have its message
                // rewritten.
                expect(trace.root!.child![0].error).toMatchObject([
                  {
                    json: '{"message":"rewritten as a new error","locations":[{"line":1,"column":2}],"path":["fieldWhichWillError"]}',
                    message: 'rewritten as a new error',
                    location: [{ column: 2, line: 1 }],
                  },
                ]);
              });

              it('modified error', async () => {
                throwError.mockImplementationOnce(() => {
                  throw new Error('rewriteError mod nope');
                });

                await setupApolloServerAndFetchPair({
                  rewriteError: (err) => {
                    err.message = 'rewritten as a modified error';
                    return err;
                  },
                });

                const result = await apolloFetch({
                  query: `{fieldWhichWillError}`,
                });
                expect(result.data).toEqual({
                  fieldWhichWillError: null,
                });
                expect(result.errors).toBeDefined();
                expect(result.errors[0].message).toEqual(
                  'rewriteError mod nope',
                );
                expect(throwError).toHaveBeenCalledTimes(1);

                const reports = await reportIngress.promiseOfReports;
                expect(reports.length).toBe(1);
                const trace = Object.values(reports[0].tracesPerQuery)[0]
                  .trace![0] as Trace;
                // There should be no error at the root, our error is a child.
                expect(trace.root!.error).toStrictEqual([]);

                // There should only be one child.
                expect(trace.root!.child!.length).toBe(1);

                // The child should maintain the path, but have its message
                // rewritten.
                expect(trace.root!.child![0].error).toMatchObject([
                  {
                    json: '{"message":"rewritten as a modified error","locations":[{"line":1,"column":2}],"path":["fieldWhichWillError"]}',
                    message: 'rewritten as a modified error',
                    location: [{ column: 2, line: 1 }],
                  },
                ]);
              });

              it('nulled error', async () => {
                throwError.mockImplementationOnce(() => {
                  throw new Error('rewriteError null nope');
                });

                await setupApolloServerAndFetchPair({
                  rewriteError: () => null,
                });

                const result = await apolloFetch({
                  query: `{fieldWhichWillError}`,
                });
                expect(result.data).toEqual({
                  fieldWhichWillError: null,
                });
                expect(result.errors).toBeDefined();
                expect(result.errors[0].message).toEqual(
                  'rewriteError null nope',
                );
                expect(throwError).toHaveBeenCalledTimes(1);

                const reports = await reportIngress.promiseOfReports;
                expect(reports.length).toBe(1);
                const trace = Object.values(reports[0].tracesPerQuery)[0]
                  .trace![0] as Trace;

                // There should be no error at the root, our error is a child.
                expect(trace.root!.error).toStrictEqual([]);

                // There should only be one child.
                expect(trace.root!.child!.length).toBe(1);

                // There should be no error in the trace for this property!
                expect(trace.root!.child![0].error).toStrictEqual([]);
              });
            });

            it('undefined error', async () => {
              throwError.mockImplementationOnce(() => {
                throw new Error('rewriteError undefined whoops');
              });

              await setupApolloServerAndFetchPair({
                rewriteError: () => undefined as any,
              });

              const result = await apolloFetch({
                query: `{fieldWhichWillError}`,
              });
              expect(result.data).toEqual({
                fieldWhichWillError: null,
              });
              expect(result.errors).toBeDefined();
              expect(result.errors[0].message).toEqual(
                'rewriteError undefined whoops',
              );
              expect(throwError).toHaveBeenCalledTimes(1);

              const reports = await reportIngress.promiseOfReports;
              expect(reports.length).toBe(1);
              const trace = Object.values(reports[0].tracesPerQuery)[0]
                .trace![0] as Trace;

              // There should be no error at the root, our error is a child.
              expect(trace.root!.error).toStrictEqual([]);

              // There should only be one child.
              expect(trace.root!.child!.length).toBe(1);

              // The child should maintain the path, but have its message
              // rewritten.
              expect(trace.root!.child![0].error).toMatchObject([
                {
                  json: '{"message":"rewriteError undefined whoops","locations":[{"line":1,"column":2}],"path":["fieldWhichWillError"]}',
                  message: 'rewriteError undefined whoops',
                  location: [{ column: 2, line: 1 }],
                },
              ]);
            });
          });
        });
      });

      it('errors thrown in plugins call formatError and are wrapped', async () => {
        const pluginCalled = jest.fn(() => {
          throw new Error('nope');
        });
        const formatError = jest.fn((error) => {
          expect(error instanceof Error).toBe(true);
          // extension should be called before formatError
          expect(pluginCalled).toHaveBeenCalledTimes(1);
          error.message = 'masked';
          return error;
        });
        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              fieldWhichWillError: String
            }
          `,
          resolvers: {
            Query: {
              fieldWhichWillError: () => {},
            },
          },
          plugins: [
            {
              async requestDidStart() {
                return {
                  async willSendResponse() {
                    // formatError should be called after plugins
                    expect(formatError).not.toBeCalled();
                    pluginCalled();
                  },
                };
              },
            },
          ],
          formatError,
          debug: true,
        });
        const apolloFetch = createApolloFetch({ uri });
        const result = await apolloFetch({
          query: `{fieldWhichWillError}`,
        });
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(result.errors[0].message).toEqual('masked');
        expect(formatError).toHaveBeenCalledTimes(1);
      });

      describe('context field', () => {
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

        it('defers context eval with thunk until after options creation', async () => {
          const uniqueContext = { key: 'major' };
          const typeDefs = gql`
            type Query {
              hello: String
            }
          `;
          const resolvers = {
            Query: {
              hello: (_parent: any, _args: any, context: any) => {
                expect(context).toEqual(Promise.resolve(uniqueContext));
                return 'hi';
              },
            },
          };
          const spy = jest.fn(() => ({}));
          const { url: uri } = await createApolloServer({
            typeDefs,
            resolvers,
            context: spy,
          });

          const apolloFetch = createApolloFetch({ uri });

          expect(spy).not.toBeCalled();

          await apolloFetch({ query: '{hello}' });
          expect(spy).toHaveBeenCalledTimes(1);
          await apolloFetch({ query: '{hello}' });
          expect(spy).toHaveBeenCalledTimes(2);
        });

        describe('context cloning', () => {
          it('clones the context for request pipeline requests', async () => {
            const uniqueContext = { key: 'major' };
            const spy = jest.fn(() => 'hi');
            const typeDefs = gql`
              type Query {
                hello: String
              }
            `;
            const resolvers = {
              Query: {
                hello: (_parent: any, _args: any, context: any) => {
                  expect(context.key).toEqual('major');
                  context.key = 'minor';
                  return spy();
                },
              },
            };
            const { url: uri } = await createApolloServer({
              typeDefs,
              resolvers,
              context: uniqueContext,
            });

            const apolloFetch = createApolloFetch({ uri });

            expect(spy).not.toBeCalled();

            await apolloFetch({ query: '{hello}' });
            expect(spy).toHaveBeenCalledTimes(1);
            await apolloFetch({ query: '{hello}' });
            expect(spy).toHaveBeenCalledTimes(2);
          });

          // https://github.com/apollographql/apollo-server/issues/4170
          it('for every request with executeOperation', async () => {
            const uniqueContext = { key: 'major' };
            const spy = jest.fn(() => 'hi');
            const typeDefs = gql`
              type Query {
                hello: String
              }
            `;
            const resolvers = {
              Query: {
                hello: (_parent: any, _args: any, context: any) => {
                  expect(context.key).toEqual('major');
                  context.key = 'minor';
                  return spy();
                },
              },
            };
            const { server } = await createApolloServer({
              typeDefs,
              resolvers,
              context: uniqueContext,
            });

            expect(spy).not.toBeCalled();

            await server.executeOperation({ query: '{hello}' });
            expect(spy).toHaveBeenCalledTimes(1);
            await server.executeOperation({ query: '{hello}' });
            expect(spy).toHaveBeenCalledTimes(2);
          });
        });

        describe('as a function', () => {
          it('can accept and return `req`', async () => {
            expect(
              await createApolloServer({
                typeDefs,
                resolvers,
                context: ({ req }) => ({ req }),
              }),
            ).not.toThrow;
          });

          it('can accept nothing and return an empty object', async () => {
            expect(
              await createApolloServer({
                typeDefs,
                resolvers,
                context: () => ({}),
              }),
            ).not.toThrow;
          });

          it('can be an async function', async () => {
            const uniqueContext = { key: 'major' };
            const spy = jest.fn(() => 'hi');
            const typeDefs = gql`
              type Query {
                hello: String
              }
            `;
            const resolvers = {
              Query: {
                hello: (_parent: any, _args: any, context: any) => {
                  expect(context.key).toEqual('major');
                  return spy();
                },
              },
            };
            const { url: uri } = await createApolloServer({
              typeDefs,
              resolvers,
              context: async () => uniqueContext,
            });

            const apolloFetch = createApolloFetch({ uri });

            expect(spy).not.toBeCalled();
            await apolloFetch({ query: '{hello}' });
            expect(spy).toHaveBeenCalledTimes(1);
          });

          it('returns thrown context error as a valid graphql result', async () => {
            const typeDefs = gql`
              type Query {
                hello: String
              }
            `;
            const resolvers = {
              Query: {
                hello: () => {
                  throw Error('never get here');
                },
              },
            };
            const { url: uri } = await createApolloServer({
              typeDefs,
              resolvers,
              stopOnTerminationSignals: false,
              __testing_nodeEnv__: undefined,
              context: () => {
                throw new AuthenticationError('valid result');
              },
            });

            const apolloFetch = createApolloFetch({ uri });

            const result = await apolloFetch({ query: '{hello}' });
            expect(result.errors.length).toEqual(1);
            expect(result.data).toBeUndefined();

            const e = result.errors[0];
            expect(e.message).toMatch('valid result');
            expect(e.extensions).toBeDefined();
            expect(e.extensions.code).toEqual('UNAUTHENTICATED');
            expect(e.extensions.exception.stacktrace).toBeDefined();
          });
        });

        describe('as an object', () => {
          it('can be an empty object', async () => {
            expect(
              await createApolloServer({
                typeDefs,
                resolvers,
                context: {},
              }),
            ).not.toThrow;
          });

          it('can contain arbitrary values', async () => {
            expect(
              await createApolloServer({
                typeDefs,
                resolvers,
                context: { value: 'arbitrary' },
              }),
            ).not.toThrow;
          });
        });
      });

      it('propagates error codes in production', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              fieldWhichWillError: String
            }
          `,
          resolvers: {
            Query: {
              fieldWhichWillError: () => {
                throw new AuthenticationError('we the best music');
              },
            },
          },
          stopOnTerminationSignals: false,
          __testing_nodeEnv__: 'production',
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({ query: `{fieldWhichWillError}` });
        expect(result.data).toBeDefined();
        expect(result.data).toEqual({ fieldWhichWillError: null });

        expect(result.errors).toBeDefined();
        expect(result.errors.length).toEqual(1);
        expect(result.errors[0].extensions.code).toEqual('UNAUTHENTICATED');
        expect(result.errors[0].extensions.exception).toBeUndefined();
      });

      it('propagates error codes with null response in production', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              fieldWhichWillError: String!
            }
          `,
          resolvers: {
            Query: {
              fieldWhichWillError: () => {
                throw new AuthenticationError('we the best music');
              },
            },
          },
          stopOnTerminationSignals: false,
          __testing_nodeEnv__: 'production',
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({ query: `{fieldWhichWillError}` });
        expect(result.data).toBeNull();

        expect(result.errors).toBeDefined();
        expect(result.errors.length).toEqual(1);
        expect(result.errors[0].extensions.code).toEqual('UNAUTHENTICATED');
        expect(result.errors[0].extensions.exception).toBeUndefined();
      });

      it('shows ApolloError extensions in extensions (only!)', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: gql`
            type Query {
              fieldWhichWillError: String
            }
          `,
          resolvers: {
            Query: {
              fieldWhichWillError: () => {
                throw new ApolloError('Some message', 'SOME_CODE', {
                  ext1: 'myext',
                });
              },
            },
          },
          stopOnTerminationSignals: false,
          __testing_nodeEnv__: 'development',
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({ query: `{fieldWhichWillError}` });
        expect(result.data).toEqual({ fieldWhichWillError: null });

        expect(result.errors).toBeDefined();
        expect(result.errors.length).toEqual(1);
        expect(result.errors[0].message).toEqual('Some message');
        expect(result.errors[0].extensions.code).toEqual('SOME_CODE');
        expect(result.errors[0].extensions.ext1).toEqual('myext');
        expect(result.errors[0].extensions.exception).toBeDefined();
        expect(result.errors[0].extensions.exception.ext1).toBeUndefined();
      });
    });

    describe('Persisted Queries', () => {
      let uri: string;
      const query = gql`
        ${TEST_STRING_QUERY}
      `;
      const hash = sha256.create().update(TEST_STRING_QUERY).hex();
      const extensions = {
        persistedQuery: {
          version: 1,
          sha256Hash: hash,
        },
      };

      beforeEach(async () => {
        const serverInfo = await createApolloServer({
          schema,
          introspection: false,
          persistedQueries: {
            cache: new Map<string, string>() as any,
          },
        });
        uri = serverInfo.url;
      });

      it('returns PersistedQueryNotFound on the first try', async () => {
        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({
          extensions,
        } as any);

        expect(result.data).toBeUndefined();
        expect(result.errors.length).toEqual(1);
        expect(result.errors[0].message).toEqual('PersistedQueryNotFound');
        expect(result.errors[0].extensions.code).toEqual(
          'PERSISTED_QUERY_NOT_FOUND',
        );
      });
      it('returns result on the second try', async () => {
        const apolloFetch = createApolloFetch({ uri });

        await apolloFetch({
          extensions,
        } as any);
        const result = await apolloFetch({
          extensions,
          query: TEST_STRING_QUERY,
        } as any);

        expect(result.data).toEqual({ testString: 'test string' });
        expect(result.errors).toBeUndefined();
      });

      it('returns result on the persisted query', async () => {
        const apolloFetch = createApolloFetch({ uri });

        await apolloFetch({
          extensions,
        } as any);
        await apolloFetch({
          extensions,
          query: TEST_STRING_QUERY,
        } as any);
        const result = await apolloFetch({
          extensions,
        } as any);

        expect(result.data).toEqual({ testString: 'test string' });
        expect(result.errors).toBeUndefined();
      });

      // Apollo Fetch's result depends on the server implementation, if the
      // statusText of the error is unparsable, then we'll fall into the catch,
      // such as with express. If it is parsable, then we'll use the afterware
      it('returns error when hash does not match', async () => {
        const apolloFetch = createApolloFetch({ uri }).useAfter((res, next) => {
          expect(res.response.status).toEqual(400);
          expect(res.response.raw).toMatch(/does not match query/);
          next();
        });

        try {
          await apolloFetch({
            extensions: {
              persistedQuery: {
                version: 1,
                sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            },
            query: TEST_STRING_QUERY,
          } as any);
        } catch (e) {
          expect(e.response).toBeDefined();
          expect(e.response.status).toEqual(400);
          expect(e.response.raw).toMatch(/does not match query/);
        }
      });

      it('returns correct result for persisted query link', (done) => {
        const variables = { id: 1 };
        const link = createPersistedQueryLink({ sha256 }).concat(
          createHttpLink({ uri, fetch } as any),
        );

        execute(link, { query, variables } as any).subscribe((result) => {
          expect(result.data).toEqual({ testString: 'test string' });
          done();
        }, done.fail);
      });

      it('returns correct result for persisted query link using get request', (done) => {
        const variables = { id: 1 };
        const link = createPersistedQueryLink({
          sha256,
          useGETForHashedQueries: true,
        }).concat(createHttpLink({ uri, fetch } as any));

        execute(link, { query, variables } as any).subscribe((result) => {
          expect(result.data).toEqual({ testString: 'test string' });
          done();
        }, done.fail);
      });
    });

    describe('usage reporting', () => {
      async function makeFakeUsageReportingServer({
        status,
        waitWriteResponse = false,
      }: {
        status: number;
        waitWriteResponse?: boolean;
      }) {
        const writeResponsePromise = resolvable();
        const fakeUsageReportingServer = http.createServer(async (_, res) => {
          await writeResponsePromise;
          res.writeHead(status);
          res.end('Important text in the body');
        });
        await new Promise<void>((resolve) => {
          fakeUsageReportingServer.listen(0, '127.0.0.1', () => {
            resolve();
          });
        });
        async function closeServer() {
          await new Promise<void>((resolve) =>
            fakeUsageReportingServer.close(() => resolve()),
          );
        }

        const { family, address, port } =
          fakeUsageReportingServer.address() as AddressInfo;
        if (family !== 'IPv4') {
          throw new Error(`The family was unexpectedly ${family}.`);
        }

        const fakeUsageReportingUrl = `http://${address}:${port}`;

        if (!waitWriteResponse) {
          writeResponsePromise.resolve();
        }

        return {
          closeServer,
          fakeUsageReportingUrl,
          writeResponseResolve: () => writeResponsePromise.resolve(),
        };
      }

      describe('graphql server functions even when Apollo servers are down', () => {
        async function testWithStatus(
          status: number,
          expectedRequestCount: number,
        ) {
          const networkError = status === 0;

          const { closeServer, fakeUsageReportingUrl, writeResponseResolve } =
            await makeFakeUsageReportingServer({
              status,
              waitWriteResponse: true,
            });

          try {
            // To simulate a network error, we create and close the server.
            // This lets us still generate a port that is hopefully unused.
            if (networkError) {
              await closeServer();
            }

            let requestCount = 0;
            const requestAgent = new http.Agent({ keepAlive: false });
            const realCreateConnection = (requestAgent as any).createConnection;
            (requestAgent as any).createConnection = function () {
              requestCount++;
              return realCreateConnection.apply(this, arguments);
            };

            let reportErrorPromiseResolve: (error: Error) => void;
            const reportErrorPromise = new Promise<Error>(
              (resolve) => (reportErrorPromiseResolve = resolve),
            );
            const { url: uri } = await createApolloServer({
              typeDefs: gql`
                type Query {
                  something: String!
                }
              `,
              resolvers: { Query: { something: () => 'hello' } },
              apollo: {
                key: 'service:my-app:secret',
                graphRef: 'my-app@current',
              },
              plugins: [
                ApolloServerPluginUsageReporting({
                  endpointUrl: fakeUsageReportingUrl,
                  reportIntervalMs: 1,
                  maxAttempts: 3,
                  requestAgent,
                  logger: quietLogger,
                  reportErrorFunction(error: Error) {
                    reportErrorPromiseResolve(error);
                  },
                }),
              ],
            });

            const apolloFetch = createApolloFetch({ uri });

            // Run a GraphQL query. Ensure that it returns successfully even
            // though reporting is going to fail. (Note that reporting can't
            // actually have failed yet (except in the network-error case)
            // because we haven't let writeResponsePromise resolve.)
            const result = await apolloFetch({
              query: `{ something }`,
            });
            expect(result.data.something).toBe('hello');

            if (!networkError) {
              // Allow reporting to return its response (for every retry).
              writeResponseResolve();
            }

            // Make sure we can get the error from reporting.
            const sendingError = await reportErrorPromise;
            expect(sendingError).toBeTruthy();
            if (networkError) {
              expect(sendingError.message).toContain(
                'Error sending report to Apollo servers',
              );
              expect(sendingError.message).toContain('ECONNREFUSED');
            } else {
              expect(sendingError.message).toBe(
                `Error sending report to Apollo servers: HTTP status ${status}, Important text in the body`,
              );
            }
            expect(requestCount).toBe(expectedRequestCount);
          } finally {
            if (!networkError) {
              await closeServer();
            }
          }
        }
        it('with retryable error', async () => {
          await testWithStatus(500, 3);
        });
        it('with network error', async () => {
          await testWithStatus(0, 3);
        });
        it('with non-retryable error', async () => {
          await testWithStatus(400, 1);
        });
      });
    });

    describe('Federated tracing', () => {
      // Enable federated tracing by pretending to be federated.
      const federationTypeDefs = gql`
        type _Service {
          sdl: String
        }
      `;

      const baseTypeDefs = gql`
        type Book {
          title: String
          author: String
        }

        type Movie {
          title: String
        }

        type Query {
          books: [Book]
          movies: [Movie]
          error: String
        }
      `;

      const allTypeDefs = [federationTypeDefs, baseTypeDefs];

      const resolvers = {
        Query: {
          books: () =>
            new Promise((resolve) =>
              setTimeout(() => resolve([{ title: 'H', author: 'J' }]), 10),
            ),
          movies: () =>
            new Promise((resolve) =>
              setTimeout(() => resolve([{ title: 'H' }]), 12),
            ),
          error: () => {
            throw new GraphQLError('It broke');
          },
        },
      };

      function createApolloFetchAsIfFromGateway(uri: string): ApolloFetch {
        return createApolloFetch({ uri }).use(({ options }, next) => {
          options.headers = { 'apollo-federation-include-trace': 'ftv1' };
          next();
        });
      }

      it("doesn't include federated trace without the special header", async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: allTypeDefs,
          resolvers,
          logger: quietLogger,
        });

        const apolloFetch = createApolloFetch({ uri });

        const result = await apolloFetch({
          query: `{ books { title author } }`,
        });

        expect(result.extensions).toBeUndefined();
      });

      it("doesn't include federated trace without _Service in the schema", async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: baseTypeDefs,
          resolvers,
        });

        const apolloFetch = createApolloFetchAsIfFromGateway(uri);

        const result = await apolloFetch({
          query: `{ books { title author } }`,
        });

        expect(result.extensions).toBeUndefined();
      });

      it('reports a total duration that is longer than the duration of its resolvers', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: allTypeDefs,
          resolvers,
          logger: quietLogger,
        });

        const apolloFetch = createApolloFetchAsIfFromGateway(uri);

        const result = await apolloFetch({
          query: `{ books { title author } }`,
        });

        const ftv1: string = result.extensions.ftv1;

        expect(ftv1).toBeTruthy();
        const encoded = Buffer.from(ftv1, 'base64');
        const trace = Trace.decode(encoded);

        let earliestStartOffset = Infinity;
        let latestEndOffset = -Infinity;
        function walk(node: Trace.Node) {
          if (node.startTime !== 0 && node.endTime !== 0) {
            earliestStartOffset = Math.min(earliestStartOffset, node.startTime);
            latestEndOffset = Math.max(latestEndOffset, node.endTime);
          }
          node.child.forEach((n) => walk(n as Trace.Node));
        }
        walk(trace.root as Trace.Node);
        expect(earliestStartOffset).toBeLessThan(Infinity);
        expect(latestEndOffset).toBeGreaterThan(-Infinity);
        const resolverDuration = latestEndOffset - earliestStartOffset;
        expect(resolverDuration).toBeGreaterThan(0);
        expect(trace.durationNs).toBeGreaterThanOrEqual(resolverDuration);

        expect(trace.startTime!.seconds).toBeLessThanOrEqual(
          trace.endTime!.seconds!,
        );
        if (trace.startTime!.seconds === trace.endTime!.seconds) {
          expect(trace.startTime!.nanos).toBeLessThanOrEqual(
            trace.endTime!.nanos!,
          );
        }
      });

      it('includes errors in federated trace', async () => {
        const { url: uri } = await createApolloServer({
          typeDefs: allTypeDefs,
          resolvers,
          formatError(err) {
            err.message = `Formatted: ${err.message}`;
            return err;
          },
          plugins: [
            ApolloServerPluginInlineTrace({
              rewriteError(err) {
                err.message = `Rewritten for Usage Reporting: ${err.message}`;
                return err;
              },
            }),
          ],
        });

        const apolloFetch = createApolloFetchAsIfFromGateway(uri);

        const result = await apolloFetch({
          query: `{ error }`,
        });

        expect(result.data).toStrictEqual({ error: null });
        expect(result.errors).toBeTruthy();
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Formatted: It broke');

        const ftv1: string = result.extensions.ftv1;

        expect(ftv1).toBeTruthy();
        const encoded = Buffer.from(ftv1, 'base64');
        const trace = Trace.decode(encoded);
        expect(trace.root!.child![0].error![0].message).toBe(
          'Rewritten for Usage Reporting: It broke',
        );
      });
    });

    describe('Response caching', () => {
      let clock: FakeTimers.Clock;
      beforeAll(() => {
        clock = FakeTimers.install();
      });

      afterAll(() => {
        clock.uninstall();
      });

      it('basic caching', async () => {
        const typeDefs = gql`
          type Query {
            cached: String @cacheControl(maxAge: 10)
            asynccached: String @cacheControl(maxAge: 10)
            asyncuncached: String @cacheControl(maxAge: 10)
            asyncnowrite: String @cacheControl(maxAge: 10)
            uncached: String
            private: String @cacheControl(maxAge: 9, scope: PRIVATE)
          }

          enum CacheControlScope {
            PUBLIC
            PRIVATE
          }

          directive @cacheControl(
            maxAge: Int
            scope: CacheControlScope
          ) on FIELD_DEFINITION | OBJECT | INTERFACE
        `;

        type FieldName =
          | 'cached'
          | 'asynccached'
          | 'asyncuncached'
          | 'asyncnowrite'
          | 'uncached'
          | 'private';
        const fieldNames: FieldName[] = [
          'cached',
          'asynccached',
          'asyncuncached',
          'asyncnowrite',
          'uncached',
          'private',
        ];
        const resolverCallCount = {} as Record<FieldName, number>;
        const expectedResolverCallCount = {} as Record<FieldName, number>;
        const expectCacheHit = (fn: FieldName) =>
          expect(resolverCallCount[fn]).toBe(expectedResolverCallCount[fn]);
        const expectCacheMiss = (fn: FieldName) =>
          expect(resolverCallCount[fn]).toBe(++expectedResolverCallCount[fn]);

        const resolvers = {
          Query: {} as Record<FieldName, () => string>,
        };
        fieldNames.forEach((name) => {
          resolverCallCount[name] = 0;
          expectedResolverCallCount[name] = 0;
          resolvers.Query[name] = () => {
            resolverCallCount[name]++;
            return `value:${name}`;
          };
        });

        const { url: uri } = await createApolloServer({
          typeDefs,
          resolvers,
          plugins: [
            ApolloServerPluginResponseCache({
              sessionId: (requestContext: GraphQLRequestContext<any>) => {
                return (
                  requestContext.request.http!.headers.get('session-id') || null
                );
              },
              extraCacheKeyData: (
                requestContext: GraphQLRequestContext<any>,
              ) => {
                return (
                  requestContext.request.http!.headers.get(
                    'extra-cache-key-data',
                  ) || null
                );
              },
              shouldReadFromCache: (
                requestContext: GraphQLRequestContext<any>,
              ) => {
                if (
                  requestContext.request.http!.headers.get('no-read-from-cache')
                )
                  return false;

                if (requestContext.request.query!.indexOf('asynccached') >= 0) {
                  return new Promise((resolve) => resolve(true));
                }

                if (
                  requestContext.request.query!.indexOf('asyncuncached') >= 0
                ) {
                  return new Promise((resolve) => resolve(false));
                }

                return true;
              },
              shouldWriteToCache: (
                requestContext: GraphQLRequestContext<any>,
              ) => {
                if (
                  requestContext.request.http!.headers.get('no-write-to-cache')
                )
                  return false;

                if (
                  requestContext.request.query!.indexOf('asyncnowrite') >= 0
                ) {
                  return new Promise((resolve) => resolve(false));
                }

                return true;
              },
            }),
          ],
        });

        const apolloFetch = createApolloFetch({ uri });
        apolloFetch.use(({ request, options }, next) => {
          const headers = (request as any).headers;
          if (headers) {
            if (!options.headers) {
              options.headers = {};
            }
            for (const k in headers) {
              (options.headers as any)[k] = headers[k];
            }
          }
          next();
        });
        // Make HTTP response headers visible on the result next to 'data'.
        apolloFetch.useAfter(({ response }, next) => {
          response.parsed.httpHeaders = response.headers;
          next();
        });
        // Use 'any' because we're sneaking httpHeaders onto response.parsed.
        function httpHeader(result: any, header: string): string | null {
          const value = (result.httpHeaders as Headers).get(header);
          // hack: hapi sets cache-control: no-cache by default; make it
          // look to our tests like the other servers.
          if (header === 'cache-control' && value === 'no-cache') {
            return null;
          }
          return value;
        }
        // Just for the typing.
        function doFetch(
          options: GraphQLRequest & { headers?: Record<string, string> },
        ) {
          return apolloFetch(options as any);
        }

        const basicQuery = '{ cached }';
        const fetch = async () => {
          const result = await doFetch({
            query: basicQuery,
          });
          expect(result.data.cached).toBe('value:cached');
          return result;
        };

        // Cache miss
        {
          const result = await fetch();
          expectCacheMiss('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
          expect(httpHeader(result, 'age')).toBe(null);
        }

        // Cache hit
        {
          const result = await fetch();
          expectCacheHit('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
          expect(httpHeader(result, 'age')).toBe('0');
        }

        // Cache hit partway to ttl.
        clock.tick(5 * 1000);
        {
          const result = await fetch();
          expectCacheHit('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
          expect(httpHeader(result, 'age')).toBe('5');
        }

        // Cache miss after ttl.
        clock.tick(6 * 1000);
        {
          const result = await fetch();
          expectCacheMiss('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
          expect(httpHeader(result, 'age')).toBe(null);
        }

        // Cache hit async
        {
          await doFetch({
            query: '{asynccached}',
          });
          expectCacheMiss('asynccached');

          await doFetch({
            query: '{asynccached}',
          });
          expectCacheHit('asynccached');
        }

        // Cache Miss async
        {
          await doFetch({
            query: '{asyncuncached}',
          });
          expectCacheMiss('asyncuncached');

          await doFetch({
            query: '{asyncuncached}',
          });
          expectCacheMiss('asyncuncached');
        }

        // Even we cache read, we did not write (async)
        {
          const asyncNoWriteQuery = '{asyncnowrite}';
          await doFetch({
            query: asyncNoWriteQuery,
          });
          expectCacheMiss('asyncnowrite');

          const result = await doFetch({
            query: asyncNoWriteQuery,
          });
          expectCacheMiss('asyncnowrite');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
        }

        // Cache hit.
        {
          const result = await fetch();
          expectCacheHit('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
          expect(httpHeader(result, 'age')).toBe('0');
        }

        // For now, caching is based on the original document text, not the AST,
        // so this should be a cache miss.
        {
          const result = await doFetch({
            query: '{       cached           }',
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheMiss('cached');
        }

        // This definitely should be a cache miss because the output is different.
        {
          const result = await doFetch({
            query: '{alias: cached}',
          });
          expect(result.data.alias).toBe('value:cached');
          expectCacheMiss('cached');
        }

        // Reading both a cached and uncached data should not get cached (it's a
        // full response cache).
        {
          const result = await doFetch({
            query: '{cached uncached}',
          });
          expect(result.data.cached).toBe('value:cached');
          expect(result.data.uncached).toBe('value:uncached');
          expectCacheMiss('cached');
          expectCacheMiss('uncached');
          expect(httpHeader(result, 'cache-control')).toBe(null);
          expect(httpHeader(result, 'age')).toBe(null);
        }

        // Just double-checking that it didn't get cached.
        {
          const result = await doFetch({
            query: '{cached uncached}',
          });
          expect(result.data.cached).toBe('value:cached');
          expect(result.data.uncached).toBe('value:uncached');
          expectCacheMiss('cached');
          expectCacheMiss('uncached');
          expect(httpHeader(result, 'cache-control')).toBe(null);
          expect(httpHeader(result, 'age')).toBe(null);
        }

        // Let's just remind ourselves that the basic query is cacheable.
        {
          await doFetch({ query: basicQuery });
          expectCacheHit('cached');
        }

        // But if we give it some extra cache key data, it'll be cached separately.
        {
          const result = await doFetch({
            query: basicQuery,
            headers: { 'extra-cache-key-data': 'foo' },
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheMiss('cached');
        }

        // But if we give it the same extra cache key data twice, it's a hit.
        {
          const result = await doFetch({
            query: basicQuery,
            headers: { 'extra-cache-key-data': 'foo' },
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheHit('cached');
        }

        // Without a session ID, private fields won't be cached.
        {
          const result = await doFetch({
            query: '{private}',
          });
          expect(result.data.private).toBe('value:private');
          expectCacheMiss('private');
          // Note that the HTTP header calculator doesn't know about session
          // IDs, so it'll still tell HTTP-level caches to cache this, albeit
          // privately.
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=9, private',
          );
          expect(httpHeader(result, 'age')).toBe(null);
        }

        // See?
        {
          const result = await doFetch({
            query: '{private}',
          });
          expect(result.data.private).toBe('value:private');
          expectCacheMiss('private');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=9, private',
          );
        }

        // OK, how about with a session ID.  First try should be a miss.
        {
          const result = await doFetch({
            query: '{private}',
            headers: { 'session-id': 'foo' },
          });
          expect(result.data.private).toBe('value:private');
          expectCacheMiss('private');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=9, private',
          );
        }

        // But next try should be a hit.
        {
          const result = await doFetch({
            query: '{private}',
            headers: { 'session-id': 'foo' },
          });
          expect(result.data.private).toBe('value:private');
          expectCacheHit('private');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=9, private',
          );
        }

        // But a different session ID should be a miss again.
        {
          const result = await doFetch({
            query: '{private}',
            headers: { 'session-id': 'bar' },
          });
          expect(result.data.private).toBe('value:private');
          expectCacheMiss('private');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=9, private',
          );
        }

        // As should be no session.
        {
          const result = await doFetch({
            query: '{private}',
          });
          expect(result.data.private).toBe('value:private');
          expectCacheMiss('private');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=9, private',
          );
        }

        // Let's remind ourselves once again that the basic (public) query is *still* cached.
        {
          const result = await doFetch({ query: basicQuery });
          expectCacheHit('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
        }

        // If you're logged in, though, you get your own cache shared with all
        // other authenticated users (the "authenticated public" cache), so this
        // is a miss. It's still a public cache, though, for the HTTP header.
        // XXX Does that makes sense? Maybe this should be private, or maybe we
        // should drop the entire "authenticated public" concept.
        {
          const result = await doFetch({
            query: basicQuery,
            headers: { 'session-id': 'bar' },
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheMiss('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
        }

        // See, this other session sees it!
        {
          const result = await doFetch({
            query: basicQuery,
            headers: { 'session-id': 'baz' },
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheHit('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
          expect(httpHeader(result, 'age')).toBe('0');
        }

        // Let's continue to remind ourselves that the basic (public) query is *still* cached.
        {
          const result = await doFetch({ query: basicQuery });
          expectCacheHit('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
        }

        // But what if we specifically ask to not read from the cache?
        {
          const result = await doFetch({
            query: basicQuery,
            headers: { 'no-read-from-cache': 'y' },
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheMiss('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
        }

        // Let's expire the cache, and run again, not writing to the cache.
        clock.tick(15 * 1000);
        {
          const result = await doFetch({
            query: basicQuery,
            headers: { 'no-write-to-cache': 'y' },
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheMiss('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
        }

        // And now verify that in fact we did not write!
        {
          const result = await doFetch({
            query: basicQuery,
          });
          expect(result.data.cached).toBe('value:cached');
          expectCacheMiss('cached');
          expect(httpHeader(result, 'cache-control')).toBe(
            'max-age=10, public',
          );
        }
      });
    });

    describe('Gateway', () => {
      it('receives schema updates from the gateway', async () => {
        const makeQueryTypeWithField = (fieldName: string) =>
          new GraphQLSchema({
            query: new GraphQLObjectType({
              name: 'QueryType',
              fields: {
                [fieldName]: {
                  type: GraphQLString,
                },
              },
            }),
          });

        const executor = (req: GraphQLRequestContextExecutionDidStart<any>) =>
          (req.source as string).match(/1/)
            ? Promise.resolve({ data: { testString1: 'hello' } })
            : Promise.resolve({ data: { testString2: 'aloha' } });

        const { gateway, triggers } = makeGatewayMock({ executor });

        triggers.resolveLoad({
          schema: makeQueryTypeWithField('testString1'),
          executor,
        });

        const { url: uri } = await createApolloServer({
          gateway,
        });

        const apolloFetch = createApolloFetch({ uri });
        const result1 = await apolloFetch({ query: '{testString1}' });

        expect(result1.data).toEqual({ testString1: 'hello' });
        expect(result1.errors).toBeUndefined();

        triggers.triggerSchemaChange!(makeQueryTypeWithField('testString2'));

        const result2 = await apolloFetch({ query: '{testString2}' });
        expect(result2.data).toEqual({ testString2: 'aloha' });
        expect(result2.errors).toBeUndefined();
      });

      it('passes apollo data to the gateway', async () => {
        const optionsSpy = jest.fn();

        const { gateway, triggers } = makeGatewayMock({ optionsSpy });
        triggers.resolveLoad({ schema, executor: async () => ({}) });
        await createApolloServer({
          gateway,
          apollo: { key: 'service:tester:1234abc', graphRef: 'tester@staging' },
          logger: quietLogger,
        });

        expect(optionsSpy).toHaveBeenLastCalledWith({
          apollo: {
            key: 'service:tester:1234abc',
            keyHash:
              '0ca858e7fe8cffc01c5f1db917d2463b348b50d267427e54c1c8c99e557b242f4145930b949905ec430642467613610e471c40bb7a251b1e2248c399bb0498c4',
            graphRef: 'tester@staging',
          },
        });
      });

      it('unsubscribes from schema update on close', async () => {
        const unsubscribeSpy = jest.fn();
        const { gateway, triggers } = makeGatewayMock({ unsubscribeSpy });
        triggers.resolveLoad({ schema, executor: async () => ({}) });
        await createApolloServer({ gateway });
        expect(unsubscribeSpy).not.toHaveBeenCalled();
        await stopServer();
        expect(unsubscribeSpy).toHaveBeenCalled();
      });

      it('waits until gateway has resolved a schema to respond to queries', async () => {
        let startPromiseResolver: any, endPromiseResolver: any;
        const startPromise = new Promise((res) => {
          startPromiseResolver = res;
        });
        const endPromise = new Promise((res) => {
          endPromiseResolver = res;
        });
        const executor = async () => {
          startPromiseResolver();
          await endPromise;
          return { data: { testString: 'hi - but federated!' } };
        };

        const { gateway, triggers } = makeGatewayMock({ executor });

        triggers.resolveLoad({ schema, executor });
        const { url: uri } = await createApolloServer({
          gateway,
        });
        const fetchComplete = jest.fn();
        const apolloFetch = createApolloFetch({ uri });
        const result = apolloFetch({ query: '{testString}' }).then((result) => {
          fetchComplete(result);
          return result;
        });
        expect(fetchComplete).not.toHaveBeenCalled();
        await startPromise;
        expect(fetchComplete).not.toHaveBeenCalled();
        endPromiseResolver();
        const resolved = await result;
        expect(fetchComplete).toHaveBeenCalled();
        expect(resolved.data).toEqual({ testString: 'hi - but federated!' });
        expect(resolved.errors).toBeUndefined();
      });

      it('can serve multiple active schemas simultaneously during a schema rollover', async () => {
        const makeQueryTypeWithField = (fieldName: string) =>
          new GraphQLSchema({
            query: new GraphQLObjectType({
              name: 'QueryType',
              fields: {
                [fieldName]: {
                  type: GraphQLString,
                },
              },
            }),
          });

        const executorData: Record<
          string,
          {
            startPromise: Resolvable<void>;
            endPromise: Resolvable<void>;
            i: number;
          }
        > = Object.create(null);
        [1, 2, 3].forEach((i) => {
          const query = `{testString${i}}`;
          executorData[query] = {
            startPromise: resolvable(),
            endPromise: resolvable(),
            i,
          };
        });

        const executor = async (
          req: GraphQLRequestContextExecutionDidStart<any>,
        ) => {
          const source = req.source as string;
          const { startPromise, endPromise, i } = executorData[source];
          startPromise.resolve();
          await endPromise;
          return { data: { [`testString${i}`]: `${i}` } };
        };

        const { gateway, triggers } = makeGatewayMock({ executor });

        triggers.resolveLoad({
          schema: makeQueryTypeWithField('testString1'),
          executor,
        });

        const { url: uri, server } = await createApolloServer({
          gateway,
        });

        const apolloFetch = createApolloFetch({ uri });
        const result1 = apolloFetch({ query: '{testString1}' });
        await executorData['{testString1}'].startPromise;
        triggers.triggerSchemaChange!(makeQueryTypeWithField('testString2'));
        // Hacky, but: executeOperation awaits schemaDerivedData, so when it
        // finishes we know the new schema is loaded.
        await server.executeOperation({ query: '{__typename}' });
        const result2 = apolloFetch({ query: '{testString2}' });
        await executorData['{testString2}'].startPromise;
        triggers.triggerSchemaChange!(makeQueryTypeWithField('testString3'));
        await server.executeOperation({ query: '{__typename}' });
        const result3 = apolloFetch({ query: '{testString3}' });
        await executorData['{testString3}'].startPromise;
        executorData['{testString3}'].endPromise.resolve();
        executorData['{testString1}'].endPromise.resolve();
        executorData['{testString2}'].endPromise.resolve();

        await Promise.all([result1, result2, result3]).then(([v1, v2, v3]) => {
          expect(v1.errors).toBeUndefined();
          expect(v2.errors).toBeUndefined();
          expect(v3.errors).toBeUndefined();
          expect(v1.data).toEqual({ testString1: '1' });
          expect(v2.data).toEqual({ testString2: '2' });
          expect(v3.data).toEqual({ testString3: '3' });
        });
      });
    });

    describe('renderLandingPage', () => {
      let httpServer: http.Server;

      function getWithoutAcceptHeader(url: string) {
        return request(httpServer).get(url);
      }
      function get(url: string) {
        return getWithoutAcceptHeader(url).set('accept', 'text/html');
      }

      function makeServerConfig(htmls: string[]): Config {
        return {
          typeDefs: 'type Query {x: ID}',
          plugins: [
            ...htmls.map((html) => ({
              async serverWillStart() {
                return {
                  async renderLandingPage() {
                    return {
                      html,
                    };
                  },
                };
              },
            })),
          ],
          // dev mode, so we get the local landing page
          __testing_nodeEnv__: undefined,
        };
      }

      // Pass this to expect in the "not LandingPage, you are trying to do GraphQL
      // but didn't send a query" case, which we should maybe change to
      // something nicer than an ugly 400.
      const serveNoLandingPage = 400;

      it('defaults to LocalDefault', async () => {
        httpServer = (await createApolloServer(makeServerConfig([])))
          .httpServer;
        await get('/graphql').expect(
          200,
          /apollo-server-landing-page.cdn.apollographql.com\/_latest.*isProd[^t]+false/s,
        );
      });

      it('can specify version for LocalDefault', async () => {
        httpServer = (
          await createApolloServer({
            typeDefs: 'type Query {x: ID}',
            plugins: [
              ApolloServerPluginLandingPageLocalDefault({ version: 'abcdef' }),
            ],
          })
        ).httpServer;
        await get('/graphql').expect(
          200,
          /apollo-server-landing-page.cdn.apollographql.com\/abcdef.*isProd[^t]+false/s,
        );
      });

      it('can install playground with specific version', async () => {
        httpServer = (
          await createApolloServer({
            typeDefs: 'type Query {x: ID}',
            plugins: [
              ApolloServerPluginLandingPageGraphQLPlayground({
                version: '9.8.7',
              }),
            ],
          })
        ).httpServer;
        await get('/graphql')
          .expect(/Playground/)
          .expect(/react@9\.8\.7/);
      });

      it('can be disabled', async () => {
        httpServer = (
          await createApolloServer({
            typeDefs: 'type Query {x: ID}',
            plugins: [ApolloServerPluginLandingPageDisabled()],
          })
        ).httpServer;
        await get('/graphql').expect(serveNoLandingPage);
      });

      describe('basic functionality', () => {
        describe('with non-root graphqlPath', () => {
          beforeEach(async () => {
            httpServer = (
              await createApolloServer(makeServerConfig(['BAZ']), {
                graphqlPath: '/goofql',
              })
            ).httpServer;
          });

          it('basic GET works', async () => {
            await get('/goofql').expect(200, 'BAZ');
          });
          it('only mounts under graphqlPath', async () => {
            await get('/foo').expect(404);
          });
          it('needs the header', async () => {
            await getWithoutAcceptHeader('/goofql').expect(serveNoLandingPage);
          });
          it('trailing slash works', async () => {
            await get('/goofql/').expect(200, 'BAZ');
          });
        });

        describe('with root graphqlPath', () => {
          beforeEach(async () => {
            httpServer = (
              await createApolloServer(makeServerConfig(['BAZ']), {
                graphqlPath: '/',
              })
            ).httpServer;
          });

          it('basic GET works', async () => {
            await get('/').expect(200, 'BAZ');
          });
          it('needs the header', async () => {
            await getWithoutAcceptHeader('/').expect(serveNoLandingPage);
          });
        });
      });

      // Serverless frameworks don't have startup errors because they don't
      // have a startup phase.
      options.serverlessFramework ||
        describe('startup errors', () => {
          it('only one plugin can implement renderLandingPage', async () => {
            await expect(
              createApolloServer(makeServerConfig(['x', 'y'])),
            ).rejects.toThrow(
              'Only one plugin can implement renderLandingPage.',
            );
          });
        });
    });
  });
}
