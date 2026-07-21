import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { defaultMessage, type MessagePayload } from '../shared/message';

export interface AppServerOptions {
  dataDir?: string;
  staticDir?: string;
}

const startedAt = new Date();
let requestCount = 0;

export function createAppHandler(options: AppServerOptions = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.APP_DATA_DIR ?? './data');
  const staticDir = resolve(options.staticDir ?? process.env.APP_STATIC_DIR ?? './dist');
  const messagePath = join(dataDir, 'message.json');

  return async function handle(request: IncomingMessage, response: ServerResponse) {
    requestCount += 1;
    const url = new URL(request.url ?? '/', 'http://localhost');

    try {
      if (url.pathname === '/health') {
        await ensureDataDir(dataDir);
        await fs.access(dataDir);
        return sendJson(response, 200, { ok: true, app: 'example' });
      }

      if (url.pathname === '/metrics') {
        return sendText(response, 200, metricsText());
      }

      if (url.pathname === '/api/message') {
        if (request.method === 'GET') {
          return sendJson(response, 200, await readMessage(messagePath));
        }
        if (request.method === 'POST') {
          const payload = await readJson<MessagePayload>(request);
          const message = String(payload.message ?? '').trim();
          if (!message) return sendJson(response, 400, { error: 'message is required' });
          await ensureDataDir(dataDir);
          await fs.writeFile(messagePath, `${JSON.stringify({ message }, null, 2)}\n`);
          return sendJson(response, 200, { message });
        }
        return sendJson(response, 405, { error: 'method not allowed' });
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 405, { error: 'method not allowed' });
      }
      return serveStatic(staticDir, url.pathname, response, request.method === 'HEAD');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return sendJson(response, 500, { error: message });
    }
  };
}

export function startServer(options: AppServerOptions = {}) {
  const port = Number(process.env.PORT ?? '8080');
  const host = process.env.HOST ?? '0.0.0.0';
  const server = createServer(createAppHandler(options));
  server.listen(port, host, () => {
    console.log(`example listening on http://${host}:${port}`);
  });
  return server;
}

async function ensureDataDir(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
}

async function readMessage(path: string): Promise<MessagePayload> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as MessagePayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultMessage;
    throw error;
  }
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response: ServerResponse, status: number, payload: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
  response.end(payload);
}

function metricsText(): string {
  const uptime = Math.max(0, (Date.now() - startedAt.getTime()) / 1000);
  return [
    '# HELP app_uptime_seconds Seconds since process start.',
    '# TYPE app_uptime_seconds gauge',
    `app_uptime_seconds ${uptime.toFixed(3)}`,
    '# HELP app_requests_total Requests handled by this process.',
    '# TYPE app_requests_total counter',
    `app_requests_total ${requestCount}`,
    ''
  ].join('\n');
}

async function serveStatic(
  staticDir: string,
  pathname: string,
  response: ServerResponse,
  headOnly: boolean
): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = resolve(staticDir, normalize(relative));
  const root = staticDir.endsWith(sep) ? staticDir : `${staticDir}${sep}`;
  const file = candidate.startsWith(root) ? candidate : join(staticDir, 'index.html');
  const fallback = join(staticDir, 'index.html');
  const target = existsSync(file) ? file : fallback;

  if (!existsSync(target)) {
    return sendText(response, 404, 'not found\n');
  }

  response.writeHead(200, { 'content-type': contentType(target) });
  if (headOnly) {
    response.end();
    return;
  }
  createReadStream(target).pipe(response);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
