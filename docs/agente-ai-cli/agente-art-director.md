# Agente Art Director

## Scopo

Trasformare una richiesta visiva, anche incompleta, in indicazioni artistiche strutturate che gli altri componenti possano validare e applicare.

## Responsabilità

- esplicitare palette, dimensioni, stile, pose, livelli e animazioni richiesti;
- distinguere una nuova generazione da una modifica puntuale;
- preservare le parti non interessate quando l'utente indica un ambito preciso;
- chiedere solo le informazioni mancanti che impediscono un risultato applicabile;
- produrre intento e operazioni candidate, non codice eseguibile.

## Input

- richiesta in linguaggio naturale;
- stato disponibile di sprite, frame, layer e selezioni;
- vincoli o riferimenti visivi;
- cronologia utile delle modifiche richieste.

## Output

Una descrizione strutturata attesa contenente, quando pertinenti:

- obiettivo e ambito della modifica;
- destinazioni nel documento;
- palette, dimensioni e stile;
- pose, layer, frame e animazioni;
- vincoli da preservare;
- informazioni ancora mancanti.

Il formato definitivo appartiene al [[../protocollo-dati/README|Protocollo Dati]].

## Dipendenze

- contesto raccolto dall'[[README|Agente Ai Cli]];
- capacità del [[../server-mcp/README|Server MCP]] di validare l'output;
- identificatori affidabili forniti dal documento corrente.

## Fuori ambito

- decidere autonomamente requisiti artistici ambigui con impatto rilevante;
- eseguire operazioni in Aseprite;
- stabilire il trasporto o lo schema definitivo;
- produrre Lua arbitrario.

## Decisioni aperte

Chiedere all'utente, solo quando non deducibili o indispensabili: dimensioni, palette, stile, vista o posa, numero di frame, timing, struttura dei layer, area da modificare e parti da preservare. Restano da definire soglie e ordine dei chiarimenti.
