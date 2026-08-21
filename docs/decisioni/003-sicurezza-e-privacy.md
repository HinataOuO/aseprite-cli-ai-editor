# 003 — Sicurezza e privacy

**Stato:** accettata.

- Bridge solo loopback, pairing con nonce monouso e correlazione richiesta/risposta.
- Nessuna credenziale o configurazione provider: la generazione usa `image_gen` del modello host.
- Log vietati per immagini, pixel, maschere e prompt completi.
- Il PNG host può essere scritto soltanto nel percorso UUID assegnato; symlink e file irregolari sono rifiutati.
- Snapshot e maschera vengono rivalidati prima di ogni applicazione.
- I file temporanei vengono eliminati su successo, scadenza o esaurimento tentativi.
