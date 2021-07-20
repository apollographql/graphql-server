---
title: GraphQL schema basics
sidebar_title: Schema basics
---

Your GraphQL server uses a **schema** to describe the shape of your available data. This schema defines a hierarchy of **types** with **fields** that are populated from your back-end data stores. The schema also specifies exactly which **queries** and **mutations** are available for clients to execute.

This article describes the fundamental building blocks of a schema and how to create one for your GraphQL server.

## The schema definition language

The GraphQL specification defines a human-readable **schema definition language** (or **SDL**) that you use to define your schema and store it as a string.

Here's a short example schema that defines two **object types**: `Book` and `Author`:

```graphql:title=schema.graphql
type Book {
  title: String
  author: Author
}

type Author {
  name: String
  books: [Book]
}
```

A schema defines a collection of types and the relationships _between_ those types. In the example schema above, a `Book` can have an associated `author`, and an `Author` can have a **list** of `books`.

Because these relationships are defined in a unified schema, client developers can see exactly what data is available and then request a specific subset of that data with a single optimized query.

Note that the schema is **not** responsible for defining where data comes from or how it's stored. It is entirely implementation-agnostic.

## Field definitions

_Most_ of the schema types you define have one or more **fields**:

```graphql
# This Book type has two fields: title and author
type Book {
  title: String  # returns a String
  author: Author # returns an Author
}
```

Each field returns data of the type specified. A field's return type can be a [scalar](#scalar-types), [object](#object-types), [enum](#enum-types), [union](#union-and-interface-types), or [interface](#union-and-interface-types) (all described below).

### List fields

A field can return a **list** containing items of a particular type. You indicate list fields with square brackets `[]`, like so:

```graphql{3}
type Author {
  name: String
  books: [Book] # A list of Books
}
```

### Field nullability

By default, it's valid for any field in your schema to return `null` instead of its specified type. You can require that a particular field _doesn't_ return `null` with an exclamation mark `!`, like so:

```graphql{2}
type Author {
  name: String! # Can't return null
  books: [Book]
}
```

These fields are **non-nullable**. If your server attempts to return `null` for a non-nullable field, an error is thrown.

#### Nullability and lists

With a list field, an exclamation mark `!` can appear in any combination of _two_ locations:

```graphql{2}
type Author {
  books: [Book!]! # This list can't be null AND its list *items* can't be null
}
```

* If `!` appears _inside_ the square brackets, the returned list can't include _items_ that are `null`.
* If `!` appears _outside_ the square brackets, _the list itself_ can't be `null`.
* In _any_ case, it's valid for a list field to return an _empty_ list.


## Supported types

Every type definition in a GraphQL schema belongs to one of the following categories:

