# perf A/B: 6ae4ac4 against 621a9a3 (2026-11-14T18:29:21.028Z)

Two tabs, one headless Chrome, 1440x900 dpr 2, interleaved K=5 × 13. Ratio = median of per-round head/base time: whole frame (GPU drained), and CPU (JS + GL submission). Load: { 12.37 19.76 20.79 }.

| gifts | time | view | frame head/base | IQR | CPU head/base | IQR | triangles | calls | geometries | programs | alloc B/frame |
|---|---|---|---|---|---|---|---|---|---|---|---|
| asleep | 750 | home | 1.007 | 0.125 | 0.835 | 0.178 | 1106364 → 1106280 | 266 → 264 | 355 → 313 | 56 → 54 | 411605 → 420980 |
| asleep | 750 | beacon | 1.029 | 0.179 | 0.944 | 0.321 | 1678933 → 1888320 | 202 → 224 | 769 → 771 | 60 → 58 | 479525 → 416695 |
