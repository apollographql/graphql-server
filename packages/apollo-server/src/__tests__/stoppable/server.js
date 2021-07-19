const http = require('http')
const stoppable = require('..')

const grace = Number(process.argv[2] || Infinity)
const server = http.createServer((req, res) => {
  const delay = parseInt(req.url.slice(1), 10)
  res.writeHead(200)
  res.write('hello')
  setTimeout(() => res.end('world'), delay)
  server.stop()
})
stoppable(server, grace)
server.listen(8000, () => console.log('listening'))
