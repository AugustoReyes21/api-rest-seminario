import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { projectPath } from './paths.js';

const yoga = createApp();
const staticFiles: Record<string, { path: string; type: string }> = {
  '/': { path: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/schema.graphql': { path: 'schema.graphql', type: 'text/plain; charset=utf-8' },
  '/implementation.ts': { path: 'src/context.ts', type: 'text/plain; charset=utf-8' },
  '/examples/scenarios.json': { path: 'examples/scenarios.json', type: 'application/json; charset=utf-8' },
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const file = Object.hasOwn(staticFiles, pathname) ? staticFiles[pathname] : undefined;
  if (file && (request.method === 'GET' || request.method === 'HEAD')) {
    try {
      const content = await readFile(projectPath(file.path));
      response.writeHead(200, { 'content-type': file.type, 'x-content-type-options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Archivo no encontrado.');
    }
    return;
  }
  await yoga(request, response);
});

const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT debe ser un entero entre 1 y 65535.');
}

server.listen(port, '127.0.0.1', () => {
  console.info(`Biblioteca: http://127.0.0.1:${port}/`);
  console.info(`GraphQL: http://127.0.0.1:${port}/graphql`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(); });
}
