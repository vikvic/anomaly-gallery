# Anomaly Gallery

Find what should not be there, in paintings that have been quietly altered.
<img width="620" height="785" alt="image" src="https://github.com/user-attachments/assets/17e6ee42-684e-4031-ac46-51ff335d7870" />


![A grafted eye on a Dutch still life, mid-round](docs/screenshot.png)

-->

[**Play it →**](https://vikvic.github.io/anomaly-gallery/)

Nine public-domain works are loaded and five are hung, one at a time. Each one
carries a single anomaly — a human eye grafted onto fruit, a mouth where no
mouth belongs, a face warped past where a face can go. Thirty seconds apiece.

The four spare works are not shown. They exist so that every op has an eligible
host on a bad draw — see **Assets** below.

**Nothing is generated.** Every anomaly is a deterministic pixel operation over
the painting's own paint, which has two consequences that matter:

- The answer key is **exact by construction**. The game knows where the anomaly
  is because it put it there — no detection, no guessing, no unsolvable levels.
- The edit **keeps the medium**. Warped paint is still oil paint: the craquelure,
  the palette, the varnish and the brush direction all survive, because pixels
  are being moved rather than synthesised. A diffusion model fights you on this;
  a warp gets it for free.

---

## The operations

| Op | What the player sees | Requires |
|---|---|---|
| **graft** | An eye or mouth, harvested from a real portrait in the same gallery, sitting on a piece of fruit | a blob target |
| **rictus** | Mouth corners dragged past where a face can go | a detected face |
| **drift** | One eye pulled out of alignment with the other | a detected face |
| **elongate** | The jaw drawn down | a detected face |

The graft donor is always one of the loaded paintings — hung or spare — so the
eye arrives already carrying the right period, palette and varnish.

Three things make a graft sit *in* a surface rather than on it: a spherical warp
so it curves with the fruit, a multiply of the host's own luminance gradient so
it obeys the painting's lighting, and a soft crease ring where lid meets flesh.

**Calibration note:** the effect lives in a narrow band. Too subtle and it reads
as a smudge; too strong and it reads as a filter rather than as something wrong.
Graft width is clamped to 5.5–14% of the canvas width for exactly this reason —
34–87px against the current 620px canvas.

---

## Pages

| File | |
|---|---|
| `index.html` | **The game** — five paintings, one at a time, 30s each. Served at the site root |
| `labs.html` | How it works — links to the three labs below |
| `eye-graft.html` | Eye harvest and graft, with live sliders |
| `ops-lab.html` | Clone and removal ops, with per-op timings |
| `painterly-lab.html` | Whether a photo can be pushed into the paintings' domain well enough for the ops to land |
| `curate.html` | Build-time asset curation — see **Assets** below |

The two technical pages are reachable from the game's header and exist for
checking the image operations in isolation. `curate.html` is a build tool and is
not linked from the game.

---

## Assets

Paintings come from Wikimedia Commons, filtered to public domain / CC0.
They are **vendored into `assets/`** rather than fetched live — Commons
rate-limits browser traffic hard, and a shipped build that depends on it will
fail under any real use.

```bash
# 1. download (~140 files, ~53 MB at 1000px)
node fetch-assets.mjs --dry      # discover only
node fetch-assets.mjs

# 2. analyse and curate
npx serve .
#    open http://localhost:3000/curate.html
#    Analyse all -> Drop unusable -> Export -> save over assets/manifest.json
```

Curation is not optional. Face detection fires on roughly **64%** of paintings
returned by a "portrait" search — the misses are genre scenes with small or
profile faces. Blob targeting, measured over the 36 vendored still lifes at the
game's own 620px canvas, finds *some* target on **97%** of them but one large
enough to actually host a graft on **78%**. Those are different numbers and the
second is the one that matters. So the fetcher over-fetches and the curator
rejects: ~140 downloaded ≈ 100 usable.

Curating writes `hasFace`, `graftable` and normalised `blobs` into the manifest,
so the game never runs a distance transform at load time and never selects a
painting whose detection would fail.

`curate.html` must stay in step with the game: it analyses at the same 620px
width, and its targeting is the game's `findBlobs` verbatim. An earlier version
ran its own single-best search at 470px and produced 27 graftable targets where
the live path produces 28 — and since a precomputed blob short-circuits the live
search, curating would have *degraded* the thing it exists to guarantee.

**Mix:** a round uses 3 portraits + 2 still lifes, so the pool is weighted the
same way. Portraits carry the three face warps and donate the eyes; still lifes
carry the grafts. Portraits make poor graft targets — they are mostly fabric and
dark ground, with nothing round to sit an eye on.

---

## Performance

Measured, not estimated:

| | |
|---|---|
| Face landmarks (478 pts) | ~24 ms per painting |
| Targeting (detector + saliency) | ~75 ms |
| Clone | 1–7 ms |
| Removal (patch 9, step 1) | 23–43 ms |
| Graft | ~20 ms |
| **Full 5-painting round** | **~0.5 s** |

Against the 30-second round clock, generation is free. The network is the only
real cost.

---

## Deployment

See [DEPLOY.md](DEPLOY.md). Short version: GitHub Pages via the Actions workflow
in `.github/workflows/deploy.yml`, with Route 53 pointing at it by A record.

---

## Credits

Paintings: [Wikimedia Commons](https://commons.wikimedia.org), public domain.
Face landmarks: [MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).
Everything else is plain canvas pixel work.
