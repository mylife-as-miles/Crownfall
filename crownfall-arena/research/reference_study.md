# Crownfall VR — Reference Study & Target Look Spec (pass 02)

Prepared 2026-10-23 for the Blender build (scene file reports Blender 5.2.3 LTS). It builds on, and does not repeat, `work/environment_art_direction.md` and `work/environment_reviews/pass01_review.md`. Every number marked **[M]** was measured by `research/measure_refs.py` → `research/ref_metrics.json`. Numbers marked **[I]** are my inference or recommendation, not measurements.

## 0. Evidence: what was actually viewed

- **User images viewed with Read:** `01_REF_primary_frontal_concept.png`, `02_REF_primary_elevated_concept.png`, `03_codex_pass01_render.png`, `04_REF_secondary_hell_courtyard.png`, `00_codex_viewport_current.png` (Blender UI screenshot, so its metrics are polluted by UI and are not used), `environment_reviews/pass01_seated.png`.
- **Game refs:** I downloaded 65 official Steam store screenshots (publisher-supplied, listed by the Steam `appdetails` API) and reviewed them as contact sheets. I selected 20 and viewed each at full size: 4 E33, 5 Elden Ring/SotE, 4 Crimson Desert, 4 Avatar FoP, 3 Black Myth (Steam lists only 6 for it). Provenance is in `game_refs/SOURCES.json`. These are for reference study only, not for redistribution or use in assets.
- **Not accessed:** publisher press kits (Steam was enough, and it is official). I did not use fan sites or wikis.
- **Caveat:** both primary references are concept paintings with loose perspective. In the frontal ref the board frame converges at a far/near ratio of 0.55 while the playfield converges at 0.79, which is impossible. Where they conflict I state the range and which value I followed.

---

## 1. Measured diagnosis: where pass01 deviates

Luma is Rec.709 weights on sRGB-encoded pixels, 0–1, display-referred. Measure the final PNG with the same script.

| Metric [M] | 01 frontal REF | 02 elevated REF | **03 Codex pass01** | Verdict |
|---|---|---|---|---|
| luma p5 / p25 / p50 | 0.062 / 0.163 / 0.276 | 0.069 / 0.143 / 0.233 | **0.168 / 0.282 / 0.335** | Black floor 2.7× too high; everything is lifted |
| luma p75 / p95 | 0.445 / 0.651 | 0.370 / 0.690 | 0.429 / 0.627 | Highlights are roughly right |
| RMS contrast (σ luma) | 0.190 | 0.189 | **0.139** | 27% too flat |
| pixels with luma < 0.08 | 7.6% | 7.3% | **0.0%** | No true darks at all |
| mean HSV saturation | 0.244 | 0.268 | **0.177** | 30% too grey |
| warm saturated pixels (red-yellow hue, S > 0.35) | 14.9% | 17.5% | **2.2%** | 7× too little heat |
| cool-tinted pixels (hue 150–260°) | 10.3% | 7.9% | **28.9%** | 3× too much teal-grey |
| luma histogram, bins of 0.1 | 11/23/20/15/12/11/5/2/1/0 % | 12/30/23/14/8/6/3/3/2/1 % | **0/11/20/40/15/8/3/2/1/0 %** | Midtones piled into 0.3–0.4 |

**3×3 value map** [M], mean luma per cell. Rows are top/middle/bottom; columns are left/centre/right.

```
REF 01 frontal          CODEX pass01            delta needed
0.25  0.48  0.33        0.37  0.48  0.36        -0.12   0    -0.03
0.22  0.48  0.34        0.36  0.32  0.34        -0.14 +0.16   0
0.20  0.33  0.20        0.31  0.46  0.27        -0.11 -0.13 -0.07
(bottom corners S=0.47) (bottom corners S=0.17-0.20)
```

The reference is a **light funnel**: a bright hazy centre column (0.48) between dark, warm, saturated corners. Pass01 inverts it. Its centre is dark because the flat black lava plane sits behind the board, its corners are too light, and its pale altar floor makes the bottom-centre bright.

**Per-element inversions** [M] (region medians; boxes are in `measure_refs.py`):

