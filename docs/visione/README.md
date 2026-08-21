# Visione

## Scopo

Consentire a chi usa Aseprite di descrivere in linguaggio naturale un nuovo disegno o una modifica puntuale, lasciando all'AI la traduzione dell'intento e ad Aseprite l'editing effettivo.

## Responsabilità

- definire il problema: ridurre il passaggio manuale tra intento visivo e operazioni ripetitive nell'editor;
- descrivere un'esperienza in cui l'utente resta nel controllo del documento e può correggere il risultato per iterazioni;
- coprire sprite statici e modifiche localizzate al frame corrente, layer o selezione;
- definire inizialmente “tempo reale” come feedback interattivo dopo ogni richiesta, senza una soglia di latenza ancora garantita.

## Input

- obiettivo visivo espresso dall'utente;
- eventuale documento, selezione o risultato esistente;
- vincoli espliciti su stile, dimensioni e palette.

## Output

Una direzione condivisa per [[../agente-ai-cli/README|Agente Ai Cli]], [[../server-mcp/README|Server MCP]], [[../plugin-lua/README|Plugin Lua]] e [[../protocollo-dati/README|Protocollo Dati]].

## Dipendenze

- [Aseprite](https://www.aseprite.org/) come editor esterno e fonte dello stato del documento;
- disponibilità delle API necessarie nel plugin;
- capacità dell'agente di produrre richieste strutturate.

## Fuori ambito

- replica dell'interfaccia o del motore di Aseprite;
- automazione incontrollata fuori dal documento aperto;
- collaborazione multiutente, hosting e distribuzione commerciale;
- garanzie definitive di latenza o fedeltà artistica.

## Decisioni aperte

- soglia e modalità precise del feedback “in tempo reale”;
- rappresentazione di pixel, primitive e immagini di riferimento;
- quantità di controllo umano richiesta prima dell'applicazione;
- limiti delle modifiche puntuali supportate inizialmente.
