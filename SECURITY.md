# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| < 2.0 | No |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include the package and its version, the platform (macOS or Windows, and the Adobe application's version), the tool and arguments involved, and what an attacker could achieve. You should get an initial response within a week.

## What this server can do

Each server runs on your machine with your user's permissions and sends ExtendScript to its Adobe application. Keep these in mind when you connect it to an AI client:

- **`execute_indesign_code` runs arbitrary ExtendScript.** ExtendScript can read and write files and run other applications. Its annotations mark it destructive; clients that honor annotations ask before calling it. Remove it from your client's allowed tools if you do not need it.
- **File access is confined.** Every path parameter is checked before it reaches a script: it must be absolute, inside your home folder or a directory listed in `INDESIGN_ALLOWED_DIRS`, and outside system directories. `npm test` verifies this for every path parameter.
- **Arguments never reach a script unescaped.** Values are converted with the validated helpers in `packages/core/src/jsx.js` (InDesign: `packages/indesign/src/utils/jsxSafe.js`); enum values are checked against fixed lists.
- **Scripts are written to the OS temp directory** as `indesign_mcp_*.jsx` and deleted after each call (and on startup).
- **The optional UXP bridge** (`indesign-mcp-uxp-bridge`) listens on `127.0.0.1` only (HTTP 3000, WebSocket 3001 by default). Without `BRIDGE_TOKEN`, any local process can send it scripts; set `BRIDGE_TOKEN` on shared machines. The token covers `/execute`, `/status` and the WebSocket port: a connection there must send the token as its first message before it becomes the plugin, and is closed otherwise. A connected plugin is never replaced by a second connection. Enter the token in the InDesign Bridge Panel, which stores it in the plugin's `localStorage`. Without a token, a local process can connect as the plugin whenever no plugin is connected and receive the scripts sent to InDesign. The plugin requests full local file system access (`localFileSystem: fullAccess`) so scripts can check and create files, as ExtendScript can.
- **Network:** the server's only network requests go to the UXP bridge when that backend is enabled (`UXP_BRIDGE_URL`, `http://127.0.0.1:3000` by default). `save_document_to_cloud` and `open_cloud_document` use InDesign's Creative Cloud documents, and `print_book` prints; their annotations mark them as reaching outside the machine.
