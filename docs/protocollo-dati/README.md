# Protocollo dati MVP

## Versione e trasporto

JSON UTF-8, versione esatta `1.0`, massimo 1 MiB per messaggio. Versioni major diverse producono `incompatible_version`; campi obbligatori mancanti o valori fuori limite producono `invalid_message`.

Ogni richiesta bridge è `{version,id,type,payload}` e ogni risposta `{version,id,ok,payload? ,error?}`. `id` correla una sola richiesta. Il primo messaggio è `pair` con nonce monouso. Capability minime: `read_snapshot`, `confirm_mask`, `apply_diff`.

## Coordinate e immagini

Origine canvas `(0,0)` in alto a sinistra; `x` cresce a destra, `y` in basso. Rettangoli `{x,y,width,height}` hanno estremi destro/inferiore esclusi. Coordinate del protocollo sono sempre canvas-relative; il plugin traduce tramite `cel.position` e fa clipping al canvas.

Lo snapshot locale può trasportare il crop minimo come riferimenti palette row-major; il server lo converte in PNG base64 prima del provider. Il crop non è autorizzazione: soltanto la maschera lo è.

## Maschera esatta

`{bounds,bits}`: `bounds` è canvas-relative; `bits` è base64 di una bitset row-major, bit meno significativo per primo. Deve contenere esattamente `ceil(width*height/8)` byte; gli eventuali bit di padding sono zero. Un bit `1` autorizza quel singolo pixel. Nessun passaggio può allargare bounds o bit.

## Palette e trasparenza

Una palette è `[{index,rgba}]`, con indici unici e `rgba` intero unsigned `0xRRGGBBAA` a 32 bit. I candidati contengono soltanto indici palette oppure `-1`, sentinella trasparente. In Indexed `transparentIndex` identifica l'indice trasparente del documento; in RGB `-1` diventa alpha zero. Nessun RGBA libero è accettato dal provider.

## Snapshot e concorrenza

Uno snapshot identifica `spriteId`, dimensioni, modalità, frame corrente, UUID layer, `imageId`/`imageVersion`, palette, trasparenza, selezione/crop e capability. `token` è SHA-256 della serializzazione canonica di questi campi escluso il token. Prima di scrivere il plugin rivalida token, sprite, frame, layer, image version e palette. Ogni evento o differenza invalida il job con `stale_snapshot`.

## Specifica, candidato e diff

- `EditSpec`: intento minimo, snapshot token, frame, UUID layer espliciti, maschera immutabile, requisiti semantici e `confirmationRequired`.
- `Candidate`: stesso token, bounds uguali alla maschera, array row-major di riferimenti palette/`-1`.
- `PixelDiff`: soltanto pixel realmente diversi `{x,y,paletteRef}` dentro la maschera, con stesso token/frame/layer.

La selezione Aseprite presente è l'unica maschera autorizzata. Senza selezione, Vision propone una maschera che deve essere confermata/corretta durante il bootstrap. Multi-layer richiede UUID espliciti e conferma.

## Errori

Forma uniforme `{code,message,retryable,details?}`. Codici MVP: `invalid_message`, `incompatible_version`, `payload_too_large`, `pairing_failed`, `timeout`, `disconnected`, `unsupported_document`, `stale_snapshot`, `unauthorized_change`, `provider_unavailable`, `validation_failed`, `confirmation_required`, `attempts_exhausted`, `apply_failed`.

Gli errori non includono immagini, credenziali o prompt completi. Un errore d'applicazione causa rollback dell'intera transazione.
