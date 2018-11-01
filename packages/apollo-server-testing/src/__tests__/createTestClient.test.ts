const { ApolloServerBase, gql } = require('apollo-server-core');
const createTestClient = require('../createTestClient');

describe('createTestClient', () => {
  const typeDefs = gql`
    type Query {
      test(echo: String): String
      # this resolver uses context
      hello: String
    }

    type Mutation {
      increment: Int!
    }
  `;

  let num = 0;
  const resolvers = {
    Query: {
      test: (_, { echo }) => echo,
      hello: (_, __, { person }) => {
        return `hello ${person}`;
      },
    },
    Mutation: {
      increment: () => ++num,
    },
  };

  const myTestServer = new ApolloServerBase({
    typeDefs,
    context: () => ({ person: 'tom' }),
    resolvers,
  });

  it('allows queries', async () => {
    const query = `{ test(echo: "foo") }`;
    const client = createTestClient(myTestServer);
    const res = await client.query({ query });
    expect(res.data).toEqual({ test: 'foo' });
  });

  it('allows mutations', async () => {
    const mutation = `mutation increment { increment }`;
    const client = createTestClient(myTestServer);
    const res = await client.mutate({ mutation });
    expect(res.data).toEqual({ increment: 1 });
  });

  it('allows variables to be passed', async () => {
    const query = `query test($echo: String){ test(echo: $echo) }`;
    const client = createTestClient(myTestServer);
    const res = await client.query({ query, variables: { echo: 'wow' } });
    expect(res.data).toEqual({ test: 'wow' });
  });

  it('uses default context function if not overwritten', async () => {
    const query = `{ hello }`;
    const client = createTestClient(myTestServer);
    const res = await client.query({ query });
    expect(res.data).toEqual({ hello: 'hello tom' });
  });

  it('allows mocking of context', async () => {
    const query = `{ hello }`;
    const client = createTestClient(myTestServer, () => ({ person: 'mary' }));
    const res = await client.query({ query });
    expect(res.data).toEqual({ hello: 'hello mary' });
  });
});
