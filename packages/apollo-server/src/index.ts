// This is the "batteries-included" version of `apollo-server-express`. It
// handles creating the Express app and HTTP server for you (using whatever
// version of `express` its dependency pulls in). If you need to customize the
// Express app or HTTP server at all, you just use `apollo-server-express`
// instead.
import express from 'express';
import http from 'http';
import {
  ApolloServer as ApolloServerExpress,
  CorsOptions,
  ApolloServerExpressConfig,
} from 'apollo-server-express';
import type { AddressInfo } from 'net';
import { format as urlFormat } from 'url';
import { Stopper } from './stoppable';

export * from './exports';

export interface ServerInfo {
  address: string;
  family: string;
  url: string;
  port: number | string;
  server: http.Server;
}

export class ApolloServer extends ApolloServerExpress {
  private stopper?: Stopper;
  private cors?: CorsOptions | boolean;
  private onHealthCheck?: (req: express.Request) => Promise<any>;
  private stopGracePeriodMillis: number;

  constructor(
    config: ApolloServerExpressConfig & {
      cors?: CorsOptions | boolean;
      onHealthCheck?: (req: express.Request) => Promise<any>;
      stopGracePeriodMillis?: number;
    },
  ) {
    super(config);
    this.cors = config && config.cors;
    this.onHealthCheck = config && config.onHealthCheck;
    this.stopGracePeriodMillis = config?.stopGracePeriodMillis ?? 10_000;
  }

  private createServerInfo(server: http.Server): ServerInfo {
    const addressInfo = server.address() as AddressInfo;

    // Convert IPs which mean "any address" (IPv4 or IPv6) into localhost
    // corresponding loopback ip. If this heuristic is wrong for your use case,
    // explicitly specify a frontend host (in the `host` option to
    // ApolloServer.listen).
    let hostForUrl = addressInfo.address;
    if (hostForUrl === '' || hostForUrl === '::') {
      hostForUrl = 'localhost';
    }

    const url = urlFormat({
      protocol: 'http',
      hostname: hostForUrl,
      port: addressInfo.port,
      pathname: this.graphqlPath,
    });

    return {
      ...addressInfo,
      server,
      url,
    };
  }

  public override applyMiddleware() {
    throw new Error(
      'To use Apollo Server with an existing express application, please use apollo-server-express',
    );
  }

  public override async start(): Promise<void> {
    throw new Error(
      "When using the `apollo-server` package, you don't need to call start(); just call listen().",
    );
  }

  // Listen takes the same arguments as http.Server.listen.
  public async listen(...opts: Array<any>): Promise<ServerInfo> {
    // First start the server and throw if startup fails (eg, schema can't be loaded
    // or a serverWillStart plugin throws).
    await this._start();

    // This class is the easy mode for people who don't create their own express
    // object, so we have to create it.
    const app = express();

    app.disable('x-powered-by');

    // provide generous values for the getting started experience
    super.applyMiddleware({
      app,
      path: '/',
      bodyParserConfig: { limit: '50mb' },
      onHealthCheck: this.onHealthCheck,
      cors:
        typeof this.cors !== 'undefined'
          ? this.cors
          : {
              origin: '*',
            },
    });

    const httpServer = http.createServer(app);

    this.stopper = new Stopper(httpServer);

    await new Promise((resolve) => {
      httpServer.once('listening', resolve);
      // If the user passed a callback to listen, it'll get called in addition
      // to our resolver. They won't have the ability to get the ServerInfo
      // object unless they use our Promise, though.
      httpServer.listen(...(opts.length ? opts : [{ port: 4000 }]));
    });

    return this.createServerInfo(httpServer);
  }

  public override async stop() {
    // First drain the HTTP server. (See #5074 for a plan to generalize this to
    // the web framework integrations.)
    //
    // `Stopper.stop` is an async function which:
    // - closes the server (ie, stops listening)
    // - closes all connections with no active requests
    // - continues to close connections when their active request count drops to
    //   zero
    // - in 10 seconds (configurable), closes all remaining active connections
    // - returns (async) once there are no remaining active connections
    //
    // If you don't like this behavior, use apollo-server-express instead of
    // apollo-server.
    const { stopper } = this;
    if (stopper) {
      this.stopper = undefined;
      await stopper.stop(this.stopGracePeriodMillis);
    }

    await super.stop();
  }
}
