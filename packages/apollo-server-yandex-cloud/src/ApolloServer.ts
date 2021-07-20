import {
    ApolloServerBase,
    FileUploadOptions,
    formatApolloErrors,
    GraphQLOptions,
    processFileUploads,
} from 'apollo-server-core';
import {
    RenderPageOptions as PlaygroundRenderPageOptions,
    renderPlaygroundPage,
} from '@apollographql/graphql-playground-html';
import {IncomingHttpHeaders, IncomingMessage, ServerResponse,} from 'http';

import {
    graphqlYCFunction,
    YcFunctionHttpContext,
    YcFunctionHttpEvent
} from './ycApollo';
import {Headers} from 'apollo-server-env';
import {Readable, Writable} from 'stream';

export interface CreateHandlerOptions {
    cors?: {
        origin?: boolean | string | string[];
        methods?: string | string[];
        allowedHeaders?: string | string[];
        exposedHeaders?: string | string[];
        credentials?: boolean;
        maxAge?: number;
    };
    uploadsConfig?: FileUploadOptions;
    onHealthCheck?: (req: YcFunctionHttpEvent) => Promise<any>;
}

export class FileUploadRequest extends Readable {
    headers!: IncomingHttpHeaders;
}

export class ApolloServer extends ApolloServerBase {
    protected serverlessFramework(): boolean {
        return true;
    }

    // Uploads are supported in this integration
    protected supportsUploads(): boolean {
        return true;
    }

    // This translates the arguments from the middleware into graphQL options It
    // provides typings for the integration specific behavior, ideally this would
    // be propagated with a generic to the super class
    createGraphQLServerOptions(
        event: YcFunctionHttpEvent,
        context: YcFunctionHttpContext,
    ): Promise<GraphQLOptions> {
        return super.graphQLServerOptions({event, context});
    }

