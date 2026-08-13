# Server MCP

## Scopo

Esporre agli agenti un confine controllato tra richiesta AI e modifica del documento Aseprite.

## Responsabilità

- offrire strumenti MCP per leggere il contesto, proporre operazioni, applicarle e ottenere risultati;
- validare struttura, versione, destinazioni, limiti e operazioni richieste;
- ridurre token trasferendo solo il contesto necessario e accorpare operazioni quando non ne cambia il significato;
- comunicare con il [[../plugin-lua/README|Plugin Lua]] tramite un trasporto ancora da scegliere;
- restituire errori distinguibili di validazione, comunicazione ed esecuzione;
- rifiutare inizialmente codice Lua arbitrario.

I nomi e le firme degli strumenti non sono ancora definitivi.

## Input

- richieste strutturate dall'[[../agente-ai-cli/README|Agente Ai Cli]];
- stato e risultati restituiti dal plugin;
- versione del [[../protocollo-dati/README|Protocollo Dati]].

## Output

- operazioni dichiarative validate per il plugin;
- contesto essenziale per l'agente;
- risultati o errori strutturati.

## Dipendenze

- runtime MCP da selezionare;
- protocollo dati condiviso;
- canale di comunicazione con il plugin;
- disponibilità del documento Aseprite tramite il plugin.

## Fuori ambito

- interpretazione artistica primaria;
- modifica diretta del documento Aseprite;
- inoltro o esecuzione di Lua generato dall'AI;
- persistenza o coda distribuita finché non necessarie.

## Decisioni aperte

- elenco e granularità degli strumenti MCP;
- trasporto, autenticazione e ciclo di vita della connessione al plugin;
- limiti di dimensione e strategie concrete di riduzione;
- tassonomia e recuperabilità degli errori.
