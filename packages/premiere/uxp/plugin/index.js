// The MCP Bridge panel: connects to the adobe-mcp-premiere server on
// 127.0.0.1 and runs the scripts it sends (see runtime.js). The connection
// logic follows the InDesign bridge panel in packages/indesign/uxp/plugin.
const ppro = require("premierepro");
const uxp = require("uxp");
const { createRuntime } = require("./runtime.js");

const statusEl = document.getElementById("status");
const portEl = document.getElementById("port");
const tokenEl = document.getElementById("token");
const formEl = document.getElementById("settings");

const DEFAULT_PORT = 3011;
const PORT_KEY = "mcpBridgePort";
const TOKEN_KEY = "mcpBridgeToken";
const RETRY_MS = 3000;

// Close codes from src/bridge.js.
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_AUTH_TIMEOUT = 4002;
const CLOSE_ALREADY_CONNECTED = 4009;

const runtime = createRuntime({ ppro, log: (msg) => console.log("[MCP Bridge]", msg) });

function savedPort() {
  try {
    const p = Number(localStorage.getItem(PORT_KEY));
    if (Number.isInteger(p) && p > 0 && p < 65536) return p;
  } catch (e) {
    // storage unavailable
  }
  return DEFAULT_PORT;
}

// Used when localStorage is unavailable: the token lasts until the panel reloads.
let sessionToken = "";

function savedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return sessionToken;
  }
}

function describeClient() {
  const host = uxp.host || {};
  const versions = uxp.versions || {};
  return { plugin: versions.plugin || null, uxp: versions.uxp || null, host: host.name || null, hostVersion: host.version || null };
}

let socket = null;
let retryTimer = null;

function connect() {
  clearTimeout(retryTimer);
  if (socket) {
    socket.onclose = null;
    try { socket.close(); } catch (e) { /* already closed */ }
  }

  const port = savedPort();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  socket = ws;
  statusEl.textContent = `Connecting to port ${port}...`;

  ws.onopen = () => {
    statusEl.textContent = `Authenticating on port ${port}...`;
    // Always the first message. The server closes the connection if it has a
    // token and this one does not match.
    ws.send(JSON.stringify({ type: "auth", token: savedToken(), client: describeClient() }));
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error("[MCP Bridge] Invalid JSON from the server");
      return;
    }
    if (msg.type === "auth-ok") {
      statusEl.textContent = `Connected on port ${port}`;
      return;
    }
    if (msg.type === "auth-error") {
      console.error("[MCP Bridge] The server refused the connection:", msg.error);
      return;
    }
    runtime.handleMessage(msg, (out) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(out);
    });
  };

  ws.onerror = () => {
    statusEl.textContent = `Cannot reach the server on port ${port}`;
  };

  ws.onclose = (event) => {
    if (event.code === CLOSE_UNAUTHORIZED || event.code === CLOSE_AUTH_TIMEOUT) {
      // Retrying with the same token cannot succeed; wait for a new one.
      statusEl.textContent = `The server on port ${port} refused the token: enter BRIDGE_TOKEN and click Connect`;
      return;
    }
    statusEl.textContent = event.code === CLOSE_ALREADY_CONNECTED
      ? `Another Premiere Pro is connected to port ${port}; retrying`
      : `Not connected (port ${port}); retrying`;
    retryTimer = setTimeout(connect, RETRY_MS);
  };
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const p = Number(portEl.value);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    statusEl.textContent = "The port must be a number from 1 to 65535";
    return;
  }
  sessionToken = tokenEl.value;
  try {
    localStorage.setItem(PORT_KEY, String(p));
    localStorage.setItem(TOKEN_KEY, tokenEl.value);
  } catch (e) {
    // storage unavailable: the port and token last until the panel reloads
  }
  connect();
});

let started = false;

uxp.entrypoints.setup({
  panels: {
    bridgePanel: {
      show() {
        if (started) return;
        started = true;
        portEl.value = String(savedPort());
        tokenEl.value = savedToken();
        connect();
      },
    },
  },
});
