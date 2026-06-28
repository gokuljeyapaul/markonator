#!/usr/bin/env bash
# Generate Chrome Web Store listing screenshots (exactly 1280x800) from the
# PNG sequence captured by tests/screenshots.spec.js.
#
# Usage: scripts/make-store-shots.sh <screenshots-dir> <out-dir>
# Requires ffmpeg (installed in CI/release via the "Install ffmpeg" step).
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "usage: $0 <screenshots-dir> <out-dir>" >&2
    exit 1
fi

DIR="$1"
OUT="$2"
mkdir -p "$OUT"

# source frame -> store screenshot filename. Aspect ratio matches 1280x800
# (16:10), so the lanczos scale is undistorted.
gen() {
    ffmpeg -y -hide_banner -loglevel error \
        -i "$DIR/$1" -vf "scale=1280:800:flags=lanczos" -frames:v 1 "$OUT/$2"
}

gen shot-02.png 1-plan-loaded.png
gen shot-04.png 2-writing-comment.png
gen shot-06.png 3-threaded-replies.png
gen shot-07.png 4-theme-and-font.png
gen shot-08.png 5-copy-agent-prompt.png

echo "wrote store screenshots to $OUT"
ls -1 "$OUT"
