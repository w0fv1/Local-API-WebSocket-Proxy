import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { request } from 'node:http';
import { fixture } from './fixture.mjs';

test('gateway CLI exposes HTTP and CDP on its loopback listener', { timeout: 60000 }, async t => {
  const resources = await fixture();
  t.after(() => resources.close());
  await mkdir(resolve('.tmp'), { recursive: true });
  const cwd = await mkdtemp(resolve('.tmp/local-api-gateway-test-'));
  await writeFile(resolve(cwd, 'proxy.json'), JSON.stringify(resources.configuration));
  const agent = spawn(resolve('build/agent.exe'), [], { cwd, windowsHide: true, stdio: 'ignore' });
  t.after(() => agent.kill());
  const gateway = spawn(process.execPath, ['gateway/cli.mjs', resources.serverUrl, '0'], { windowsHide: true });
  let output = '';
  let errors = '';
  gateway.stderr.on('data', data => { errors += data; });
  t.after(async () => { gateway.kill(); await writeFile(resolve(cwd, 'gateway.log'), output + errors); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(output + errors)), 45000);
    gateway.once('error', reject);
    gateway.once('exit', code => { clearTimeout(timeout); reject(new Error(`Gateway exited: ${code} ${errors}`)); });
    gateway.stdout.on('data', data => {
      output += data;
      if (output.includes('Local API agent ready') && output.includes('http://')) { clearTimeout(timeout); resolve(); }
    });
  });
  const base = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const response = await fetch(base + '/cli?query=preserved', {
    method: 'POST', headers: { 'x-test': 'preserved' }, body: Buffer.from([0, 128, 255]),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 128, 255]));
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(resources.requests[0].path, '/cli?query=preserved');
  assert.equal(resources.requests[0].headers['x-test'], 'preserved');
  const upgradeStatus = await new Promise((resolve, reject) => {
    const req = request(base + '/http-upgrade', {
      headers: { connection: 'Upgrade, HTTP2-Settings', upgrade: 'h2c', 'http2-settings': 'AAEAABAAAAIAAAABAAMAAABk' },
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(upgradeStatus, 201);
  const ws = new WebSocket(base.replace('http:', 'ws:') + `/__ws?port=${resources.echo.address().port}&path=%2Fdevtools%2Fbrowser%2Ftest`);
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const text = once(ws, 'message');
  ws.send('CDP via CLI');
  const [message, binary] = await text;
  assert.equal(message.toString(), 'CDP via CLI');
  assert.equal(binary, false);
  ws.close();
  await once(ws, 'close');
  await assert.rejects(access(resolve(cwd, 'communication.json')), { code: 'ENOENT' });
});
