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

'use strict';

const https = require('https');

module.exports = (server, grace) => {
  grace = typeof grace === 'undefined' ? Infinity : grace;
  const reqsPerSocket = new Map();
  let stopped = false;
  let gracefully = true;

  if (server instanceof https.Server) {
    server.on('secureConnection', onConnection);
  } else {
    server.on('connection', onConnection);
  }

  server.on('request', onRequest);
  server.stop = stop;
  server._pendingSockets = reqsPerSocket;
  return server;

  function onConnection(socket) {
    reqsPerSocket.set(socket, 0);
    socket.once('close', () => reqsPerSocket.delete(socket));
  }

  function onRequest(req, res) {
    reqsPerSocket.set(req.socket, reqsPerSocket.get(req.socket) + 1);
    res.once('finish', () => {
      const pending = reqsPerSocket.get(req.socket) - 1;
      reqsPerSocket.set(req.socket, pending);
      if (stopped && pending === 0) {
        req.socket.end();
      }
    });
  }

  function stop(callback) {
    // allow request handlers to update state before we act on that state
    setImmediate(() => {
      stopped = true;
      if (grace < Infinity) {
        setTimeout(destroyAll, grace).unref();
      }
      server.close((e) => {
        if (callback) {
          callback(e, gracefully);
        }
      });
      reqsPerSocket.forEach(endIfIdle);
    });
  }

  function endIfIdle(requests, socket) {
    if (requests === 0) socket.end();
  }

  function destroyAll() {
    gracefully = false;
    reqsPerSocket.forEach((reqs, socket) => socket.end());
    setImmediate(() => {
      reqsPerSocket.forEach((reqs, socket) => socket.destroy());
    });
  }
};
