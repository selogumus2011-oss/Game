// Minimal static server for local play: `npm start` then open the printed URL.
// ES modules need a real HTTP origin, so opening index.html from disk will not work.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

// fileURLToPath, not `.pathname`: on Windows a file URL's pathname is
// "/C:/Users/..." with a leading slash, and resolving that gives a path that
// exists nowhere, so every request 404s while the server sits there looking
// like it is working.
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** This machine's address on the local network, for playing on a phone. */
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

// A port already in use used to end the run with a raw EADDRINUSE stack trace,
// which reads as "it crashed" rather than as "something else is on 8080" —
// and then the browser just says it cannot connect. Step up through a few
// ports and say which one won.
let port = PORT;
let tries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tries < 8) {
    tries++;
    console.log(`  port ${port} is already in use, trying ${port + 1}`);
    server.listen(++port);
    return;
  }
  if (e.code === 'EADDRINUSE') {
    console.error(`\nCould not find a free port between ${PORT} and ${port}.`);
    console.error('Close whatever is using them, or pick one: PORT=9000 npm start\n');
  } else {
    console.error('\nCould not start the server:', e.message, '\n');
  }
  process.exit(1);
});
server.listen(port, () => {
  const lan = lanAddress();
  console.log(`\nNexus Island Royale: Cursed\n`);
  console.log(`  this computer   http://localhost:${port}`);
  if (lan) console.log(`  same wifi       http://${lan}:${port}   (phones and tablets)`);
  console.log(`\n  serving ${ROOT}`);
  console.log('  Ctrl-C to stop\n');
});
