# Ground shader diet (forest.js GROUND_COLOUR_GLSL)

Exact early-outs only: every skipped noise was multiplied by zero or faded to its
mean (0.5) by a smoothstep that had already reached 1. No look change by
construction; the pixel diff (land layer, same views, `scripts/perf.mjs shots` /
`diff`, base 7a66546) is at the harness's noise floor everywhere (diff.md); the
heat maps show zero on ground pixels, the residue is the wisp's glow, the near-ground
grass carpet and the cat (things that are not frozen between two page loads).

| pixel class | dNoise evaluated before | after |
|---|---|---|
| far hill (~25 m, scrub + sward + soil) | 17 | 9 |
| mid inland (~8 m, sward + soil) | 10 | 5 |
| near dry beach (~2.5 m) | 6 + zone terms | unchanged |

Skips: the two grain octaves past their fade; ripple off the dry band; the damp band
outside 1–4.8 m inland; the strandline (2 noises) outside 2.65–6.55 m; its bits and
shells past their fade; sward strokes; scrub clump octaves c1–c4; sour-fig f1, f2 and
lobes past their fade (new `dNoiseFade`).
