# Lifetime, 15 minutes (fresh headless Chrome, seed 1847, HEAD 099c448)

The quest played round and round: teleport beside the nearest sleeping keepsake,
walk in, wait out its ceremony; after the finale "begin again"; between ceremonies
run, meow, jump, and switch day/night. 59 ceremonies, 8 full quest loops, no page
errors.

No leak. After GC the JS heap rises 29.7 → 36 MB in the first two minutes (LOD
levels, programs and shaders seen for the first time) and then stays at 37–39 MB
for the remaining 13 minutes. Scene objects constant (1,643: no ceremony leaves
objects behind). Listeners 53–69 and DOM nodes 373–376, flat. WebGPU buffers (12)
and textures (20) constant. WebGL geometries, buffers and VAOs climb as vegetation
chunk levels are first drawn (geometries 302 → 1,387 by minute 2) and then creep
toward the finite set of chunk levels (1,483 at minute 15, +7% over 13 minutes and
flattening): a bounded first-use cost, not a per-ceremony leak. Programs 77 from
minute 2 on. The 488 MB death was not reproduced. (WebGPU pipeline creation was not
counted in this run: the app creates pipelines async; the counter now wraps the
async calls too.)
