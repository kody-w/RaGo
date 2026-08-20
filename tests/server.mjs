import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = createServer(async (request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relative = normalize(requestPath).replace(/^[/\\]+/u, '');
  const source = relative === 'vendor/three.module.js'
    ? 'node_modules/three/build/three.module.js'
    : relative === 'vendor/three.core.js'
      ? 'node_modules/three/build/three.core.js'
      : (relative || 'index.html');
  let path = join(root, source);
  if (!path.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, 'index.html');
    const finalInfo = await stat(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Length': finalInfo.size,
      'Cache-Control': 'no-store'
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`RaGo test server listening on http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
