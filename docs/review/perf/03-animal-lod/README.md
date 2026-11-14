# Animal LOD (animal-forms.js herdBounds `coarse`)

Each herd draws a decimated body (the same sculpt, capped by `formGeometry(kind,
{ coarse: N })`) once its nearest member is past `far` metres from the eye, with 3 m
of hysteresis. The two geometries share every instance buffer: the module writes
one set, the switch is a pointer swap, no extra draw call.

| animal | near triangles | coarse | far (m) | herd |
|---|---|---|---|---|
| penguin | 2,072 | 413 | 18 | 14 → −23k triangles |
| seal | 2,132 | 548 | 26 | 5 → −8k |
| whale | ~1,700 | ~400 | 45 | 1 |
| tortoise | ~1,200 | ~300 | 16 | 1 |
| oystercatcher | ~900 | ~260 | 16 | 2 |

Same frame, fine vs coarse body, just past the switch (reduced motion, nothing else
changes): penguins at 27 m 0.02% of pixels differ by more than 8/255 (585 px, the
crops are indistinguishable by eye); seals at 34 m 0.009% (270 px). Frame triangles
841,858 → 825,712 and 1,459,234 → 1,444,234 in those views. Measured with
`animallod.mjs` (here).
