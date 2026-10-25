# Crownfall — Claude track: common brief for every build agent

Read this whole file before doing anything. It is binding.

## 0. Situation
Codex (another AI agent) owns the live Blender session (MCP port **9876**), the shared scene
`outputs/Crownfall_Environment_v001/*.blend`, and final integration. We (the Claude track) produce
**modular, reviewable assets + scripts** that Codex integrates. Codex's first environment pass scored
3.5/10 (`work/environment_reviews/pass01_review.md` — read it; its listed failures are what we fix).

Root: `C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create`
Our area: `work\claude_environment\`  (write ONLY here, inside your assigned sub-folders)

### Hard rules
- NEVER connect to port 9876, never open/save Codex's .blend files, never edit files outside `work\claude_environment\`.
  Reading Codex files is fine.
- Run Blender ONLY via the slot-gated wrapper (max 2 concurrent Blender processes machine-wide; RAM is tight):
  `python lib/run_blender.py scripts/<your_script>.py --timeout 1800 -- <args>`
  (run from `work\claude_environment`; system `python` is 3.12 with numpy+PIL). It prints a log tail and exit code.
  Never launch blender.exe directly. Never run more than one Blender job at a time yourself.
- Keep SDF grids ≤ ~8M samples (e.g. 200×200×200). Renders ≤ 1280×720, EEVEE, 32–64 samples while iterating.
- The board (`outputs/Crownfall_Board_v001/Crownfall_Board_v001.blend`) is sacred: never modify it. 0.76 m overall,
  0.64 m playing area, 0.08 m squares, playing surface Z=0, origin at its centre, +Z up, player on −Y.
  No chess pieces, no faction names, no text, no invented emblems/logos anywhere.
- Honesty: never claim AAA/photoreal/Quest-performance/hand-tracking. Report what you actually rendered and saw.
  If something failed or is unfinished, say so.

## 1. Library (in `lib/`, import after `sys.path.insert(0, <CL>/lib)`)
- `cf_sdf.py` — numpy SDF modelling: `perlin, fbm, ridged, warp`, primitives `sphere, ellipsoid, box(round_r), capsule,
  round_cone(a,b,r1,r2), torus, plane, cylinder_z, polyline_tube`, ops `union, subtract, intersect, smin, smax, ssub(k)`,
  `rot_matrix(rx,ry,rz deg)`, `to_local`, `mesh_sdf(fn,bmin,bmax,voxel)->(verts,quads)`, `to_blender_mesh(name,v,q)`.
  Inside<0. Domain-warp + ridged noise give organic/eroded forms. ~17 s for a 2.3M-sample grid.
- `cf_materials.py` — procedural world-space materials: `get(name)`, `assign(obj,name,**kw)`. Names:
  `Basalt, AncientStone, BoneStone, Moss, Lava, Bronze, Fern, CrimsonLeaf, Bark` (all prefixed `CFCL_`).
  Owned by the surface agent; everyone else just calls `assign`.
- `cf_render.py` — `reset_scene, setup_render, setup_world, standard_lights, camera, look_at, render_to, turntable,
  bounds, tri_count, write_json, append_board`. Paths: `R.CL`, `R.ROOT`, `R.BOARD_BLEND`.
- Smoke test that proves the pipeline: `scripts/_smoke_test.py` (renders `renders/_smoke_front.png`).

Blender API notes (5.2): engine id `BLENDER_EEVEE`; use bmesh / foreach_set for speed; `mesh.shade_smooth()`;
modifiers apply via `bpy.ops.object.modifier_apply` with the object active (or evaluate depsgraph + `bpy.data.meshes.new_from_object`).
Decimate: `obj.modifiers.new(type='DECIMATE')`, `ratio`. Remesh voxel: `mode='VOXEL'`, `voxel_size`.
`mathutils.noise` exists for per-vertex displacement. Musgrave texture node no longer exists (use Noise node `noise_type`).

## 2. World layout + scale contract — REVISED 2026-10-23 ~20:05 (supersedes the earlier monumental table)
We now match **Codex's live scene** (so our assets are drop-in replacements) and the research camera solve
(`research/reference_study.md` §6c). All positions metres, board centre = origin, player on −Y.
Codex hero camera: (0,−1.05,0.32)→(0,0.8,0.22) 20 mm; research recommends 28 mm at (0,−1.31,0.22), +2° pitch.

| Element | Target size | Placement (Codex current → research ideal) |
|---|---|---|
| Board | 0.76 × 0.76 × 0.061 | origin (unchanged) |
| Altar drum around the board | Ø ≈1.12–1.3 m top, 3-step drum (§4d) | origin |
| Optional VR dais floor | top Z=−0.76 (seated-VR floor height) | origin — Codex decides whether to use it |
| Skull | ≈2.7 m wide, ≈2.5 m tall (cranium+maxilla), no attached mandible | Codex ≈(−3.8,8.1,−0.4) → ideal (−2.8,9.5,+1.0), yaw ~30° toward board |
| Hand | hand length (wrist crease→middle tip) ≈2.5 m; visible forearm ≈2 m; total visible ≈4.5 m | Codex ≈(3.6,9.8,−0.2) → ideal (4.5,10,−0.35) |
| Gate (Codex owns) | span 3 m, peak ≈4.9 m | (0, 11.05) |
| Basalt ribs | near 4–9 m tall, mid 6–14 m, far 10–20 m | near 2–6 m from board, mid 6–14 m, far 15–30 m; two inward-leaning arcs (§4a) |
| Floating islands | large 2–4 m, small 0.4–1.5 m, ≈40 chips | one arc skull-top → eclipse → hand fingertips, 10–25 m away, Z +3…+9 |
| Eclipse | r ≈2.0 m | Codex (0,19,6.05) → ideal (3.95,20,5.25) |
| Lava | channels 1.5–3 m below the altar rim | two channels flanking the altar merging in front; abyss floor Z ≈ −3…−6; extent ≈ 70 m |
| Far cliffs/spires | silhouettes | 35–80 m |

Read `research/reference_study.md` §3 (palette/luma targets), §4 (shape language) and §5 (story) — they are binding
where more specific than this brief (e.g. skull: no attached mandible; hand: reads as a LEFT hand reaching toward the
eclipse with index+middle extended, ring+little curled, little-finger tip broken).

Story spine (shared): the arena is built inside the remains of a fallen stone colossus — the skull (left) and the
reaching hand (right) are its remains, the basalt "ribs" read as its ribcage turned to rock, and the eclipse is what
struck it down. A people later carved the dais and altar here and kept the board as a sacred rite; the ruins are
theirs, now collapsing; nature (moss, ferns, crimson growth) reclaims everything. Assets should physically show this
(wear, cracks radiating from impacts, collapse direction, offerings/broken chains are fine; NO text/emblems).

## 3. Asset conventions
- Units metres, +Z up. Object origin = ground-contact centre (bottom centre) unless noted. Apply all transforms.
- Names: objects `CFCL_<Family>_<Variant>` e.g. `CFCL_Hero_Skull`, `CFCL_Rib_A`. One collection per asset `CFCL_<Asset>`.
- Save each asset to `assets/<AssetName>/<AssetName>_v###.blend` (never overwrite an older version) with materials
  from `cf_materials` (procedural; no external images unless you record a CC0 licence in the asset README).
