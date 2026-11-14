#!/bin/sh
# Colour-grading contact sheets: six November hours x four views, clear and
# overcast (48 stills), each hour a row, each view a column.
#   scripts/grade-sheets.sh <out-dir> [--base <ref>]   (dev server on $PORT, CDP on $CDP)
# Writes <out>/<weather>/*.jpg stills and <out>/sheet-<weather>.jpg.
set -e
OUT=$1; shift
PORT=${PORT:-5353}
CDP=${CDP:-9423}
TIMES=350,750,1145,1165,1188,1320
VIEWS=home,slope,hill,sea
for W in clear overcast; do
  node scripts/perf.mjs shots --label "$W" --weather "$W" --magic asleep --times $TIMES --views $VIEWS \
    --size 1280x800 --dpr 1 --port "$PORT" --cdp "$CDP" --out "$OUT" "$@"
  ARGS=""; LAYOUT=""; N=0
  for T in $(echo $TIMES | tr , ' '); do
    for V in $(echo $VIEWS | tr , ' '); do
      ARGS="$ARGS -i $OUT/$W/asleep-$T-$V.jpg"
    done
  done
  # 4 columns x 6 rows of 480x300 tiles.
  for R in 0 1 2 3 4 5; do for C in 0 1 2 3; do
    LAYOUT="$LAYOUT|$((C * 480))_$((R * 300))"; N=$((N + 1))
  done; done
  FILTER=""; I=0
  while [ $I -lt $N ]; do FILTER="$FILTER[$I]scale=480:300[t$I];"; I=$((I + 1)); done
  I=0; IN=""; while [ $I -lt $N ]; do IN="$IN[t$I]"; I=$((I + 1)); done
  ffmpeg -loglevel error -y $ARGS -filter_complex "$FILTER${IN}xstack=inputs=$N:layout=${LAYOUT#|}" -q:v 3 "$OUT/sheet-$W.jpg"
done
