const http = require('http');
const { Stopper } = require('../../../dist/stoppable.js');

const grace = Number(process.argv[2] || Infinity);
let stopper;
const server = http.createServer((req, res) => {
  const delay = parseInt(req.url.slice(1), 10);
  res.writeHead(200);
  res.write('hello');
  setTimeout(() => res.end('world'), delay);
  stopper.stop(grace);
});
stopper = new Stopper(server);
server.listen(0, () => console.log(server.address().port));