    public createHandler({cors, onHealthCheck}: CreateHandlerOptions = {
        cors: undefined,
        onHealthCheck: undefined
    }) {
        // We will kick off the `willStart` event once for the server, and then
        // await it before processing any requests by incorporating its `await` into
        // the GraphQLServerOptions function which is called before each request.
        const promiseWillStart = this.willStart();

        const corsHeaders = new Headers();

        if (cors) {
            if (cors.methods) {
                if (typeof cors.methods === 'string') {
                    corsHeaders.set('access-control-allow-methods', cors.methods);
                } else if (Array.isArray(cors.methods)) {
                    corsHeaders.set(
                        'access-control-allow-methods',
                        cors.methods.join(','),
                    );
                }
            }

            if (cors.allowedHeaders) {
                if (typeof cors.allowedHeaders === 'string') {
                    corsHeaders.set('access-control-allow-headers', cors.allowedHeaders);
                } else if (Array.isArray(cors.allowedHeaders)) {
                    corsHeaders.set(
                        'access-control-allow-headers',
                        cors.allowedHeaders.join(','),
                    );
                }
            }

            if (cors.exposedHeaders) {
                if (typeof cors.exposedHeaders === 'string') {
                    corsHeaders.set('access-control-expose-headers', cors.exposedHeaders);
                } else if (Array.isArray(cors.exposedHeaders)) {
                    corsHeaders.set(
                        'access-control-expose-headers',
                        cors.exposedHeaders.join(','),
                    );
                }
            }

            if (cors.credentials) {
                corsHeaders.set('access-control-allow-credentials', 'true');
            }
            if (typeof cors.maxAge === 'number') {
                corsHeaders.set('access-control-max-age', cors.maxAge.toString());
            }
        }

        return async (
            event: YcFunctionHttpEvent,
            context: YcFunctionHttpContext,
        ) => {
            // We re-load the headers into a Fetch API-compatible `Headers`
            // interface within `graphqlLambda`, but we still need to respect the
            // case-insensitivity within this logic here, so we'll need to do it
            // twice since it's not accessible to us otherwise, right now.
            const eventHeaders = new Headers(event.headers);

            // Make a request-specific copy of the CORS headers, based on the server
            // global CORS headers we've set above.
            const requestCorsHeaders = new Headers(corsHeaders);

            if (cors && cors.origin) {
                const requestOrigin = eventHeaders.get('origin');
                if (typeof cors.origin === 'string') {
                    requestCorsHeaders.set('access-control-allow-origin', cors.origin);
                } else if (
                    requestOrigin &&
                    (typeof cors.origin === 'boolean' ||
                        (Array.isArray(cors.origin) &&
                            requestOrigin &&
                            cors.origin.includes(requestOrigin)))
                ) {
                    requestCorsHeaders.set('access-control-allow-origin', requestOrigin);
                }

                const requestAccessControlRequestHeaders = eventHeaders.get(
                    'access-control-request-headers',
                );
                if (!cors.allowedHeaders && requestAccessControlRequestHeaders) {
                    requestCorsHeaders.set(
                        'access-control-allow-headers',
                        requestAccessControlRequestHeaders,
                    );
                }
            }

            // Convert the `Headers` into an object which can be spread into the
            // various headers objects below.
            // Note: while Object.fromEntries simplifies this code, it's only currently
            //       supported in Node 12 (we support >=6)
            const requestCorsHeadersObject = Array.from(requestCorsHeaders).reduce<Record<string, string>>((headersObject, [key, value]) => {
                headersObject[key] = value;
                return headersObject;
            }, {});

            if (event.httpMethod === 'OPTIONS') {
                return {
                    body: '',
                    statusCode: 204,
                    headers: {
                        ...requestCorsHeadersObject,
                    },
                };
            }

            if (event.path === '/.well-known/apollo/server-health') {
                const successfulResponse = {
                    body: JSON.stringify({status: 'pass'}),
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        ...requestCorsHeadersObject,
                    },
                };
                if (onHealthCheck) {
                    onHealthCheck(event)
                        .then(() => {
                            return successfulResponse;
                        })
                        .catch(() => {
                            return {
                                body: JSON.stringify({status: 'fail'}),
                                statusCode: 503,
                                headers: {
                                    'Content-Type': 'application/json',
                                    ...requestCorsHeadersObject,
                                },
                            };
                        });
                } else {
                    return successfulResponse;
                }
            }

            if (this.playgroundOptions && event.httpMethod === 'GET') {
                const acceptHeader = event.headers['Accept'] || event.headers['accept'];
                if (acceptHeader && acceptHeader.includes('text/html')) {
                    const path = event.path || '/';

                    const playgroundRenderPageOptions: PlaygroundRenderPageOptions = {
                        endpoint: path,
                        ...this.playgroundOptions,
                    };

                    return {
                        body: renderPlaygroundPage(playgroundRenderPageOptions),
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            ...requestCorsHeadersObject,
                        },
                    };
                }
            }

            const response = new Writable() as ServerResponse;

            const fileUploadHandler = (next: Function) => {
                const contentType = event.headers["content-type"] || event.headers["Content-Type"];
                if (contentType && contentType.startsWith("multipart/form-data")
                    && typeof processFileUploads === "function") {
                    const request = new FileUploadRequest() as IncomingMessage;
                    request.push(
                        Buffer.from(
                            <any>event.body,
                            event.isBase64Encoded ? "base64" : "ascii"
                        )
                    );
                    request.push(null);
                    request.headers = event.headers;
                    return processFileUploads(request, response, this.uploadsConfig || {})
                        .then(body => {
                            event.body = body as any;
                            return next();
                        })
                        .catch(error => {
                            throw formatApolloErrors([error], {
                                formatter: this.requestOptions.formatError,
                                debug: this.requestOptions.debug,
                            });
                        });
                } else {
                    return next();
                }
            };

            return await fileUploadHandler(() => graphqlYCFunction(async () => {
                // In a world where this `createHandler` was async, we might avoid this
                // but since we don't want to introduce a breaking change to this API
                // (by switching it to `async`), we'll leverage the
                // `GraphQLServerOptions`, which are dynamically built on each request,
                // to `await` the `promiseWillStart` which we kicked off at the top of
                // this method to ensure that it runs to completion (which is part of
                // its contract) prior to processing the request.
                await promiseWillStart;
                return this.createGraphQLServerOptions(event, context);
            })(event, context));
        };
    }
}
