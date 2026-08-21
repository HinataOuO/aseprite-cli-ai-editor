# Pixel Art Pipeline

Pipeline Python locale e deterministica per PNG statici. Produce `sprite.json`
canonico v1, `sprite.png` ricostruito dalla matrice e `preview.png`
nearest-neighbor. Le coordinate sono sempre `pixels[y][x]`.

## Installazione

Richiede Python 3.11+.

```bash
cd pixel-art-pipeline
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Generazione

`--size` è obbligatorio e indica il lato massimo. Il secondo lato viene
calcolato preservando le proporzioni, arrotondato deterministicamente e mai
inferiore a 1.

```bash
PYTHONPATH=src python scripts/generate.py \
  --input input.png --output output/ --size 64 --max-colors 256

python scripts/extract_grid.py input.png \
  --output sprite.json --size 32 --config config/default.yaml
```

Sono ammessi solo `--size 16`, `32`, `64` o `128` e PNG reali, statici e
leggibili. File rinominati, altri formati e PNG animati vengono rifiutati.
Sorgenti più grandi vengono ridotte con campionamento `dominant` predefinito;
sorgenti più piccole vengono ingrandite esclusivamente nearest-neighbor.
`center` e gli offset interi restano disponibili per il campionamento in
riduzione.

```bash
PYTHONPATH=src python scripts/generate.py \
  --input input.png --output output/ --size 128 \
  --sampling-method center --sample-offset-x 0 --sample-offset-y 0
```

Se il PNG è completamente opaco, il colore dominante del bordo viene usato
come candidato sfondo: soltanto i pixel cromaticamente compatibili e connessi
al bordo diventano `#00000000`. `--background-tolerance` regola l'euristica.
PNG che contengono già trasparenza restano intatti. La rimozione opzionale di
piccoli componenti (`--min-component-pixels`) e il singolo pruning
(`--prune-passes 1`) sono separati e disattivati per default.

Limite noto: questa è un'euristica flood-fill dal bordo, non segmentazione AI.
Sfondi complessi o indistinguibili dal soggetto, soprattutto quando il soggetto
tocca il bordo con colori simili, non possono essere rimossi in modo affidabile.

## Rendering, validazione e import

```bash
python scripts/render.py sprite.json --output sprite.png \
  --preview preview.png --scale 8
python scripts/validate.py sprite.json --png sprite.png

aseprite -b --script-param input="$PWD/output/sprite.json" \
  --script-param output="$PWD/output/sprite.aseprite" \
  --script ../plugin/import-sprite-json.lua
```

Flusso unico:

```text
image_gen → PNG → generate.py --size 16|32|64|128 → sprite.json → import Aseprite
```

Il formato non cambia:

```json
{
  "version": 1,
  "width": 64,
  "height": 32,
  "palette": ["#00000000", "#FFFFFFFF"],
  "pixels": [[0, 1]],
  "metadata": {}
}
```

Un solo sprite statico per JSON; dimensioni `1–128`, area massima 16384 pixel
e palette massima 256 colori. Nessun provider AI, credenziale o download nella
pipeline Python.

## Test

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
```
