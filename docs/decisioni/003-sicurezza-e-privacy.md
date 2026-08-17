# 003 — Sicurezza e privacy

**Stato:** accettata.

- Bridge solo loopback, pairing con nonce monouso e correlazione richiesta/risposta.
- Provider cloud disabilitato senza consenso esplicito (`AI_EDITOR_CLOUD_CONSENT=1`).
- Credenziali solo da ambiente; mai in richieste, cache o log.
- Log vietati per immagini, pixel, maschere, prompt completi e credenziali.
- Al provider va solo crop minimo PNG, maschera, palette e intento minimo.
- JSONL di calibrazione e cache sono locali, cancellabili e soggetti a retention configurabile; nessuna immagine completa è persistita.
