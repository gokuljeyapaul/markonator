#!/usr/bin/env bash
# Generate a voiced promo video for YouTube:
#   - intro card (branded marquee tile) + peppy music
#   - 8 app-demo scenes with neural voice-over + calm music
#   - outro card (branded marquee tile) + peppy music
# Renders a 1920x1080 H.264 MP4.
#
# Needs the edge-tts Python tool (set $EDGE_TTS; default .venv/bin/edge-tts) and
# network access for the one-time voice synthesis. Cross-platform.
#
# Usage: scripts/make-promo-voiced.sh <screenshots-dir> <out.mp4> [brand.png]
# Env: EDGE_TTS, VOICE (default en-US-AriaNeural), RATE (default +0%).
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "usage: $0 <screenshots-dir> <out.mp4> [brand.png]" >&2
    exit 1
fi

SRC="$1"
OUT="$2"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
EDGE_TTS="${EDGE_TTS:-.venv/bin/edge-tts}"
VOICE="${VOICE:-en-US-AriaNeural}"
RATE="${RATE:-+0%}"
BRAND="${3:-promo/marquee.png}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/frames"

INTRO_HOLD=3.5
OUTRO_HOLD=5.0
PAD=0.4

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
INTRO_TEXT="Markonator."
OUTRO_TEXT="Markonator. Markdown, annotator. Find it on Google Chrome Web Store and Github."

scale1920() { # $1 in $2 out
    ffmpeg -y -hide_banner -loglevel error -i "$1" \
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0d1117" \
        -frames:v 1 "$2"
}

