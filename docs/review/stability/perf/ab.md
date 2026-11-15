# perf A/B: 6c9c9a3 against b00fa07 (2026-11-15T06:58:20.306Z)

Two tabs, one headless Chrome, 1440x900 dpr 2, interleaved K=5 × 9. Ratio = median of per-round head/base time: whole frame (GPU drained), and CPU (JS + GL submission). Load: { 15.50 17.97 18.77 }.

| gifts | time | view | frame head/base | IQR | CPU head/base | IQR | triangles | calls | geometries | programs | alloc B/frame |
|---|---|---|---|---|---|---|---|---|---|---|---|
| asleep | 750 | home | 0.834 | 0.048 | 1.13 | 0.163 | 1060434 → 1060434 | 258 → 258 | 343 → 307 | 94 → 94 | 297141 → 362056 |
| asleep | 750 | milkwood | 0.85 | 0.044 | 0.994 | 0.113 | 1412662 → 1405372 | 190 → 187 | 533 → 503 | 95 → 95 | 286405 → 409626 |
| asleep | 750 | beacon | 0.828 | 0.014 | 0.874 | 0.185 | 1864139 → 1871221 | 228 → 227 | 680 → 650 | 95 → 95 | 257071 → 329406 |
| asleep | 750 | sea | 0.817 | 0.02 | 1.094 | 0.258 | 463227 → 463043 | 60 → 59 | 690 → 660 | 95 → 95 | 229774 → 314180 |
