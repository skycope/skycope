#!/bin/sh
# A quick grade check while tuning: a few hours and views, one weather,
# tiled in a sheet (hours down, views across).
#   scripts/grade-quick.sh <out-dir> [times] [views] [weather] [--base <ref>]
set -e
OUT=$1
TIMES=${2:-750,1165,1320}
VIEWS=${3:-home,slope,hill,sea}
W=${4:-clear}
shift; [ $# -gt 0 ] && shift; [ $# -gt 0 ] && shift; [ $# -gt 0 ] && shift
node scripts/perf.mjs shots --label "$W" --weather "$W" --magic asleep --times "$TIMES" --views "$VIEWS" \
  --size 1280x800 --dpr 1 --port "${PORT:-5353}" --cdp "${CDP:-9423}" --out "$OUT" "$@" > /dev/null
ARGS=""; N=0; R=0
for T in $(echo "$TIMES" | tr , ' '); do
  C=0
  for V in $(echo "$VIEWS" | tr , ' '); do
    ARGS="$ARGS -i $OUT/$W/asleep-$T-$V.jpg"; LAYOUT="$LAYOUT|$((C * 640))_$((R * 400))"; N=$((N + 1)); C=$((C + 1))
  done
  R=$((R + 1))
done
FILTER=""; IN=""; I=0
while [ $I -lt $N ]; do FILTER="$FILTER[$I]scale=640:400[t$I];"; IN="$IN[t$I]"; I=$((I + 1)); done
ffmpeg -loglevel error -y $ARGS -filter_complex "$FILTER${IN}xstack=inputs=$N:layout=${LAYOUT#|}" -q:v 3 "$OUT/sheet-$W.jpg"
echo "$OUT/sheet-$W.jpg"
