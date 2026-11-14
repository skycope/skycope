# perf A/B: c6290f0+dirty against 7a66546 (2026-11-14T18:20:36.912Z)

Two tabs, one headless Chrome, 1440x900 dpr 2, interleaved K=5 × 13. Ratio = median of per-round head/base whole-frame time. Load: { 29.33 29.94 22.23 }.

| gifts | time | view | head/base | IQR | triangles | calls | geometries | programs | alloc B/frame |
|---|---|---|---|---|---|---|---|---|---|
| asleep | 750 | home | 0.9544 | 0.10529999999999999 | 1106280 → 1106280 | 264 → 264 | 355 → 313 | 56 → 54 | 426398 → 480439 |
| asleep | 750 | milkwood | 1.0314 | 0.2029 | 1558784 → 1513591 | 183 → 180 | 687 → 695 | 61 → 59 | 509762 → 437068 |
| asleep | 750 | beacon | 0.888 | 0.1281 | 1891127 → 1885346 | 226 → 224 | 902 → 857 | 61 → 61 | 418977 → 414648 |
| asleep | 750 | lighthouse | 0.9943000000000001 | 0.20120000000000002 | 1024774 → 1032926 | 116 → 117 | 1029 → 981 | 61 → 61 | 307118 → 334586 |
