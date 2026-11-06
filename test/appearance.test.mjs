import test from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, copyFile, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixture.mjs';
import { Gateway } from '../gateway/gateway.mjs';

const execute = promisify(execFile);

test('desktop keeps actions in the corners and controls its real logon trigger', { timeout: 120000 }, async t => {
  const resource = await fixture();
  t.after(() => resource.close());
  const root = resolve('.tmp/local-api-appearance-test');
  await mkdir(root, { recursive: true });
  const cwd = await mkdtemp(join(root, 'run-'));
  const executable = join(cwd, 'local-api-websocket-proxy.exe');
  await copyFile(resolve('build/local-api-websocket-proxy.exe'), executable);
  for (const file of ['startup.ps1', 'supervise.ps1']) await copyFile(resolve(file), join(cwd, file));
  const taskName = `Local API Proxy Appearance ${process.pid}`;
  await writeFile(join(cwd, 'startup.json'), JSON.stringify({ taskName }));
  await writeFile(join(cwd, 'proxy.json'), JSON.stringify({ proxies: [{ id: 1, name: 'API', ...resource.configuration, enabled: false }] }));
  const startup = async action => (await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(cwd, 'startup.ps1'), '-Action', action, '-Directory', cwd], { windowsHide: true, encoding: 'utf8' })).stdout.trim();
  const application = spawn(executable, [], { cwd, windowsHide: true, stdio: 'ignore' });
  let phase = 'startup';
  const ui = async (action, text = '', extras = []) => {
    try { return (await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('test/desktop-ui.ps1'), '-LauncherId', String(application.pid), '-Action', action, '-Text', text, ...extras], { windowsHide: true, encoding: 'utf8' })).stdout; }
    catch (error) {
      let snapshot = '';
      if (action !== 'Inspect' && action !== 'Close') {
        try { snapshot = (await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('test/desktop-ui.ps1'), '-LauncherId', String(application.pid), '-Action', 'Inspect'], { windowsHide: true, encoding: 'utf8' })).stdout; } catch {}
      }
      throw new Error(`${phase}: application exit ${application.exitCode}, ${action} ${text} ${snapshot}`, { cause: error });
    }
  };
  t.after(async () => {
    if (application.exitCode === null) {
      const exited = once(application, 'exit');
      try { await ui('Close'); } catch { application.kill(); }
      await exited;
    }
    await startup('Remove');
    assert.equal(application.exitCode, 0, 'native launcher must exit cleanly');
  });
  let elements;
  for (let i = 0; i < 60; i++) {
    if (application.exitCode !== null) break;
    try { elements = JSON.parse(await ui('Inspect')); break; } catch { await delay(250); }
  }
  assert.ok(elements, 'application starts');
  const checkLayout = elements => {
    const window = elements[0];
    const buttons = elements.filter(item => item.type === 'ControlType.Button');
    const add = buttons.find(item => item.name === '新增代理');
    const save = buttons.find(item => item.name === '保存更改');
    const startup = elements.find(item => item.name === '开机启动');
    assert.ok(add && startup && !save, 'toolbar actions remain visible and saved settings need no save button');
    const status = elements.find(item => /^● /.test(item.name));
    const action = buttons.find(item => item.name === '连接' || item.name === '断开');
    const remove = buttons.find(item => item.name === '删除');
    assert.ok(add.y < status.y && status.y < action.y);
    assert.ok(remove.x < action.x && Math.abs(remove.y - action.y) < 12);
    assert.ok(action.x + action.width > window.x + window.width * 0.7, 'actions use the available card width');
    assert.ok(elements.some(item => item.name === '中继地址') && elements.some(item => item.name === '本地服务地址'));

  };
  checkLayout(elements);
  phase = 'pointer focus and text entry';
  await ui('ExerciseInputs');
  assert.ok(elements.some(item => item.name === '● 未连接'));
  assert.equal(await startup('Query'), 'false');
  const toggleStartup = async () => {
    for (let i = 0; i < 40; i++) {
      const elements = JSON.parse(await ui('Inspect'));
      if (elements.some(item => item.name === '开机启动' && item.enabled)) { await ui('Toggle', '开机启动'); return; }
      await delay(100);
    }
    assert.fail('startup switch remains unavailable');
  };
  phase = 'enable startup';
  await toggleStartup();
  for (let i = 0; i < 40 && await startup('Query') !== 'true'; i++) await delay(100);
  assert.equal(await startup('Query'), 'true');
  phase = 'disable startup';
  await toggleStartup();
  for (let i = 0; i < 40 && await startup('Query') !== 'false'; i++) await delay(100);
  assert.equal(await startup('Query'), 'false');
  phase = 'connect';
  await ui('Click', '连接');
  for (let i = 0; i < 40 && !(await ui('Snapshot')).includes('● 等待网关'); i++) await delay(100);
  const waiting = await ui('Snapshot');
  assert.ok(waiting.includes('● 等待网关'), waiting);
  const gateway = new Gateway(resource.serverUrl);
  t.after(() => gateway.close());
  await gateway.ready();
  for (let i = 0; i < 40 && !(await ui('Snapshot')).includes('● 已连接'); i++) await delay(100);
  assert.ok((await ui('Snapshot')).includes('● 已连接'));
  await ui('Capture', '', ['-OutputPath', join(root, 'desktop.png')]);
  phase = 'add and save';
  await ui('Click', '新增代理');
  await ui('Click', '保存更改');
  assert.equal(JSON.parse(await readFile(join(cwd, 'proxy.json'), 'utf8')).proxies.length, 2);
  assert.ok(JSON.parse(await ui('Inspect')).some(item => item.name === '开机启动' && item.enabled), 'adding a proxy preserves the startup widget');
  phase = 'resize large';
  await ui('Resize', '', ['-Width', '980', '-Height', '820']);
  await delay(200);
  checkLayout(JSON.parse(await ui('Inspect')));
  await ui('Capture', '', ['-OutputPath', join(root, 'desktop-wide.png')]);
  phase = 'resize small';
  await ui('Resize', '', ['-Width', '500', '-Height', '400']);
  await delay(200);
  checkLayout(JSON.parse(await ui('Inspect')));
  await ui('Capture', '', ['-OutputPath', join(root, 'desktop-narrow.png')]);
  await ui('Click', '全部断开');
  for (let i = 0; i < 40 && !(await ui('Snapshot')).includes('● 未连接'); i++) await delay(100);
  assert.ok((await ui('Snapshot')).includes('● 未连接'));
});
