import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdir, mkdtemp, copyFile, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixture.mjs';
import { Gateway } from '../gateway/gateway.mjs';

const execute = promisify(execFile);
async function ui(process, action, text = '') {
  return (await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('test/desktop-ui.ps1'), '-LauncherId', String(process.pid), '-Action', action, '-Text', text], { windowsHide: true, timeout: 15000, encoding: 'utf8' })).stdout;
}

test('native desktop isolates proxies, detects missing pong and restores enabled profiles', { timeout: 120000 }, async t => {
  const first = await fixture({ autoPong: false });
  const second = await fixture();
  t.after(() => { first.close(); second.close(); });
  await mkdir(resolve('.tmp/local-api-desktop-test'), { recursive: true });
  const cwd = await mkdtemp(resolve('.tmp/local-api-desktop-test/run-'));
  const executable = join(cwd, 'local-api-websocket-proxy.exe');
  await copyFile(resolve('build/local-api-websocket-proxy.exe'), executable);
  for (const file of ['startup.ps1', 'supervise.ps1']) await copyFile(resolve(file), join(cwd, file));
  await writeFile(join(cwd, 'startup.json'), JSON.stringify({ taskName: `Local API Proxy Desktop ${process.pid}` }));
  const proxies = [first, second].map((resource, index) => ({ id: index + 1, name: `API ${index + 1}`, ...resource.configuration, enabled: true }));
  await writeFile(join(cwd, 'proxy.json'), JSON.stringify({ proxies }));
  let application;
  t.after(async () => {
    if (application && application.exitCode === null) {
      try { await ui(application, 'Close'); } catch { application.kill(); }
    }
  });
  let one = new Gateway(first.serverUrl);
  let two = new Gateway(second.serverUrl);
  t.after(() => { one.close(); two.close(); });
  application = spawn(executable, [], { cwd, windowsHide: true, stdio: 'ignore' });
  await Promise.all([one.ready(), two.ready()]);
  const send = async (gateway, text) => {
    const response = await gateway.request({ method: 'POST', path: '/echo', body: Buffer.from(text) });
    assert.equal(response.body.toString(), text);
  };
  await Promise.all([send(one, 'first-local-api'), send(two, 'second-local-api')]);
  assert.equal(first.requests.length, 1);
  assert.equal(second.requests.length, 1);
  const heartbeatRecovery = once(one, 'ready');
  const failures = [];
  const probes = [];
  const alive = setInterval(() => { probes.push(send(two, 'unaffected').catch(error => failures.push(error))); }, 1000);
  t.after(() => clearInterval(alive));
  try { await heartbeatRecovery; } finally { clearInterval(alive); }
  await Promise.all(probes);
  assert.deepEqual(failures, []);
  assert.ok(second.requests.length >= 10, 'second proxy remains usable during heartbeat recovery');
  await send(one, 'after-heartbeat-reconnect');
  await ui(application, 'Click', '全部断开');
  for (let i = 0; i < 40 && [...first.relay.clients, ...second.relay.clients].some(client => client.role === 'client'); i++) await delay(100);
  assert.ok(![...first.relay.clients, ...second.relay.clients].some(client => client.role === 'client'));
  assert.ok(JSON.parse(await readFile(join(cwd, 'proxy.json'), 'utf8')).proxies.every(proxy => !proxy.enabled));
  const recovered = Promise.all([once(one, 'ready'), once(two, 'ready')]);
  await ui(application, 'Click', '全部连接');
  await recovered;
  await ui(application, 'Click', '新增');
  await ui(application, 'Click', '保存');
  assert.equal(JSON.parse(await readFile(join(cwd, 'proxy.json'), 'utf8')).proxies.length, 3);
  await ui(application, 'Click', '删除');
  assert.equal(JSON.parse(await readFile(join(cwd, 'proxy.json'), 'utf8')).proxies.length, 2);
  const exit = once(application, 'exit');
  await ui(application, 'Close');
  assert.equal((await exit)[0], 0);
  one.close(); two.close();
  one = new Gateway(first.serverUrl); two = new Gateway(second.serverUrl);
  application = spawn(executable, [], { cwd, windowsHide: true, stdio: 'ignore' });
  await Promise.all([one.ready(), two.ready()]);
  await Promise.all([send(one, 'restored-one'), send(two, 'restored-two')]);
  await assert.rejects(access(join(cwd, 'communication.json')));
});
