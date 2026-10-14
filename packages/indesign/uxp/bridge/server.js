#!/usr/bin/env node
/**
 * UXP bridge — HTTP /execute + WebSocket to InDesign plugin.
 * Adapted from theloniuser/indesign-uxp-server (see uxp/NOTICE).
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import express from 'express';

const WS_PORT = Number(process.env.UXP_WS_PORT || 3001);
const HTTP_PORT = Number(process.env.UXP_HTTP_PORT || 3000);
const TIMEOUT_MS = 30000;
// How long a new WebSocket connection has to send { type: 'auth', token } before it is closed.
const AUTH_TIMEOUT_MS = Number(process.env.UXP_AUTH_TIMEOUT_MS || 5000);

// WebSocket close codes the plugin acts on (4000-4999 are free for applications).
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_AUTH_TIMEOUT = 4002;
const CLOSE_ALREADY_CONNECTED = 4009;

// L1: Optional auth token — set BRIDGE_TOKEN env var to require Bearer auth on /execute and /status,
// and { type: 'auth', token } as the plugin's first WebSocket message.
// Without it the bridge is open to any local process; token is recommended for shared machines.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || null;
if (!BRIDGE_TOKEN) {
  console.warn('[Bridge] WARNING: BRIDGE_TOKEN not set. Any local process can send InDesign commands');
  console.warn('[Bridge]   or connect to the WebSocket port as the plugin.');
  console.warn('[Bridge]   To enable auth: export BRIDGE_TOKEN="$(openssl rand -hex 32)" before starting,');
  console.warn('[Bridge]   and enter the same token in the InDesign Bridge panel.');
}

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** Constant-time comparison against BRIDGE_TOKEN (hashing first makes the lengths equal). */
function tokenMatches(candidate) {
  return typeof candidate === 'string' && timingSafeEqual(digest(candidate), digest(BRIDGE_TOKEN));
}

const app = express();
app.use(express.json());

// Auth middleware — only applied when BRIDGE_TOKEN is configured
if (BRIDGE_TOKEN) {
  app.use(['/execute', '/status'], (req, res, next) => {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ') || !tokenMatches(auth.slice('Bearer '.length))) {
      return res.status(401).json({ error: 'Unauthorized: missing or invalid BRIDGE_TOKEN' });
    }
    next();
  });
}

let pluginSocket = null;
const pending = new Map(); // id -> { resolve, reject, timer }

// Serial execution queue — one UXP execution in flight at a time to prevent
// concurrent DOM mutations from corrupting InDesign document state (H2).
const requestQueue = [];
let processingQueue = false;

function drainQueue() {
  if (processingQueue || requestQueue.length === 0) return;

  const socket = pluginSocket;
  if (!socket) {
    // Drain all queued items with a connection error
    while (requestQueue.length > 0) {
      const item = requestQueue.shift();
      item.reject(new Error('Plugin not connected'));
    }
    return;
  }

  processingQueue = true;
  const { code, resolve, reject } = requestQueue.shift();
  const id = randomUUID();

  const timer = setTimeout(() => {
    pending.delete(id);
    processingQueue = false;
    reject(new Error('Execution timed out after 30s'));
    drainQueue();
  }, TIMEOUT_MS);

  pending.set(id, {
    resolve: (result) => {
      processingQueue = false;
      resolve(result);
      drainQueue();
    },
    reject: (err) => {
      processingQueue = false;
      reject(err);
      drainQueue();
    },
    timer,
  });

  // Guard against WebSocket transitioning to CLOSING between null-check and send (L2)
  try {
    socket.send(JSON.stringify({ type: 'execute', id, code }));
    console.log('[Bridge] Sending execute:', id, code.slice(0, 100));
  } catch (err) {
    clearTimeout(timer);
    pending.delete(id);
    processingQueue = false;
    reject(new Error('Failed to send to plugin: ' + err.message));
    drainQueue();
  }
}

function enqueueExecution(code) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ code, resolve, reject });
    drainQueue();
  });
}

// WebSocket server — UXP plugin connects here.
// A connection becomes the plugin socket only after it authenticates: with BRIDGE_TOKEN set, its
// first message must be { type: 'auth', token } with the right token within AUTH_TIMEOUT_MS. Without
// BRIDGE_TOKEN every connection counts as authenticated (and an auth message is still answered).
// A connected plugin is never replaced: a second connection is closed while the first is open.
const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

