describe("ApolloServer", () => {
  it.todo("errors when called without any parameters");
  it.todo("accepts 'typeDefs' and 'resolvers'");
  describe("accepts context", () => {
    it.todo("permits context to be a simple object");
    it.todo("permits context to be a function that returns an object");
  });
  describe("mocks", () => {
    it.todo("allows mocks to be boolean true");
    it.todo("allows mocks as an object");
    it.todo("allows mocks as an object and preserves existing resolvers");
    // Not sure about this, but see existing test by the same name.
    it.todo("skipped allows mocks as an object with overriding the existing resolvers");
  });
});
