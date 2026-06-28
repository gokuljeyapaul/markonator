#!/usr/bin/env bash
# Build a short promo video (MP4, 1920x1080, H.264) from the screenshot
# sequence captured by tests/screenshots.spec.js, for upload to YouTube as the
# Chrome Web Store listing video.
#
# Usage: scripts/make-promo-video.sh <screenshots-dir> <out.mp4>
# Requires ffmpeg.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "usage: $0 <screenshots-dir> <out.mp4>" >&2
    exit 1
fi

DIR="$1"
OUT="$2"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

cd "$DIR"

LIST="promo-video-list.txt"
: > "$LIST"
FRAMES=(shot-01.png shot-02.png shot-03.png shot-04.png shot-05.png shot-06.png shot-07.png shot-08.png)
DURATIONS=(1.5 1.5 1.5 2 2 2 2 2.5)
LAST=""
i=0
for f in "${FRAMES[@]}"; do
    echo "file '$f'" >> "$LIST"
    echo "duration ${DURATIONS[$i]}" >> "$LIST"
    LAST="$f"
    i=$((i + 1))
done
# hold the final frame (concat ignores duration on the last entry)
echo "file '$LAST'" >> "$LIST"

# 16:10 source frames into a 16:9 1920x1080 canvas, centered with dark bars,
# H.264 + yuv420p (YouTube-friendly), faststart for web.
ffmpeg -y -hide_banner -loglevel error \
    -f concat -safe 0 -i "$LIST" \
    -vf "fps=25,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0d1117,setsar=1" \
    -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT"

echo "wrote $OUT"
