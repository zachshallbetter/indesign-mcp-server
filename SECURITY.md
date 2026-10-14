# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| < 2.0 | No |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include the version, platform (macOS or Windows, InDesign version), the tool and arguments involved, and what an attacker could achieve. You should get an initial response within a week.

## What this server can do

The server runs on your machine with your user's permissions and sends ExtendScript to InDesign. Keep these in mind when you connect it to an AI client:

- **`execute_indesign_code` runs arbitrary ExtendScript.** ExtendScript can read and write files and run other applications. Its annotations mark it destructive; clients that honor annotations ask before calling it. Remove it from your client's allowed tools if you do not need it.
- **File access is confined.** Every path parameter is checked before it reaches a script: it must be absolute, inside your home folder or a directory listed in `INDESIGN_ALLOWED_DIRS`, and outside system directories. `npm test` verifies this for every path parameter.
- **Arguments never reach a script unescaped.** Values are converted with the validated helpers in `src/utils/jsxSafe.js`; enum values are checked against fixed lists.
- **Scripts are written to the OS temp directory** as `indesign_mcp_*.jsx` and deleted after each call (and on startup).
- **The optional UXP bridge** (`indesign-mcp-uxp-bridge`) listens on `127.0.0.1` only (HTTP 3000, WebSocket 3001 by default). Without `BRIDGE_TOKEN`, any local process can send it scripts; set `BRIDGE_TOKEN` on shared machines.
- **Network:** the server's only network requests go to the UXP bridge when that backend is enabled (`UXP_BRIDGE_URL`, `http://127.0.0.1:3000` by default). `save_document_to_cloud` and `open_cloud_document` use InDesign's Creative Cloud documents, and `print_book` prints; their annotations mark them as reaching outside the machine.
