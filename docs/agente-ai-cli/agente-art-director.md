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

## Profilo e precedenza

`ArtDirectionProfile` è compilato una volta per generazione e contiene `nativeSprite`, `pixelStyle`, `rendering`, ruoli palette espressi come indici reali, `character`, `pose`, `preserve`, vincoli negativi e priorità. Ogni regola osservata registra valore, evidenza, confidenza e origine; una misura euristica non viene presentata come requisito certo.

Precedenza: vincoli tecnici del documento e della maschera → intento esplicito → stile osservato nel crop → default dipendente dalla risoluzione. Il compilatore elimina istruzioni incompatibili, per esempio outline continua e selettiva.

L'analisi usa bounding box opaca, frequenze e luminosità palette, colori sul bordo trasparente, componenti connesse e densità. Le risoluzioni 16/32/64 applicano budget di dettaglio distinti; una figura fino a circa 48 px dentro un canvas 64×64 conserva il budget 48 px invece di acquisire dettaglio automaticamente.

## Dipendenze

- contesto raccolto dall'[[README|Agente Ai Cli]];
- capacità del [[../server-mcp/README|Server MCP]] di validare l'output;
- identificatori affidabili forniti dal documento corrente.

## Fuori ambito

- decidere autonomamente requisiti artistici ambigui con impatto rilevante;
- eseguire operazioni in Aseprite;
- stabilire il trasporto o lo schema definitivo;
- produrre Lua arbitrario;
- chiedere raster o PNG al provider: l'output generativo è sempre un `Candidate` JSON row-major.

## Decisioni aperte

Chiedere all'utente, solo quando non deducibili o indispensabili: dimensioni, palette, stile, vista o posa, numero di frame, timing, struttura dei layer, area da modificare e parti da preservare. Restano da definire soglie e ordine dei chiarimenti.