| Element | REF luma | Codex luma | Problem |
|---|---|---|---|
| Sky haze behind monuments | 0.58 (#97938b) | 0.32 (#55605b) | Sky is far too dark and too green |
| Eclipse disc | 0.25 (#424041), darker than its sky | **0.49 (#837c64), lighter than its sky** | Disc must read darker than the air around it |
| Altar/ring stone | 0.25 (#404034) | **0.70 (#b6b29f)** | 2.8× too bright; it competes with the board's light squares |
| Skull | shadow 0.19, mid 0.26–0.43, lit 0.66–0.71 | median 0.60 | 1.5–2.3× too bright and evenly lit |
| Hand | 0.19–0.24 median | 0.41–0.50 | 2× too bright |
| Lava | crust < 0.05 on 33% of pixels, mid 0.19, cracks 0.30–0.55 | uniform 0.33–0.43 (#b04e33) | No crust and no value range, so it reads as a flat decal |
| Board light / dark squares | 0.77–0.86 / 0.22–0.27 | (similar) | OK. Keep as the strongest contrast pair in the lower half |

---

## 2. Per-game techniques → rules for this scene

### Clair Obscur: Expedition 33 (Sandfall / Kepler)

1. **One swept drift direction for every floating fragment** (`E33_01_floating_shards_bent_tower.jpg`). The big slabs are elongated, tilted 20–40° off vertical, and all drift along one lower-left→upper-right diagonal. Each trails a comet tail of small chips. → Put our floating islands on **one arc**: skull crown (0.30, 0.30) → (0.42, 0.20) → eclipse rim (0.57, 0.22). Tilt each island's long axis tangent to that arc. Trail 10–25 chips per island toward the eclipse, with sizes in a 1 : 4 : 20 large/medium/small ratio.
2. **Architecture bent into a gesture** (`E33_01`). The tower is curved like a breaking wave and frames the sky. → No straight rib shafts. Each near rib gets one dominant C-curve that bows inward and frames the eclipse (see §4a).
3. **Sky split by colour temperature at the focal axis** (`E33_01`). The left sky is warm backlit cumulus (#bbb0a5), the right is cool slate (#636673), and the monument stands on the boundary. → Our ref does the same in mirror: the warm fire plume spills to the right of the eclipse (hand side), the skull side stays cool green-grey, and the boundary passes behind the board's centre line.
4. **Vortex density gradient around the sky event** (`E33_02_vortex_sky_flower_meadow.jpg`). Hundreds of fragments thicken toward the event and stretch tangentially, like a spiral. Near-black foliage frames the left edge (#211b13 is 25.8% of pixels [M]). → Within 1 eclipse diameter of the corona, place 3× the debris density used elsewhere. Rotate the chips so their long axes run tangent to the disc.
5. **Colossus dissolved in fog** (`E33_03_teal_fog_colossus_crimson_leaves.jpg`). The giant figure is only ~0.1 luma darker than the fog behind it, with soft edges. Full contrast is kept for the foreground (palette: #245777 33%, #141b1d 15% [M]). → The shadow side of the skull and hand must sit at most 0.15–0.25 luma below the fog behind them. Reserve black-level contrast for the altar, near ribs and lava banks.
6. **Crimson as a band on a boundary, not confetti** (`E33_04_crimson_band_teal_ground.jpg`). Saturated red ground cover runs as a continuous strip where the dark ground meets the misty background. → Crimson foliage follows **contours**: the altar lunette edges, rib bases, skull base and lava banks. Use bands 3–8× longer than they are wide, at 3 depths.

### Elden Ring + Shadow of the Erdtree (FromSoftware / Bandai Namco)

1. **The sky event lights the air around it** (`ER_01_erdtree_rays_ruined_arches.jpg`). The tree is the brightest mass, and its haze is lifted far beyond its silhouette (palette #dad5aa 8.5%, #b5b37d 8.7% around it; #152022 in the corners [M]). It casts 8–12 discrete ray shafts. → Fog within 1.5 eclipse diameters of the corona is lifted to luma 0.55–0.65 with a warm tint. Let 3–5 faint shafts escape through gaps in the plume. Use volumetric forward scattering or the Glare *Sun Beams* mode (§7).
2. **Ruin silhouettes repeated at 3 scales, aligned toward the event** (`ER_01`). Arches and towers repeat smaller as they recede. → Standing stones and monoliths come in 3 sizes (≈1:2:4) and sit on lines converging toward the space under the eclipse.
3. **Fog floor with readable tops** (`ER_02_fog_sea_spires_gold_trees.jpg`). A valley of fog hides every base; only spire tops carry detail. A dark rock outcrop anchors the bottom centre, and warm accents form a triangle across the frame. → A dense height-fog layer below altar level hides the abyss floor, mesh ends and the horizon line seen in pass01. Our warm triangle is the eclipse (top right), the left lava pool and the right lava pool.
4. **A dark sky event against bright backlight, with molten seams** (`ER_03_SOTE_shadow_tree_backlit_castle.jpg`). The shadow tree is a dark mass with glowing orange cracks running along its trunk. The top corners are dark and the centre bright, as in our grid. → Our black eclipse uses the same logic: a dark disc on bright haze. Add 2–3 thin molten seams in the plume that follow its curl.
5. **Glow only through gaps in a dark structure** (`ER_04_SOTE_burning_lattice_tower.jpg`). Fire is visible only between dark lattice members, and the outer faces stay dark (#ad371d and #eb9b39 are only 5.4% combined [M]). → Lava crust plates cover 60–70% of the lava area and stay dark. Emission lives only in cracks and at broken plate edges.
6. **A carved altar as panels, plain margins and offerings** (`ER_05_SOTE_carved_altar_candles.jpg`). Scroll-relief bands sit inside plain ashlar margins. The lintel is split down its centre. Candles cluster at the corners with wax drips. There are 3 stepped plinth tiers, and 59.6% of pixels are below luma 0.08 [M]. → The altar ring alternates carved panels with plain 15–20% margins, keeps one decisive central crack, and clusters offerings at the 4 lunettes.

### Crimson Desert (Pearl Abyss)

1. **Floating masses made of breaking blocks** (`CD_01_floating_block_shards_carved_plinth.jpg`). The levitating rocks are built from stacked rectangular blocks shedding cubic debris. Nearby carved stone has vertical fluting and stepped-fret panels, and the stepped plinth has wildflowers at its foot. → Island undersides show stacked strata and blocky fracture planes, never smooth cones. The stepped fret is compatible with the board's lozenge/chevron border (§4d).
2. **Concentric rings broken into displaced arc segments** (`CD_02_broken_concentric_rings_aerial.jpg`). Rings are partial arcs (≈25–40% missing), segments are separated by gaps and tilted, and chains tether fragments. → Break our outer altar lip into arc segments. Tilt 2–3 of them 5–15° outward and down toward the lava, and remove one completely (§4d).
3. **Sedimentary strata and fan clusters** (`CD_03_stratified_cliff_crystal_fans.jpg`). Horizontal beds have vertical joints and erosion pitting. Crystal sheaves radiate from a single root point. Scree at the base is graded large→small. → Islands get 4–7 strata bands with undercut shadow lines. Ferns and rib clusters radiate from one root point, like these sheaves.
4. **Accumulation plus drip logic** (`CD_04_snowcapped_ruin_floating_block.jpg`). Snow sits on every up-facing plane and icicles hang from every lip. → Moss follows the same logic: an up-facing mask (§7) plus hanging moss and root strands 5–30 cm (monument scale) off every overhang.

### Avatar: Frontiers of Pandora (Massive / Ubisoft)

1. **Hanging vegetation curtains from island lips** (`AFOP_03_floating_cliffs_hanging_vines.jpg`). Vines hang straight down from the top edge for 0.3–0.5 of the island's height. Background islands are lighter and bluer. → Every floating island gets 6–15 hanging roots or vines from its lip. Each step back in depth gains about +0.12 luma and loses 30% saturation.
2. **Undercut shadow line under every stratum** (`AFOP_02_stratified_rock_arches.jpg`). Each rock sheet has a dark band under its overhang, 15–25% of the layer's height, and that is what conveys scale (palette #393d40 33% [M]). → Basalt and island strata need real geometric overhangs, not texture stripes.
3. **One accent colour repeated at decreasing size into depth** (`AFOP_01_crimson_canopy_heath_depth.jpg`). Red canopies appear at 4+ depths as a colour path, and vegetation shadows go violet-dark, not black. → Repeat crimson clumps at the altar (FG), skull base (MG) and a distant ledge (BG), losing saturation with distance. Shadows in crimson go to #280e0e, never to grey.
4. **Shelf fungi tiers and a partially occluded sky disc** (`AFOP_04_bracket_fungi_mossy_trunks_sky_disc.jpg`). Bracket fungi step up the mossy trunks, and the giant disc is partly hidden behind foliage with a soft halo. → Add tiered shelf fungi on the hand's forearm and on broken rib stumps. Let one floating island or rib tip overlap ≤10% of the eclipse disc to lock it in depth.

### Black Myth: Wukong (Game Science)

1. **Pale bone against near-black, plus a scale ladder** (`BMW_03_giant_bone_creature_dark.jpg`). Long, tapered, curved spines with knobbed joints radiate from the body. The ground is littered with human-scale skulls and ribcages, and there is one localised red haze (#1b1d1b is 47% of pixels [M]). → Rib bases get condyle-like swellings. Scatter 5–8 human-scale bone fragments at the outer altar rubble as a scale ladder (never on the board). Use one localised red haze volume over each lava pool.
2. **Erosion that keeps the big planes** (`BMW_02_weathered_colossal_statue_votives.jpg`). The colossal statue is weathered soft, but its drapery folds still read. Rows of small votive figures line the plinth steps, and dark water mirrors the warm haze. → Skull and hand erosion removes micro-form only. Primary landmarks (§4b/§4c) stay crisp at the 10–20 cm scale. Offerings are placed in rows and clusters, never randomly.
3. **Moss is mostly dark; the bright green is only where light hits** (`BMW_01_moss_clearing_godrays.jpg`). Moss covers ground and stone tops, but saturated yellow-green appears only in sun patches (#4a4a1e 4.3%). The canopy darkens the top corners (#181712 35% [M]). → Keep 80% of moss pixels in the #2b372f–#435041 range and only light-struck tips up to #8b937e.

---

## 3. Target look spec (numbers)

### 3a. Palette per material family

"Rendered target" is what the final PNG should measure in that material [M from refs]. "Base Color start" is an [I] starting albedo (sRGB hex as typed in Blender's picker, with its linear value) to calibrate by re-measuring.

| Family | Rendered target: shadow / mid / lit (luma) [M] | Base Color start [I] | Rough. [I] | Notes |
|---|---|---|---|---|
| **Basalt ribs, near** | #171615 (0.09) / #1f1f1d (0.12) / rim #585b57 (0.35) | #3a3733 (lin ≈0.04) | 0.55–0.8; fresh breaks 0.35 | Near ribs ≈0.08–0.11 median. Warm brown variation #3a332c. |
| Basalt, mid-distance (6–14 m) | #5c6663–#646e6a (0.40–0.42) | same albedo | — | Fog does the lifting, not albedo |
| **Ancient carved stone (altar ring, masonry)** | #232217 (0.13) / #404034 (0.25) / #76776a (0.46) | #6b665a (lin 0.13) | 0.7; worn kneeling dips 0.35 | Olive-grey limestone, not ivory. Moss on 25–40% of top faces |
| **Bone-stone skull** | #2a332c (0.19) / #687054 (0.43) / #a9ae91–#c5caaf (0.67–0.78) | #8f8a76 (lin 0.25) | 0.65 | Greenish grime #6d6f5c in recesses. Brightest lit bone ≈0.7, never > 0.8 |
| Hand stone | #222b25 (0.16) / #3a433b (0.24) / #87897f (0.53) | #77756a (lin 0.18) | 0.7 | Darker and mossier than the skull |
| **Moss, lit** | #65725a (0.43) → tips #8b937e (0.56), max #b5b8a5 | #4f5a3a (lin 0.09) | 0.9 + sheen 0.2 | HSV S 0.18–0.23, hue 75–112°. **Not** saturated green |
| **Moss, shadow** | #1f281e (0.15) / #2b372f (0.20) / #435041 (0.30) | (same) | | ~80% of moss pixels should land here |
| **Crimson foliage** | #280e0e (0.08) / #502324 (0.18) / #6c393b (0.27) | leaf #6e1a1f (lin 0.04), stem #3b1a14 | 0.5 | Oxblood, S 0.45–0.50, hue 350–5°. Backlit translucency to #8f3a35 near lava only |
| Fern green [I] (not in refs) | #2c3520 (0.19) / #55613c (0.36) | #4d5836 | 0.6 | Yellower than moss; shaded pockets only |
| **Lava crust** | #110a07–#1b0a07 (0.04–0.05) | #1a1512, emission 0 | 0.85 | 60–70% of lava area |
| **Lava mid glow** | #48221d–#702822 (0.16–0.22) | emission, hue 5–12° | | Plate edges and thin crust |
| **Lava core / cracks** | #953e33–#b64837 (0.31–0.37); top 1% #c65d4b–#ee7453 (0.45–0.55) | emission, hue 10–18° | | ≤3% of lava area. Optional [I] thinnest cores up to #ffa060 on ≤0.5% |
| **Eclipse disc** | #393a3c–#424041 (0.23–0.25); inner rim #564f4c | black, emission 0 | 1.0 | Hazed, so not 0. **Must be darker than the surrounding sky (0.55–0.6)** |
| **Eclipse corona** | core #fef2cc–#fffcda (0.95–0.98) / body #cda174 (0.66) / falloff #a78565 (0.54) / smoke #6c594a (0.36) | emission | | Cream-white core only on the innermost ~10% of ring width |
| Eclipse fire plume (right) | highlights #efcc9a (0.82) / body #a87751 (0.50) / smoke #704e3b (0.33) | emission + volume | | Extends x 0.45–0.86, y 0–0.42 of frame |
| **Fog, near (lava-lit, bottom 15%)** | #24110e (0.08) → #4a241e (0.17) | volume | | Warm, saturated, dark |
| **Fog, mid (behind board)** | #949085 (0.57) | volume | | Warm grey, S ≈ 0.10 |
| **Fog, far / sky centre** | #97938b (0.58), brightest #a7a39b (0.64) | world + volume | | The light funnel |
| **Sky, upper corners** | #2e3834–#3c423e (0.21–0.25), cloud #697374 (0.44) | world | | Cool green-slate |
| Board light / dark squares | #d2c1aa–#ebd9c0 (0.77–0.86) / #49433c (0.27) | (existing) | | Max contrast pair in the lower half |
| Board bronze / wood frame | #5e4d34 → highlight #e4d2a9 / #463a33 (0.24) | (existing) | | Bronze highlights may reach 0.83 |

Frontal ref global k-means palette [M]: #2e332e 20%, #4e4d47 18%, #6c6d66 16%, #1a1410 16%, #979286 15%, #45211c 8%, #d2bca1 4.5%, #8b3f30 1.7%. About **70% of the image is near-neutral grey/olive**. Colour is concentrated in dark reds (10%) and a little cream.

### 3b. Value ranges per depth plane (final hero render, display luma 0–1)

| Plane | World range [I] | Target luma p10–p90 (median) [M-derived] |
|---|---|---|
| Foreground (altar face, lava banks, near ribs, bottom 15% of frame) | 0–2 m | 0.03–0.27 (0.08–0.10) |
| Board (focal object) | 0 m | dark squares 0.20–0.27, light 0.75–0.86 |
| Altar ring top, rubble | 0–1.5 m | 0.10–0.37 (0.19–0.25) |
| Midground monuments: skull, hand | 9–11 m | shadow 0.15–0.20, mid 0.24–0.43, lit peaks 0.65–0.72 |
| Mid spires, standing stones | 4–15 m | 0.38–0.45 (shadow side 0.18–0.25 for the nearest monoliths) |
| Background fog/sky centre column | 15 m+ | 0.52–0.62 |
| Sky upper corners | — | 0.20–0.30 |
| Eclipse disc / corona core | 20 m | 0.22–0.30 / 0.90–0.98 on < 0.5% of frame |

### 3c. Saturation rules

- Global mean HSV S **0.24–0.27** (pass01: 0.177). Mean CIELAB chroma 8–10 [M].
- **Chroma lives in the darks.** The most saturated pixels (S 0.45–0.65) are the darkest warm ones: lava, crimson foliage and lava-lit haze, at luma 0.05–0.37. Highlights stay near-neutral cream (corona core S < 0.2, light squares S ≈ 0.18).
- Neutral stone and fog S ≤ 0.12. Moss 0.18–0.23. Corona amber 0.32–0.43.
- Warm saturated pixels **14–18%** of frame, in the bottom corners, the eclipse and the plume. Cool-tinted pixels **8–10%**, in the upper corners.
- The secondary ref `04` is far hotter (S 0.59, 85% warm [M]). Borrow only its low-haze colours (#592a1b, #85422c) for the lava-lit fog near the ground, and its chained-platform idea. Do not adopt its global saturation.

### 3d. Hero-render histogram acceptance band (derived from 01 + 02)

| Statistic | Target band | Pass01 |
|---|---|---|
| p5 / p25 / p50 / p75 / p95 | 0.05–0.08 / 0.14–0.17 / 0.23–0.28 / 0.37–0.45 / 0.64–0.70 | 0.168 / 0.282 / 0.335 / 0.429 / 0.627 |
| mean / RMS | 0.28–0.32 / 0.18–0.20 | 0.361 / 0.139 |
| pixels < 0.08 | 6–9% | 0% |
| pixels > 0.85 | 0.5–1.5%; clipped > 0.98 ≤ 0.2% | 0.5% |
| 10-bin % | 10–13 / 22–30 / 20–23 / 13–15 / 8–12 / 6–11 / 3–5 / 2–3 / 1–1.6 / 0.3–0.6 | 0/11/20/40/15/8/3/2/1/0 |
| 3×3 grid | top 0.22–0.30 / 0.45–0.52 / 0.30–0.36; mid 0.20–0.26 / 0.45–0.52 / 0.30–0.36; bottom 0.17–0.23 / 0.28–0.36 / 0.17–0.23, with bottom-corner S ≥ 0.40 | see §1 |

---

## 4. Shape language

### 4a. Basalt ribs (the enclosing "ribcage")

- **Arrangement:** the elevated ref shows ~10 ribs per side on **two concentric arcs** around the altar, with tips leaning inward like a ribcage [M by grid]. In the frontal ref I count 9 near ribs on the left and 7 on the right, plus ~12 mid spires [M].
- **Counts per depth** [I, matched to ref]:
  - Near, 2–6 m: 4 left + 3 right. Each is 4–8% of frame width and cut by the frame edge.
  - Mid, 6–14 m: 6–8 per side, 1.5–3% of frame width.
  - Far, 15–30 m: 8–12 faint ones, < 1% of frame width, luma 0.42–0.55.
  - Never two identical heights adjacent. Height ratios between neighbours 0.6–0.85.
- **Curvature:** one dominant C-curve per rib, lying in a plane that faces the altar centre. Tip deflection from the base axis is 15–35% of length. Near ribs bow inward and frame the eclipse. About 1 in 4 gets a gentle S (counter-curve in the last third). No straight shafts.
- **Taper:** base diameter : length of 1:8 (near, massive) to 1:14 (mid). Taper is non-linear: the first 70% of length keeps 60–80% of base width, then it narrows fast. Tips end **broken**, with end width 15–30% of base and a sheared plane at 30–60°. Only 1 in 6 may come to a point (pass01 cones all do).
- **Cross-section:** irregular 5–7-sided columnar-basalt prism, flattened about 1:1.4 (wide face toward the altar), with 1–3 longitudinal grooves. Transverse joints every 0.6–1.2× base diameter, each offset 2–5% of width, so ribs read as stacked columnar segments.
- **Breaks:** 1 in 3 ribs is snapped mid-length. The upper piece leans on a neighbour or lies half-sunk in lava. Fresh break faces are +0.08 luma lighter, sharper and less mossy.
- **Base:** flared to 1.3–1.6× shaft width and buried in rubble. Add a condyle-like swelling (`BMW_03`). Crimson bands wrap the bases.
- **Material:** dark basalt. Moss only on altar-facing upper shelves and joint ledges. Lava rim light on the undersides of the nearest 3 ribs.

### 4b. Skull: landmarks that must read

Reference measurements [M]: 19.5% of frame width, 31.5% of frame height, centre (0.30, 0.45). In the elevated view the orbits face the altar. **No mandible** is visible in the frontal ref: the skull rests on its maxilla and upper teeth, half-sunk.

Human proportions to scale from [I, standard anatomy; scale ≈ ×19 for a 2.7 m wide skull]:

- **Cranium:** length : width : height ≈ 1 : 0.78 : 0.75. The temples are **flattened** (temporal planes), not spherical. Coronal and sagittal sutures run as zig-zag grooves 2–4 cm wide at scale.
- **Brow ridge:** a supraorbital bar overhanging the orbits by 0.08–0.15× orbit width. Its top surface is a moss shelf; its underside is bare and dark.
- **Orbits:** each about 0.28× skull width, height 0.85× width, rims slightly squared. Interorbital gap ≈ 0.6× orbit width. One orbit is ≈5° oblique and slightly higher (asymmetry). Inside: real cavities, at least 0.5× orbit width deep, so the measured orbit shadow (0.13–0.16 luma) is achievable.
- **Zygomatic arch:** a thin bar (≈0.07× skull height) from cheekbone to temporal bone, with **visible negative space** behind it (the temporal fossa). This is the single best "real skull, not a ball" cue. Break one arch.
- **Nasal aperture:** an inverted pear ≈0.18× skull width and ≈0.25× face height, with a sharp lower rim and a nasal spine. Its bottom sits at about 60% of skull height from the top.
- **Maxilla:** ≈0.12× skull height from nasal base to the tooth line, with alveolar bone receding.
- **Teeth:** 8–10 upper teeth visible, **3 missing**, unequal crown lengths (±25%), roots exposed where bone eroded, one canine chipped. Not a bead row.
- **Mandible:** detached and absent from the hero, or a broken half-mandible lying 1–2 skull-widths forward-left, half-buried and rotated 70–110°.
- **Erosion and damage:** one large impact break on the upper-left parietal (≈15% of the cranium), with a crack network radiating from it, plus weathering pits.
- **Pose:** yaw 25–35° toward the board, pitch the chin down 5–10° into the ground, roll 5–8°. Sunk to just below the maxilla.
- **Moss** (≈45–55% of visible surface): crown and upper parietal, brow-ridge top, upper inner orbit rims, top of the zygomatic arches, and along the sutures. Drips hang 10–30 cm from overhangs. Leave bare bone on the face, cheeks and the undersides of the brow and orbit roofs. Measured split: moss crown #435041 vs lit bone #a9ae91.

### 4c. Hand: anatomy and gesture

Reference measurements [M]: 14% of frame width; 50% of frame height including the forearm (fingertips at y = 0.12, ground at y = 0.62). The palm and fingers span y 0.12–0.40, so 22% of frame height is forearm.

Proportions [I, standard anatomy]:

- **Hand length:** palm 0.56, middle finger 0.44. Palm width ≈ 0.45× hand length.
- **Finger lengths** relative to the middle finger: index 0.90, ring 0.94, little 0.76.
- **Phalanx ratio** proximal : middle : distal ≈ 1 : 0.62 : 0.45. The thumb has 2 phalanges plus a long metacarpal.
- **Knuckles:** the MCP knuckle line is an arc (middle highest). PIP joints are 10–15% wider than the shafts. Distal width ≈ 75% of proximal.
- **Thumb opposition:** rotate the thumb 80–90° so its nail faces sideways, not forward. The thenar mass fills about 1/3 of the palm base. The thumb sits on the inboard side (toward screen centre).
- **Cupping:** the metacarpal arch sinks the palm centre by 10–15% of palm width, and the hypothenar edge is thick.

Gesture and condition:

- **Reach:** a reaching claw aimed at the eclipse. Index and middle extended within ±10° of the eclipse direction; ring and little fingers curled 30–60° at the PIP; thumb opposed and angled toward screen-left. The palm faces the board and eclipse, inward-left from camera (it reads as a left hand).
- **Wrist and forearm:** the wrist is buried. The forearm emerges 1.5–2 palm-lengths from the ground, leaning 10–20° toward the eclipse.
- **Ground at the wrist:** ground plates around the wrist are heaved and tilted outward 15–30°, which says "pushed up through".
- **Wear:** the little-finger tip is broken off, with cracks across the finger joints.
- **Moss:** forearm 80–90%, back of the palm 40%, fingers 20–30% (tips bare). Roots and vines hang from the wrist and between the fingers. Add shelf fungi on the forearm (`AFOP_04`).

### 4d. Carved altar ring

- **Size:** board frame : altar diameter = 0.68 [M, elevated] → Ø ≈ 1.12 m for the 0.76 m board, which agrees with the prior 0.56–0.58 m radius.
- **Segments:** 12 ring blocks of 30° with visible joints, plus the 4 lunettes (circle segments between the board's corners and the ring). The lunettes are where all vegetation and offerings live.
- **Profile:** a 3-step stepped drum (`ER_05`, `CD_01`). Top rim band ≈ 9% of radius. The front face carries a frieze band 40–60 mm tall.
- **Carving:** a running band of interlocked **lozenges with chevron infill**, the same vocabulary as the board border, at 1–1.5× the board motif scale. Panels are 70–80% carved with plain margins (`ER_05`). Relief depth 3–6 mm. One stepped-fret variant on the front frieze (`CD_01`) is permitted. No figurative emblems, glyphs or text.
- **Breakage:** front-right block cracked with a V-gap of 10–15°. Rear-left block dropped 3–6 cm and tilted 6–10° outward (`CD_02`). Outer lip chipped (70% of chips on the outer edge). Radial cracks run from the skull side and **stop at the ring** (§5).
- **Wear:** two kneeling dips worn into the top step at the front and back player sides. These are polished (roughness 0.35) and slightly lighter.

### 4e. Floating islands

- **Counts** [M]: in the frontal ref, 2 large (left 6%W × 14%H; below-eclipse 8%W × 9%H), 3–6 small, and ≈40 chips around the eclipse.
- **Top:** a broken slab of terrain or masonry tilted 10–35°, with moss and crimson tufts on top only.
- **Underside:** an asymmetric inverted wedge or cone 1.2–2.0× top width deep, with one secondary lobe. 4–7 strata bands with undercut shadow lines (`AFOP_02`, `CD_03`). A blunt broken tip, never a needle.
- **Roots:** 6–15 per island from the lip and underside, 0.3–0.8× island height, gravity-straight with kinks.
- **Debris:** comet tails along the shared arc (§2 E33 #1). Chip sizes from 1/6 to 1/60 of island width.
- **Value:** islands get fog-lifted too. In the frontal ref the large left island is #5a5e5c, 0.36 luma [M].

### 4f. Vegetation families and placement ecology

1. **Moss cushions** (dominant): up-facing stone, joints, sutures, carved recesses. Denser on the cool skull side. Sparse on faces within ~1 m of lava.
2. **Crimson shrub** (oxblood compound leaves; 4–12 cm at altar scale, 0.3–0.8 m at monument scale): bands along contours (lunettes, rib bases, skull base, lava banks). Leaves tilt toward the eclipse.
3. **Ferns** (radial rosettes of 6–14 fronds): shaded moist pockets only — under the hand's palm, the shadow side of the skull, between rib roots.
4. **Hanging roots and vines:** island lips, hand wrist and fingers, rib overhangs.
5. **Shelf fungi** (stepped tiers): hand forearm, broken rib stumps.

Clumping rules:
- Clusters of 3–9 with one dominant individual; per-cluster scale 0.6–1.4; ≥ 60% of plants within 15 cm (altar scale) of a stone edge or crack.
- **Nothing on the board.** Moss stops 2–4 cm short of the board frame on every side.

### 4g. Lava

- **Where:** sunken 1.5–3 m below the altar rim. In the frontal hero it is visible only in the bottom corners [M: x 0–0.15 and 0.85–1.0, y > 0.72]. In the elevated view it is two streams flanking the altar that merge in front.
- **Glow:** emission only in cracks between crust plates and at broken bank edges. Hot cores ≤ 3% of the visible lava area.
- **Crust:** Voronoi plates 0.3–1.5 m, stretched 1.5–2.5× along the flow. Thicker and darker crust at the banks, thinner in the channel centre. Ropy folds at the banks.
- **Light on surroundings:** lava lights the undersides of the near ribs, the altar's underside, and backlit crimson leaves. Red haze rises 0.5–2 m above it (`BMW_03`, `04_REF`), and sparse embers drift upward.

---

## 5. Environmental storytelling: "the heart that would not burn"

**The story** [I]. A titan once lay across this abyss on its back: head to the left, chest at the centre, one arm raised. It reached for the sun and the sun was eclipsed in its grasp. The titan fell and petrified. Its ribs became the basalt ribcage, and its heart cavity became the altar. The still-molten blood still circles the heart in two channels. The board was set in the heart-place by later hands. It is the one thing nature and fire refuse to touch. Moss, lava and the falling sky all part around it, which is why it is sacred.

This adds no faction, name, text, emblem or chess piece. It is told through the following physical evidence:

| Asset | What it physically shows |
|---|---|
| **Ribs** | All curve toward one centre, the altar. Their bases flare along a **buried spine ridge**: 3–5 knobbed, vertebra-like rock masses running from behind the altar toward the skull's base. This is a leading line from skull to board. |
| **Skull** | Turned toward the board (its own heart). An impact crater and compression ring at its base. Rubble ejecta fan *away* from the skull. Ground cracks radiate from it toward the altar and **stop at the ring**. The mandible broke off on impact. |
| **Hand** | Still reaching: the index/middle direction points at the eclipse, the palm is cupped to catch. Heaved ground plates at the wrist. One snapped fingertip lies nearby. Optional: one heavy manacle at the wrist with 3–5 links, the last link sheared (no markings). |
| **Eclipse** | Pulling the titan's broken land upward. Islands and chips sit on the arc from skull to eclipse, and debris trails all point toward it. The fire plume streams to the hand's side, as if the hand tore it. |
| **Lava** | Two channels flanking the altar like vessels, merging in front. Crust is thinnest (hottest) nearest the altar. |
| **Altar** | Unbroken where the board sits. Breaks only on the outer lip. Kneeling dips worn at the two player sides. Offerings in the 4 lunettes: guttered candle stubs and wax pools (`ER_05`), small stacked-pebble cairns, a few bone fragments, scattered dried crimson petals. Nothing on the board. |
| **Vegetation** | Crimson grows densest nearest the lava and altar, leaning toward the eclipse. Moss halts 2–4 cm from the board frame: a clean margin of "refusal". |

---

## 6. Composition for the frontal hero camera

### 6a. Measured from `01_REF` [M] (fractions of frame; origin top-left; 16:9)

| Element | Position / size |
|---|---|
| Eclipse disc | centre (0.643, 0.224); Ø 14.7% of W (26.3% of H). Plume x 0.45–0.86, y 0–0.42 |
| Skull | x 0.20–0.395, y 0.295–0.61 (19.5% W × 31.5% H); centre (0.30, 0.45) |
| Hand incl. forearm | x 0.74–0.88, y 0.12–0.62 (14% W × 50% H) |
| Board playfield | far edge y 0.685 (x 0.30–0.71), near edge y 0.835 (x 0.24–0.76) |
| Board frame (bronze corners) | near x 0.145–0.855 (≈71% W) |
| Altar front face | y 0.84–1.0, x 0.10–0.90 |
| Fog / horizon line | y ≈ 0.60 |
| Lava | bottom corners only |

Size ratios: skull/eclipse diameter = 1.33; hand height/skull height = 1.59.

### 6b. Thirds, lines and negative space

**Thirds:**
- The skull centre sits on the **left third line** (x 0.30 vs 0.333).
- The eclipse sits just inside the **upper-right power point** (0.643, 0.224 vs 0.667, 0.333).
- The board's far edge lies on the **lower third line** (0.685 vs 0.667).
- The hand is a frame-edge pillar outside the right third.
- The board is centred and alone in the bottom-centre cell.

**Leading lines:**
1. Near ribs lean in from both edges toward roughly (0.5, 0.35).
2. The board's receding sides converge to the same zone.
3. The "crown arc" of islands runs skull top → eclipse → hand fingertips (0.80, 0.13).
4. The hand's index finger points at the eclipse.
5. The buried spine ridge runs from the skull base to the altar's rear.

**Negative space that must stay clear:**
- The central haze column, x 0.45–0.58, y 0.28–0.60. Only far spires ≤ 1% W each and small chips are allowed; it measures 0.48–0.58 luma.
- A gap of ≥ 3% W between the fingertips and the corona (no tangency).
- A gap of ≥ 4% H between the skull top and any island.
- A clear band of 1–2% H above the board's far edge, so the board silhouette reads against fog.
- The whole playfield.

### 6c. Camera solve to hit those fractions [I, computed]

Assumes a 36 mm sensor (fit Auto, horizontal), 16:9, board top at z = 0, centred at the origin, facing +Y.

The pass01 plan was 21 mm at (0, −1.05, 0.32), pitched 3° down. It gives a far/near board-edge ratio of **0.47**: strong wide-angle forced perspective, which is one cause of the "toy" read. The reference frame measures 0.55 (the playfield 0.79).

| Recommendation | Value |
|---|---|
| Lens | **28 mm** (HFOV 65.5°, VFOV 39.8°) |
| Camera | (0, −1.31, 0.22), **pitch +2° up**, no roll |
| Result: board | frame near edge 64% W; far/near 0.55; board centre at v = 0.78 (ref 0.76) |
| Skull | centre (−2.8, 9.5, +1.0); **≈2.7 m wide, 2.5 m tall** to read at 19.5% W |
| Hand | x ≈ +4.5, y 10. Visible from z ≈ −0.35 (fog line) to fingertips z ≈ +3.8 (4.1 m visible). The existing 4.6 m hand is fine |
| Eclipse | centre ≈ (+3.95, 20, 5.25), **radius ≈ 2.0 m** for 14.7% W |
| Check | at 35 mm and y = −1.52 the skull shrinks to 2.2 m and the board centre drops to v = 0.86 (too low), so 28 mm is the balance point |

The seated VR inspection camera is separate. Keep it as previously specified.

### 6d. Depth planes

| Plane | Distance | Contents |
|---|---|---|
| FG | 0–2 m | Altar drum, near lava banks, 7 near ribs cut by the frame |
| Focal | 0 m | Board |
| MG1 | 2–6 m | Rubble ring, monoliths, mid ribs |
| MG2 | 9–11 m | Skull, hand |
| BG | 12–30 m | Far ribs, islands, fog floor |
| Sky | 20 m+ | Eclipse, plume, debris spiral |

Each plane back gains +0.10–0.15 luma and loses ~30% saturation (`AFOP_03`).

---

## 7. Blender technique notes (5.x; scene reports 5.2.3 LTS)

**Engine and colour management**

- In 5.0 the EEVEE engine identifier changed from `BLENDER_EEVEE_NEXT` to **`BLENDER_EEVEE`**, and `gtao_distance` moved to the view layer as `ambient_occlusion_distance`. Update any scripts. [5.0 EEVEE notes]
- Blender 5.0 added a working colour space setting (default Linear Rec.709), ACES views and an AgX HDR view. **Keep Linear Rec.709 + AgX (SDR) + sRGB display** so measured PNGs stay comparable. [5.0 colour notes]
- **Fix values in the scene first** (§1). Use an AgX *Look* only as the final trim. *Punchy* applies a power of 1.35, which would take a mid of 0.335 to ≈0.23, but it also darkens the sky that must get brighter. *Medium High Contrast* (contrast 1.2) is the safer trim. [AgX OCIO PR]
- AgX's "path to white" desaturates very bright saturated emitters toward white. The refs' lava is **deep red** (cracks 0.31–0.55 luma). So **keep lava emission low** and sell heat through context: red haze, lit undersides, and unseen red area lights at the lava for bounce.
  - [I] Starting values at exposure 0, with the key set so light squares read ≈0.8: crust 0, mid glow strength 0.5–1, cracks 1.5–3, rare cores 4–6.
  - Then measure. If cracks render more yellow-white than #ee7453, lower the strength.

**Moss mask** (both engines)

- Formula: `Geometry ▸ Normal → Separate XYZ.Z → Map Range (0.45→0.80 ⇒ 0→1)`, times a large-scale Noise on Object coordinates (scale 2–4 per object metre), plus a crevice term. Run it through a Color Ramp with a tight edge (0.45–0.55).
- Crevice term: the **AO node** works in EEVEE except *Only Local*. **Pointiness and Bevel are not supported in EEVEE.** [EEVEE node support] [AO node]
- For both engines: compute a curvature/cavity attribute in Geometry Nodes (or *Dirty Vertex Colors*, or bake in Cycles) and read it with the Attribute node. [Pointiness algorithm thread]
- For silhouette fuzz on the hero, scatter low moss-cushion instances with GN using the **same mask**. Never use floating cards.

**Edge wear and erosion**

- Build a convexity attribute (GN edge angle / curvature).
- Lighten fresh chips by +0.08 luma and lower roughness by 0.1 on breaks.
- Put grime (#6d6f5c on bone) in the cavity term.
- Use displacement only on the skull, hand and altar at hero distance.

**Volumetric fog**, three layers:

1. **World volume:** low density (start [I] 0.004–0.01 /m) for aerial perspective. Anisotropy 0.3–0.5 so forward scatter blooms around the eclipse, as with the Erdtree haze (`ER_01`).
2. **Height fog:** a box with Principled Volume, density = Color Ramp(Object Z). Dense below altar level, fading to 0 by +2 m. Warm-grey colour; it hides the abyss floor and mesh ends. [BlenderNation volumes-for-depth]
3. **Lava haze:** local volumes over each lava pool, scatter colour #4a241e, lit by the red area lights.

EEVEE ▸ Render ▸ Volumes:
- Resolution 1:4 for look-dev, 1:2 for finals. Steps 128–256. Distribution ≈ 0.8.
- **Custom Range** start 0.1 to end ≈ 40 m, so samples are not wasted beyond the eclipse. The manual recommends this for World volumes. [EEVEE volumes manual]
- Calibrate densities by measurement: skull shadow side 0.16–0.20, mid spires 0.38–0.45, centre column 0.52–0.62.

**Lava shader**

- Voronoi feature *Distance to Edge* gives the crack network: `crack = 1 − smoothstep(0, w, d)` with w ≈ 0.03–0.06. [Voronoi manual]
- Stretch the input vector 1.5–2.5× along the flow. Use two octaves (plates 0.8 m and 0.15 m). Bump the crust up.
- Crack colour: Blackbody 1100–1400 K or a ramp #3a0a05 → #b64837 → #ee7453.

**Eclipse corona: painterly, not neon**

- **Disc:** a black, non-emissive disc in front of an emissive ring, with haze in front lifting it to 0.22–0.30.
- **Ring structure:** polar coordinates (atan2 of local XY → angle) drive a noise-modulated ring thickness that varies 0.5–4% of the radius around the circumference.
- **Brightness:** 2–3 bright arcs cover ~35% of the circumference, brightest at the lower-right and right as in the ref. The cream core (#fef2cc) occupies only the inner ~10% of ring width, with an amber falloff (#cda174 → #a78565 → #6c594a).
- **Breakup:** dark smoke wisps (noise-masked, non-emissive volume or cards) cross the ring in 3–5 places.
- **Plume:** an emissive volume or billboard plume up and to the right.
- **Bloom:** EEVEE's built-in bloom was removed in 4.2, so use the compositor **Glare ▸ Bloom** or *Fog Glow*: threshold ≈ 1.0, Strength 0.3–0.6, Size ≈ 0.5, **Saturation 0.6–0.8**, Tint warm cream, Clamp on. Optional *Sun Beams* from the eclipse centre for shafts. [Glare manual] [EEVEE-Next bloom thread]

**Engines and QA**

- Use EEVEE for iteration and **Cycles for the hero** (volumes, GI, AO correctness).
- After every render, run `measure_refs.py` on it and compare against §3d. Do not raise a score while p5 > 0.09, warm < 10%, or the eclipse disc is lighter than its surrounding sky.

**Sources:**
- [Blender 5.0 EEVEE release notes](https://developer.blender.org/docs/release_notes/5.0/eevee/)
- [Blender 5.0 colour management notes](https://developer.blender.org/docs/release_notes/5.0/color_management/)
- [EEVEE supported nodes (manual)](https://docs.blender.org/manual/en/latest/render/eevee/limitations/nodes_support.html)
- [EEVEE Volumes settings (manual)](https://docs.blender.org/manual/en/latest/render/eevee/render_settings/volumes.html)
- [Glare node (manual)](https://docs.blender.org/manual/en/latest/compositing/types/filter/glare.html)
- [Ambient Occlusion node (manual)](https://docs.blender.org/manual/en/latest/render/shader_nodes/input/ao.html)
- [Voronoi Texture (manual)](https://docs.blender.org/manual/en/latest/render/shader_nodes/textures/voronoi.html)
- [AgX OCIO config PR, look values](https://projects.blender.org/blender/blender/pulls/106355)
- [EEVEE-Next feedback thread, bloom → Glare](https://devtalk.blender.org/t/blender-4-2-eevee-next-feedback/31813)
- [Understanding the Pointiness algorithm](https://devtalk.blender.org/t/understanding-the-pointiness-algorithm/13093)
- [BlenderNation: How to use volumes to add depth (2025)](https://www.blendernation.com/2025/02/26/how-to-use-volumes-to-add-depth/)

---

## 8. TOP 12 changes that will move the score most (ranked)

1. **Rebuild the value structure into the light funnel.**
   - Brighten the centre sky/fog column to 0.52–0.62 and darken the frame corners to 0.17–0.25.
   - Cut stone albedos 2–3×: altar from 0.70 → 0.20–0.30 rendered; skull median 0.60 → 0.30–0.40; hand → 0.20–0.25.
   - Pass gate: p5 0.05–0.08, p50 0.23–0.28, RMS ≥ 0.18, ≥ 6% of pixels below 0.08.
2. **Re-solve the hero camera and monument placement.** 28 mm at (0, −1.31, 0.22), +2° pitch. Skull 2.7 m wide at (−2.8, 9.5, 1.0) yawed 30° to the board. Hand at x +4.5, y 10. Eclipse r 2.0 m at (3.95, 20, 5.25). This cures the 0.47 forced-perspective "toy" look.
3. **Eclipse.** Hazed dark disc at 0.22–0.30, darker than its sky. Irregular cream-core/amber corona with 2–3 bright arcs and smoke breaks. Plume to the upper right, debris spiral, Glare Bloom at Saturation < 1. Kill the uniform neon wire.
4. **Lava.** Delete the flat decals. Sunken channels with 60–70% dark crust, crack-only emission, banks, red haze and embers. Visible only in the bottom corners in the hero. Gate: warm saturated pixels 14–18%.
5. **Basalt ribs.** Replace the cones with curved, non-linearly tapered, columnar-jointed, broken-tip ribs on two inward-leaning ribcage arcs (7 near / 12–16 mid / 8–12 far). Near ribs at 0.08–0.11 luma.
6. **Three-layer volumetrics** (world, height fog, lava haze), calibrated so each depth plane steps +0.10–0.15 luma. The fog floor hides the abyss bottom and horizon line.
7. **Skull anatomy.** Flattened temples, brow shelf, deep orbits (one oblique), zygomatic arches with negative space (one broken), nasal aperture, eroded maxilla with irregular teeth (3 missing), no attached mandible, impact break, suture moss lines.
8. **Hand anatomy and gesture.** Cupped palm, thumb rotated 80–90°, correct phalanx ratios and knuckle arc, index and middle aimed at the eclipse, buried wrist with heaved plates, a broken fingertip, moss and vines.
9. **Moss.** Replace the floating leaf cards with the normal-Z + cavity shader mask and GN cushion instances. Desaturated olive (S 0.18–0.23), 80% in shadow tones, clean 2–4 cm margin around the board.
10. **Crimson foliage.** Oxblood (#502324 mid, #6c393b lit, #280e0e shadow) in contour bands at the lunettes, rib bases, skull base and lava banks, repeated at 3 depths, leaning toward the eclipse.
11. **Floating islands.** One arc from skull to eclipse. Stratified, undercut, blunt undersides; hanging roots; comet-tail debris; one island overlapping ≤ 10% of the disc for depth.
12. **Altar ring craft and story.** 12 segments, 3-step drum, lozenge/chevron frieze matching the board, two displaced/cracked blocks, kneeling-wear dips, offerings only in the lunettes, and a buried vertebral ridge leading from the skull to the altar.
