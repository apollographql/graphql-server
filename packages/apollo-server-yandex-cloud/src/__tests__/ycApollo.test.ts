import { ApolloServer } from "../ApolloServer";
import testSuite, {
  CreateAppOptions,
  NODE_MAJOR_VERSION,
  schema as Schema
} from "apollo-server-integration-testsuite";
import { Config } from "apollo-server-core";
import { IncomingMessage, ServerResponse } from "http";

import url from "url";
import gql from "graphql-tag";
import request from "supertest";

const createYcFunction = (options: CreateAppOptions = {}) => {
  const server = new ApolloServer(
    (options.graphqlOptions as Config) || { schema: Schema }
  );

  const handler = server.createHandler();

  return (req: IncomingMessage, res: ServerResponse) => {
    // return 404 if path is /bogus-route to pass the test, lambda doesn't have paths
    if (req.url && req.url.includes("/bogus-route")) {
      res.statusCode = 404;
      return res.end();
    }

    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const urlObject = url.parse(req.url || "", true);
      const event = {
        httpMethod: req.method,
        body: body,
        path: req.url,
        queryStringParameters: urlObject.query,
        requestContext: {
          path: urlObject.pathname
        },
        headers: req.headers
      };

      handler(event as any, {} as any)
        .then((result) => {
            res.statusCode = result.statusCode;
            for (let key in result.headers) {
              if (result.headers.hasOwnProperty(key)) {
                if (typeof result.headers[key] === "boolean") {
                  res.setHeader(key, result.headers[key].toString());
                } else {
                  // Without casting this to `any`, TS still believes `boolean`
                  // is possible.
                  res.setHeader(key, result.headers[key] as any);
                }
              }
            }
            res.write(result.body);
            res.end();
          },
          (error) => {
            throw error;
          }
        );
    });
  };
};

describe("integration:Yandex Cloud", () => {
  testSuite(createYcFunction);
});

const typeDefs = gql`
  type File {
    filename: String!
    mimetype: String!
    encoding: String!
  }
  type Query {
    uploads: [File]
    helloWorld: String
  }
  type Mutation {
    singleUpload(file: Upload!): File!
    multiUpload(files: [Upload!]!): [File]!
  }
`;

const resolvers = {
  Query: {
    uploads() {
    },
    helloWorld() {
      return "hi";
    }
  },
  Mutation: {
    async singleUpload(_parent: any, { file }: { file: any }) {
      expect((await file).createReadStream).toBeDefined();
      return file;
    },
    async multiUpload(_parent: any, { files }: { files: any }) {
      const fileArray = await files;
      fileArray.forEach(async (file: any) => {
        expect((await file).createReadStream).toBeDefined();
      });
      return fileArray;
    }
  }
};


// NODE: Skip Node.js 6 and 14, but only because `graphql-upload`
// doesn't support them on the version use use.
(
  [6, 14].includes(NODE_MAJOR_VERSION) ? describe.skip : describe
)("file uploads", () => {
  let app = <any>null;
  beforeAll(async () => {
    app = await createYcFunction({
      graphqlOptions: {
        typeDefs,
        resolvers
      }
    });
  });

  it("allows for a standard query without uploads", async () => {
    const req = request(app)
      .post("/graphql")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json")
      .send({
        query: `query{helloWorld}`
      });
    const res = await req;
    expect(res.statusCode).toBe(200);
    expect(res.body.data.helloWorld).toBe("hi");
  });

  it("allows for uploading a single file", async () => {
    const expected = {
      filename: "package.json",
      encoding: "7bit",
      mimetype: "application/json"
    };

    const req = request(app)
      .post("/graphql")
      .set("Content-Type", "multipart/form-data")
      .field(
        "operations",
        JSON.stringify({
          query: `
            mutation($file: Upload!) {
              singleUpload(file: $file) {
                filename
                encoding
                mimetype
              }
            }
          `,
          variables: {
            file: null
          }
        })
      )
      .field("map", JSON.stringify({ 0: ["variables.file"] }))
      .attach("0", "package.json");
    return req.then((res: any) => {
      expect(res.status).toEqual(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.singleUpload).toEqual(expected);
    });
  });

  it("allows for uploading multiple files", async () => {
    const expected = [{
      filename: "package.json",
      encoding: "7bit",
      mimetype: "application/json"
    },
      {
        filename: "tsconfig.json",
        encoding: "7bit",
        mimetype: "application/json"
      }];

    const req = request(app)
      .post("/graphql")
      .type("form")
      .field(
        "operations",
        JSON.stringify({
          query: `
            mutation($files: [Upload!]!) {
              multiUpload(files: $files) {
                filename
                encoding
                mimetype
              }
            }
          `,
          variables: {
            files: [null, null]
          }
        })
      )
      .field("map", JSON.stringify({
        0: ["variables.files.0"],
        1: ["variables.files.1"]
      }))
      .attach("0", "package.json")
      .attach("1", "tsconfig.json");
    return req.then((res: any) => {
      expect(res.status).toEqual(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.multiUpload).toEqual(expected);
    });
  });
});
