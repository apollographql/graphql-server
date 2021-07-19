// This file is adapted from the stoppable npm package:
// https://github.com/hunterloftis/stoppable
//
// We've ported it to TypeScript and made some further changes.
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

import http from 'http';
import https from 'https';
const a: any = require('awaiting');
const request: any = require('requisition');
import fs from 'fs';
import { Stopper } from '../stoppable';
import child from 'child_process';
import path from 'path';
import { AddressInfo } from 'net';

function port(s: http.Server) {
  return (s.address() as AddressInfo).port;
}

interface SchemeInfo {
  agent: (opts?: http.AgentOptions) => http.Agent;
  server: (handler?: http.RequestListener) => http.Server;
}

const agents: http.Agent[] = [];
afterEach(() => {
  agents.forEach((a) => a.destroy());
  agents.length = 0;
});

const schemes: Record<string, SchemeInfo> = {
  http: {
    agent: (opts = {}) => {
      const a = new http.Agent(opts);
      agents.push(a);
      return a;
    },
    server: (handler) =>
      http.createServer(handler || ((_req, res) => res.end('hello'))),
  },
  https: {
    agent: (opts = {}) => {
      const a = new https.Agent(
        Object.assign({ rejectUnauthorized: false }, opts),
      );
      agents.push(a);
      return a;
    },
    server: (handler) =>
      https.createServer(
        {
          key: fs.readFileSync(
            path.join(__dirname, 'stoppable', 'fixture.key'),
          ),
          cert: fs.readFileSync(
            path.join(__dirname, 'stoppable', 'fixture.cert'),
          ),
        },
        handler || ((_req, res) => res.end('hello')),
      ),
  },
};

Object.keys(schemes).forEach((schemeName) => {
  const scheme = schemes[schemeName];

  describe(`${schemeName}.Server`, function () {
    describe('.close()', () => {
      let server: http.Server;

      beforeEach(function () {
        server = scheme.server();
      });

      it('without keep-alive connections', async () => {
        let closed = 0;
        server.on('close', () => closed++);
        server.listen(0);
        const p = port(server);
        await a.event(server, 'listening');
        const res1 = await request(`${schemeName}://localhost:${p}`).agent(
          scheme.agent(),
        );
        const text1 = await res1.text();
        expect(text1).toBe('hello');
        server.close();
        const err = await a.failure(
          request(`${schemeName}://localhost:${p}`).agent(scheme.agent()),
        );
        expect(err.message).toMatch(/ECONNREFUSED/);
        expect(closed).toBe(1);
      });

      it('with keep-alive connections', async () => {
        let closed = 0;

        server.on('close', () => closed++);
        server.listen(0);
        const p = port(server);
        await a.event(server, 'listening');
        const res1 = await request(`${schemeName}://localhost:${p}`).agent(
          scheme.agent({ keepAlive: true }),
        );
        const text1 = await res1.text();
        expect(text1).toBe('hello');
        server.close();
        const err = await a.failure(
          request(`${schemeName}://localhost:${p}`).agent(
            scheme.agent({ keepAlive: true }),
          ),
        );
        expect(err.message).toMatch(/ECONNREFUSED/);
        expect(closed).toBe(0);
      });
    });

    describe('Stopper', function () {
      it('without keep-alive connections', async () => {
        let closed = 0;
        const server = scheme.server();
        const stopper = new Stopper(server);

        server.on('close', () => closed++);
        server.listen(0);
        const p = port(server);
        await a.event(server, 'listening');
        const res1 = await request(`${schemeName}://localhost:${p}`).agent(
          scheme.agent(),
        );
        const text1 = await res1.text();
        expect(text1).toBe('hello');
        const gracefully = await stopper.stop();
        const err = await a.failure(
          request(`${schemeName}://localhost:${p}`).agent(scheme.agent()),
        );
        expect(err.message).toMatch(/ECONNREFUSED/);

        expect(closed).toBe(1);
        expect(gracefully).toBe(true);
      });

      it('with keep-alive connections', async () => {
        let closed = 0;
        const server = scheme.server();
        const stopper = new Stopper(server);

        server.on('close', () => closed++);
        server.listen(0);
        const p = port(server);
        await a.event(server, 'listening');
        const res1 = await request(`${schemeName}://localhost:${p}`).agent(
          scheme.agent({ keepAlive: true }),
        );
        const text1 = await res1.text();
        expect(text1).toBe('hello');
        const gracefully = await stopper.stop();
        const err = await a.failure(
          request(`${schemeName}://localhost:${p}`).agent(
            scheme.agent({ keepAlive: true }),
          ),
        );
        expect(err.message).toMatch(/ECONNREFUSED/);

        expect(closed).toBe(1);
        expect(gracefully).toBe(true);

        expect(stopper['reqsPerSocket'].size).toBe(0);
      });
    });

    it('with a 0.5s grace period', async () => {
      const server = scheme.server((_req, res) => {
        res.writeHead(200);
        res.write('hi');
      });
      const stopper = new Stopper(server);
      server.listen(0);
      const p = port(server);
      await a.event(server, 'listening');
      await Promise.all([
        request(`${schemeName}://localhost:${p}`).agent(
          scheme.agent({ keepAlive: true }),
        ),
        request(`${schemeName}://localhost:${p}`).agent(
          scheme.agent({ keepAlive: true }),
        ),
      ]);
      const start = Date.now();
      const closeEventPromise = a.event(server, 'close');
      const gracefully = await stopper.stop(500);
      await closeEventPromise;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(450);
      expect(elapsed).toBeLessThanOrEqual(550);
      expect(gracefully).toBe(false);
      // It takes a moment for the `finish` events to happen.
      await a.delay(20);
      expect(stopper['reqsPerSocket'].size).toBe(0);
    });

    it('with requests in-flight', async () => {
      const server = scheme.server((req, res) => {
        const delay = parseInt(req.url!.slice(1), 10);
        res.writeHead(200);
        res.write('hello');
        setTimeout(() => res.end('world'), delay);
      });
      const stopper = new Stopper(server);

      server.listen(0);
      const p = port(server);
      await a.event(server, 'listening');
      const start = Date.now();
      const res = await Promise.all([
        request(`${schemeName}://localhost:${p}/250`).agent(
          scheme.agent({ keepAlive: true }),
        ),
        request(`${schemeName}://localhost:${p}/500`).agent(
          scheme.agent({ keepAlive: true }),
        ),
      ]);
      const closeEventPromise = a.event(server, 'close');
      const gracefully = await stopper.stop();
      const bodies = await Promise.all(res.map((r) => r.text()));
      await closeEventPromise;
      expect(bodies[0]).toBe('helloworld');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(400);
      expect(elapsed).toBeLessThanOrEqual(600);
      expect(gracefully).toBe(true);
    });

    if (schemeName === 'http') {
      it('with in-flights finishing before grace period ends', async () => {
        const file = path.join(__dirname, 'stoppable', 'server.js');
        const server = child.spawn('node', [file, '500']);
        const [data] = await a.event(server.stdout, 'data');
        const port = +data.toString();
        expect(typeof port).toBe('number');
        const start = Date.now();
        const res = await request(
          `${schemeName}://localhost:${port}/250`,
        ).agent(scheme.agent({ keepAlive: true }));
        const body = await res.text();
        expect(body).toBe('helloworld');
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(150);
        expect(elapsed).toBeLessThanOrEqual(350);
        // Wait for subprocess to go away.
        await a.event(server, 'close');
      });
    }
  });
});
