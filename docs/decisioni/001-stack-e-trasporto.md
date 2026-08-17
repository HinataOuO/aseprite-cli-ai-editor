# 001 — Stack e trasporto

**Stato:** accettata.

- Runtime: Node.js 20+, TypeScript strict.
- Confine agente/server: MCP su stdin/stdout; stdout è riservato al protocollo, log su stderr.
- Confine server/plugin: WebSocket JSON su `127.0.0.1`; il server ascolta, Aseprite si connette.
- Ogni avvio genera un nonce monouso mostrato all'utente. Il primo messaggio deve associarlo; nonce errati o riutilizzati chiudono la connessione.
- Limite messaggio: 1 MiB. Timeout richiesta: 10 s.

WebSocket evita polling/file temporanei ed è disponibile nell'API Aseprite >=1.3.0. Nessun bind LAN o trasporto remoto nell'MVP.
