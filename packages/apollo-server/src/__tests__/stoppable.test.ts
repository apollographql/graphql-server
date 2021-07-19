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

const http = require('http')
const https = require('https')
const a = require('awaiting')
const request = require('requisition')
const assert = require('chai').assert
const fs = require('fs')
const stoppable = require('..')
const child = require('child_process')
const path = require('path')

const PORT = 8000

const schemes = {
  http: {
    agent: (opts = {}) => new http.Agent(opts),
    server: handler => http.createServer(handler || ((req, res) => res.end('hello')))
  },
  https: {
    agent: (opts = {}) => https.Agent(Object.assign({rejectUnauthorized: false}, opts)),
    server: handler => https.createServer({
      key: fs.readFileSync('test/fixture.key'),
      cert: fs.readFileSync('test/fixture.cert')
    }, handler || ((req, res) => res.end('hello')))
  }
}

Object.keys(schemes).forEach(schemeName => {
  const scheme = schemes[schemeName]

  describe(`${schemeName}.Server`, function () {
    describe('.close()', () => {
      let server

      beforeEach(function () {
        server = scheme.server()
      })

      describe('without keep-alive connections', () => {
        let closed = 0
        it('stops accepting new connections', async () => {
          server.on('close', () => closed++)
          server.listen(PORT)
          await a.event(server, 'listening')
          const res1 =
              await request(`${schemeName}://localhost:${PORT}`).agent(scheme.agent())
          const text1 = await res1.text()
          assert.equal(text1, 'hello')
          server.close()
          const err = await a.failure(
            request(`${schemeName}://localhost:${PORT}`).agent(scheme.agent()))
          assert.match(err.message, /ECONNREFUSED/)
        })

        it('closes', () => {
          assert.equal(closed, 1)
        })
      })

      describe('with keep-alive connections', () => {
        let closed = 0

        it('stops accepting new connections', async () => {
          server.on('close', () => closed++)
          server.listen(PORT)
          await a.event(server, 'listening')
          const res1 = await request(`${schemeName}://localhost:${PORT}`)
            .agent(scheme.agent({keepAlive: true}))
          const text1 = await res1.text()
          assert.equal(text1, 'hello')
          server.close()
          const err =
              await a.failure(request(`${schemeName}://localhost:${PORT}`)
              .agent(scheme.agent({keepAlive: true})))
          assert.match(err.message, /ECONNREFUSED/)
        })

        it("doesn't close", () => {
          assert.equal(closed, 0)
        })
      })
    })

    describe('.stop()', function () {
      describe('without keep-alive connections', function () {
        let closed = 0
        let gracefully = false
        let server

        beforeEach(function () {
          server = stoppable(scheme.server())
        })

        it('stops accepting new connections', async () => {
          server.on('close', () => closed++)
          server.listen(PORT)
          await a.event(server, 'listening')
          const res1 =
              await request(`${schemeName}://localhost:${PORT}`).agent(scheme.agent())
          const text1 = await res1.text()
          assert.equal(text1, 'hello')
          server.stop((e, g) => {
            gracefully = g
          })
          const err = await a.failure(
            request(`${schemeName}://localhost:${PORT}`).agent(scheme.agent()))
          assert.match(err.message, /ECONNREFUSED/)
        })

        it('closes', () => {
          assert.equal(closed, 1)
        })

        it('gracefully', () => {
          assert.isOk(gracefully)
        })
      })

      describe('with keep-alive connections', () => {
        let closed = 0
        let gracefully = false
        let server

        beforeEach(function () {
          server = stoppable(scheme.server())
        })

        it('stops accepting new connections', async () => {
          server.on('close', () => closed++)
          server.listen(PORT)
          await a.event(server, 'listening')
          const res1 = await request(`${schemeName}://localhost:${PORT}`)
            .agent(scheme.agent({keepAlive: true}))
          const text1 = await res1.text()
          assert.equal(text1, 'hello')
          server.stop((e, g) => {
            gracefully = g
          })
          const err = await a.failure(request(`${schemeName}://localhost:${PORT}`)
            .agent(scheme.agent({ keepAlive: true })))
          assert.match(err.message, /ECONNREFUSED/)
        })

        it('closes', () => { assert.equal(closed, 1) })

        it('gracefully', () => {
          assert.isOk(gracefully)
        })

        it('empties all sockets once closed',
          () => { assert.equal(server._pendingSockets.size, 0) })

        it('registers the "close" callback', (done) => {
          server.listen(PORT)
          server.stop(done)
        })
      })
    })

    describe('with a 0.5s grace period', () => {
      let gracefully = true
      let server

      beforeEach(function () {
        server = stoppable(scheme.server((req, res) => {
          res.writeHead(200)
          res.write('hi')
        }), 500)
      })

      it('kills connections after 0.5s', async () => {
        server.listen(PORT)
        await a.event(server, 'listening')
        await Promise.all([
          request(`${schemeName}://localhost:${PORT}`)
            .agent(scheme.agent({keepAlive: true})),
          request(`${schemeName}://localhost:${PORT}`)
            .agent(scheme.agent({keepAlive: true}))
        ])
        const start = Date.now()
        server.stop((e, g) => {
          gracefully = g
        })
        await a.event(server, 'close')
        assert.closeTo(Date.now() - start, 500, 50)
      })

      it('gracefully', () => {
        assert.isNotOk(gracefully)
      })

      it('empties all sockets', () => {
        assert.equal(server._pendingSockets.size, 0)
      })
    })

    describe('with requests in-flight', () => {
      let server
      let gracefully = false

      beforeEach(function () {
        server = stoppable(scheme.server((req, res) => {
          const delay = parseInt(req.url.slice(1), 10)
          res.writeHead(200)
          res.write('hello')
          setTimeout(() => res.end('world'), delay)
        }))
      })

      it('closes their sockets once they finish', async () => {
        server.listen(PORT)
        await a.event(server, 'listening')
        const start = Date.now()
        const res = await Promise.all([
          request(`${schemeName}://localhost:${PORT}/250`)
            .agent(scheme.agent({keepAlive: true})),
          request(`${schemeName}://localhost:${PORT}/500`)
            .agent(scheme.agent({keepAlive: true}))
        ])
        server.stop((e, g) => {
          gracefully = g
        })
        const bodies = await Promise.all(res.map(r => r.text()))
        await a.event(server, 'close')
        assert.equal(bodies[0], 'helloworld')
        assert.closeTo(Date.now() - start, 500, 100)
      })
      it('gracefully', () => {
        assert.isOk(gracefully)
      })

      describe('with in-flights finishing before grace period ends', function () {
        if (schemeName !== 'http') {
          return
        }

        it('exits immediately', async () => {
          const file = path.join(__dirname, 'server.js')
          const server = child.spawn('node', [file, '500'])
          await a.event(server.stdout, 'data')
          const start = Date.now()
          const res = await request(`${schemeName}://localhost:${PORT}/250`)
            .agent(scheme.agent({keepAlive: true}))
          const body = await res.text()
          assert.equal(body, 'helloworld')
          assert.closeTo(Date.now() - start, 250, 100)
        })
      })
    })
  })
})
