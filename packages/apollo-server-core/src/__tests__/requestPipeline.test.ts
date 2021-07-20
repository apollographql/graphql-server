describe("requestPipeline", () => {
  describe("queries", () => {
    it.todo("can run a simple query");
    it.todo("can run a query with variables");
    it.todo("raises a syntax error when one is encountered in the operation document")
    // Reconsider this test.
    it.todo("does not call console.error if an error occurs and debug mode is set");
    // Reconsider this test.
    it.todo("does not call console.error if an error occurs and not in debug mode");
    it.todo("returns a validation error if the query does not validate");
    it.todo("errors when variables are malformed");
    it.todo("throws an error when there are missing variables");
    it.todo("allows a resolver to yield");
    it.todo("executes the correct operation when 'operationName' is specified");
    it.todo("errors out when an 'operationName' does not match an operation in the document");
    it.todo("returns an IntrospectionResult when performing an IntrospectionQuery");
    // I don't understand this test.  It seems to me that we'd just
    // want to ensure that we're receiving a JSON string value for 'query', but
    // this seems to make a specific test for DocumentNode?
    it.todo("does not accept a DocumentNode as a 'query' body");
  });

  describe("Mutations", () => {
    it.todo("can run a simple mutation");
  });

  describe("errors", () => {
    it.todo("propagates errors, WITH their stack and code, to the 'errors' response in non-production");
    it.todo("propagates errors, WITHOUT their stack and code, to the 'errors' response in production");
  });

  describe("formatResponse", () => {
    it.todo("applies formatResponse");
  });

  describe("formatError", () => {
    it.todo("applies formatError");
    it.todo("receives an error that is an instance of GraphQLError and Error");
    it.todo("allows the sanitization of an error");
    it.todo("permits the return of an object");
    it.todo("guards against exceptions within a user's formatError implementation");
  });

  describe("Context", () => {
    it.todo("passes the context to the resolver");
    it.todo("propagates contextual errors to the 'errors' response");
    // Maybe.  This might be tested elsewhere, but I needed to log this here
    // to at least acknowledge it did exist before.
    it.todo("receives transport-specific properties");
  });

  describe("Plugins", () => {
    // Each of these should be tested more thoroughly, paying close attention to
    // timing and ordering, including whether they properly await other hooks.
    it.todo("requestDidStart");
    describe("parsingDidStart", () => {
      // There are existing tests, but they don't seem to be named correctly
      // considering this life-cycle hook would be a _before_ parse hook.
      // That said, they were on the `graphql-extensions` implementation, not
      // the new request pipeline, so maybe the behavior has changed.
      it.todo("is invoked when parsing will result in an error");
      it.todo("is invoked when a successful parse happens")
    });
    it.todo("validationDidStart");
    it.todo("didResolveOperation");
    describe("didEncounterErrors", () => {
      it.todo("is invoked when an error occurs during parsing");
      it.todo("is invoked when an error occurs during validation");
      it.todo("is invoked when an error occurs during prior life-cycle hooks");
      it.todo("is invoked when an error occurs during execution");
    });
    it.todo("responseForOperation");
    it.todo("executionDidStart");
    it.todo("willSendResponse");
  });

  describe("parsing and validation cache", () => {
    it.todo("validates each time when the documentStore is not configured");
    it.todo("caches the DocumentNode in the documentStore when configured");
  });

  // We may not support rootValue in AS3, so these may not need to be implemented.
  describe("rootValue", () => {
    it.todo("passes the rootValue to the resolver");
    it.todo("passes the rootValue function result to the resolver");
  });

  // We may not support fieldResolver in AS3, so these may not need to be implemented.
  describe("fieldResolver", () => {
    it.todo("runs a custom fieldResolver");
  });

  describe("validationRules", () => {
    it.todo("applies user-provided validation rules");
  });

  describe("Batches", () => {
    it.todo("returns an array response when an array of operations is sent");
    it.todo("returns an array response when an array of operations is sent and one of the operations contains multiple operations with an 'operationName' specified");
    it.todo("can process the requests in parallel");
    // TODO what _should_ this do?
    it.todo("does something properly with the context when doing batched operations");
  });

  describe("Cache Control", () => {
    it.todo("returns cacheControl extensions when cacheControl is enabled");
    it.todo("returns default maxAge when no specific hints are provided");
  });

  describe("Persisted Queries", () => {
    it.todo("normalizes operations to the same hash");
    it.todo("errors with 'PersistedQueryNotSupported' when persisted queries are disabled");
    it.todo("errors with 'PersistedQueryNotSupported' when persisted queries are disabled");
    it.todo("errors with 'PersistedQueryNotFound' when query is not persisted");
    it.todo("uses DocumentNode from persisted operation when it is available");
    it.todo("behaves properly for batched operations");
    it.todo("errors when the hash provided doesn't match the operation provided");
  });

  // TODO Possibly remove these or put them somewhere else.
  describe("Misc", () => {
    it.todo("does not break async_hook call stack");
  });
});
