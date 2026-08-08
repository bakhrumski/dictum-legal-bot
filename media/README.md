# Brand media

Rendered assets. Sources live in the repo, so anything here can be rebuilt —
do not hand-edit these files.

## Logo animation

Rendered from `public/logo-animation.html`, which is itself extracted verbatim
from the `#intro-overlay` block in `public/index.html`. Change the animation
there and re-render; the timings must stay in sync with the site.

| File | Format | Use |
|---|---|---|
| `juristai-logo-1080p60-sound.mp4` | 1920×1080 60fps H.264 + AAC | **Default.** General video use, award submission |
| `juristai-logo-square-1080-sound.mp4` | 1080×1080 60fps H.264 + AAC | Instagram / square social |
| `juristai-logo-1080p60.mp4` | 1920×1080 60fps H.264, silent | When the edit supplies its own audio bed |
| `juristai-logo-square-1080.mp4` | 1080×1080 60fps H.264, silent | Square, silent |
| `juristai-logo-alpha.webm` | 1920×1080 60fps VP9 **yuva420p**, silent | Overlay on footage (carries alpha) |
| `juristai-sting.wav` | 48kHz stereo PCM | The audio alone, for an editor to place freely |

Duration 3.23s: entrance 2.3s → fade-out 0.65s → ~0.25s empty tail.

MP4/H.264 cannot carry an alpha channel that editors read reliably, which is
why the transparent variant is WebM. If an editor rejects it, re-render to
ProRes 4444 or a PNG sequence instead.

## Audio

Synthesized by `scripts/render-logo-audio.sh` from ffmpeg sine and noise
sources — **no licensed track**, so there is nothing to clear before using
this in a submission, an ad, or a store listing.

Cues land on the animation beats:

| Time | Sound | Visual |
|---|---|---|
| 0.05 / 0.20 / 0.35s | three soft air swells (pink noise, lowpassed) | the rings drawing in |
| 0.90s | warm chime — A4 with 2nd/3rd partials, exponential decay | the "J" appears |
| 1.25s | quiet high ping (E6) | the diamond |
| 1.50s | A-major chord swell (A2–A3–C♯4–E4) | the wordmark |
| 2.75s | fade out | with the visual fade |

Delivered at **−3.0 dBFS peak** (≈ −10.5 LUFS integrated). That is a normal
standalone-sting level with headroom for an editor to place it; duck it under
a voiceover rather than using it as-is in a mixed edit.

Two level traps are handled in the script and worth knowing if you edit it:
ffmpeg's `sine` generator peaks near −18 dBFS while `anoisesrc` peaks near
0 dBFS, so tonal elements are lifted 18 dB before mixing — without that the
background ring swells sit at the same level as the hero chime. Master level
is set by an explicit gain, with `alimiter` only as a safety net.

## Re-rendering

Frames are captured by scrubbing the Web Animations API — every animation is
paused and `currentTime` set to an exact offset before each screenshot —
rather than screen-recording. Screen recording yields whatever frames the
compositor happened to produce (dropped frames, uneven spacing); scrubbing is
deterministic and reproducible. Fonts are awaited before frame 0, otherwise
the first frames render the wordmark in the Georgia fallback and visibly swap
to Source Serif mid-animation.

Requires `playwright-core` + `ffmpeg-static` (dev-only, not project deps) and
the Chromium at `PLAYWRIGHT_BROWSERS_PATH`:

```bash
# 1. frames  (env: W H FPS SIZE HOLD_MS FADE_MS TAIL_MS TRANSPARENT)
FPS=60 SIZE=720 node render.js public/logo-animation.html frames

# 2. MP4
ffmpeg -framerate 60 -i frames/%05d.png \
       -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
       -movflags +faststart juristai-logo-1080p60.mp4

# 3. transparent WebM  (render frames with TRANSPARENT=1 first)
ffmpeg -framerate 60 -i framesA/%05d.png \
       -c:v libvpx-vp9 -pix_fmt yuva420p -crf 24 -b:v 0 -auto-alt-ref 0 \
       juristai-logo-alpha.webm

# 4. square crop from the 1920×1080 frames
ffmpeg -framerate 60 -i frames/%05d.png -vf "crop=1080:1080:420:0" \
       -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
       -movflags +faststart juristai-logo-square-1080.mp4
```

```bash
# 5. sting + mux (synthesizes the audio and muxes it, copying the video stream)
scripts/render-logo-audio.sh <ffmpeg> juristai-logo-1080p60.mp4 \
                             juristai-logo-1080p60-sound.mp4 juristai-sting.wav
```

Scripts: `scripts/render-logo-animation.js`, `scripts/render-logo-audio.sh`.
