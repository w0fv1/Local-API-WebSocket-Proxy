import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';

export async function fixture({ autoPong = true } = {}) {
  const requests = [];
  const local = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, headers: req.headers });
    const chunks = [];
    req.on('data', data => chunks.push(data));
    req.on('end', () => {
      if (req.url === '/never') return;
      res.writeHead(201, { 'content-type': 'application/octet-stream', 'set-cookie': ['one=1', 'two=2'] });
      res.end(req.url === '/large' ? Buffer.alloc(1500000, 255) : Buffer.concat(chunks));
    });
  });
  const echo = new WebSocketServer({ port: 0, host: '127.0.0.1', maxPayload: 8 * 1024 * 1024 });
  await once(echo, 'listening');
  echo.on('connection', ws => ws.on('message', (data, binary) => ws.send(data, { binary })));
  local.listen(0, '127.0.0.1');
  await once(local, 'listening');
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1', maxPayload: 1024 * 1024, autoPong });
  await once(relay, 'listening');
  relay.on('connection', (ws, req) => {
    ws.role = new URL(req.url, 'http://localhost').searchParams.get('role');
    if (ws.role === 'client' && [...relay.clients].some(peer => peer !== ws && peer.role === 'client' && peer.readyState === WebSocket.OPEN)) { ws.close(1008); return; }
    ws.on('message', (data, binary) => {
      for (const peer of relay.clients) if (peer !== ws && peer.role !== ws.role && peer.readyState === WebSocket.OPEN) peer.send(data, { binary });
    });
  });
  return {
    requests, local, echo, relay,
    configuration: { controlUrl: `ws://127.0.0.1:${relay.address().port}/?role=client`, localBaseUrl: `http://127.0.0.1:${local.address().port}` },
    serverUrl: `ws://127.0.0.1:${relay.address().port}/?role=server`,
    close() {
      for (const ws of relay.clients) ws.terminate();
      for (const ws of echo.clients) ws.terminate();
      relay.close(); echo.close(); local.closeAllConnections(); local.close();
    }
  };
}
