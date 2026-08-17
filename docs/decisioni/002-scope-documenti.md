# 002 — Scope documenti

**Stato:** accettata.

L'MVP accetta sprite `16×16`, `32×32` o `64×64`, nei modi Indexed o RGB, con una sola palette. Opera sul frame corrente e su un image layer editabile; più layer richiedono UUID espliciti e conferma.

Rifiuta con `unsupported_document`: grayscale, tilemap, reference layer, group come destinazione, layer bloccato, palette multiple e qualsiasi altra dimensione. Un cel assente è leggibile come trasparente e può essere creato atomicamente in applicazione.
