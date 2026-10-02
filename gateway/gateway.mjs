import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const LIMIT = 8 * 1024 * 1024;
const CHUNK = 8192;

export class Gateway extends EventEmitter {
  constructor(url) {
    super();
    this.session = randomUUID();
    this.operations = new Map();
    this.available = false;
    this.ws = new WebSocket(url, { maxPayload: 1024 * 1024, handshakeTimeout: 10000 });
    this.ws.on('open', () => { try { this.send({ type: 'hello', version: 1 }); } catch (error) { this.fail(error); } });
    this.ws.on('message', data => {
      try { this.receive(JSON.parse(data.toString())); }
      catch (error) { this.fail(error); this.ws.terminate(); }
    });
    this.ws.on('error', error => this.fail(error));
    this.ws.on('close', () => this.fail(new Error('relay disconnected')));
    this.lastSeen = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 30000) { this.fail(new Error('agent heartbeat timed out')); this.ws.terminate(); return; }
      if (this.ws.readyState === WebSocket.OPEN) {
        try { this.send({ type: this.available ? 'ping' : 'hello', version: 1 }); }
        catch (error) { this.fail(error); this.ws.terminate(); }
      }
    }, 1000);
  }

  send(frame) {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error('relay is not connected');
    const text = JSON.stringify({ session: this.session, id: '', ...frame });
    if (Buffer.byteLength(text) > 1024 * 1024 || this.ws.bufferedAmount > 1024 * 1024) throw new Error('relay send capacity exceeded');
    this.ws.send(text);
  }

  async ready() {
    if (this.available) return;
    if (this.failure) throw this.failure;
    await new Promise((resolve, reject) => {
      const success = () => { cleanup(); resolve(); };
      const failure = error => { cleanup(); reject(error); };
      const timeout = setTimeout(() => failure(new Error('agent is not ready')), 45000);
      const cleanup = () => { clearTimeout(timeout); this.off('ready', success); this.off('failure', failure); };
      this.on('ready', success);
      this.on('failure', failure);
    });
  }

  receive(frame) {
    if (frame.type === 'agent.hello' && frame.version === 1) {
      this.available = false;
      for (const operation of [...this.operations.values()]) operation.fail(new Error('agent reconnected; in-flight operation was not replayed'));
      this.send({ type: 'hello', version: 1 });
      return;
    }
    if (frame.session !== this.session) return;
    this.lastSeen = Date.now();
    if (frame.type === 'ready') {
      if (frame.version !== 1) throw new Error('unsupported agent protocol');
      this.available = true;
      this.emit('ready');
      return;
    }
    if (frame.type === 'pong') return;
    const operation = this.operations.get(frame.id);
    if (!operation) return;
    if (frame.type === 'error') { operation.fail(new Error(frame.error)); return; }
    if (frame.type === 'upload.ack') { operation.ack?.(); return; }
    if (frame.type === 'ws.opened') { operation.resolve(operation.tunnel); return; }
    if (frame.type === 'ws.closed') { operation.tunnel.close(frame.status); return; }
    if (frame.type !== 'http.response' && frame.type !== 'ws.data') throw new Error('invalid agent frame');
    if (!Array.isArray(frame.data) || frame.data.length > CHUNK || frame.data.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('invalid payload');
    const data = Buffer.from(frame.data);
    operation.size += data.length;
    if (operation.size > LIMIT) { operation.fail(new Error('response capacity exceeded')); return; }
    operation.chunks.push(data);
    this.send({ type: 'ack', id: frame.id });
    if (frame.end) {
      const body = Buffer.concat(operation.chunks);
      operation.size = 0;
      operation.chunks = [];
      if (frame.type === 'http.response') {
        operation.resolve({ status: frame.status, headers: frame.headers, body });
        operation.dispose();
      } else operation.tunnel.emit('message', body, frame.binary);
    }
  }

  operation() {
    if (!this.available) throw new Error('agent is not ready');
    if (this.operations.size >= 16) throw new Error('gateway capacity exceeded');
    const id = randomUUID();
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const operation = { id, promise, resolve, reject, chunks: [], size: 0, pending: 0, disposed: false };
    operation.dispose = () => { operation.disposed = true; clearTimeout(operation.timeout); this.operations.delete(id); };
    operation.fail = error => {
      if (operation.disposed) return;
      operation.reject(error);
      operation.rejectAck?.(error);
      if (operation.tunnel) operation.tunnel.emit('failure', error);
      operation.dispose();
      if (!this.failure && this.ws.readyState === WebSocket.OPEN) {
        try { this.send({ type: 'cancel', id }); } catch { this.ws.terminate(); }
      }
    };
    operation.timeout = setTimeout(() => operation.fail(new Error('operation timed out')), 45000);
    this.operations.set(id, operation);
    return operation;
  }

  async upload(operation, head, body, binary = true) {
    if (body.length > LIMIT) throw new Error('request capacity exceeded');
    for (let offset = 0; offset < body.length || offset === 0; offset += CHUNK) {
      if (operation.disposed) throw new Error('operation closed');
      const end = Math.min(offset + CHUNK, body.length);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { operation.ack = undefined; reject(new Error('upload acknowledgement timed out')); }, 15000);
        operation.ack = () => { clearTimeout(timeout); operation.ack = undefined; operation.rejectAck = undefined; resolve(); };
        operation.rejectAck = error => { clearTimeout(timeout); operation.ack = undefined; reject(error); };
        try {
          this.send({ ...head, type: offset === 0 ? head.type : head.type === 'http.request' ? 'http.body' : head.type,
            id: operation.id, data: [...body.subarray(offset, end)], end: end === body.length, binary });
        } catch (error) { clearTimeout(timeout); reject(error); }
      });
    }
  }

  request({ method, path, headers = [], body = Buffer.alloc(0), signal }) {
    const operation = this.operation();
    const abort = () => operation.fail(new Error('request cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else this.upload(operation, { type: 'http.request', method, path, headers }, body).catch(operation.fail);
    return operation.promise.finally(() => signal?.removeEventListener('abort', abort));
  }

  openTunnel({ path, port, headers = [] }) {
    const operation = this.operation();
    const tunnel = new EventEmitter();
    operation.tunnel = tunnel;
    let outgoing = Promise.resolve();
    let closed = false;
    tunnel.send = (data, binary) => {
      if (closed || operation.disposed) throw new Error('tunnel closed');
      const body = Buffer.from(data);
      operation.pending += body.length;
      if (operation.pending > LIMIT) { operation.fail(new Error('tunnel send capacity exceeded')); return; }
      outgoing = outgoing.then(() => this.upload(operation, { type: 'ws.data' }, body, binary))
        .then(() => { operation.pending -= body.length; }).catch(operation.fail);
    };
    tunnel.close = (code = 1000) => {
      if (closed) return;
      closed = true;
      operation.dispose();
      operation.rejectAck?.(new Error('tunnel closed'));
      if (this.ws.readyState === WebSocket.OPEN) {
        try { this.send({ type: 'ws.close', id: operation.id }); } catch { this.ws.terminate(); }
      }
      tunnel.emit('close', code);
    };
    try { this.send({ type: 'ws.open', id: operation.id, path, port, headers }); }
    catch (error) { operation.fail(error); }
    return operation.promise.then(value => { clearTimeout(operation.timeout); return value; });
  }

  fail(error) {
    if (this.failure) return;
    this.available = false;
    this.failure = error;
    clearInterval(this.heartbeat);
    for (const operation of [...this.operations.values()]) operation.fail(error);
    this.emit('failure', error);
  }

  close() {
    if (this.available && this.ws.readyState === WebSocket.OPEN) {
      try { this.send({ type: 'goodbye' }); } catch { this.ws.terminate(); }
    }
    this.fail(new Error('gateway closed'));
    this.ws.close();
  }
}
