// persisted query tests
import { sha256 } from 'js-sha256';

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLError,
  GraphQLNonNull,
  GraphQLScalarType,
  getIntrospectionQuery,
  BREAK,
  DocumentNode,
  getOperationAST,
  ValidationContext,
} from 'graphql';

import request from 'supertest';
import type { HTTPError } from 'superagent';
import resolvable from '@josephg/resolvable';

import {
  GraphQLOptions,
  Config,
  PersistedQueryOptions,
  KeyValueCache,
  ApolloServerPluginCacheControl,
} from 'apollo-server-core';
import gql from 'graphql-tag';
import { GraphQLResponse, ValueOrPromise } from 'apollo-server-types';
import { GraphQLRequestListener } from 'apollo-server-plugin-base';
import { PersistedQueryNotFoundError } from 'apollo-server-errors';

export * from './ApolloServer';
export { createApolloFetch } from './apolloFetch';

const QueryRootType = new GraphQLObjectType({
  name: 'QueryRoot',
  fields: {
    test: {
      type: GraphQLString,
      args: {
        who: {
          type: GraphQLString,
        },
      },
      resolve: (_, args) => 'Hello ' + (args['who'] || 'World'),
    },
    thrower: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: () => {
        throw new Error('Throws!');
      },
    },
    custom: {
      type: GraphQLString,
      args: {
        foo: {
          type: new GraphQLScalarType({
            name: 'Foo',
            serialize: (v) => v,
            parseValue: () => {
              throw new Error('Something bad happened');
            },
            parseLiteral: () => {
              throw new Error('Something bad happened');
            },
          }),
        },
      },
    },
    context: {
      type: GraphQLString,
      resolve: (_obj, _args, context) => context,
    },
  },
});

const TestSchema = new GraphQLSchema({
  query: QueryRootType,
  mutation: new GraphQLObjectType({
    name: 'MutationRoot',
    fields: {
      writeTest: {
        type: QueryRootType,
        resolve: () => ({}),
      },
    },
  }),
});

const personType = new GraphQLObjectType({
  name: 'PersonType',
  fields: {
    firstName: {
      type: GraphQLString,
    },
    lastName: {
      type: GraphQLString,
    },
  },
});

const queryType = new GraphQLObjectType({
  name: 'QueryType',
  fields: {
    testString: {
      type: GraphQLString,
      resolve() {
        return 'it works';
      },
    },
    testPerson: {
      type: personType,
      resolve() {
        return { firstName: 'Jane', lastName: 'Doe' };
      },
    },
    testPersonWithCacheControl: {
      type: personType,
      resolve(_source, _args, _context, info) {
        info.cacheControl.setCacheHint({ maxAge: 11 });
        return { firstName: 'Jane', lastName: 'Doe' };
      },
    },
    testStringWithDelay: {
      type: GraphQLString,
      args: {
        delay: { type: new GraphQLNonNull(GraphQLInt) },
      },
      resolve(_, args) {
        return new Promise((resolve) => {
          setTimeout(() => resolve('it works'), args['delay']);
        });
      },
    },
    testContext: {
      type: GraphQLString,
      resolve(_parent, _args, context) {
        if (context.otherField) {
          return 'unexpected';
        }
        context.otherField = true;
        return context.testField;
      },
    },
    testRootValue: {
      type: GraphQLString,
      resolve(rootValue) {
        return rootValue;
      },
    },
    testArgument: {
      type: GraphQLString,
      args: { echo: { type: GraphQLString } },
      resolve(_, { echo }) {
        return `hello ${echo}`;
      },
    },
    testError: {
      type: GraphQLString,
      resolve() {
        throw new Error('Secret error message');
      },
    },
  },
});

const mutationType = new GraphQLObjectType({
  name: 'MutationType',
  fields: {
    testMutation: {
      type: GraphQLString,
      args: { echo: { type: GraphQLString } },
      resolve(_, { echo }) {
        return `not really a mutation, but who cares: ${echo}`;
      },
    },
    testPerson: {
      type: personType,
      args: {
        firstName: {
          type: new GraphQLNonNull(GraphQLString),
        },
        lastName: {
          type: new GraphQLNonNull(GraphQLString),
        },
      },
      resolve(_, args) {
        return args;
      },
    },
  },
});

export const schema = new GraphQLSchema({
  query: queryType,
  mutation: mutationType,
});

export interface CreateAppOptions {
  excludeParser?: boolean;
  graphqlOptions?:
    | GraphQLOptions
    | { (): ValueOrPromise<GraphQLOptions> }
    | Config;
}

export interface CreateAppFunc {
  (options?: CreateAppOptions): Promise<any>;
}

export interface DestroyAppFunc {
  (app: any): ValueOrPromise<void>;
}

