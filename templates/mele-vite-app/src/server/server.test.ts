import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAppHandler } from './server';

let server: Server;
let baseUrl: string;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'example-app-'));
  server = createServer(createAppHandler({ dataDir, staticDir: dataDir }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(dataDir, { recursive: true, force: true });
});

describe('example MeLE server', () => {
  it('reports health', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, app: 'example' });
  });

  it('exposes Prometheus metrics', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('app_requests_total');
  });

  it('persists the message API in the data directory', async () => {
    await expect(fetch(`${baseUrl}/api/message`).then((response) => response.json()))
      .resolves.toEqual({ message: 'Hello from example' });

    const update = await fetch(`${baseUrl}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Updated from test' })
    });
    expect(update.status).toBe(200);

    await expect(fetch(`${baseUrl}/api/message`).then((response) => response.json()))
      .resolves.toEqual({ message: 'Updated from test' });
  });
});
