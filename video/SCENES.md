# Scene contract (read before writing a scene)

The video for *No Off Switch* (assets/audio.m4a, 220.7 s, ~131.6 BPM) is rendered by `video/src/engine.js` with three.js 0.160.
Each visual world is a **scene module** in `video/src/scenes/<name>.js`. The timeline (`video/src/timeline.js`) cuts between
shots; each shot names a scene plus a `mode` and `variant`. The engine renders the shot into a 1920×1080 render target,
then a post pass (`video/src/post.js`) either dithers it to pure black/white with a 4×4 Bayer matrix (cell size usually
3 px, so the 17 characteristic patterns are visible) or shows it in full colour. Lyrics are drawn on top by the engine
in the bottom ~200 px; keep the subject above y ≈ 860 px.

## Module shape

```js
// video/src/scenes/<name>.js  (ES module; `import * as THREE from 'three'` and 'three/addons/...' work)
export const meta = { modes: ['solo', 'swarm'], variants: 24 };   // documentation for the timeline author
export async function create(ctx) {
  // ctx = { THREE, renderer, width: 1920, height: 1080, base }   base = URL of the repo root (assets/ lives there)
  // Build everything expensive here (or lazily, cached by variant). Called once at load.
  return {
    scene, camera,             // A: engine calls renderer.render(scene, camera) into its render target, or
    // render(renderer, target) // B: draw it yourself into `target` (a THREE.WebGLRenderTarget), or
    // canvas                   // C: your own canvas (own GL context, preserveDrawingBuffer: true); uploaded after update()
    update(t, shot) { ... },   // called once per frame, right before rendering
  };
}
```

`shot` passed to `update` contains:

| field | meaning |
|---|---|
| `t` | song time in seconds (same as the first argument) |
| `mode`, `variant`, `seed` | from the timeline; `variant` is an integer index into your "many types" |
| `lt`, `dur`, `p` | seconds since the shot started, shot length, `lt / dur` |
| `beat` | `{ bpm, period, index, phase, pulse, bar, barPhase }`; `pulse` is 1 on each beat and decays |
| `energy` | 0..1 smoothed loudness of the song |
| `onset` | 0..~1.5 onset strength (drum hits) at t |
| `sing` | 0..1, 1 while the vocalist pronounces a word |
| `word`, `line` | the current word and lyric line (`line.sec` is the section name: Verse 1, Chorus, Bridge, ...) |
| `dither` | whether this shot will be dithered |

## Rules

- **Determinism.** The same `(t, shot)` must give the same image no matter which frames were rendered before, because
  the renderer seeks around (contact sheets, parallel workers). Animate as a function of `t`/`lt`. No `Math.random()`
  at update time; use a seeded RNG keyed by `variant`/`seed`. Caching built meshes per variant is fine. If a
  simulation truly needs stepping, precompute it at create time (or lazily, cached) and index it by time.
- **Speed.** Aim for under ~60 ms per frame (live playback) and never over ~400 ms. Switching variant may cost more
  once (build), but keep a variant build under ~300 ms and cache it.
- **Same scene, different shot.** Consecutive shots of the same scene are hard cuts; a dissolve renders two different
  scenes in the same frame, so never share mutable state between scene modules.
- **The 1-bit look.** Dithered shots lose colour and fine detail. Design for it: dark background, strong key light
  and rim light, big readable silhouettes, clear tonal separation between subject and background, avoid large areas
  of the same mid grey. Check both `dither=1` and `dither=0` if your scene is used both ways.
- **No UI.** Never show the experiment's parameters, panels, labels or HUD text.
- Don't modify files outside your scene (`video/src/scenes/<name>.js` plus an optional folder
  `video/src/scenes/<name>/` for helpers). If a shared file needs a change, say so in your report.
- No network at render time beyond what's in the repo: three.js comes from node_modules via the import map.

## Checking your work (run from the repo root)

```
node video/render.mjs --q="scene=queen&mode=sing&variant=3" --sheet=0.5,4,8,12,16,20 --out=out/check/queen_a.jpg
node video/render.mjs --q="scene=queen&mode=sing&variant=3&dither=0" --stills=10 --out=out/check/queen_full
node video/render.mjs --q="scene=queen&mode=sing&variant=3" --clip=74:84 --out=out/check/queen.mp4
```

With `scene=` the whole song is one shot of that scene starting at t = 0, so `t` is song time (beat, energy, sing and
word all work, e.g. the first chorus is at 74.5–88 s). The sheet prints ms per frame. Open the JPEGs with the Read tool
and look hard: is the subject readable in black and white at 640 px wide? Does it move to the music?
