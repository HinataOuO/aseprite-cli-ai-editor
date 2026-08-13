# Piano MVP della pipeline ibrida

## Obiettivo e confini

L'MVP modifica una parte esistente dello sprite nel frame corrente, mantenendo Aseprite come autorità sul documento. Supporta soltanto sprite `16×16`, `32×32` e `64×64` e deve funzionare con modelli Vision locali o cloud.

La palette letta da Aseprite è un vincolo assoluto: nessun pixel prodotto può usare colori esterni. Il piano non rende definitivi stack tecnologico, trasporto MCP→plugin, schema dati o formato delle immagini.

Il primo test end-to-end sostituisce un braccio su uno sprite `32×32`, senza alterare pixel esterni all'area autorizzata, frame diversi o layer non autorizzati.

## Gestione del documento

- Si opera sul frame corrente.
- Per impostazione predefinita è autorizzato soltanto il layer in focus.
- L'accesso a più layer richiede una richiesta esplicita e un elenco di layer autorizzati.
- Una selezione Aseprite, quando presente, definisce l'area modificabile prioritaria.
- L'intera applicazione della modifica costituisce una singola transazione annullabile con undo.

## Pipeline

1. **Stato Lua:** il plugin legge dimensioni, frame corrente, layer in focus, selezione, palette, trasparenza e pixel strettamente necessari.
2. **Crop:** il sistema limita l'immagine all'area selezionata oppure a un contesto minimo utile alla localizzazione Vision.
3. **Analisi Vision:** un modello locale o cloud interpreta richiesta e crop; se manca una selezione, propone una maschera e una confidence di localizzazione.
4. **Specifica strutturata:** l'agente converte intento, area autorizzata, palette, vincoli del documento e requisiti semantici in una richiesta dichiarativa. Contratto e serializzazione restano da definire.
5. **Generazione:** il modello produce soltanto i pixel candidati nell'area autorizzata, usando esclusivamente riferimenti alla palette Aseprite.
6. **Validazione:** controlli deterministici verificano invarianti del documento; la valutazione semantica assegna separatamente l'accuracy del risultato.
7. **Applicazione:** il plugin applica una modifica valida al frame e ai layer autorizzati in una sola transazione, oppure non modifica il documento.

## Responsabilità

| Componente | Responsabilità esclusiva |
| --- | --- |
| Agente | Raccogliere intento e chiarimenti, costruire la specifica dichiarativa, presentare conferme e coordinare i tentativi. |
| Server MCP | Orchestrare la pipeline, inoltrare dati, applicare policy e mantenere cache e calibrazione; non scrive direttamente nel documento. |
| Plugin Lua | Leggere lo stato autorizzato di Aseprite e applicare operazioni già validate tramite una singola transazione undo; non interpreta l'intento. |
| Modello Vision | Proporre localizzazione e contenuto visivo con confidence o score grezzi; non autorizza né applica modifiche. |
| Validatori deterministici | Bloccare output che viola palette, area, frame, layer o trasparenza; non valutano la qualità artistica. |

La valutazione dei requisiti semantici resta distinta dai validatori deterministici; il relativo score deve ancora essere progettato.

## Localizzazione e confidence

La selezione Aseprite prevale sempre e diventa la maschera autorizzata. In sua assenza, Vision propone l'area modificabile. Le soglie seguenti riguardano esclusivamente la **confidence di localizzazione**, non la qualità del risultato generato:

- **Bootstrap:** le prime 30 maschere di ogni modello/versione richiedono sempre conferma o correzione in Aseprite.
- **Meno del 70%:** l'agente chiede chiarimenti testuali e richiede una nuova proposta.
- **Dal 70% al 90% inclusi:** l'utente conferma o corregge la maschera in Aseprite.
- **Oltre il 90%:** l'area può essere automatizzata soltanto dopo la calibrazione del modello/versione.

Una correzione aggiorna il campione locale e la maschera corretta diventa l'unica area autorizzata.

## Calibrazione

La calibrazione è separata per identificatore e versione del modello, perché confidence provenienti da modelli diversi non sono direttamente confrontabili. Per ogni proposta si salvano localmente input minimo identificabile, confidence, maschera proposta, maschera confermata o corretta e risultato del confronto. Contenuto sensibile e immagini complete non vengono conservati quando hash, crop e maschere sono sufficienti.

La metrica di calibrazione delle maschere è:

`(2 × precisione + recall) / 3`

