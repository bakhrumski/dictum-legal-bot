# Brand media

Rendered assets. Sources live in the repo, so anything here can be rebuilt —
do not hand-edit these files.

## Logo animation

Rendered from `public/logo-animation.html`, which is itself extracted verbatim
from the `#intro-overlay` block in `public/index.html`. Change the animation
there and re-render; the timings must stay in sync with the site.

| File | Format | Use |
|---|---|---|
| `juristai-logo-1080p60.mp4` | 1920×1080, 60fps, H.264 yuv420p | General video use, award submission |
| `juristai-logo-square-1080.mp4` | 1080×1080, 60fps, H.264 yuv420p | Instagram / square social |
| `juristai-logo-alpha.webm` | 1920×1080, 60fps, VP9 **yuva420p** | Overlay on footage (carries alpha) |

Duration 3.23s: entrance 2.3s → fade-out 0.65s → ~0.25s empty tail.

MP4/H.264 cannot carry an alpha channel that editors read reliably, which is
why the transparent variant is WebM. If an editor rejects it, re-render to
ProRes 4444 or a PNG sequence instead.

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

`render.js` is in `scripts/render-logo-animation.js`.
