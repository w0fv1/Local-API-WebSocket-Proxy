import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixture.mjs';
import { Gateway } from '../gateway/gateway.mjs';

async function startAgent(t, name, transferWindow) {
  const resources = await fixture();
  t.after(() => resources.close());
  const cwd = resolve(`.tmp/window-${name}`);
  await mkdir(cwd, { recursive: true });
  await writeFile(resolve(cwd, 'proxy.json'), JSON.stringify({ ...resources.configuration, transferWindow }));
  const agent = spawn(resolve('build/agent.exe'), [], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  agent.stdout.on('data', data => { output += data; });
  agent.stderr.on('data', data => { output += data; });
  t.after(() => agent.kill());
  return { resources, agent, output: () => output };
}

async function connect(t, resources) {
  const gateway = new Gateway(resources.serverUrl);
  t.after(() => gateway.close());
  await gateway.ready();
  return gateway;
}

for (const configured of [1, 4, 16, undefined]) {
  const transferWindow = configured ?? 8;
  test(`native transmission window ${configured ?? 'default'} bounds unacknowledged frames and preserves messages`, { timeout: 20000 }, async t => {
    const { resources, agent } = await startAgent(t, configured ?? 'default', configured);
    const gateway = await connect(t, resources);
    const tunnel = await gateway.openTunnel({ path: '/window', port: resources.echo.address().port, headers: [] });
    const send = gateway.send.bind(gateway);
    const acknowledgements = [];
    let hold = true;
    gateway.send = frame => {
      if (hold && frame.type === 'ack') acknowledgements.push(frame);
      else send(frame);
    };
    const received = [];
    tunnel.on('message', (data, binary) => received.push({ data, binary }));
    const upstream = [...resources.echo.clients][0];
    const messageCount = transferWindow + 3;
    for (let i = 0; i < messageCount; i++) upstream.send(i === 0 ? '' : `message-${i}`);
    await delay(800);
    assert.equal(acknowledgements.length, transferWindow);
    assert.equal(received.length, transferWindow);
    send(acknowledgements.shift());
    await delay(400);
    assert.equal(acknowledgements.length, transferWindow);
    assert.equal(received.length, transferWindow + 1);
    hold = false;
    for (const frame of acknowledgements.splice(0)) send(frame);
    for (let i = 0; i < 100 && received.length < messageCount; i++) await delay(20);
    assert.deepEqual(received.map(message => message.data.toString()), Array.from({ length: messageCount }, (_, i) => i === 0 ? '' : `message-${i}`));
    hold = true;
    const binary = Buffer.alloc(8192 * transferWindow + 123, 255);
    const wireFrames = [];
    const recordWireFrames = raw => {
      const frame = JSON.parse(raw);
      if (frame.type === 'ws.data') wireFrames.push(raw.length);
    };
    gateway.ws.on('message', recordWireFrames);
    upstream.send(binary);
    upstream.send('after-binary');
    await delay(800);
    assert.equal(acknowledgements.length, transferWindow);
    assert.equal(received.length, messageCount);
    assert.ok(wireFrames.reduce((total, size) => total + size, 0) < 1024 * 1024);
    gateway.ws.off('message', recordWireFrames);
    hold = false;
    for (const frame of acknowledgements.splice(0)) send(frame);
    for (let i = 0; i < 100 && received.length < messageCount + 2; i++) await delay(20);
    assert.equal(received.length, messageCount + 2);
    assert.equal(received[messageCount].binary, true);
    assert.deepEqual(received[messageCount].data, binary);
    assert.equal(received[messageCount + 1].data.toString(), 'after-binary');
    assert.equal(agent.exitCode, null);
  });
}

for (const transferWindow of [0, 17]) {
  test(`native agent rejects transmission window ${transferWindow}`, { timeout: 10000 }, async t => {
    const { resources, agent, output } = await startAgent(t, `invalid-${transferWindow}`, transferWindow);
    const [status] = await once(agent, 'close');
    assert.notEqual(status, 0);
    assert.match(output(), /invalid transfer window/i);
    assert.equal(resources.relay.clients.size, 0);
  });
}

test('HTTP and WebSocket operations share credit across peers and cancellation advances queued work', { timeout: 20000 }, async t => {
  const { resources } = await startAgent(t, 'mixed', 16);
  const gateway = await connect(t, resources);
  const openTunnel = path => gateway.openTunnel({ path, port: resources.echo.address().port, headers: [] });
  const first = await openTunnel('/first');
  const send = gateway.send.bind(gateway);
  const held = [];
  gateway.send = frame => {
    if (frame.type === 'ack') held.push(frame);
    else send(frame);
  };
  const [upstream] = resources.echo.clients;
  for (let index = 0; index < 16; index++) upstream.send(`first-${index}`);
  for (let index = 0; index < 100 && held.length < 16; index++) await delay(20);
  assert.equal(held.length, 16);
  const firstId = held[0].id;
  const second = await openTunnel('/second');
  const otherGateway = await connect(t, resources);
  const otherTunnel = await otherGateway.openTunnel({ path: '/other-peer', port: resources.echo.address().port, headers: [] });
  const otherSend = otherGateway.send.bind(otherGateway);
  const otherHeld = [];
  otherGateway.send = frame => {
    if (frame.type === 'ack') otherHeld.push(frame);
    else otherSend(frame);
  };
  const secondMessage = once(second, 'message');
  const otherMessage = once(otherTunnel, 'message');
  const [, secondUpstream, otherUpstream] = resources.echo.clients;
  secondUpstream.send('second');
  otherUpstream.send('other-peer');
  const request = gateway.request({ method: 'GET', path: '/mixed-http' });
  request.catch(() => {});
  for (let index = 0; index < 100 && resources.requests.length === 0; index++) await delay(20);
  assert.equal(resources.requests[0]?.path, '/mixed-http');
  await delay(150);
  assert.equal(held.length, 16);
  assert.equal(otherHeld.length, 0);
  assert.ok(held.every(frame => frame.id === firstId));
  first.close();
  assert.equal((await request).status, 201);
  assert.equal((await secondMessage)[0].toString(), 'second');
  assert.equal((await otherMessage)[0].toString(), 'other-peer');
  second.close();
  otherTunnel.close();
});

test('native agent rejects a cross-type ID collision and sends WebSocket close after the last ACK', { timeout: 20000 }, async t => {
  const { resources } = await startAgent(t, 'terminal', 4);
  const gateway = await connect(t, resources);
  const tunnel = await gateway.openTunnel({ path: '/terminal', port: resources.echo.address().port, headers: [] });
  const send = gateway.send.bind(gateway);
  const acknowledgements = [];
  gateway.send = frame => {
    if (frame.type === 'ack') acknowledgements.push(frame);
    else send(frame);
  };
  const tail = once(tunnel, 'message');
  const [upstream] = resources.echo.clients;
  upstream.send('tail');
  assert.equal((await tail)[0].toString(), 'tail');
  const [{ id }] = acknowledgements;
  const receive = gateway.receive.bind(gateway);
  let rejectCollision;
  const collision = new Promise(resolveCollision => { rejectCollision = resolveCollision; });
  gateway.receive = frame => {
    if (frame.type === 'error' && frame.id === id) rejectCollision(frame.error);
    else receive(frame);
  };
  send({ type: 'http.request', id, method: 'GET', path: '/collision', data: [], end: true });
  assert.equal(await collision, 'duplicate id');
  assert.deepEqual(resources.requests, []);
  gateway.receive = receive;
  let closed = false;
  tunnel.on('close', () => { closed = true; });
  const closeEvent = once(tunnel, 'close');
  upstream.close(1000);
  await delay(300);
  assert.equal(closed, false);
  send(acknowledgements[0]);
  assert.equal((await closeEvent)[0], 1000);
});

test('a peer sending heartbeats without ACKs eventually releases the window for another peer', { timeout: 45000 }, async t => {
  const { resources } = await startAgent(t, 'ack-timeout', 1);
  const stuckGateway = await connect(t, resources);
  const healthyGateway = await connect(t, resources);
  const tunnel = await stuckGateway.openTunnel({ path: '/stuck', port: resources.echo.address().port, headers: [] });
  const send = stuckGateway.send.bind(stuckGateway);
  let pings = 0;
  stuckGateway.send = frame => {
    if (frame.type === 'ping') pings++;
    if (frame.type !== 'ack') send(frame);
  };
  const firstMessage = once(tunnel, 'message');
  const failure = once(tunnel, 'failure');
  const [upstream] = resources.echo.clients;
  upstream.send('withheld ACK');
  assert.equal((await firstMessage)[0].toString(), 'withheld ACK');
  let completed = false;
  const request = healthyGateway.request({ method: 'GET', path: '/healthy' });
  request.then(() => { completed = true; }, () => {});
  for (let index = 0; index < 100 && resources.requests.length === 0; index++) await delay(20);
  assert.equal(resources.requests[0]?.path, '/healthy');
  assert.equal(completed, false);
  const [timeout] = await failure;
  assert.equal(timeout.code, 'ACK_TIMEOUT');
  assert.ok(pings >= 10);
  assert.equal((await request).status, 201);
});

test('the next available credit rotates between peers during a large response', { timeout: 20000 }, async t => {
  const { resources } = await startAgent(t, 'fairness', 1);
  const bulkGateway = await connect(t, resources);
  const smallGateway = await connect(t, resources);
  const send = bulkGateway.send.bind(bulkGateway);
  const held = [];
  bulkGateway.send = frame => {
    if (frame.type === 'ack') held.push(frame);
    else send(frame);
  };
  const abort = new AbortController();
  const bulkRequest = bulkGateway.request({ method: 'GET', path: '/large', signal: abort.signal });
  const cancelled = assert.rejects(bulkRequest, /cancelled/);
  for (let index = 0; index < 100 && held.length === 0; index++) await delay(20);
  assert.equal(held.length, 1);
  let completed = false;
  const smallRequest = smallGateway.request({ method: 'GET', path: '/small' });
  smallRequest.then(() => { completed = true; }, () => {});
  for (let index = 0; index < 100 && resources.requests.length < 2; index++) await delay(20);
  assert.equal(resources.requests[1]?.path, '/small');
  await delay(150);
  assert.equal(completed, false);
  send(held.shift());
  const result = await Promise.race([smallRequest, delay(2000, null)]);
  assert.equal(result?.status, 201);
  abort.abort();
  await cancelled;
});
