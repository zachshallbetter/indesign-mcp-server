/**
 * Client for ArtCraft desktop applications' JSON-lines control protocol.
 *
 * Each request is one JSON line: {"id": id, "method": method, "params": params}
 * Each reply is one JSON line: {"id": id, "ok": true, "result": ...} or {"id": id, "ok": false, "error": ...}
 *
 * Loopback connections (127.0.0.1) only. Authenticates with a 256-bit token when configured.
 */
import net from 'node:net';
import fs from 'node:fs';

export class ControlClient {
    /**
     * @param {object} options
     * @param {number} options.port
     * @param {string} [options.host='127.0.0.1']
     * @param {string} [options.token]
     * @param {number} [options.timeoutMs=30000]
     */
    constructor({ port, host = '127.0.0.1', token, timeoutMs = 30000 } = {}) {
        if (!port) throw new Error('ControlClient requires a port');
        this.port = Number(port);
        this.host = host;
        this.token = token ? String(token).trim() : null;
        this.timeoutMs = timeoutMs;
        this.socket = null;
        this.buffer = '';
        this.nextId = 1;
        this.pending = new Map();
        this.authenticated = false;
        this.connectingPromise = null;
    }

    /**
     * Probe whether the control port is currently listening.
     * @param {number} [probeTimeoutMs=600]
     * @returns {Promise<boolean>}
     */
    async isAvailable(probeTimeoutMs = 600) {
        return new Promise((resolve) => {
            const sock = new net.Socket();
            let resolved = false;

            const finish = (val) => {
                if (resolved) return;
                resolved = true;
                sock.destroy();
                resolve(val);
            };

            sock.setTimeout(probeTimeoutMs);
            sock.once('connect', () => finish(true));
            sock.once('timeout', () => finish(false));
            sock.once('error', () => finish(false));
            sock.connect(this.port, this.host);
        });
    }

    /**
     * Ensure a connected and authenticated socket.
     * @returns {Promise<net.Socket>}
     */
    async connect() {
        if (this.socket && !this.socket.destroyed && this.authenticated) {
            return this.socket;
        }
        if (this.connectingPromise) {
            return this.connectingPromise;
        }

        this.connectingPromise = (async () => {
            this.disconnect();

            const socket = new net.Socket();
            this.socket = socket;
            this.buffer = '';
            this.authenticated = !this.token;

            await new Promise((resolve, reject) => {
                const onConnect = () => {
                    socket.removeListener('error', onError);
                    resolve();
                };
                const onError = (err) => {
                    socket.removeListener('connect', onConnect);
                    reject(new Error(`Cannot connect to control server at ${this.host}:${this.port}: ${err.message}`));
                };
                socket.once('connect', onConnect);
                socket.once('error', onError);
                socket.connect(this.port, this.host);
            });

            socket.setNoDelay(true);

            socket.on('data', (chunk) => this._onData(chunk));
            socket.on('error', (err) => this._onError(err));
            socket.on('close', () => this._onClose());

            if (this.token) {
                const authReply = await this._sendRaw('auth', 'auth', { token: this.token });
                if (!authReply || !authReply.ok) {
                    this.disconnect();
                    throw new Error(`Control server authentication failed: ${authReply?.error || 'unauthorized'}`);
                }
                this.authenticated = true;
            }

            return socket;
        })();

        try {
            return await this.connectingPromise;
        } finally {
            this.connectingPromise = null;
        }
    }

    /**
     * Call a method on the control server.
     * @param {string} method
     * @param {object} [params={}]
     * @returns {Promise<{ ok: boolean, result?: any, error?: string }>}
     */
    async call(method, params = {}) {
        await this.connect();
        const id = this.nextId++;
        return this._sendRaw(id, method, params);
    }

    /**
     * Execute an engine command through engine.execute.
     * @param {string} command
     * @param {object} [params={}]
     * @returns {Promise<any>} returns result on success, throws on error
     */
    async execute(command, params = {}) {
        const reply = await this.call('engine.execute', { command, params });
        if (!reply.ok) {
            throw new Error(reply.error || `Command ${command} failed`);
        }
        return reply.result;
    }

    _sendRaw(id, method, params) {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.destroyed) {
                return reject(new Error('Control socket is not connected'));
            }

            const timer = setTimeout(() => {
                this.pending.delete(String(id));
                reject(new Error(`Control call '${method}' timed out after ${this.timeoutMs}ms`));
            }, this.timeoutMs);

            this.pending.set(String(id), { resolve, reject, timer, method });

            const payload = JSON.stringify({ id, method, params }) + '\n';
            this.socket.write(payload, 'utf8', (err) => {
                if (err) {
                    clearTimeout(timer);
                    this.pending.delete(String(id));
                    reject(err);
                }
            });
        });
    }

    _onData(chunk) {
        this.buffer += chunk.toString('utf8');
        let newlineIdx;
        while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newlineIdx).trim();
            this.buffer = this.buffer.slice(newlineIdx + 1);
            if (!line) continue;

            try {
                const parsed = JSON.parse(line);
                const key = String(parsed.id);
                const req = this.pending.get(key);
                if (req) {
                    clearTimeout(req.timer);
                    this.pending.delete(key);
                    req.resolve(parsed);
                }
            } catch (err) {
                // Ignore malformed lines from server
            }
        }
    }

    _onError(err) {
        for (const [_, req] of this.pending) {
            clearTimeout(req.timer);
            req.reject(new Error(`Control connection error: ${err.message}`));
        }
        this.pending.clear();
    }

    _onClose() {
        for (const [_, req] of this.pending) {
            clearTimeout(req.timer);
            req.reject(new Error('Control connection closed'));
        }
        this.pending.clear();
        this.socket = null;
        this.authenticated = false;
    }

    disconnect() {
        if (this.socket) {
            try {
                this.socket.destroy();
            } catch {
                // ignore
            }
            this.socket = null;
        }
        this.authenticated = false;
        this.buffer = '';
    }
}

/**
 * Create a ControlClient resolving configuration from environment variables.
 * @param {object} options
 * @param {string} options.appPrefix e.g. "PHOTOCRAFT" or "VECTORCRAFT"
 * @param {number} options.defaultPort e.g. 7878 or 7979
 * @param {Record<string, string>} [options.env=process.env]
 */
export function createControlClient({ appPrefix, defaultPort, env = process.env }) {
    const port = Number(env[`${appPrefix}_CONTROL_PORT`] || env.ARTCRAFT_CONTROL_PORT || defaultPort);
    let token = env[`${appPrefix}_CONTROL_TOKEN`] || env.ARTCRAFT_CONTROL_TOKEN || null;

    if (!token) {
        const tokenFile = env[`${appPrefix}_CONTROL_TOKEN_FILE`] || env.ARTCRAFT_CONTROL_TOKEN_FILE;
        if (tokenFile) {
            try {
                token = fs.readFileSync(tokenFile, 'utf8').trim();
            } catch {
                // Ignore missing token file
            }
        }
    }

    return new ControlClient({ port, token });
}
