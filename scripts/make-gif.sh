#!/usr/bin/env bash
# Build a looping demo GIF from the PNG screenshot sequence captured by
# tests/screenshots.spec.js.
#
# Usage: scripts/make-gif.sh <screenshots-dir> <out.gif>
#
# Requires ffmpeg (preinstalled on ubuntu-latest GitHub runners).
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "usage: $0 <screenshots-dir> <out.gif>" >&2
    exit 1
fi

DIR="$1"
OUT="$2"

# Resolve OUT to an absolute path before we cd into DIR.
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

cd "$DIR"

# Frame order + per-frame durations (seconds). The final frame is repeated so
# the concat demuxer holds on it (it ignores `duration` on the last entry).
FRAMES=(shot-01.png shot-02.png shot-03.png shot-04.png shot-05.png shot-06.png shot-07.png shot-08.png)
DURATIONS=(1.2 1.2 1.2 1.6 1.6 1.6 1.6 1.4)

LIST="list.txt"
: > "$LIST"
LAST=""
i=0
for f in "${FRAMES[@]}"; do
    echo "file '$f'" >> "$LIST"
    echo "duration ${DURATIONS[$i]}" >> "$LIST"
    LAST="$f"
    i=$((i + 1))
done
# hold the final frame
echo "file '$LAST'" >> "$LIST"

# High-quality GIF: custom palette + lanczos scaling to 900px wide, loops forever.
ffmpeg -y -hide_banner -loglevel error \
    -f concat -safe 0 -i "$LIST" \
    -vf "fps=12,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
    -loop 0 "$OUT"

echo "wrote $OUT"
