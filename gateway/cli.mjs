import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Gateway } from './gateway.mjs';

const [controlUrl, port = '8765'] = process.argv.slice(2);
if (!controlUrl || !/^wss?:$/.test(new URL(controlUrl).protocol)) throw new Error('Usage: npm run gateway -- <server-control-url> [listen-port]');
let gateway;
let stopping = false;
let reconnect;
function connect() {
  gateway = new Gateway(controlUrl);
  gateway.once('failure', error => {
    console.error(error.message);
    if (!stopping) reconnect = setTimeout(connect, 2000);
  });
  gateway.on('ready', () => console.log('Local API agent ready'));
}
connect();
const blocked = new Set(['host', 'connection', 'upgrade', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol']);
function headers(raw) {
  const result = [];
  const forbidden = new Set(blocked);
  for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() === 'connection') for (const name of raw[i + 1].split(',')) forbidden.add(name.trim().toLowerCase());
  for (let i = 0; i < raw.length; i += 2) if (!forbidden.has(raw[i].toLowerCase())) result.push({ name: raw[i], value: raw[i + 1] });
  return result;
}
const server = createServer({ shouldUpgradeCallback: req => req.headers.upgrade?.toLowerCase() === 'websocket' }, async (req, res) => {
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  try {
    if (!gateway.available) { res.writeHead(503).end('Local API agent is not ready'); return; }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { res.writeHead(413).end('Request exceeds 8 MiB'); return; }
      chunks.push(chunk);
    }
    const reply = await gateway.request({ method: req.method, path: req.url, headers: headers(req.rawHeaders), body: Buffer.concat(chunks), signal: abort.signal });
    const outgoing = headers(reply.headers.flatMap(h => [h.name, h.value])).flatMap(h => [h.name, h.value]);
    res.writeHead(reply.status, outgoing);
    res.end(reply.body);
  } catch (error) {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/__ws') throw new Error('Use /__ws?port=PORT&path=ENCODED_PATH');
    if (req.headers['sec-websocket-protocol']) throw new Error('WebSocket subprotocols are not supported');
    const tunnel = await gateway.openTunnel({ path: url.searchParams.get('path') ?? '/', port: Number(url.searchParams.get('port')), headers: headers(req.rawHeaders) });
    if (socket.destroyed) { tunnel.close(); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      tunnel.on('message', (data, binary) => {
        if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); tunnel.close(); }
        else ws.send(data, { binary });
      });
      tunnel.on('close', code => ws.close(code === 1000 ? 1000 : 1011));
      tunnel.on('failure', () => ws.close(1011));
      ws.on('message', (data, binary) => { try { tunnel.send(data, binary); } catch { ws.close(1011); } });
      ws.on('close', () => tunnel.close());
      ws.on('error', () => tunnel.close());
    });
  } catch {
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  }
});
server.listen(Number(port), '127.0.0.1', () => console.log(`Local API gateway: http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  clearTimeout(reconnect);
  gateway.close();
  for (const ws of sockets.clients) ws.terminate();
  server.closeAllConnections();
  server.close();
});
