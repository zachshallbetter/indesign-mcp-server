#!/bin/sh
set -eu

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 18 or later first: https://nodejs.org/' >&2
  exit 1
fi

node -e 'if (Number(process.versions.node.split(".")[0]) < 18) process.exit(1)' || {
  printf '%s\n' 'Adobe MCP Suite requires Node.js 18 or later.' >&2
  exit 1
}

npm install --global --no-audit --no-fund adobe-mcp-suite@latest