I primi 30 campioni sono soltanto un bootstrap, non una garanzia statistica. L'automazione oltre il 90% può essere abilitata solo per la specifica coppia modello/versione dopo il bootstrap e dopo che la metrica osservata è stata giudicata adeguata; la soglia di adeguatezza resta una decisione futura.

## Validazione prima dell'applicazione

Ogni tentativo deve soddisfare tutti gli invarianti deterministici:

- ogni colore appartiene esattamente alla palette letta da Aseprite;
- nessun pixel cambia fuori dalla maschera autorizzata;
- cambiano soltanto frame e layer autorizzati;
- indice o canale di trasparenza e pixel trasparenti rispettano lo stato del documento;
- la specifica contiene requisiti semantici verificabili dalla futura valutazione dedicata;
- l'applicazione completa è racchiusa in una singola transazione undo.

Il fallimento di un invariante blocca l'applicazione e non può essere superato da un punteggio semantico alto.

## Accuracy del risultato e rigenerazione

Dopo i controlli deterministici, una valutazione separata assegna l'**accuracy del risultato** rispetto ai requisiti semantici. Queste soglie non sono confidence di localizzazione:

- **Meno del 50%:** rigenerazione automatica.
- **Dal 50% al 70% inclusi:** richiesta di conferma dell'utente.
- **Oltre il 70%:** applicazione automatica, se tutti gli invarianti sono validi.

Sono consentiti al massimo tre tentativi complessivi. Ogni nuovo tentativo usa errori e differenze del precedente senza ampliare area, frame o layer autorizzati. Dopo il terzo tentativo non valido o insufficiente, il sistema interrompe la rigenerazione e richiede intervento manuale.

La definizione e la calibrazione dello score semantico restano da progettare; fino ad allora l'applicazione automatica basata su accuracy non è abilitabile.

## Riduzione di token e lavoro remoto

- Inviare crop e contesto minimo, non il documento completo.
- Identificare stato, crop, maschere e risultati tramite hash per riusare risposte compatibili.
- Trasmettere riferimenti o indici della palette invece di ripetere valori colore.
- Tra tentativi, inviare differenze di pixel e motivi di errore invece dell'intera immagine.
- Eseguire localmente, senza AI, verifiche di palette, area, frame, layer, trasparenza e diff.
- Invalidare la cache quando cambiano hash del contenuto, modello/versione, richiesta o vincoli autorizzati.

## Fasi future approvabili separatamente

Ogni fase richiede approvazione prima dell'implementazione e non rende definitive le decisioni delle fasi successive:

1. **Contratto dati:** definire richieste, risposte, errori, maschere e riferimenti palette, lasciando aperta la serializzazione finché non approvata.
2. **Lettura Aseprite:** acquisire in Lua stato minimo, frame, layer, selezione, palette, trasparenza e crop.
3. **Localizzazione:** integrare selezione prioritaria, proposta Vision, conferme, campioni e soglie di confidence.
4. **Generazione:** produrre candidati vincolati a maschera e palette con provider locale o cloud intercambiabile a livello di contratto.
5. **Validazione:** implementare invarianti deterministici, diff, transazione undo e interfaccia ancora aperta per lo score semantico.
6. **Calibrazione:** persistere campioni locali per modello/versione, calcolare la metrica e definire in seguito la soglia operativa.
7. **Test end-to-end:** sostituire il braccio sul caso `32×32`, quindi verificare i confini `16×16` e `64×64`, rigenerazione e arresto dopo tre tentativi.

## Criteri del primo test completo

Il caso del braccio `32×32` è completo quando:

1. il plugin legge correttamente stato, selezione o contesto minimo e palette;
2. la localizzazione segue il percorso di conferma previsto dalla calibrazione corrente;
3. il candidato usa soltanto la palette e modifica esclusivamente la maschera, il frame corrente e i layer autorizzati;
4. i requisiti semantici del braccio sono valutati senza confondere accuracy e confidence di localizzazione;
5. un risultato valido è applicato con un solo undo; un risultato non valido lascia il documento invariato;
6. cache, hash e diff riducono i dati dei tentativi successivi;
7. tre fallimenti consecutivi terminano con intervento manuale.

## Rischi aperti

- Le confidence Vision non sono direttamente confrontabili tra modelli o versioni.
- Trenta campioni costituiscono bootstrap, non significatività statistica garantita.
- La definizione dello score semantico e dei suoi dati di calibrazione è ancora aperta.
- Trasporto MCP→plugin, schema e formato dati restano aperti.