export default ({
  createApp,
  destroyApp,
  serverlessFramework,
  integrationName,
}: {
  createApp: CreateAppFunc;
  destroyApp?: DestroyAppFunc;
  serverlessFramework?: boolean;
  integrationName?: string;
}) => {
  describe('apolloServer', () => {
    let app: any;
    let didEncounterErrors: jest.MockedFunction<
      NonNullable<GraphQLRequestListener['didEncounterErrors']>
    >;

    afterEach(async () => {
      // XXX nothing calls server.stop?
      if (app) {
        if (destroyApp) {
          await destroyApp(app);
          app = null;
        } else {
          app = null;
        }
      }
    });

    describe('graphqlHTTP', () => {
      it('rejects the request if the method is not POST or GET', async () => {
        app = await createApp();
        const req = request(app).head('/graphql').send();
        return req.then((res) => {
          expect(res.status).toEqual(405);
          expect(res.headers['allow']).toEqual('GET, POST');
        });
      });

      it('throws an error if POST body is empty', async () => {
        app = await createApp();
        const req = request(app).post('/graphql').type('text/plain').send('  ');
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch('POST body missing');
        });
      });

      it('throws an error if POST body is missing even with content-type', async () => {
        app = await createApp();
        const req = request(app)
          .post('/graphql')
          .type('application/json')
          .send();
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch(
            integrationName === 'fastify'
              ? "Body cannot be empty when content-type is set to 'application/json'"
              : 'POST body missing',
          );
        });
      });

      it('throws an error if invalid content-type', async () => {
        app = await createApp();
        const req = request(app)
          .post('/graphql')
          .type('text/plain')
          .send(
            JSON.stringify({
              query: 'query test{ testString }',
            }),
          );
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch('invalid Content-Type');
        });
      });

      it('throws an error if POST operation is missing', async () => {
        app = await createApp();
        const req = request(app).post('/graphql').send({});
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch('has no keys');
        });
      });

      it('throws an error if POST operation is empty', async () => {
        app = await createApp();
        const req = request(app).post('/graphql').send({ query: '' });
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch('non-empty `query`');
        });
      });

      it('throws an error if POST JSON is malformed', async () => {
        app = await createApp();
        const req = request(app)
          .post('/graphql')
          .type('application/json')
          .send('{foo');
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch(
            integrationName === 'hapi'
              ? 'Invalid request payload JSON format'
              : integrationName === 'micro'
              ? 'Invalid JSON'
              : integrationName === 'azure-functions'
              ? // This is not really the right message but AF does its parsing
                // outside of our handlers and getting it actually right was too
                // much of a pain.
                'POST body missing, invalid Content-Type, or JSON object has no keys.'
              : 'Unexpected token f',
          );
        });
      });

      it('throws an error if GET query is missing', async () => {
        app = await createApp();
        const req = request(app).get(`/graphql`);
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch('GET query missing.');
        });
      });

      it('can handle a basic GET request', async () => {
        app = await createApp();
        const expected = {
          testString: 'it works',
        };
        const query = {
          query: 'query test{ testString }',
        };
        const req = request(app).get('/graphql').query(query);
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('can handle a basic implicit GET request', async () => {
        app = await createApp();
        const expected = {
          testString: 'it works',
        };
        const query = {
          query: '{ testString }',
        };
        const req = request(app).get('/graphql').query(query);
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('throws error if trying to use mutation using GET request', async () => {
        didEncounterErrors = jest.fn();
        app = await createApp({
          graphqlOptions: {
            schema,
            plugins: [
              {
                async requestDidStart() {
                  return { didEncounterErrors };
                },
              },
            ],
          },
        });
        const query = {
          query: 'mutation test{ testMutation(echo: "ping") }',
        };
        const req = request(app).get('/graphql').query(query);

        await req.then((res) => {
          expect(res.status).toEqual(405);
          expect(res.headers['allow']).toEqual('POST');
          expect((res.error as HTTPError).text).toMatch(
            'GET supports only query operation',
          );
        });

        expect(didEncounterErrors).toBeCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                message: 'GET supports only query operation',
              }),
            ]),
          }),
        );
      });

      it('throws error if trying to use mutation with fragment using GET request', async () => {
        didEncounterErrors = jest.fn();
        app = await createApp({
          graphqlOptions: {
            schema,
            plugins: [
              {
                async requestDidStart() {
                  return { didEncounterErrors };
                },
              },
            ],
          },
        });
        const query = {
          query: `fragment PersonDetails on PersonType {
              firstName
            }

            mutation test {
              testPerson(firstName: "Test", lastName: "Me") {
                ...PersonDetails
              }
            }`,
        };
        const req = request(app).get('/graphql').query(query);
        await req.then((res) => {
          expect(res.status).toEqual(405);
          expect(res.headers['allow']).toEqual('POST');
          expect((res.error as HTTPError).text).toMatch(
            'GET supports only query operation',
          );
        });

        expect(didEncounterErrors).toBeCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                message: 'GET supports only query operation',
              }),
            ]),
          }),
        );
      });

      it('can handle a GET request with variables', async () => {
        app = await createApp();
        const query = {
          query: 'query test($echo: String){ testArgument(echo: $echo) }',
          variables: JSON.stringify({ echo: 'world' }),
        };
        const expected = {
          testArgument: 'hello world',
        };
        const req = request(app).get('/graphql').query(query);
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('can handle a basic request', async () => {
        app = await createApp();
        const expected = {
          testString: 'it works',
        };
        const req = request(app).post('/graphql').send({
          query: 'query test{ testString }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('cache-control not set without any hints', async () => {
        app = await createApp({
          graphqlOptions: { schema },
        });
        const expected = {
          testPerson: { firstName: 'Jane' },
        };
        const req = request(app).post('/graphql').send({
          query: 'query test{ testPerson { firstName } }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
          // hapi defaults to no-cache, so we have to allow that.
          expect([undefined, 'no-cache']).toContain(
            res.headers['cache-control'],
          );
        });
      });

      it('cache-control set with dynamic hint', async () => {
        app = await createApp({
          graphqlOptions: { schema },
        });
        const expected = {
          testPersonWithCacheControl: { firstName: 'Jane' },
        };
        const req = request(app).post('/graphql').send({
          query: 'query test{ testPersonWithCacheControl { firstName } }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
          expect(res.headers['cache-control']).toBe('max-age=11, public');
        });
      });

      it('cache-control set with defaultMaxAge', async () => {
        app = await createApp({
          graphqlOptions: {
            schema,
            plugins: [ApolloServerPluginCacheControl({ defaultMaxAge: 5 })],
          },
        });
        const expected = {
          testPerson: { firstName: 'Jane' },
        };
        const req = request(app).post('/graphql').send({
          query: 'query test{ testPerson { firstName } }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
          expect(res.headers['cache-control']).toBe('max-age=5, public');
        });
      });

      it('returns PersistedQueryNotSupported to a GET request if PQs disabled', async () => {
        app = await createApp({
          graphqlOptions: { schema, persistedQueries: false },
        });
        const req = request(app)
          .get('/graphql')
          .query({
            extensions: JSON.stringify({
              persistedQuery: {
                version: 1,
                sha256Hash:
                  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            }),
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.errors).toBeDefined();
          expect(res.body.errors[0].message).toEqual(
            'PersistedQueryNotSupported',
          );
          expect(res.headers['cache-control']).toBe(
            'private, no-cache, must-revalidate',
          );
        });
      });

      it('returns PersistedQueryNotSupported to a POST request if PQs disabled', async () => {
        app = await createApp({
          graphqlOptions: { schema, persistedQueries: false },
        });
        const req = request(app)
          .post('/graphql')
          .send({
            extensions: {
              persistedQuery: {
                version: 1,
                sha256Hash:
                  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            },
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.errors).toBeDefined();
          expect(res.body.errors.length).toEqual(1);
          expect(res.body.errors[0].message).toEqual(
            'PersistedQueryNotSupported',
          );
          expect(res.headers['cache-control']).toBe(
            'private, no-cache, must-revalidate',
          );
        });
      });

      it('returns PersistedQueryNotFound to a GET request', async () => {
        app = await createApp();
        const req = request(app)
          .get('/graphql')
          .query({
            extensions: JSON.stringify({
              persistedQuery: {
                version: 1,
                sha256Hash:
                  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            }),
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.errors).toBeDefined();
          expect(res.body.errors.length).toEqual(1);
          expect(res.body.errors[0].message).toEqual('PersistedQueryNotFound');
          expect(res.headers['cache-control']).toBe(
            'private, no-cache, must-revalidate',
          );
        });
      });

      it('returns PersistedQueryNotFound to a POST request', async () => {
        app = await createApp();
        const req = request(app)
          .post('/graphql')
          .send({
            extensions: {
              persistedQuery: {
                version: 1,
                sha256Hash:
                  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            },
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.errors).toBeDefined();
          expect(res.body.errors.length).toEqual(1);
          expect(res.body.errors[0].message).toEqual('PersistedQueryNotFound');
          expect(res.headers['cache-control']).toBe(
            'private, no-cache, must-revalidate',
          );
        });
      });

      // Micro does not have built-in support for CORS.
      if (integrationName !== 'micro') {
        describe('cors enabled by default', () => {
          const origin = 'https://my-origin.test/';
          it('for POST request', async () => {
            app = await createApp();
            const expected = {
              testString: 'it works',
            };
            const res = await request(app)
              .post('/graphql')
              .set('origin', origin)
              .send({
                query: 'query test{ testString }',
              });
            expect(res.status).toEqual(200);
            expect(res.body.data).toEqual(expected);
            expect(res.header['access-control-allow-origin']).toEqual('*');
          });

          it('for OPTIONS preflight request', async () => {
            app = await createApp();
            const res = await request(app)
              .options('/graphql')
              .set('origin', origin)
              .set('access-control-request-headers', 'content-type')
              .set('access-control-request-method', 'POST');
            expect(res.status).toEqual(204);
            expect(res.text).toEqual('');
            expect(res.header['access-control-allow-origin']).toEqual('*');
            expect(res.header['access-control-allow-origin']).toEqual('*');
            expect(
              res.header['access-control-allow-headers']?.toLowerCase(),
            ).toContain('content-type');
            expect(res.header['access-control-allow-methods']).toContain(
              'POST',
            );
            // It would be nice if Hapi and Koa properly set Vary here, but
            // their cors support modules do not. Oh well.
            if (integrationName !== 'hapi' && integrationName !== 'koa') {
              expect(res.header['vary']).toContain(
                'Access-Control-Request-Headers',
              );
            }
          });
        });
      }

      it('can handle a request with variables', async () => {
        app = await createApp();
        const expected = {
          testArgument: 'hello world',
        };
        const req = request(app)
          .post('/graphql')
          .send({
            query: 'query test($echo: String){ testArgument(echo: $echo) }',
            variables: { echo: 'world' },
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('can handle a request with variables as string', async () => {
        app = await createApp();
        const expected = {
          testArgument: 'hello world',
        };
        const req = request(app).post('/graphql').send({
          query: 'query test($echo: String!){ testArgument(echo: $echo) }',
          variables: '{ "echo": "world" }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('can handle a request with variables as an invalid string', async () => {
        app = await createApp();
        const req = request(app).post('/graphql').send({
          query: 'query test($echo: String!){ testArgument(echo: $echo) }',
          variables: '{ echo: "world" }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect((res.error as HTTPError).text).toMatch(
            'Variables are invalid JSON.',
          );
        });
      });

      it('can handle a request with operationName', async () => {
        app = await createApp();
        const expected = {
          testString: 'it works',
        };
        const req = request(app)
          .post('/graphql')
          .send({
            query: `
                      query test($echo: String){ testArgument(echo: $echo) }
                      query test2{ testString }`,
            variables: { echo: 'world' },
            operationName: 'test2',
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('can handle introspection request', async () => {
        app = await createApp();
        const req = request(app)
          .post('/graphql')
          .send({ query: getIntrospectionQuery() });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data.__schema.types[0].fields[0].name).toEqual(
            'testString',
          );
        });
      });

      it('does not accept a query AST', async () => {
        app = await createApp();
        const req = request(app)
          .post('/graphql')
          .send({
            query: gql`
              query test {
                testString
              }
            `,
          });
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect(res.text).toMatch('GraphQL queries must be strings');
        });
      });

      it('can handle batch requests', async () => {
        app = await createApp();
        const expected = [
          {
            data: {
              testString: 'it works',
            },
          },
          {
            data: {
              testArgument: 'hello yellow',
            },
          },
        ];
        const req = request(app)
          .post('/graphql')
          .send([
            {
              query: `
                      query test($echo: String){ testArgument(echo: $echo) }
                      query test2{ testString }`,
              variables: { echo: 'world' },
              operationName: 'test2',
            },
            {
              query: `
                      query testX($echo: String){ testArgument(echo: $echo) }`,
              variables: { echo: 'yellow' },
              operationName: 'testX',
            },
          ]);
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body).toEqual(expected);
        });
      });

      it('can handle batch requests', async () => {
        app = await createApp();
        const expected = [
          {
            data: {
              testString: 'it works',
            },
          },
        ];
        const req = request(app)
          .post('/graphql')
          .send([
            {
              query: `
                      query test($echo: String){ testArgument(echo: $echo) }
                      query test2{ testString }`,
              variables: { echo: 'world' },
              operationName: 'test2',
            },
          ]);
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body).toEqual(expected);
        });
      });

      it('can handle batch requests in parallel', async function () {
        const parallels = 100;
        const delayPerReq = 40;

        app = await createApp();
        const expected = Array(parallels).fill({
          data: { testStringWithDelay: 'it works' },
        });
        const req = request(app)
          .post('/graphql')
          .send(
            Array(parallels).fill({
              query: `query test($delay: Int!) { testStringWithDelay(delay: $delay) }`,
              operationName: 'test',
              variables: { delay: delayPerReq },
            }),
          );
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body).toEqual(expected);
        });
      }, 3000); // this test will fail due to timeout if running serially.

      it('clones batch context', async () => {
        app = await createApp({
          graphqlOptions: {
            schema,
            context: { testField: 'expected' },
          },
        });
        const expected = [
          {
            data: {
              testContext: 'expected',
            },
          },
          {
            data: {
              testContext: 'expected',
            },
          },
        ];
        const req = request(app)
          .post('/graphql')
          .send([
            {
              query: 'query test{ testContext }',
            },
            {
              query: 'query test{ testContext }',
            },
          ]);
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body).toEqual(expected);
        });
      });

      it('executes batch context if it is a function', async () => {
        let callCount = 0;
        app = await createApp({
          graphqlOptions: {
            schema,
            context: () => {
              callCount++;
              return { testField: 'expected' };
            },
          },
        });
        const expected = [
          {
            data: {
              testContext: 'expected',
            },
          },
          {
            data: {
              testContext: 'expected',
            },
          },
        ];
        const req = request(app)
          .post('/graphql')
          .send([
            {
              query: 'query test{ testContext }',
            },
            {
              query: 'query test{ testContext }',
            },
          ]);
        return req.then((res) => {
          // XXX In AS 1.0 we ran context once per GraphQL operation (so this
          // was 2) rather than once per HTTP request. Was this actually
          // helpful? Honestly we're not sure why you'd use a function in the
          // 1.0 API anyway since the function didn't actually get any useful
          // arguments. Right now there's some weirdness where a context
          // function is actually evaluated both inside ApolloServer and in
          // runHttpQuery.
          expect(callCount).toEqual(1);
          expect(res.status).toEqual(200);
          expect(res.body).toEqual(expected);
        });
      });

      it('can handle a request with a mutation', async () => {
        app = await createApp();
        const expected = {
          testMutation: 'not really a mutation, but who cares: world',
        };
        const req = request(app)
          .post('/graphql')
          .send({
            query: 'mutation test($echo: String){ testMutation(echo: $echo) }',
            variables: { echo: 'world' },
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data).toEqual(expected);
        });
      });

      it('applies the formatResponse function', async () => {
        app = await createApp({
          graphqlOptions: {
            schema,
            formatResponse(response: GraphQLResponse) {
              response['extensions'] = { it: 'works' };
              return response;
            },
          },
        });
        const expected = { it: 'works' };
        const req = request(app)
          .post('/graphql')
          .send({
            query: 'mutation test($echo: String){ testMutation(echo: $echo) }',
            variables: { echo: 'world' },
          });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.extensions).toEqual(expected);
        });
      });

      it('passes the context to the resolver', async () => {
        const expected = 'context works';
        app = await createApp({
          graphqlOptions: {
            schema,
            context: { testField: expected },
          },
        });
        const req = request(app).post('/graphql').send({
          query: 'query test{ testContext }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data.testContext).toEqual(expected);
        });
      });

      it('passes the rootValue to the resolver', async () => {
        const expected = 'it passes rootValue';
        app = await createApp({
          graphqlOptions: {
            schema,
            rootValue: expected,
          },
        });
        const req = request(app).post('/graphql').send({
          query: 'query test{ testRootValue }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data.testRootValue).toEqual(expected);
        });
      });

      it('passes the rootValue function result to the resolver', async () => {
        const expectedQuery = 'query: it passes rootValue';
        const expectedMutation = 'mutation: it passes rootValue';
        app = await createApp({
          graphqlOptions: {
            schema,
            rootValue: (documentNode: DocumentNode) => {
              const op = getOperationAST(documentNode, undefined);
              return op!.operation === 'query'
                ? expectedQuery
                : expectedMutation;
            },
          },
        });
        const queryReq = request(app).post('/graphql').send({
          query: 'query test{ testRootValue }',
        });
        return queryReq.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data.testRootValue).toEqual(expectedQuery);
        });
        const mutationReq = request(app).post('/graphql').send({
          query: 'mutation test{ testMutation(echo: "ping") }',
        });
        return mutationReq.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.data.testRootValue).toEqual(expectedMutation);
        });
      });

      it('returns errors', async () => {
        const expected = 'Secret error message';
        app = await createApp({
          graphqlOptions: {
            schema,
          },
        });
        const req = request(app).post('/graphql').send({
          query: 'query test{ testError }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.errors[0].message).toEqual(expected);
        });
      });

      it('applies formatError if provided', async () => {
        const expected = '--blank--';
        app = await createApp({
          graphqlOptions: {
            schema,
            formatError: (error) => {
              expect(error instanceof Error).toBe(true);
              return { message: expected };
            },
          },
        });
        const req = request(app).post('/graphql').send({
          query: 'query test{ testError }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.errors[0].message).toEqual(expected);
        });
      });

      it('formatError receives error that passes instanceof checks', async () => {
        const expected = '--blank--';
        app = await createApp({
          graphqlOptions: {
            schema,
            formatError: (error) => {
              expect(error instanceof Error).toBe(true);
              expect(error instanceof GraphQLError).toBe(true);
              return { message: expected };
            },
          },
        });
        const req = request(app).post('/graphql').send({
          query: 'query test{ testError }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(200);
          expect(res.body.errors[0].message).toEqual(expected);
        });
      });

      it('allows for custom error formatting to sanitize', async () => {
        app = await createApp({
          graphqlOptions: {
            schema: TestSchema,
            formatError(error) {
              return { message: 'Custom error format: ' + error.message };
            },
          },
        });

        const response = await request(app).post('/graphql').send({
          query: '{thrower}',
        });

        expect(response.status).toEqual(200);
        expect(JSON.parse(response.text)).toEqual({
          data: null,
          errors: [
            {
              message: 'Custom error format: Throws!',
            },
          ],
        });
      });

      it('allows for custom error formatting to elaborate', async () => {
        app = await createApp({
          graphqlOptions: {
            schema: TestSchema,
            formatError(error) {
              return {
                message: error.message,
                locations: error.locations,
                stack: 'Stack trace',
              };
            },
          },
        });

        const response = await request(app).post('/graphql').send({
          query: '{thrower}',
        });

        expect(response.status).toEqual(200);
        expect(JSON.parse(response.text)).toEqual({
          data: null,
          errors: [
            {
              message: 'Throws!',
              locations: [{ line: 1, column: 2 }],
              stack: 'Stack trace',
            },
          ],
        });
      });

      it('sends internal server error when formatError fails', async () => {
        app = await createApp({
          graphqlOptions: {
            schema,
            formatError: () => {
              throw new Error('I should be caught');
            },
          },
        });
        const req = request(app).post('/graphql').send({
          query: 'query test{ testError }',
        });
        return req.then((res) => {
          expect(res.body.errors[0].message).toEqual('Internal server error');
        });
      });

      it('applies additional validationRules', async () => {
        const expected = 'alwaysInvalidRule was really invalid!';
        const alwaysInvalidRule = function (context: ValidationContext) {
          return {
            enter() {
              context.reportError(new GraphQLError(expected));
              return BREAK;
            },
          };
        };
        app = await createApp({
          graphqlOptions: {
            schema,
            validationRules: [alwaysInvalidRule],
          },
        });
        const req = request(app).post('/graphql').send({
          query: 'query test{ testString }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(400);
          expect(res.body.errors[0].message).toEqual(expected);
        });
      });
    });

    describe('server setup', () => {
      // Serverless frameworks default listening on all paths so there's no 404.
      if (!serverlessFramework) {
        it('throws error on 404 routes', async () => {
          app = await createApp();

          const query = {
            query: '{ testString }',
          };
          const req = request(app).get('/bogus-route').query(query);
          return req.then((res) => {
            expect(res.status).toEqual(404);
          });
        });
      }
    });

    if (serverlessFramework) {
      // This tests the serverless-specific behavior that ensures that startup
      // finishes before serving a request. Non-serverless frameworks don't have
      // this behavior: they assert that you've done `await server.start()`
      // earlier in the process.
      it('calls serverWillStart before serving a request', async () => {
        // We'll use this to determine the order in which
        // the events we're expecting to happen actually occur and validate
        // those expectations in various stages of this test.
        const calls: string[] = [];

        const pluginStartedBarrier = resolvable();
        const letPluginFinishBarrier = resolvable();

        // We want this to create the app as fast as `createApp` will allow.
        // for integrations whose `applyMiddleware` currently returns a
        // Promise we want them to resolve at whatever eventual pace they
        // will so we can make sure that things are happening in order.
        const unawaitedApp = createApp({
          graphqlOptions: {
            schema,
            plugins: [
              {
                async serverWillStart() {
                  calls.push('zero');
                  pluginStartedBarrier.resolve();
                  await letPluginFinishBarrier;
                  calls.push('one');
                },
              },
            ],
          },
        });

        // Account for the fact that `createApp` might return a Promise,
        // and might not, depending on the integration's implementation of
        // createApp.  This is entirely to account for the fact that
        // non-async implementations of `applyMiddleware` leverage a
        // middleware as the technique for yielding to `startWillStart`
        // hooks while their `async` counterparts simply `await` those same
        // hooks.  In a future where we make the behavior of `applyMiddleware`
        // the same across all integrations, this should be changed to simply
        // `await unawaitedApp`.
        app = 'then' in unawaitedApp ? await unawaitedApp : unawaitedApp;

        // Intentionally fire off the request asynchronously, without await.
        const res = request(app)
          .get('/graphql')
          .query({
            query: 'query test{ testString }',
          })
          .then((res) => {
            calls.push('two');
            return res;
          });

        // At this point calls might be [] or ['zero'] because the back-compat
        // code kicks off start() asynchronously. We can safely wait on
        // the plugin's serverWillStart to begin.
        await pluginStartedBarrier;
        expect(calls).toEqual(['zero']);
        letPluginFinishBarrier.resolve();

        // Now, wait for the request to finish.
        await res;

        // Finally, ensure that the order we expected was achieved.
        expect(calls).toEqual(['zero', 'one', 'two']);
      });
    }

    describe('status code', () => {
      it('allows setting a custom status code', async () => {
        const app = await createApp({
          graphqlOptions: {
            schema,
            plugins: [
              {
                async requestDidStart() {
                  return {
                    async willSendResponse({ response: { http } }) {
                      http!.status = 403;
                    },
                  };
                },
              },
            ],
          },
        });

        const req = request(app).post('/graphql').send({
          query: 'query test{ testString }',
        });
        return req.then((res) => {
          expect(res.status).toEqual(403);
          expect(res.body.data).toEqual({
            testString: 'it works',
          });
        });
      });
    });

    describe('Persisted Queries', () => {
      const query = '{testString}';
      const query2 = '{ testString }';

      const hash = sha256.create().update(query).hex();
      const extensions = {
        persistedQuery: {
          version: 1,
          sha256Hash: hash,
        },
      };

      const extensions2 = {
        persistedQuery: {
          version: 1,
          sha256Hash: sha256.create().update(query2).hex(),
        },
      };

      function createMockCache(): KeyValueCache {
        const map = new Map<string, string>();
        return {
          set: jest.fn(async (key, val) => {
            await map.set(key, val);
          }),
          get: jest.fn(async (key) => map.get(key)),
          delete: jest.fn(async (key) => map.delete(key)),
        };
      }

      let didEncounterErrors: jest.MockedFunction<
        NonNullable<GraphQLRequestListener['didEncounterErrors']>
      >;

      let didResolveSource: jest.MockedFunction<
        NonNullable<GraphQLRequestListener['didResolveSource']>
      >;

      function createApqApp(apqOptions: PersistedQueryOptions = {}) {
        return createApp({
          graphqlOptions: {
            schema,
            plugins: [
              {
                async requestDidStart() {
                  return {
                    didResolveSource,
                    didEncounterErrors,
                  };
                },
              },
            ],
            persistedQueries: {
              cache,
              ...apqOptions,
            },
          },
        });
      }

      let cache: KeyValueCache;

      beforeEach(async () => {
        cache = createMockCache();
        didResolveSource = jest.fn();
        didEncounterErrors = jest.fn();
      });

      it('when ttlSeconds is set, passes ttl to the apq cache set call', async () => {
        app = await createApqApp({ ttl: 900 });

        await request(app).post('/graphql').send({
          extensions,
          query,
        });

        expect(cache.set).toHaveBeenCalledWith(
          expect.stringMatching(/^apq:/),
          query,
          expect.objectContaining({
            ttl: 900,
          }),
        );
        expect(didResolveSource.mock.calls[0][0]).toHaveProperty(
          'source',
          query,
        );
      });

      it('when ttlSeconds is unset, ttl is not passed to apq cache', async () => {
        app = await createApqApp();

        await request(app).post('/graphql').send({
          extensions,
          query,
        });

        expect(cache.set).toHaveBeenCalledWith(
          expect.stringMatching(/^apq:/),
          '{testString}',
          expect.not.objectContaining({
            ttl: 900,
          }),
        );
        expect(didResolveSource.mock.calls[0][0]).toHaveProperty(
          'source',
          query,
        );
      });

      it('errors when version is not specified', async () => {
        app = await createApqApp();

        const result = await request(app)
          .get('/graphql')
          .query({
            query,
            extensions: JSON.stringify({
              persistedQuery: {
                // Version intentionally omitted.
                sha256Hash: extensions.persistedQuery.sha256Hash,
              },
            }),
          });

        expect(result).toMatchObject({
          status: 400,
          // Different integrations' response text varies in format.
          text: expect.stringContaining('Unsupported persisted query version'),
          req: expect.objectContaining({
            method: 'GET',
          }),
        });

        expect(didEncounterErrors).toBeCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                message: 'Unsupported persisted query version',
              }),
            ]),
          }),
        );
      });

      it('errors when version is unsupported', async () => {
        app = await createApqApp();

        const result = await request(app)
          .get('/graphql')
          .query({
            query,
            extensions: JSON.stringify({
              persistedQuery: {
                // Version intentionally wrong.
                version: 2,
                sha256Hash: extensions.persistedQuery.sha256Hash,
              },
            }),
          });

        expect(result).toMatchObject({
          status: 400,
          // Different integrations' response text varies in format.
          text: expect.stringContaining('Unsupported persisted query version'),
          req: expect.objectContaining({
            method: 'GET',
          }),
        });

        expect(didEncounterErrors).toBeCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                message: 'Unsupported persisted query version',
              }),
            ]),
          }),
        );
      });

      it('errors when hash is mismatched', async () => {
        app = await createApqApp();

        const result = await request(app)
          .get('/graphql')
          .query({
            query,
            extensions: JSON.stringify({
              persistedQuery: {
                version: 1,
                // Sha intentionally wrong.
                sha256Hash: extensions.persistedQuery.sha256Hash.substr(0, 5),
              },
            }),
          });

        expect(result).toMatchObject({
          status: 400,
          // Different integrations' response text varies in format.
          text: expect.stringContaining('provided sha does not match query'),
          req: expect.objectContaining({
            method: 'GET',
          }),
        });

        expect(didEncounterErrors).toBeCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                message: 'provided sha does not match query',
              }),
            ]),
          }),
        );

        expect(didResolveSource).not.toHaveBeenCalled();
      });

      it('returns PersistedQueryNotFound on the first try', async () => {
        app = await createApqApp();

        const result = await request(app).post('/graphql').send({
          extensions,
        });

        expect(result.body.data).toBeUndefined();
        expect(result.body.errors.length).toEqual(1);
        expect(result.body.errors[0].message).toEqual('PersistedQueryNotFound');
        expect(result.body.errors[0].extensions.code).toEqual(
          'PERSISTED_QUERY_NOT_FOUND',
        );

        expect(didEncounterErrors).toBeCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.any(PersistedQueryNotFoundError),
            ]),
          }),
        );

        expect(didResolveSource).not.toHaveBeenCalled();
      });
      it('returns result on the second try', async () => {
        app = await createApqApp();

        await request(app).post('/graphql').send({
          extensions,
        });

        // Only the first request should result in an error.
        expect(didEncounterErrors).toHaveBeenCalledTimes(1);
        expect(didEncounterErrors).toBeCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.any(PersistedQueryNotFoundError),
            ]),
          }),
        );

        expect(didResolveSource).not.toHaveBeenCalled();

        const result = await request(app).post('/graphql').send({
          extensions,
          query,
        });

        // There should be no additional errors now.  In other words, we'll
        // re-assert that we've been called the same single time that we
        // asserted above.
        expect(didEncounterErrors).toHaveBeenCalledTimes(1);

        expect(didResolveSource.mock.calls[0][0]).toHaveProperty(
          'source',
          query,
        );

        expect(result.body.data).toEqual({ testString: 'it works' });
        expect(result.body.errors).toBeUndefined();
      });

      it('returns with batched persisted queries', async () => {
        app = await createApqApp();

        const errors = await request(app)
          .post('/graphql')
          .send([
            {
              extensions,
            },
            {
              extensions: extensions2,
            },
          ]);

        expect(errors.body[0].data).toBeUndefined();
        expect(errors.body[1].data).toBeUndefined();
        expect(errors.body[0].errors[0].message).toEqual(
          'PersistedQueryNotFound',
        );
        expect(errors.body[0].errors[0].extensions.code).toEqual(
          'PERSISTED_QUERY_NOT_FOUND',
        );
        expect(errors.body[1].errors[0].message).toEqual(
          'PersistedQueryNotFound',
        );
        expect(errors.body[1].errors[0].extensions.code).toEqual(
          'PERSISTED_QUERY_NOT_FOUND',
        );

        const result = await request(app)
          .post('/graphql')
          .send([
            {
              extensions,
              query,
            },
            {
              extensions: extensions2,
              query: query2,
            },
          ]);

        expect(result.body[0].data).toEqual({ testString: 'it works' });
        expect(result.body[0].data).toEqual({ testString: 'it works' });
        expect(result.body.errors).toBeUndefined();
      });

      it('returns result on the persisted query', async () => {
        app = await createApqApp();

        await request(app).post('/graphql').send({
          extensions,
        });

        expect(didResolveSource).not.toHaveBeenCalled();

        await request(app).post('/graphql').send({
          extensions,
          query,
        });
        const result = await request(app).post('/graphql').send({
          extensions,
        });

        expect(didResolveSource.mock.calls[0][0]).toHaveProperty(
          'source',
          query,
        );

        expect(result.body.data).toEqual({ testString: 'it works' });
        expect(result.body.errors).toBeUndefined();
      });

      it('returns error when hash does not match', async () => {
        app = await createApqApp();

        const response = await request(app)
          .post('/graphql')
          .send({
            extensions: {
              persistedQuery: {
                version: 1,
                sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            },
            query,
          });
        expect(response.status).toEqual(400);
        expect((response.error as HTTPError).text).toMatch(
          /does not match query/,
        );
        expect(didResolveSource).not.toHaveBeenCalled();
      });

      it('returns correct result using get request', async () => {
        app = await createApqApp();

        await request(app).post('/graphql').send({
          extensions,
          query,
        });
        const result = await request(app)
          .get('/graphql')
          .query({
            extensions: JSON.stringify(extensions),
          });
        expect(result.body.data).toEqual({ testString: 'it works' });
        expect(didResolveSource.mock.calls[0][0]).toHaveProperty(
          'source',
          query,
        );
      });
    });

    /**
     * This is the beginning of tests which are directly related to HTTP
     * transport-related functionality.
     */
    describe("transport specific", () => {
      it.todo("returns a 500 if the body of the request is missing");
      it.todo("returns a 405 if the HTTP method was not 'POST' or 'GET'");
      it.todo("returns a 400 if the 'query' is missing when the 'GET' method is used");
      it.todo("returns a 200 when GraphQL execution completes");
      it.todo("returns a 405 when attempting a 'mutation' when the 'GET' method is used");
      it.todo("ensure that 'extensions' are properly returned in the response");
      it.todo("ensure that 'errors' is properly returned in the response");
      it.todo("ensure that 'data' is properly returned in the response");
      it.todo("returns a 400 when 'query' is malformed");
      it.todo("returns a 400 when 'variables' is malformed");
      it.todo("returns a 400 when the GraphQL operation does not validate");
      // I'm not sure if this next one is relevant anymore since we'll be
      // specifically leaving that binding up to the user and it would be
      // outside of our knowledge/concern.
      it.todo("returns a 404 on other routes");
      it.todo("invokes 'serverWillStart' life-cycle hook before serving a request");

      // TODO Consider Persisted Queries.
      // The HTTP status codes for persisted queries should be generated
      // within the transport based on the error codes that are related to
      // persisted queries (i.e. PersistedQueryNotFound)
      it.todo("returns 400 when persisted query hash is mismatched with the document")
    });
  });
};
