#!/bin/zsh
# sheet.sh out.jpg cols width img1 img2 ...  — grid of images, each scaled to `width`.
out=$1; cols=$2; w=$3; shift 3
n=$#
inputs=()
filters=""
layout=""
i=0
for f in "$@"; do
  inputs+=(-i "$f")
  filters+="[$i:v]scale=${w}:-2,setsar=1[v$i];"
  i=$((i+1))
done
# All tiles share a height (same aspect inputs assumed): read it from the first.
h=$(/opt/homebrew/bin/ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$1" | awk -F, -v w=$w '{printf "%d", int(w*$2/$1/2)*2}')
stack=""
for ((k=0;k<n;k++)); do
  c=$((k % cols)); r=$((k / cols))
  stack+="[v$k]"
  [[ -n $layout ]] && layout+="|"
  layout+="$((c*w))_$((r*h))"
done
if (( n == 1 )); then
  /opt/homebrew/bin/ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "${filters}[v0]null[o]" -map "[o]" -q:v 3 "$out"
else
  /opt/homebrew/bin/ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "${filters}${stack}xstack=inputs=${n}:layout=${layout}:fill=black[o]" -map "[o]" -q:v 3 "$out"
fi
echo "$out"
