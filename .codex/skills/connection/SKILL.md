---
name: connection
description: Show Aseprite CLI AI Editor bridge connection details and guide pairing when the user asks how to connect, requests the port or nonce, or reports connection status problems.
---

# Aseprite connection

Call `get_connection_info`, then show its host, port, nonce, and status.

Tell user to open **File → Scripts → Connect CLI AI Editor** in Aseprite and enter returned port and nonce.

Interpret status:

- `awaiting_pairing`: nonce can be used for pairing.
- `connected`: Aseprite plugin is paired.
- `disconnected`: nonce was already consumed. Restart MCP server to obtain a new nonce before reconnecting.
