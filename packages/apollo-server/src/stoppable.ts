// This file is adapted from the stoppable npm package:
// https://github.com/hunterloftis/stoppable
//
// We've ported it to TypeScript and simplified the API and fixed some bugs.
// Here's the license of the original code:
//
// The MIT License (MIT)
//
// Copyright (c) 2017 Hunter Loftis <hunter@hunterloftis.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import type http from 'http';
import https from 'https';
import type { Socket } from 'net';

export class Stopper {
  private reqsPerSocket = new Map<Socket, number>();
  private stopped = false;

  constructor(private server: http.Server | https.Server) {
    // Keep a number in reqsPerSocket for each current connection.
    server.on(
      server instanceof https.Server ? 'secureConnection' : 'connection',
      (socket: Socket) => {
        this.reqsPerSocket.set(socket, 0);
        socket.once('close', () => this.reqsPerSocket.delete(socket));
      },
    );

    // Track how many HTTP requests are active on the socket.
    server.on(
      'request',
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        this.reqsPerSocket.set(
          req.socket,
          (this.reqsPerSocket.get(req.socket) ?? 0) + 1,
        );
        res.once('finish', () => {
          const pending = (this.reqsPerSocket.get(req.socket) ?? 0) - 1;
          this.reqsPerSocket.set(req.socket, pending);
          // If we're in the process of stopping and it's gone idle, close the
          // socket.
          if (this.stopped && pending === 0) {
            req.socket.end();
          }
        });
      },
    );
  }

  async stop(stopGracePeriodMillis: number = Infinity): Promise<boolean> {
    let gracefully = true;

    // In the off-chance that we are calling `stop` directly from within the
    // HTTP server's request handler (and so we haven't gotten to the
    // `connection` event yet), wait a moment so that `connection` can be called
    // and this request can actually count.
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.stopped = true;

    let timeout: NodeJS.Timeout | null = null;
    // Soon, hard-destroy everything.
    if (stopGracePeriodMillis < Infinity) {
      timeout = setTimeout(() => {
        gracefully = false;
        this.reqsPerSocket.forEach((_, socket) => socket.end());
        // (FYI, when importing from upstream, not sure why we need setImmediate
        // here.)
        setImmediate(() => {
          this.reqsPerSocket.forEach((_, socket) => socket.destroy());
        });
      }, stopGracePeriodMillis);
    }

    // Close the server and create a Promise that resolves when all connections
    // are closed. Note that we ignore any error from `close` here.
    const closePromise = new Promise<void>((resolve) =>
      this.server.close(() => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        resolve();
      }),
    );

    // Immediately close any idle sockets.
    this.reqsPerSocket.forEach((requests, socket) => {
      if (requests === 0) socket.end();
    });

    // Wait for all connections to be closed.
    await closePromise;

    return gracefully;
  }
}
