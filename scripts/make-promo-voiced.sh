#!/usr/bin/env bash
# Generate a voiced promo video for YouTube: Microsoft neural TTS (edge-tts)
# narrates each scene timed to the app screenshot frames, a soft synthesized
# music bed plays under it, and ffmpeg renders a 1920x1080 H.264 MP4.
#
# Needs the edge-tts Python tool on PATH (or set $EDGE_TTS) and network access
# for the one-time voice synthesis. Cross-platform (not macOS-only).
#
# Usage: scripts/make-promo-voiced.sh <screenshots-dir> <out.mp4> [endcard.png]
# Env: EDGE_TTS (default .venv/bin/edge-tts), VOICE (default en-US-AriaNeural),
#      RATE (default +0%; e.g. -5% for a slower read).
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "usage: $0 <screenshots-dir> <out.mp4> [endcard.png]" >&2
    exit 1
fi

SRC="$1"
OUT="$2"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
EDGE_TTS="${EDGE_TTS:-.venv/bin/edge-tts}"
VOICE="${VOICE:-en-US-AriaNeural}"
RATE="${RATE:-+0%}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/frames"

# Scenes: frame | narration. Frames are pre-scaled to 1920x1080 (padded, dark).
SCENES=(
"shot-01.png|Markonator. The Markdown reviewer, built for people who work with coding agents."
"shot-02.png|Open any plan, skill, or spec. It renders like a page, with line numbers."
"shot-03.png|Move your cursor over a line, and click the plus to add a comment."
"shot-04.png|Write comments in Markdown, with a live preview right beside it."
"shot-05.png|Save, and the comments are written back into the file. In a format any coding agent can read."
"shot-06.png|Reply to build threads. Resolve them as your agent addresses the feedback."
"shot-07.png|Six themes. Eight fonts. Everything bundled, so it works fully offline."
"shot-08.png|One click copies a prompt that tells your agent exactly what to fix, and where."
)

# Pre-scale each screenshot frame to 1920x1080 (centered, dark bars).
i=0
for s in "${SCENES[@]}"; do
    f="${s%%|*}"
    ffmpeg -y -hide_banner -loglevel error -i "$SRC/$f" \
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0d1117" \
        -frames:v 1 "$WORK/frames/f$i.png"
    i=$((i + 1))
done

# End card: reuse the branded marquee PNG (avoids the drawtext filter, which
# isn't in every ffmpeg build). Scaled/padded to 1920x1080.
ENDCARD_SRC="${3:-promo/marquee.png}"
if [ -f "$ENDCARD_SRC" ]; then
    ffmpeg -y -hide_banner -loglevel error -i "$ENDCARD_SRC" \
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0d1117" \
        -frames:v 1 "$WORK/frames/endcard.png"
else
    cp "$WORK/frames/f$((i-1)).png" "$WORK/frames/endcard.png"
fi

# Narration per scene -> wav. The video frame for scene i is held for
# (narration_duration + PAD). The audio track places the narration clip followed
# by PAD silence, so scene (i+1)'s voice begins exactly when its frame appears.
PAD=0.4
ENDHOLD=3.2
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "anullsrc=r=44100:cl=mono" -t "$PAD" -c:a pcm_s16le "$WORK/pad.wav"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "anullsrc=r=44100:cl=mono" -t "$ENDHOLD" -c:a pcm_s16le "$WORK/endhold.wav"

# Retry the (free, sometimes rate-limited) edge-tts endpoint a few times.
tts() {
    local text="$1" out="$2" n=0
    until "$EDGE_TTS" --voice "$VOICE" --rate "$RATE" --text "$text" --write-media "$out"; do
        n=$((n + 1)); [ "$n" -ge 4 ] && { echo "edge-tts failed after $n tries" >&2; return 1; }
        echo "edge-tts retry $n ..." >&2; sleep 2
    done
}

VDUR="$WORK/vlist.txt"
: > "$VDUR"
ADUR="$WORK/alist.txt"
: > "$ADUR"
TOTAL=0
i=0
for s in "${SCENES[@]}"; do
    txt="${s#*|}"
    tts "$txt" "$WORK/v$i.mp3"
    ffmpeg -y -hide_banner -loglevel error -i "$WORK/v$i.mp3" -ar 44100 -ac 1 -c:a pcm_s16le "$WORK/v$i.wav"
    d=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$WORK/v$i.wav")
    dur=$(awk "BEGIN{printf \"%.3f\", $d + $PAD}")
    echo "file '$WORK/frames/f$i.png'" >> "$VDUR"
    echo "duration $dur" >> "$VDUR"
    echo "file '$WORK/v$i.wav'" >> "$ADUR"
    echo "file '$WORK/pad.wav'" >> "$ADUR"
    TOTAL=$(awk "BEGIN{printf \"%.3f\", $TOTAL + $dur}")
    i=$((i + 1))
done

# End card scene: endcard held for ENDHOLD; matching silence on the audio track.
echo "file '$WORK/frames/endcard.png'" >> "$VDUR"
echo "duration $ENDHOLD" >> "$VDUR"
echo "file '$WORK/frames/endcard.png'" >> "$VDUR"   # concat requires a trailing file
echo "file '$WORK/endhold.wav'" >> "$ADUR"
TOTAL=$(awk "BEGIN{printf \"%.3f\", $TOTAL + $ENDHOLD}")
FADEOUT=$(awk "BEGIN{printf \"%.2f\", $TOTAL - 3}")
echo "TOTAL duration: ${TOTAL}s (fade out at ${FADEOUT}s)"

# Narration track = voice clips interleaved with the matching silences; exactly
# TOTAL long and in sync with the frames.
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$ADUR" -c:a pcm_s16le "$WORK/narration_full.wav"

# Soft synthesized music bed (calm two-note drone with tremolo + lowpass), faded.
ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "sine=f=110:duration=$TOTAL" -f lavfi -i "sine=f=164.81:duration=$TOTAL" \
    -filter_complex "[0]tremolo=f=0.15:d=0.25,lowpass=f=700[a];[1]tremolo=f=0.2:d=0.3,lowpass=f=700[b];\
[a]volume=0.6[a2];[b]volume=0.5[b2];[a2][b2]amix=inputs=2,afade=t=in:st=0:d=2,afade=t=out:st=$FADEOUT:d=3,volume=0.16" \
    -c:a pcm_s16le "$WORK/music.wav"

# Mix narration (full) + music (quiet) -> stereo AAC.
ffmpeg -y -hide_banner -loglevel error -i "$WORK/narration_full.wav" -i "$WORK/music.wav" \
    -filter_complex "[0]aformat=channel_layouts=stereo,volume=1.0[n];[1]aformat=channel_layouts=stereo,volume=1.0[m];[n][m]amix=inputs=2:duration=longest:normalize=0" \
    -c:a aac -b:a 192k "$WORK/audio.m4a"

# Video from the frame concat (each image held for its scene duration).
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$VDUR" \
    -vf "fps=25,setsar=1" -c:v libx264 -pix_fmt yuv420p -preset medium "$WORK/video.mp4"

# Mux video + audio.
ffmpeg -y -hide_banner -loglevel error -i "$WORK/video.mp4" -i "$WORK/audio.m4a" \
    -c:v copy -c:a copy -shortest -movflags +faststart "$OUT"

echo "wrote $OUT"
