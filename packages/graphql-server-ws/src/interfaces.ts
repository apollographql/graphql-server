import { GraphQLOptions } from "graphql-server-core";
import { graphql, GraphQLSchema, ExecutionResult } from 'graphql';
import { IObservable } from 'graphql-server-core';
import * as WebSocket from 'ws';

export interface WSRequest {
	id: number; // Per socket increasing number
	action: "request" | "cancel";
	query?: string; // GraphQL Printed Query.
	variables?: any; // GraphQL variables.
	operationName?: string; // GraphQL operationName
}

export interface WSMessageParams {
  requestParams: WSRequest;
  graphqlOptions?: WSGraphQLOptions;
  flags: {
    binary: boolean;
  };
}

export interface WSGraphQLEngine {
  graphqlReactive: (
    schema: GraphQLSchema,
    requestString: string,
    rootValue?: any,
    contextValue?: any,
    variableValues?: {[key: string]: any},
    operationName?: string) => IObservable<ExecutionResult>;
}

export interface WSGraphQLOptions extends GraphQLOptions {
  engine: WSGraphQLEngine;
}

export interface WSGraphQLOptionsFunction {
  (ws: WebSocket): WSGraphQLOptions | Promise<WSGraphQLOptions>;
}

export interface WSHandler {
  (ws: WebSocket): void;
}