* [Scalar](#scalar-types)
* [Object](#object-types)
  * This includes the three special **root operation types**: [`Query`](#the-query-type), [`Mutation`](#the-mutation-type), and [`Subscription`](#the-subscription-type).
* [Input](#input-types)
* [Enum](#enum-types)
* [Union](#union-and-interface-types)
* [Interface](#union-and-interface-types)

Each of these is described below.

### Scalar types

Scalar types are similar to primitive types in your favorite programming language. They always resolve to concrete data.

GraphQL's default scalar types are:

* `Int`: A signed 32‐bit integer
* `Float`: A signed double-precision floating-point value
* `String`: A UTF‐8 character sequence
* `Boolean`: `true` or `false`
* `ID` (serialized as a `String`): A unique identifier that's often used to refetch an object or as the key for a cache. Although it's serialized as a `String`, an `ID`  is not intended to be human‐readable.

These primitive types cover the majority of use cases. For more specific use cases, you can create [custom scalar types](/schema/custom-scalars/).

### Object types

Most of the types you define in a GraphQL schema are object types. An object type contains a collection of [fields](#field-definitions), each of which has its _own_ type.

Two object types _can_ include each other as fields, as is the case in our example schema from earlier:

```graphql
type Book {
  title: String
  author: Author
}

type Author {
  name: String
  books: [Book]
}
```

### The `Query` type

The `Query` type is a special object type that defines all of the top-level **entry points** for queries that clients execute against your server.

Each field of the `Query` type defines the name and return type of a different entry point. The `Query` type for our example schema might resemble the following:

```graphql
type Query {
  books: [Book]
  authors: [Author]
}
```

This `Query` type defines two fields: `books` and `authors`. Each field returns a list of the corresponding type.

With a REST-based API, books and authors would probably be returned by different endpoints (e.g., `/api/books` and `/api/authors`). The flexibility of GraphQL enables clients to query both resources with a single request.

#### Structuring a query

When your clients build queries to execute against your data graph, those queries match the shape of the object types you define in your schema.

Based on our example schema so far, a client could execute the following query, which requests both a list of all book titles _and_ a list of all author names:

```graphql
query GetBooksAndAuthors {
  books {
    title
  }

  authors {
    name
  }
}
```

Our server would then respond to the query with results that match the query's structure, like so:

```json
{
  "data": {
    "books": [
      {
        "title": "City of Glass"
      },
      ...
    ],
    "authors": [
      {
        "name": "Paul Auster"
      },
      ...
    ]
  }
}
```

Although it might be useful in some cases to fetch these two separate lists, a client would probably prefer to fetch a single list of books, where each book's author is included in the result.

Because our schema's `Book` type has an `author` field of type `Author`, a client could instead structure their query like so:

```graphql
query GetBooks {
  books {
    title
    author {
      name
    }
  }
}
```

And once again, our server would respond with results that match the query's structure:

```json
{
  "data": {
    "books": [
      {
        "title": "City of Glass",
        "author": {
          "name": "Paul Auster"
        }
      },
      ...
    ]
  }
}
```

### The `Mutation` type

The `Mutation` type is similar in structure and purpose to the [`Query` type](#the-query-type). Whereas the `Query` type defines entry points for _read_ operations, the `Mutation` type defines entry points for _write_ operations.

Each field of the `Mutation` type defines the signature and return type of a different entry point. The `Mutation` type for our example schema might resemble the following:

```graphql
type Mutation {
  addBook(title: String, author: String): Book
}
```

This `Mutation` type defines a single available mutation, `addBook`. The mutation accepts two arguments (`title` and `author`) and returns a newly created `Book` object. As you'd expect, this `Book` object conforms to the structure that we defined in our schema.

#### Structuring a mutation

Like queries, mutations match the structure of your schema's type definitions. The following mutation creates a new `Book` and requests certain fields of the created object as a return value:

```graphql
mutation CreateBook {
  addBook(title: "Fox in Socks", author: "Dr. Seuss") {
    title
    author {
      name
    }
  }
}
```

As with queries, our server would respond to this mutation with a result that matches the mutation's structure, like so:

```json
{
  "data": {
    "addBook": {
      "title": "Fox in Socks",
      "author": {
        "name": "Dr. Seuss"
      }
    }
  }
}
```

A single mutation operation can include multiple top-level fields of the `Mutation` type. This usually means that the operation will execute multiple back-end writes (at least one for each field). To prevent race conditions, top-level `Mutation` fields are [resolved](../data/resolvers/) serially in the order they're listed (all other fields can be resolved in parallel).

[Learn more about designing mutations](#designing-mutations)

### The `Subscription` type

See [Subscriptions](../data/subscriptions).

### Input types

Input types are special object types that allow you to provide hierarchical data as **arguments** to fields (as opposed to providing only flat scalar arguments).

An input type's definition is similar to an object type's, but it uses the `input` keyword:

```graphql
input BlogPostContent {
  title: String
  body: String
}
```

Each field of an input type can be only a [scalar](#scalar-types), an [enum](#enum-types), or _another_ input type:

```graphql
input BlogPostContent {
  title: String
  body: String
  media: [MediaDetails!]
}

input MediaDetails {
  format: MediaFormat!
  url: String!
}

enum MediaFormat {
  IMAGE
  VIDEO
}
```

After you define an input type, any number of different object fields can accept that type as an argument:

```graphql
type Mutation {
  createBlogPost(content: BlogPostContent!): Post
  updateBlogPost(id: ID!, content: BlogPostContent!): Post
}
```

Input types can sometimes be useful when multiple operations require the exact same set of information, but you should reuse them sparingly. Operations might eventually diverge in their sets of required arguments.

> **Take care if using the same input type for fields of both `Query` and `Mutation`**. In many cases, arguments that are _required_ for a mutation are _optional_ for a corresponding query. You might want to create separate input types for each operation type.

### Enum types

An enum is similar to a scalar type, but its legal values are defined in the schema. Here's an example definition:

```graphql
enum AllowedColor {
  RED
  GREEN
  BLUE
}
```

Enums are most useful in situations where the user must pick from a prescribed list of options. As an additional benefit, enum values autocomplete in tools like the Apollo Studio Explorer.

An enum can appear anywhere a scalar is valid (including as a field argument), because they serialize as strings:

```graphql
type Query {
  favoriteColor: AllowedColor # enum return value
  avatar(borderColor: AllowedColor): String # enum argument
}
```

A query might then look like this:

```graphql
query GetAvatar {
  avatar(borderColor: RED)
}
```

#### Internal values (advanced)

Sometimes, a backend forces a different value for an enum internally than in the public API. You can set each enum value's corresponding _internal_ value in the [resolver map](../data/resolvers/#defining-a-resolver) you provide to Apollo Server.

> This feature usually isn't required unless another library in your application expects enum values in a different form.

The following example uses color hex codes for each `AllowedColor`'s internal value:

```js
const resolvers = {
  AllowedColor: {
    RED: '#f00',
    GREEN: '#0f0',
    BLUE: '#00f',
  }
  // ...other resolver definitions...
};
```

These internal values don't change the public API at all. Apollo Server resolvers accept these values instead of the schema values, as shown:

```js
const resolvers = {
  AllowedColor: {
    RED: '#f00',
    GREEN: '#0f0',
    BLUE: '#00f',
  },
  Query: {
    favoriteColor: () => '#f00',
    avatar: (parent, args) => {
      // args.borderColor is '#f00', '#0f0', or '#00f'
    },
  }
};
```

### Union and interface types

See [Unions and interfaces](./unions-interfaces/).

## Growing with a schema

As your organization grows and evolves, your data graph grows and evolves with it. New products and features introduce new schema types and fields. To track these changes over time, you should maintain your schema's definition in version control.

Most _additive_ changes to a schema are safe and backward compatible. However, changes that remove or alter _existing_ behavior might be _breaking_ changes for one or more of your existing clients. All of the following schema changes are potentially breaking changes:

* Removing a type or field
* Renaming a type or field
* Adding [nullability](#field-nullability) to a field
* Removing a field's arguments

A graph management tool such as [Apollo Studio](https://studio.apollographql.com/) helps you understand whether a potential schema change will impact any of your active clients. Studio also provides field-level performance metrics, schema history tracking, and advanced security via operation safelisting.

## Descriptions (docstrings)

GraphQL's schema definition language (SDL) supports Markdown-enabled documentation strings, called **descriptions**. These help consumers of your data graph discover fields and learn how to use them.

The following snippet shows how to use both single-line string literals and multi-line blocks:

```graphql
"Description for the type"
type MyObjectType {
  """
  Description for field
  Supports **multi-line** description for your [API](http://example.com)!
  """
  myField: String!

  otherField(
    "Description for argument"
    arg: Int
  )
}
```

A well documented schema helps provide an enhanced development experience, because GraphQL development tools (such as [Apollo Explorer](https://www.apollographql.com/docs/studio/explorer/)) auto-complete field names along with descriptions when they're provided. Furthermore, [Apollo Studio](https://studio.apollographql.com/) displays descriptions alongside field usage and performance details when using its metrics reporting and client awareness features.

## Naming conventions

The GraphQL specification is flexible and doesn't impose specific naming guidelines. However, it's helpful to establish a set of conventions to ensure consistency across your organization. We recommend the following:

* **Field names** should use `camelCase`. Many GraphQL clients are written in JavaScript, Java, Kotlin, or Swift, all of which recommend `camelCase` for variable names.
* **Type names** should use `PascalCase`. This matches how classes are defined in the languages mentioned above.
* **Enum names** should use `PascalCase`.
* **Enum values** should use `ALL_CAPS`, because they are similar to constants.

These conventions help ensure that most clients don't need to define extra logic to transform the results returned by your server.

## Query-driven schema design

A GraphQL schema is most powerful when it's designed for the needs of the clients that will execute operations against it. Although you _can_ structure your types so they match the structure of your back-end data stores, you don't have to! A single object type's fields can be populated with data from any number of different sources. **Design your schema based on how data is used, not based on how it's stored.**

If your data store includes a field or relationship that your clients don't need yet, omit it from your schema. It's easier and safer to add a new field to a schema than it is to remove an existing field that some of your clients are using.

### Example of a query-driven schema

Let's say we're creating a web app that lists upcoming events in our area. We want the app to show the name, date, and location of each event, along with the weather forecast for it.

In this case, we want our web app to be able to execute a query with a structure similar to the following:

```graphql
query EventList {
  upcomingEvents {
    name
    date
    location {
      name
      weather {
        temperature
        description
      }
    }
  }
}
```

Because we know this is the structure of data that would be helpful for our client, that can inform the structure of our schema:

```graphql
type Query {
  upcomingEvents: [Event!]!
}

type Event {
  name: String!
  date: String!
  location: Location
}

type Location {
  name: String!
  weather: WeatherInfo
}

type WeatherInfo {
  temperature: Float
  description: String
}
```

As mentioned, each of these types can be populated with data from a different data source (or _multiple_ data sources). For example, the `Event` type's `name` and `date` might be populated with data from our back-end database, whereas the `WeatherInfo` type might be populated with data from a third-party weather API.

## Designing mutations

In GraphQL, it's _recommended_ for every mutation's response to include the data that the mutation modified. This enables clients to obtain the latest persisted data without needing to send a followup query.

A schema that supports updating the `email` of a `User` would include the following:

```graphql
type Mutation {
  # This mutation takes id and email parameters and responds with a User
  updateUserEmail(id: ID!, email: String!): User
}

type User {
  id: ID!
  name: String!
  email: String!
}
```

A client could then execute a mutation against the schema with the following structure:

```graphql
mutation updateMyUser {
  updateUserEmail(id: 1, email: "jane@example.com"){
    id
    name
    email
  }
}
```

After the GraphQL server executes the mutation and stores the new email address for the user, it responds to the client with the following:

```json
{
  "data": {
    "updateUserEmail": {
      "id": "1",
      "name": "Jane Doe",
      "email": "jane@example.com"
    }
  }
}
```

Although it isn't _mandatory_ for a mutation's response to include the modified object, doing so greatly improves the efficiency of client code. And as with queries, determining which mutations would be useful for your clients helps inform the structure of your schema.

### Structuring mutation responses

A single mutation can modify multiple types, or multiple instances of the _same_ type. For example, a mutation that enables a user to "like" a blog post might increment the `likes` count for a `Post` _and_ update the `likedPosts` list for the `User`. This makes it less obvious what the structure of the mutation's response should look like.

Additionally, mutations are much more likely than queries to cause errors, because they modify data. A mutation might even result in a _partial_ error, in which it successfully modifies one piece of data and fails to modify another. Regardless of the type of error, it's important that the error is communicated back to the client in a consistent way.

To help resolve both of these concerns, we recommend defining a `MutationResponse` [interface](../schema/unions-interfaces/#interface-type) in your schema, along with a collection of object types that _implement_ that interface (one for each of your mutations).

Here's what a `MutationResponse` interface might look like:

```graphql
interface MutationResponse {
  code: String!
  success: Boolean!
  message: String!
}
```

And here's what an object that _implements_ `MutationResponse` might look like:

```graphql
type UpdateUserEmailMutationResponse implements MutationResponse {
  code: String!
  success: Boolean!
  message: String!
  user: User
}
```

Our `updateUserEmail` mutation would specify `UpdateUserEmailMutationResponse` as its return type (instead of `User`), and the structure of its response would be the following:

```json
{
  "data": {
    "updateUserEmail": {
      "code": "200",
      "success": true,
      "message": "User email was successfully updated",
      "user": {
        "id": "1",
        "name": "Jane Doe",
        "email": "jane@example.com"
      }
    }
  }
}
```

Let’s break this down field by field:

* `code` is a string that represents the status of the data transfer. Think of it like an HTTP status code.
* `success` is a boolean that indicates whether the mutation was successful. This allows a coarse check by the client to know if there were failures.
* `message` is a human-readable string that describes the result of the mutation. It is intended to be used in the UI of the product.
* `user` is added by the implementing type `UpdateUserEmailMutationResponse` to return the newly updated user to the client.

If a mutation modifies _multiple_ types (like our earlier example of "liking" a blog post), its implementing type can include a separate field for each type that's modified:

```graphql
type LikePostMutationResponse implements MutationResponse {
  code: String!
  success: Boolean!
  message: String!
  post: Post
  user: User
}
```

Because our hypothetical `likePost` mutation modifies fields on both a `Post` and a `User`, its response object includes fields for both of those types. A response has the following structure:

```json
{
  "data": {
    "likePost": {
      "code": "200",
      "success": true,
      "message": "Thanks!",
      "post": {
        "id": "123",
        "likes": 5040
      },
      "user": {
        "likedPosts": ["123"]
      }
    }
  }
}
```

Following this pattern provides a client with helpful, detailed information about the result of each requested operation. Equipped with this information, developers can better react to operation failures in their client code.