# Retry the (free, sometimes rate-limited) edge-tts endpoint a few times.
tts() {
    local text="$1" out="$2" n=0
    until "$EDGE_TTS" --voice "$VOICE" --rate "$RATE" --text "$text" --write-media "$out"; do
        n=$((n + 1)); [ "$n" -ge 4 ] && { echo "edge-tts failed after $n tries" >&2; return 1; }
        echo "edge-tts retry $n ..." >&2; sleep 2
    done
}
voicewav() { # $1 text $2 out.wav
    tts "$1" "$WORK/_t.mp3"
    ffmpeg -y -hide_banner -loglevel error -i "$WORK/_t.mp3" -ar 44100 -ac 1 -c:a pcm_s16le "$2"
}
silence() { # $1 seconds $2 out.wav
    ffmpeg -y -hide_banner -loglevel error -f lavfi -i "anullsrc=r=44100:cl=mono" -t "$1" -c:a pcm_s16le "$2"
}
dur_of() { ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$1"; }

# Pre-scale frames + brand tile to 1920x1080.
i=0
for s in "${SCENES[@]}"; do
    scale1920 "$SRC/${s%%|*}" "$WORK/frames/f$i.png"; i=$((i + 1))
done
scale1920 "$BRAND" "$WORK/frames/brand.png"

# Generate demo voice clips, durations, and the demo audio/video lists.
VDUR="$WORK/vlist.txt"; : > "$VDUR"
ADEMO="$WORK/ademo.txt"; : > "$ADEMO"
DEMO_TOTAL=0
i=0
for s in "${SCENES[@]}"; do
    voicewav "${s#*|}" "$WORK/v$i.wav"
    d=$(dur_of "$WORK/v$i.wav")
    dur=$(awk "BEGIN{printf \"%.3f\", $d + $PAD}")
    echo "file '$WORK/frames/f$i.png'" >> "$VDUR"
    echo "duration $dur" >> "$VDUR"
    echo "file '$WORK/v$i.wav'" >> "$ADEMO"
    echo "file '$WORK/pad.wav'" >> "$ADEMO"
    DEMO_TOTAL=$(awk "BEGIN{printf \"%.3f\", $DEMO_TOTAL + $dur}")
    i=$((i + 1))
done
echo "DEMO total: ${DEMO_TOTAL}s"

# Intro + outro voice + matching silence to fill their card holds.
voicewav "$INTRO_TEXT" "$WORK/vintro.wav"
ID=$(dur_of "$WORK/vintro.wav")
INTRO_SIL=$(awk "BEGIN{printf \"%.3f\", ($INTRO_HOLD - $ID) * (($INTRO_HOLD > $ID) + 0)}")
voicewav "$OUTRO_TEXT" "$WORK/voutro.wav"
OD=$(dur_of "$WORK/voutro.wav")
OUTRO_SIL=$(awk "BEGIN{printf \"%.3f\", ($OUTRO_HOLD - $OD) * (($OUTRO_HOLD > $OD) + 0)}")

silence "$PAD" "$WORK/pad.wav"
silence "$INTRO_SIL" "$WORK/intro_sil.wav"
silence "$OUTRO_SIL" "$WORK/outro_sil.wav"

TOTAL=$(awk "BEGIN{printf \"%.3f\", $INTRO_HOLD + $DEMO_TOTAL + $OUTRO_HOLD}")
FADEOUT=$(awk "BEGIN{printf \"%.2f\", $TOTAL - 2}")
echo "TOTAL: ${TOTAL}s"

# Narration track: intro voice + intro silence + demo (voices+pads) + outro voice + outro silence.
ALIST="$WORK/alist.txt"
{
  echo "file '$WORK/vintro.wav'"; echo "file '$WORK/intro_sil.wav'"
  cat "$ADEMO"
  echo "file '$WORK/voutro.wav'"; echo "file '$WORK/outro_sil.wav'"
} > "$ALIST"
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$ALIST" -c:a pcm_s16le "$WORK/narration.wav"

# Music beds.
gen_peppy() { # $1 duration $2 out
    local D=$1 out=$2 f
    f=$(awk "BEGIN{printf \"%.2f\", $D-1}")
    ffmpeg -y -hide_banner -loglevel error \
        -f lavfi -i "sine=f=220:duration=$D" -f lavfi -i "sine=f=277.18:duration=$D" -f lavfi -i "sine=f=329.63:duration=$D" \
        -filter_complex "[0]tremolo=f=2.4:d=0.45,lowpass=f=1800[a];[1]tremolo=f=2.4:d=0.45,lowpass=f=1800[b];[2]tremolo=f=3:d=0.4,lowpass=f=2200[c];[a]volume=0.5[a2];[b]volume=0.5[b2];[c]volume=0.45[c2];[a2][b2][c2]amix=inputs=3,afade=t=in:st=0:d=0.4,afade=t=out:st=$f:d=1,volume=0.2" \
        -c:a pcm_s16le "$out"
}
gen_calm() { # $1 duration $2 out
    local D=$1 out=$2 f
    f=$(awk "BEGIN{printf \"%.2f\", $D-2}")
    ffmpeg -y -hide_banner -loglevel error \
        -f lavfi -i "sine=f=110:duration=$D" -f lavfi -i "sine=f=164.81:duration=$D" \
        -filter_complex "[0]tremolo=f=0.15:d=0.25,lowpass=f=700[a];[1]tremolo=f=0.2:d=0.3,lowpass=f=700[b];[a]volume=0.6[a2];[b]volume=0.5[b2];[a2][b2]amix=inputs=2,afade=t=in:st=0:d=1,afade=t=out:st=$f:d=2,volume=0.15" \
        -c:a pcm_s16le "$out"
}
gen_peppy "$INTRO_HOLD" "$WORK/peppy_in.wav"
gen_calm "$DEMO_TOTAL" "$WORK/calm.wav"
gen_peppy "$OUTRO_HOLD" "$WORK/peppy_out.wav"
MLIST="$WORK/mlist.txt"
{ echo "file '$WORK/peppy_in.wav'"; echo "file '$WORK/calm.wav'"; echo "file '$WORK/peppy_out.wav'"; } > "$MLIST"
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$MLIST" -c:a pcm_s16le "$WORK/music.wav"

# Mix narration (full) + music (quiet) -> stereo AAC.
ffmpeg -y -hide_banner -loglevel error -i "$WORK/narration.wav" -i "$WORK/music.wav" \
    -filter_complex "[0]aformat=channel_layouts=stereo,volume=1.0[n];[1]aformat=channel_layouts=stereo,volume=1.0[m];[n][m]amix=inputs=2:duration=longest:normalize=0" \
    -c:a aac -b:a 192k "$WORK/audio.m4a"

# Video: intro card -> demo frames -> outro card.
VLIST="$WORK/vlist2.txt"
{
  echo "file '$WORK/frames/brand.png'"; echo "duration $INTRO_HOLD"
  cat "$VDUR"
  echo "file '$WORK/frames/brand.png'"; echo "duration $OUTRO_HOLD"
  echo "file '$WORK/frames/brand.png'"
} > "$VLIST"
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$VLIST" \
    -vf "fps=25,setsar=1" -c:v libx264 -pix_fmt yuv420p -preset medium "$WORK/video.mp4"

# Mux.
ffmpeg -y -hide_banner -loglevel error -i "$WORK/video.mp4" -i "$WORK/audio.m4a" \
    -c:v copy -c:a copy -shortest -movflags +faststart "$OUT"

echo "wrote $OUT"