function rejectSocket(ws, code, reason) {
  console.warn(`[Bridge] Rejected WebSocket connection: ${reason}`);
  try {
    ws.send(JSON.stringify({ type: 'auth-error', error: reason }));
  } catch (e) {
    // already closing
  }
  ws.close(code, reason);
}

function adoptPlugin(ws) {
  if (pluginSocket && pluginSocket !== ws && pluginSocket.readyState === pluginSocket.OPEN) {
    rejectSocket(ws, CLOSE_ALREADY_CONNECTED, 'Another plugin is already connected');
    return;
  }
  pluginSocket = ws;
  ws.send(JSON.stringify({ type: 'auth-ok' }));
  console.log('[Bridge] Plugin connected');
}

function handlePluginMessage(msg) {
  console.log('[Bridge] From plugin:', JSON.stringify(msg).slice(0, 200));

  const item = pending.get(msg.id);
  if (!item) return;

  clearTimeout(item.timer);
  pending.delete(msg.id);

  if (msg.type === 'result') {
    item.resolve(msg.result);
  } else if (msg.type === 'error') {
    item.reject(new Error(msg.error));
  } else if (msg.type === 'pong') {
    item.resolve('pong');
  }
}

wss.on('connection', (ws) => {
  let authenticated = !BRIDGE_TOKEN;
  const authTimer = BRIDGE_TOKEN
    ? setTimeout(() => rejectSocket(ws, CLOSE_AUTH_TIMEOUT, 'No auth message received'), AUTH_TIMEOUT_MS)
    : null;
  if (authenticated) adoptPlugin(ws);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      console.error('[Bridge] Invalid JSON from', authenticated ? 'plugin' : 'unauthenticated connection');
      if (!authenticated) {
        clearTimeout(authTimer);
        rejectSocket(ws, CLOSE_UNAUTHORIZED, 'First message must be an auth message');
      }
      return;
    }

    if (!authenticated) {
      clearTimeout(authTimer);
      if (msg && msg.type === 'auth' && tokenMatches(msg.token)) {
        authenticated = true;
        adoptPlugin(ws);
      } else {
        rejectSocket(ws, CLOSE_UNAUTHORIZED, 'Invalid or missing token');
      }
      return;
    }

    if (msg && msg.type === 'auth') {
      // Plugins always send one; without BRIDGE_TOKEN the connection is already accepted.
      return;
    }
    if (ws !== pluginSocket) return;
    handlePluginMessage(msg);
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (ws !== pluginSocket) return;
    console.log('[Bridge] Plugin disconnected');
    pluginSocket = null;
    // Reject any in-flight pending entry
    for (const [id, item] of pending.entries()) {
      clearTimeout(item.timer);
      item.reject(new Error('Plugin disconnected'));
      pending.delete(id);
    }
    // processingQueue will be unblocked via the reject→drainQueue chain above;
    // if for some reason it isn't, reset it so reconnect can proceed
    processingQueue = false;
    // Drain any items waiting in queue with a connection error
    drainQueue();
  });

  ws.on('error', (err) => {
    console.error('[Bridge] WebSocket error:', err);
  });
});

// HTTP API — MCP server calls these endpoints

app.get('/status', (req, res) => {
  res.json({ connected: pluginSocket !== null, queueDepth: requestQueue.length });
});

app.post('/execute', async (req, res) => {
  if (!pluginSocket) {
    return res.status(503).json({
      error: 'Plugin not connected. Open InDesign, then load the Bridge Panel via UXP Developer Tool.'
    });
  }

  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Missing "code" in request body' });
  }

  try {
    const result = await enqueueExecution(code);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[Bridge] HTTP server on http://127.0.0.1:${HTTP_PORT}`);
  console.log(`[Bridge] WebSocket server on ws://127.0.0.1:${WS_PORT}`);
  if (WS_PORT !== 3001) {
    console.log(`[Bridge] Set the port in the InDesign Bridge panel to ${WS_PORT}.`);
  }
  if (BRIDGE_TOKEN) {
    console.log('[Bridge] Enter BRIDGE_TOKEN in the InDesign Bridge panel; connections without it are closed.');
  }
  console.log('[Bridge] Waiting for UXP plugin to connect...');
});
