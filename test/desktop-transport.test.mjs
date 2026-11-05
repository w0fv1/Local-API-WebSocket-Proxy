import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fixture } from './fixture.mjs';
import { Gateway } from '../gateway/gateway.mjs';

// Exercise the actual desktop runtime without keyboard/mouse automation.
test('desktop startup restores configuration and survives malformed peer frames', { timeout: 90000 }, async t => {
  const relay = await fixture();
  t.after(() => relay.close());
  await mkdir(resolve('.tmp/desktop-transport'), { recursive: true });
  const directory = await mkdtemp(resolve('.tmp/desktop-transport/run-'));
  const executable = join(directory, 'local-api-websocket-proxy.exe');
  await copyFile(resolve('build/local-api-websocket-proxy.exe'), executable);
  for (const file of ['startup.ps1', 'supervise.ps1']) await copyFile(resolve(file), join(directory, file));
  await writeFile(join(directory, 'startup.json'), JSON.stringify({ taskName: `Proxy Transport Test ${process.pid}` }));
  await writeFile(join(directory, 'proxy.json'), JSON.stringify({ proxies: [{
    id: 1, name: 'Transport regression', ...relay.configuration, enabled: true
  }] }));
  const application = spawn(executable, [], { cwd: directory, windowsHide: true, stdio: 'ignore' });
  t.after(() => application.kill());
  const gateway = new Gateway(relay.serverUrl);
  t.after(() => gateway.close());
  await gateway.ready();
  const headers = [{ name: 'x-test-key', value: 'desktop-test' }];
  const response = await gateway.request({ method: 'POST', path: '/echo', headers, body: Buffer.from('桌面转发') });
  assert.equal(response.body.toString(), '桌面转发');
  assert.equal(relay.requests[0].headers['x-test-key'], 'desktop-test');
  const tunnel = await gateway.openTunnel({ path: '/devtools/browser/test', port: relay.echo.address().port });
  const received = once(tunnel, 'message');
  tunnel.send(Buffer.from('CDP'), false);
  assert.equal((await received)[0].toString(), 'CDP');
  tunnel.close();
  const recovered = once(gateway, 'ready');
  gateway.send({ type: 'http.request', id: 'bad-header', headers: [[]] });
  await recovered;
  assert.equal(application.exitCode, null);
  assert.equal((await gateway.request({ method: 'GET', path: '/after-error' })).status, 201);
});
