/**
 * The connection to Premiere Pro.
 *
 * Premiere Pro has no external scripting route: no AppleScript dictionary, no
 * COM object, and no supported command line that returns a result. Scripts
 * therefore run inside Premiere Pro, in the UXP plugin in uxp/plugin. A UXP
 * plugin can open WebSocket connections but cannot accept them, so this
 * process listens and the plugin dials in.
 *
 * One port on 127.0.0.1 (PREMIERE_WS_PORT, default 3011) carries:
 *
 *   - WebSocket: the plugin. Its first message must be
 *     { type: 'auth', token, client } within the auth timeout. With a token
 *     configured, a wrong token closes the connection with 4001, silence with
 *     4002. While one plugin is connected, any other connection is closed with
 *     4009. Scripts go out as { type: 'execute', id, code } and come back as
 *     { type: 'result', id, result } or { type: 'error', id, error }.
 *
 *   - HTTP: GET /status and POST /execute, used by a second MCP server process
 *     on the same machine (two MCP clients each start their own server). The
 *     second process finds the port taken by this service, forwards its scripts
 *     here, and takes the port over if this process exits. With a token
 *     configured, both endpoints require `Authorization: Bearer <token>`.
 *     Requests that carry an Origin header (that is, from a web page) are refused.
 *
 * Scripts run one at a time, in the order they arrive.
 */
import http from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

export const SERVICE = 'adobe-mcp-premiere';
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 3011;

// WebSocket close codes the plugin acts on (4000-4999 are free for applications).
export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_AUTH_TIMEOUT = 4002;
export const CLOSE_ALREADY_CONNECTED = 4009;

const MAX_BODY = 16 * 1024 * 1024;

