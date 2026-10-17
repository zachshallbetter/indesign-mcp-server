# Builder brief: Premiere Pro

Read [common.md](common.md) first. Branch `premiere-<slug>`; findings
`atlas-notes/premiere-<slug>.json`; PR title "Premiere Pro: <epic>".

## How Premiere Pro tools work

Premiere Pro has no AppleScript or COM interface. The MCP server listens on
`127.0.0.1:PREMIERE_WS_PORT` (default 3011, optional `BRIDGE_TOKEN`); a UXP plugin
in Premiere Pro (`packages/premiere/uxp/plugin`) connects to it and runs the scripts.

- Tools live in `packages/premiere/src/tools/<area>.js`, registered in
  `src/server.js`.
- Scripts are **async UXP JavaScript**, not ExtendScript, with `ppro`
  (`require("premierepro")`) and `transact` in scope. Every edit goes through
  `transact`, which builds actions inside `lockedAccess` and runs them with
  `executeTransaction`.
- `src/bridge.js` is the WebSocket and HTTP bridge (one plugin at a time; a second
  MCP process forwards to the first).
- Paths: the package's path policy (`PREMIERE_ALLOWED_DIRS`).

## Rules for Premiere Pro scripts

- Only UXP members in `tests/fixtures/premiere-uxp-api.json` (generated from Adobe's
  UXP reference by `scripts/generate-fixtures.js`); the audit checks every member.
- A member newer than 25.6 needs the tool to declare `since: '<version>'`, or to
  check for the member first and list it in `guarded`.
- There is no menu-command API, and undo is not scriptable.
- The atlas's Premiere routes describe the ExtendScript object model. When a feature
  is reachable only through UXP, claim it and record a note (route kept) saying so.
