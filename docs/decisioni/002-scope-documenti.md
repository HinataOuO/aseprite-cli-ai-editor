# 002 — Scope documenti

**Stato:** accettata.

L'MVP accetta sprite rettangolari con lati `1–128` e area massima 16384 pixel, incluso `72×48`, nei modi Indexed o RGB, con una sola palette. Opera sul frame corrente e su un image layer editabile; più layer richiedono UUID espliciti e conferma.

Rifiuta con `unsupported_document`: grayscale, tilemap, reference layer, group come destinazione, layer bloccato, palette multiple e dimensioni fuori limite. Un cel assente è leggibile come trasparente e può essere creato atomicamente in applicazione.
