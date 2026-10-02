import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture } from './fixture.mjs';
import { Gateway } from '../gateway/gateway.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const resources = await fixture();
const directory = resolve('.tmp/local-api-proxy-ui');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'fixture.json'), JSON.stringify({ ...resources.configuration, serverUrl: resources.serverUrl }));
let gateway;
resources.relay.on('connection', (_, request) => {
  if (!request.url.includes('role=client')) return;
  gateway?.close();
  gateway = new Gateway(resources.serverUrl);
  gateway.on('ready', async () => {
  try {
    const response = await gateway.request({ method: 'POST', path: '/desktop', body: Buffer.from('desktop-verified') });
    assert.equal(response.status, 201);
    assert.equal(response.body.toString(), 'desktop-verified');
    assert.equal(response.headers.filter(h => h.name === 'set-cookie').length, 2);
    assert.deepEqual((await gateway.request({ method: 'GET', path: '/large' })).body, Buffer.alloc(1500000, 255));
    await Promise.all(Array.from({ length: 4 }, async (_, i) => {
      const body = Buffer.alloc(50000, i);
      assert.deepEqual((await gateway.request({ method: 'POST', path: '/concurrent', body })).body, body);
    }));
    const tunnel = await gateway.openTunnel({ path: '/devtools/browser/native', port: resources.echo.address().port });
    const text = once(tunnel, 'message');
    tunnel.send(Buffer.from('原生 CDP'), false);
    assert.equal((await text)[0].toString(), '原生 CDP');
    const binary = once(tunnel, 'message');
    tunnel.send(Buffer.from([0, 128, 255]), true);
    assert.deepEqual((await binary)[0], Buffer.from([0, 128, 255]));
    tunnel.close();
    const abort = new AbortController();
    const cancelled = assert.rejects(gateway.request({ method: 'GET', path: '/never', signal: abort.signal }), /cancelled/);
    abort.abort();
    await cancelled;
    assert.equal((await gateway.request({ method: 'GET', path: '/after-cancel' })).status, 201);
    await writeFile(resolve(directory, 'result.json'), JSON.stringify({ passed: true, status: response.status, body: response.body.toString() }));
  } catch (error) {
    console.error(error);
    await writeFile(resolve(directory, 'result.json'), JSON.stringify({ passed: false, error: error.message }));
  }
  });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { gateway?.close(); resources.close(); });