/** Settings from the environment. */
export function bridgeConfig(env = process.env) {
    const int = (name, fallback, min, max) => {
        const raw = env[name];
        if (raw === undefined || raw === '') return fallback;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}: ${raw}`);
        return n;
    };
    return {
        port: int('PREMIERE_WS_PORT', DEFAULT_PORT, 0, 65535), // 0: any free port (tests)
        token: env.PREMIERE_BRIDGE_TOKEN || env.BRIDGE_TOKEN || null,
        timeoutMs: int('PREMIERE_SCRIPT_TIMEOUT_MS', 120000, 1000, 24 * 3600 * 1000),
        connectWaitMs: int('PREMIERE_CONNECT_WAIT_MS', 4000, 0, 600000),
        authTimeoutMs: int('PREMIERE_AUTH_TIMEOUT_MS', 5000, 100, 600000),
    };
}

/** An Error with a `code` the executor and tests can tell apart. */
function failure(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
}

const digest = (value) => createHash('sha256').update(String(value)).digest();

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string|null} [opts.token]
 * @param {number} [opts.timeoutMs] per script
 * @param {number} [opts.connectWaitMs] how long a script waits for the plugin to connect
 * @param {number} [opts.authTimeoutMs]
 * @param {string} [opts.pluginDir] shown in the "not connected" message
 * @param {(msg: string) => void} [opts.log] diagnostics (stderr; stdout carries MCP)
 */
export function createBridge({
    port = DEFAULT_PORT, token = null, timeoutMs = 120000, connectWaitMs = 4000, authTimeoutMs = 5000,
    pluginDir = 'uxp/plugin', log = (msg) => process.stderr.write(`[premiere] ${msg}\n`),
} = {}) {
    let mode = 'stopped'; // 'host' | 'forward' | 'stopped'
    let starting = null;
    let server = null;
    let wss = null;
    let plugin = null; // the authenticated WebSocket
    let client = null; // what the plugin reported about itself
    const queue = [];
    let busy = false;
    const pending = new Map(); // id -> { resolve, reject, timer }
    const waiters = new Set(); // resolve functions waiting for a plugin

    const tokenMatches = (candidate) => !token || (typeof candidate === 'string' && timingSafeEqual(digest(candidate), digest(token)));
    const bearer = (req) => {
        const h = req.headers.authorization || '';
        return h.startsWith('Bearer ') ? h.slice(7) : null;
    };
    const connected = () => Boolean(plugin && plugin.readyState === plugin.OPEN);

    function notConnected() {
        return failure('NOT_CONNECTED',
            `Premiere Pro is not connected. Open Premiere Pro 25.6 or later, load the plugin in ${pluginDir} with the UXP Developer Tool, `
            + `and open its MCP Bridge panel from the Window menu; it connects to port ${port}`
            + `${token ? ' and needs the same token as BRIDGE_TOKEN' : ''}. premiere_status shows the connection.`);
    }

    // ---- the plugin ------------------------------------------------------------

    function refuse(ws, code, reason) {
        log(`refused a plugin connection: ${reason}`);
        try { ws.send(JSON.stringify({ type: 'auth-error', error: reason })); } catch { /* closing */ }
        ws.close(code, reason);
    }

    function adopt(ws, info, origin) {
        if (connected() && plugin !== ws) {
            refuse(ws, CLOSE_ALREADY_CONNECTED, 'Another plugin is already connected');
            return;
        }
        plugin = ws;
        const c = info && typeof info === 'object' ? info : {};
        const text = (v) => (typeof v === 'string' ? v.slice(0, 200) : null);
        client = {
            plugin: text(c.plugin), host: text(c.host), hostVersion: text(c.hostVersion), uxp: text(c.uxp),
            origin: text(origin), connectedAt: new Date().toISOString(),
        };
        ws.send(JSON.stringify({ type: 'auth-ok' }));
        log(`plugin connected${client.hostVersion ? ` (Premiere Pro ${client.hostVersion})` : ''}`);
        for (const resolve of waiters) resolve(ws);
        waiters.clear();
    }

    function onConnection(ws, req) {
        let authenticated = false;
        const timer = setTimeout(() => refuse(ws, CLOSE_AUTH_TIMEOUT, 'No auth message received'), authTimeoutMs);
        timer.unref?.();
        ws.on('message', (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
            } catch {
                if (!authenticated) {
                    clearTimeout(timer);
                    refuse(ws, CLOSE_UNAUTHORIZED, 'First message must be an auth message');
                }
                return;
            }
            if (!authenticated) {
                clearTimeout(timer);
                if (msg?.type === 'auth' && tokenMatches(msg.token)) {
                    authenticated = true;
                    adopt(ws, msg.client, req.headers.origin);
                } else {
                    refuse(ws, CLOSE_UNAUTHORIZED, token ? 'Invalid or missing token' : 'First message must be an auth message');
                }
                return;
            }
            if (ws !== plugin || !msg || typeof msg.id !== 'string') return;
            const job = pending.get(msg.id);
            if (!job) return; // timed out already
            clearTimeout(job.timer);
            pending.delete(msg.id);
            if (msg.type === 'result') job.resolve({ ok: true, result: msg.result === undefined ? null : msg.result });
            else if (msg.type === 'error') job.resolve({ ok: false, error: String(msg.error ?? 'Unknown error') });
            else if (msg.type === 'pong') job.resolve({ ok: true, result: 'pong' });
        });
        ws.on('close', () => {
            clearTimeout(timer);
            if (ws !== plugin) return;
            plugin = null;
            log('plugin disconnected');
            for (const [id, job] of pending) {
                clearTimeout(job.timer);
                pending.delete(id);
                job.reject(failure('DISCONNECTED', 'Premiere Pro disconnected while the script was running (the plugin panel closed or Premiere Pro quit). The change may or may not have been made; check before retrying.'));
            }
        });
        ws.on('error', (e) => log(`plugin socket error: ${e.message}`));
    }

    function waitForPlugin(ms) {
        if (connected()) return Promise.resolve(plugin);
        if (ms <= 0) return Promise.reject(notConnected());
        return new Promise((resolve, reject) => {
            const done = (ws) => { clearTimeout(timer); waiters.delete(done); resolve(ws); };
            const timer = setTimeout(() => { waiters.delete(done); reject(notConnected()); }, ms);
            waiters.add(done);
        });
    }

    function send(ws, { code, timeoutMs: limit }) {
        return new Promise((resolve, reject) => {
            const id = randomUUID();
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(failure('TIMEOUT',
                    `Premiere Pro did not answer within ${limit < 1000 ? `${limit} ms` : `${Math.round(limit / 1000)} s`}. A dialog may be open in Premiere Pro, or the operation is still running `
                    + '(raise PREMIERE_SCRIPT_TIMEOUT_MS for long exports). The plugin runs one script at a time, so the next call waits for this one to finish.'));
            }, limit);
            pending.set(id, { resolve, reject, timer });
            try {
                ws.send(JSON.stringify({ type: 'execute', id, code }));
            } catch (e) {
                clearTimeout(timer);
                pending.delete(id);
                reject(failure('DISCONNECTED', `Could not send the script to Premiere Pro: ${e.message}`));
            }
        });
    }

    async function drain() {
        if (busy || !queue.length) return;
        busy = true;
        const job = queue.shift();
        try {
            const ws = await waitForPlugin(connectWaitMs);
            job.resolve(await send(ws, job));
        } catch (e) {
            job.reject(e);
        } finally {
            busy = false;
            drain();
        }
    }

    function enqueue(code, limit) {
        return new Promise((resolve, reject) => {
            queue.push({ code, timeoutMs: limit, resolve, reject });
            drain();
        });
    }

    // ---- HTTP, for other MCP server processes ------------------------------------

    function reply(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    }

    function localStatus() {
        return { service: SERVICE, connected: connected(), plugin: connected() ? client : null, queueDepth: queue.length + (busy ? 1 : 0) };
    }

    function onRequest(req, res) {
        if (req.headers.origin) return reply(res, 403, { service: SERVICE, error: 'Requests from web pages are refused' });
        const url = (req.url || '').split('?')[0];
        if (url !== '/status' && url !== '/execute') return reply(res, 404, { service: SERVICE, error: 'Not found' });
        if (!tokenMatches(bearer(req))) return reply(res, 401, { service: SERVICE, error: 'Missing or wrong token (BRIDGE_TOKEN)' });
        if (url === '/status') {
            if (req.method !== 'GET') return reply(res, 405, { service: SERVICE, error: 'Use GET' });
            return reply(res, 200, localStatus());
        }
        if (req.method !== 'POST') return reply(res, 405, { service: SERVICE, error: 'Use POST' });
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reply(res, 415, { service: SERVICE, error: 'Send application/json' });
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) { reply(res, 413, { service: SERVICE, error: 'Script too large' }); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', async () => {
            if (res.writableEnded) return;
            let body;
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { service: SERVICE, error: 'Body is not JSON' }); }
            if (typeof body?.code !== 'string' || !body.code.trim()) return reply(res, 400, { service: SERVICE, error: 'Missing "code"' });
            const limit = Number.isInteger(body.timeoutMs) && body.timeoutMs > 0 ? Math.min(body.timeoutMs, 24 * 3600 * 1000) : timeoutMs;
            try {
                reply(res, 200, await enqueue(body.code, limit));
            } catch (e) {
                const status = e.code === 'NOT_CONNECTED' ? 503 : e.code === 'TIMEOUT' ? 504 : 502;
                reply(res, status, { service: SERVICE, error: e.message, code: e.code ?? null });
            }
        });
    }

    /** One HTTP request to the process that holds the port. */
    function request(method, path, body, limitMs) {
        return new Promise((resolve, reject) => {
            const payload = body === undefined ? null : JSON.stringify(body);
            const req = http.request({
                host: HOST, port, method, path,
                // A fresh connection each time: a kept-alive socket to a process that has
                // since stopped fails with a reset instead of ECONNREFUSED, which hides that
                // the port is free to take over.
                agent: false,
                headers: {
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    let json = null;
                    try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not ours */ }
                    resolve({ status: res.statusCode, json });
                });
            });
            req.setTimeout(limitMs, () => req.destroy(failure('TIMEOUT', `The Premiere Pro MCP server on port ${port} did not answer within ${Math.round(limitMs / 1000)} s`)));
            req.on('error', reject);
            req.end(payload ?? undefined);
        });
    }

    async function forward(code, limit) {
        const { status, json } = await request('POST', '/execute', { code, timeoutMs: limit }, limit + connectWaitMs + 10000);
        if (status === 200 && json && typeof json.ok === 'boolean') return json;
        if (status === 401) throw failure('UNAUTHORIZED', `The Premiere Pro MCP server already running on port ${port} needs a different BRIDGE_TOKEN than this one has`);
        throw failure(json?.code ?? 'FORWARD_FAILED', json?.error ?? `The Premiere Pro MCP server on port ${port} answered HTTP ${status}`);
    }

    // ---- lifecycle ---------------------------------------------------------------

    function listen() {
        return new Promise((resolve, reject) => {
            const s = http.createServer(onRequest);
            const w = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
            s.on('upgrade', (req, socket, head) => {
                socket.unref?.();
                w.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
            });
            s.on('connection', (socket) => socket.unref?.());
            s.once('error', reject);
            s.listen(port, HOST, () => {
                s.off('error', reject);
                s.on('error', (e) => log(`server error: ${e.message}`));
                s.unref();
                port = s.address().port; // when asked for port 0, the one the system chose
                server = s;
                wss = w;
                resolve();
            });
        });
    }

    /** Listen on the port, or forward to the instance of this server that already does. */
    async function start() {
        if (mode !== 'stopped') return mode;
        starting ??= (async () => {
            try {
                await listen();
                mode = 'host';
                log(`waiting for the Premiere Pro plugin on ws://${HOST}:${port}`);
            } catch (e) {
                if (e.code !== 'EADDRINUSE') throw e;
                let peer = null;
                try { peer = await request('GET', '/status', undefined, 3000); } catch { /* nothing answering */ }
                if (peer?.json?.service !== SERVICE) {
                    throw failure('PORT_IN_USE', `Port ${port} on ${HOST} is in use by another program. Set PREMIERE_WS_PORT to a free port, and the same port in the plugin panel.`);
                }
                if (peer.status === 401) {
                    throw failure('UNAUTHORIZED', `Another Premiere Pro MCP server holds port ${port} and needs a different BRIDGE_TOKEN than this one has`);
                }
                mode = 'forward';
                log(`port ${port} is held by another Premiere Pro MCP server; forwarding scripts to it`);
            }
            return mode;
        })().finally(() => { starting = null; });
        return starting;
    }

    /**
     * Run a script in Premiere Pro. Resolves { ok: true, result } or
     * { ok: false, error } (the script threw); rejects when Premiere Pro cannot
     * be reached (err.code NOT_CONNECTED, TIMEOUT, DISCONNECTED, ...).
     */
    async function execute(code, { timeoutMs: limit = timeoutMs } = {}) {
        if (typeof code !== 'string' || !code.trim()) throw new Error('No script to run');
        await start();
        if (mode === 'forward') {
            try {
                return await forward(code, limit);
            } catch (e) {
                // Only when nothing answered: then the script was never sent and
                // the process that held the port has gone, so take the port over.
                if (e.code !== 'ECONNREFUSED') throw e;
                mode = 'stopped';
                await start();
                if (mode === 'forward') return forward(code, limit);
            }
        }
        return enqueue(code, limit);
    }

    async function status() {
        const base = { mode, host: HOST, port, tokenRequired: Boolean(token), timeoutMs };
        if (mode === 'forward') {
            try {
                const { json } = await request('GET', '/status', undefined, 3000);
                return { ...base, connected: Boolean(json?.connected), plugin: json?.plugin ?? null, queueDepth: json?.queueDepth ?? null, via: `the Premiere Pro MCP server already listening on port ${port}` };
            } catch (e) {
                return { ...base, connected: false, plugin: null, error: e.message };
            }
        }
        const { service, ...local } = localStatus();
        return { ...base, ...local };
    }

    async function stop() {
        mode = 'stopped';
        for (const [id, job] of pending) {
            clearTimeout(job.timer);
            pending.delete(id);
            job.reject(failure('DISCONNECTED', 'The server is shutting down'));
        }
        while (queue.length) queue.shift().reject(failure('DISCONNECTED', 'The server is shutting down'));
        try { plugin?.terminate(); } catch { /* gone */ }
        plugin = null;
        if (wss) for (const c of wss.clients) c.terminate();
        await new Promise((resolve) => {
            if (!server) return resolve();
            server.close(() => resolve());
            server.closeAllConnections?.();
        });
        server = null;
        wss = null;
    }

    return {
        start, execute, status, stop,
        get mode() { return mode; },
        get port() { return port; },
        get connected() { return connected(); },
    };
}
