import {GraphQLOptions, HttpQueryError, runHttpQuery,} from 'apollo-server-core';
import {Headers} from 'apollo-server-env';
import {ValueOrPromise} from 'apollo-server-types';

export interface YcFunctionHttpEvent {
    httpMethod: string,
    headers?: { [id: string]: string },
    path?: string,
    multiValueHeaders?: { [id: string]: string[] },
    queryStringParameters?: { [id: string]: string },
    multiValueQueryStringParameters?: { [id: string]: string[] },
    requestContext?: {
        identity: {
            sourceIp: string,
            userAgent: string
        },
        httpMethod: string,
        requestId: string,
        requestTime: string,
        requestTimeEpoch: number
    },
    body?: string,
    isBase64Encoded?: boolean
}

export interface YcFunctionHttpContext {
    requestId: string;
    functionName: string;
    functionVersion: string;
    memoryLimitInMB: number;
    token?: string
}

export interface YcFunctionResult {
    statusCode: number;
    headers?: {
        [header: string]: boolean | number | string;
    };
    multiValueHeaders?: {
        [header: string]: Array<boolean | number | string>;
    };
    body: string;
    isBase64Encoded?: boolean;
}

export type Handler<TEvent = any, TResult = any> = (
    event: TEvent,
    context: YcFunctionHttpContext,
) => void | TResult;

export type YCloudFunctionHandler = Handler<YcFunctionHttpEvent, Promise<YcFunctionResult>>

export interface YcGraphQLOptionsFunction {
    (event: YcFunctionHttpEvent, context: YcFunctionHttpContext): ValueOrPromise<GraphQLOptions>;
}

export function graphqlYCFunction(
    options: GraphQLOptions | YcGraphQLOptionsFunction,
): YCloudFunctionHandler {
    if (!options) {
        throw new Error('Apollo Server requires options.');
    }

    if (arguments.length > 1) {
        throw new Error(
            `Apollo Server expects exactly one argument, got ${arguments.length}`,
        );
    }

    const graphqlHandler: YCloudFunctionHandler = async (
        event,
        context,
    ): Promise<YcFunctionResult> => {
        let {body, isBase64Encoded} = event;

        if (body && isBase64Encoded) {
            body = Buffer.from(body, 'base64').toString();
        }

        if (event.httpMethod === 'POST' && !body) {
            return {
                body: 'POST body missing.',
                statusCode: 500,
            };
        }
        const headers =  event.headers?? {};
        const contentType = headers["content-type"] || headers["Content-Type"];
        let query: Record<string, any> | Record<string, any>[];

        if (body && event.httpMethod === 'POST' &&
            contentType && contentType.startsWith("multipart/form-data")
        ) {
            query = body as any;
        } else if (body && event.httpMethod === 'POST') {
            query = JSON.parse(body);
        } else {
            query = event.queryStringParameters || {};
        }

        return await runHttpQuery([event, context], {
            method: event.httpMethod,
            options: options,
            query,
            request: {
                url: event.path || "",
                method: event.httpMethod,
                headers: new Headers(event.headers),
            },
        }).then(
            ({graphqlResponse}) => {
                const body = graphqlResponse.trim();
                return  {
                    body,
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': `${body.length}`
                    },
                };
            },
            (error: HttpQueryError) => {
                if ('HttpQueryError' !== error.name) {
                    return {
                        statusCode: 500,
                        body: JSON.stringify(error)
                    }
                }
                return {
                    body: error.message,
                    statusCode: error.statusCode,
                    headers: error.headers,
                };
            }
        );
    };

    return graphqlHandler;
}
