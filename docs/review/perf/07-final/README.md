# Stage 2, whole lane: d284eaa against dc0cb8f (magic-round2 at the start)

`ab.md`: two snapshots in two tabs of one headless Chrome, interleaved, 9 rounds of
5 frames per view, load average 4–9 (other agents on the GPU, so ratios only).
Whole frame (GPU drained) head/base 0.955–0.990, median 0.968: every view faster,
every IQR under 0.1. CPU side (JS + GL submission) 0.65–0.93, median 0.82. Sampled
allocation per frame −22% to −36%. Triangles and draw calls unchanged within noise
(the animal LOD only bites when a herd is 18+ m away; the views mostly have them
nearer or out of frame).

`diff-awake-noon.md`: stills of all six views with every gift awake, before and
after, land layer: mean absolute difference 0.01–0.35 of 255, the same as two runs
of one build. The heat maps (`*-diff.jpg`) show only things that animate on their
own between page loads: fireflies, the wisp's trail, the near-ground grass carpet.

Where the remaining CPU allocation is (sampled, per frame, not in this lane): the
cat's update (cat.js, ~35 KB), instance LOD repacking (instance-lod.js packDue /
chunkRange returning arrays and Math.hypot with many arguments, ~45 KB), penguins'
update (~30–55 KB, boxed numbers), surf.js (~9 KB), three's own sort and uniform
upload (~20 KB).