- Also write `assets/<AssetName>/README.md` + `meta.json`: purpose, dimensions (measured bounds), triangle count (measured
  with `tri_count`), material slots, origin, intended placement, LOD info, known defects, render paths.
- Triangle budgets (render/hero LOD0): skull ≤150k, hand ≤150k, each rib ≤20k, each floating island ≤25k,
  altar+dais ≤90k, each ruin piece ≤15k, vegetation clump ≤6k. Decimate (collapse) after detailing; keep silhouettes.
- No stray floating fragments unless intentional (and then intentionally composed). No non-manifold holes visible.
- Scripts go in `scripts/` named after your asset; they must be re-runnable from scratch (deterministic seeds).

## 4. Iteration loop (mandatory)
build → render (turntable 3–4 views + 1 close-up, using `cf_render` lights) → OPEN and LOOK at every render with
the Read tool → compare against the primary references (`research/user_refs/01_REF_primary_frontal_concept.png`,
`02_REF_primary_elevated_concept.png`) → write an honest critique (what reads wrong at silhouette level first,
then secondary forms, then surface) → fix the worst 2–3 issues → re-render. Do at least 3 full iterations; stop
only when the remaining problems are minor surface details, or after 6 iterations. Keep every iteration's renders
(`renders/<asset>/iterNN_*.png`) and log a one-paragraph critique per iteration in your README.

Priorities: primary silhouette and proportion > secondary forms (breaks, joints, erosion planes) > tertiary
surface detail > material polish. Noise alone never equals realism.
