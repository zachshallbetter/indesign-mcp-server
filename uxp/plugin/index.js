// Adapted from theloniuser/indesign-uxp-server — see uxp/NOTICE
const indesign = require("indesign");
const { entrypoints } = require("uxp");
const { createRuntime } = require("./runtime.js");

const statusEl = document.getElementById("status");
const portEl = document.getElementById("port");
const tokenEl = document.getElementById("token");
const formEl = document.getElementById("portForm");

const DEFAULT_PORT = 3001;
const PORT_KEY = "bridgePort";
const TOKEN_KEY = "bridgeToken";

// Close codes from uxp/bridge/server.js.
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_AUTH_TIMEOUT = 4002;
const CLOSE_ALREADY_CONNECTED = 4009;

function loadFs() {
  try {
    return require("fs");
  } catch (e) {
    console.warn("[Plugin] fs module unavailable; File.exists and Folder.create will throw:", e);
    return null;
  }
}

// Whitelist: only 'indesign' and 'uxp' modules are allowed inside execute calls.
// Passing raw require into the script would otherwise expose the full module system.
const ALLOWED_MODULES = new Set(['indesign', 'uxp']);
function sandboxedRequire(moduleName) {
  if (!ALLOWED_MODULES.has(moduleName)) {
    throw new Error(`require('${moduleName}') is not allowed inside execute calls`);
  }
  return require(moduleName);
}

const runtime = createRuntime({ indesign, require: sandboxedRequire, fs: loadFs(), timeoutMs: 25000 });

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

let socket = null;
let retryTimer = null;

function connectToBridge() {
  clearTimeout(retryTimer);
  if (socket) {
    socket.onclose = null;
    try { socket.close(); } catch (e) { /* already closed */ }
  }

  const port = savedPort();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  socket = ws;
  statusEl.textContent = `Connecting to bridge on port ${port}...`;

  ws.onopen = () => {
    statusEl.textContent = `Authenticating with bridge on port ${port}...`;
    // Always the first message. The bridge closes the connection if BRIDGE_TOKEN is set and this
    // token does not match; without BRIDGE_TOKEN it ignores the token.
    ws.send(JSON.stringify({ type: "auth", token: savedToken() }));
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error("[Plugin] Invalid JSON:", event.data);
      return;
    }
    if (msg.type === "auth-ok") {
      statusEl.textContent = `Connected to bridge on port ${port} ✓`;
      console.log("[Plugin] Connected to bridge on port", port);
      return;
    }
    if (msg.type === "auth-error") {
      console.error("[Plugin] Bridge refused the connection:", msg.error);
      return;
    }
    console.log("[Plugin] Received:", event.data.slice(0, 200));
    runtime.handleMessage(msg, (out) => ws.send(out));
  };

  ws.onerror = (err) => {
    statusEl.textContent = `Bridge connection error (port ${port})`;
    console.error("[Plugin] WebSocket error:", err);
  };

  ws.onclose = (event) => {
    if (event.code === CLOSE_UNAUTHORIZED || event.code === CLOSE_AUTH_TIMEOUT) {
      // Retrying with the same token cannot succeed; wait for a new one.
      statusEl.textContent = `Bridge on port ${port} rejected the token — enter BRIDGE_TOKEN and click Connect`;
      return;
    }
    if (event.code === CLOSE_ALREADY_CONNECTED) {
      statusEl.textContent = `Another plugin is connected to port ${port} — retrying in 3s`;
    } else {
      statusEl.textContent = `Disconnected from port ${port} — retrying in 3s`;
    }
    retryTimer = setTimeout(connectToBridge, 3000);
  };
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const p = Number(portEl.value);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    statusEl.textContent = "Port must be a number from 1 to 65535";
    return;
  }
  sessionToken = tokenEl.value;
  try {
    localStorage.setItem(PORT_KEY, String(p));
    localStorage.setItem(TOKEN_KEY, tokenEl.value);
  } catch (e) {
    // storage unavailable: the port and token last until the panel reloads
  }
  connectToBridge();
});

let started = false;

entrypoints.setup({
  panels: {
    mainPanel: {
      show() {
        if (started) return;
        started = true;
        portEl.value = String(savedPort());
        tokenEl.value = savedToken();
        try {
          console.log("[Plugin] DOM OK — open docs:", indesign.app.documents.length);
        } catch (e) {
          console.error("[Plugin] DOM access failed:", e);
        }
        connectToBridge();
      }
    }
  }
});
