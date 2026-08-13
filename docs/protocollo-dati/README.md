# Protocollo Dati

## Scopo

Definire il contratto dichiarativo che separa [[../agente-ai-cli/README|Agente Ai Cli]], [[../server-mcp/README|Server MCP]] e [[../plugin-lua/README|Plugin Lua]], senza fissarne ancora lo schema.

## Responsabilità

- rappresentare intenzioni e operazioni senza codice eseguibile;
- identificare in modo non ambiguo sprite, frame, layer e selezioni;
- descrivere operazioni atomiche e relative precondizioni;
- dichiarare una versione compatibile del protocollo;
- consentire validazione prima dell'applicazione;
- rappresentare risultati, modifiche effettuate ed errori.

## Input

- intento strutturato dell'agente;
- riferimenti al documento corrente;
- capacità dichiarate da server, plugin e versione di Aseprite.

## Output

Buste dichiarative per richieste e risposte. Campi, tipi, serializzazione, granularità e schema di validazione restano da progettare e approvare.

## Dipendenze

- requisiti reali delle API Aseprite;
- strumenti MCP scelti;
- trasporto tra server e plugin solo per gli eventuali vincoli che introduce.

## Fuori ambito

- codice Lua arbitrario;
- dettagli interni del modello AI;
- scelta immediata di JSON, MessagePack o altra serializzazione;
- operazioni speculative non richieste dai primi scenari.

## Decisioni aperte

- forma e stabilità degli identificatori;
- catalogo minimo delle operazioni atomiche;
- gestione di versioni, capacità e compatibilità;
- precondizioni, atomicità e risultati parziali;
- rappresentazione di pixel, forme, immagini e dati binari;
- struttura uniforme degli errori.
