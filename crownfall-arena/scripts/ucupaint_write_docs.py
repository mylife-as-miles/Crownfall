"""Write README.md + meta.json for a CFCL_Ucupaint_<T> asset from its build_report_v###.json files and the
hand-written critique log (iteration_log.md in the same folder).   (system python)

python scripts/ucupaint_write_docs.py <AssetName> <ready_ver or 0> [status text]
"""
import sys
import os
import json
import glob

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[1]
ready = int(sys.argv[2]) if len(sys.argv) > 2 else 0
status = sys.argv[3] if len(sys.argv) > 3 else ""
adir = os.path.join(CL, "assets", name)
reps = sorted(glob.glob(os.path.join(adir, "build_report_v*.json")))
R = [json.load(open(p)) for p in reps]
last = R[-1]
cur = [r for r in R if r["ver"] == ready][0] if ready else last
ver = cur["ver"]


def md_stack(stack):
    out = ["| # (top first) | Layer | Type | Channels (blend / override / bump) | Layer mods | Masks (type, blend, mask mods) |",
           "|---|---|---|---|---|---|"]
    for i, l in enumerate(stack):
        ch = "; ".join("%s %s%s%s" % (k, v["blend"], (" =%.2f" % v["override"]) if v["override"] is not None else "",
                                     (" bump %.4f" % v["bump"]) if v.get("bump") else "") for k, v in l["channels"].items())
        ms = "; ".join("%s (%s, %s%s)" % (m["name"], m["type"], m["blend"], (", " + "+".join(m["mods"])) if m["mods"] else "")
                       for m in l["masks"])
        out.append("| %d | %s | %s | %s | %s | %s |" % (i, l["layer"], l["type"], ch, ",".join(l["modifiers"]) or "-", ms or "-"))
    return "\n".join(out)


tex = sorted(os.path.basename(p) for p in glob.glob(os.path.join(adir, "textures", "*.png")))
lines = []
lines.append("# %s — Ucupaint layered material + PBR bakes (Claude track)\n" % name)
if ready:
    lines.append("STATUS: **READY v%03d** (`%s_v%03d.blend`). %s\n" % (ready, name, ready, status))
else:
    lines.append("STATUS: IN PROGRESS (latest v%03d), not for integration. %s\n" % (last["ver"], status))
lines.append("""## What this is
- The hero mesh(es) of `%s` (unchanged geometry) re-textured with a **Ucupaint 3.0.0** layered material
  (live, procedural, editable in the Ucupaint panel), then **baked by Ucupaint's own bake targets** to PBR PNGs.
- Built headless by `scripts/ucupaint_monuments.py` (+ helpers `scripts/ucupaint_lib.py`). Re-run:
  `python lib/run_blender.py scripts/ucupaint_monuments.py --timeout 3600 -- --target <t> --ver N --res 4096`
- Palette follows the LOCKED direction (research/E33_RITUAL_FLOOR_DIRECTION.md, 2026-10-24): warm-grey ancient
  stone (rendered #5d574e mid / #8a8377 lit), selective moss green, dark earth sediment on the lower third.

## Blend contents (`%s_v%03d.blend`)
- Runtime objects keep their source names and collections, so `arrangement.json` (copied from the source asset,
  same placements) appends them unchanged. They carry the **`*_Baked`** material: a plain Principled BSDF that
  uses ONLY the baked images (Base Color sRGB, ORM -> R occlusion via a `glTF Material Output` group / G roughness
  / B metallic, tangent-space Normal map on `UVMap`). This is the export material for three.js (glTF).
- Collection `%s_UcupaintLive`: linked duplicates (`*_UcuLive`, same mesh data and UVs, material linked to
  OBJECT) carrying the **live Ucupaint material**. Hidden for render; enable it to edit/re-bake in the Ucupaint
  panel (select a `*_UcuLive` object).
- Other objects of the source asset (rubble / mound / bronze) are included untouched so the arrangement is a
  drop-in replacement.
""" % (cur.get("src", ""), name, ver, name))
lines.append("## Source\n- read-only source: `%s`\n- this version's blend: `%s`\n- objects: %s\n" % (
    os.path.relpath(cur.get("src", ""), CL), os.path.relpath(cur.get("blend", ""), CL),
    ", ".join(cur.get("objects", []))))
lines.append("## UVs (manual prep, not Ucupaint)\n")
for g, u in cur.get("uv", {}).items():
    lines.append("- **%s**: %s; islands %s; UV coverage %.2f; texel density at bake res %d: %.0f px/env-m = %.0f px per "
                 "main-scene metre (env x4.6) = %.2f cm/texel; density spread (log2 std) %s; %.0f s." % (
                     g, u.get("method"), u.get("islands"), u["uv_coverage"], u["res"], u["px_per_env_m"],
                     u["px_per_scene_m"], u["cm_per_texel_scene"], u.get("density_log2_std"), u.get("secs", 0)))
lines.append("""- Why not Smart UV Project: on these decimated Surface-Nets meshes it produced 15-17k islands (avg 7 faces)
  with 0.5 % coverage at the requested margin (measured, `scripts/ucupaint_uvtest.py`). Seam-based Unwrap
  (ANGLE_BASED / CONFORMAL / MINIMUM_STRETCH) on the charts failed on ~36 islands, which left 1.5 % coverage
  or 0 %.
- Used instead (`UL.chart_project`):
  - smooth the vertex normals (40 iterations);
  - label every face by the best of 14 projection directions;
  - majority-filter the labels over face adjacency and merge regions under 150 faces;
  - re-label faces more than 75 deg from their chart direction, so edge-on crack and breach walls do not smear;
  - project each face orthographically along its chart direction (no solver, deterministic, metric scale kept);
  - Pack Islands (CONCAVE, rotate) into ONE 0-1 atlas per material.
- All layers sample 3D Object coordinates, so UV layout only changes texel density, never the pattern shape.
""")

lines.append("## Ucupaint layer stack (as built in v%03d)\n" % ver)
for g, st in cur.get("stack", {}).items():
    lines.append("### %s\n%s\n" % (g, md_stack(st)))
lines.append("""Mask semantics: masks are evaluated top to bottom and combined with their blend mode onto the running mask
value. `MODIFIER (RAMP)` masks threshold the accumulated value (ragged moss / soil edges = up-facing or gradient
`LINEAR_LIGHT` a noise, then a narrow ramp). `IMAGE` masks are Ucupaint Bake-to-Layer AO images (inverted with an
INVERT mask modifier + RAMP). `VCOL` masks read colour attributes written by the build script (`UCU_convex`,
`UCU_concave` from the source asset's curvature attributes; `UCU_side`, `UCU_base`, `UCU_roots`, `UCU_grad`,
`UCU_block`, `UCU_path`, `UCU_scorch` computed in numpy). `HEMI` = Ucupaint fake-lighting mask used as an
up-facing (normal-Z) mask.
""")
lines.append("## Bakes\n")
lines.append("- Ucupaint **Bake-to-Layer AO** (Cycles, 24 samples, denoise + FXAA): `ao_wide` (feeds the AO channel ->"
             " ORM.R and the sediment/soil masks) and `ao_tight` (cracks/sutures/carvings mask; its AO-channel layer is"
             " disabled). Resolution %d.\n" % cur.get("aores", 0))
lines.append("- Ucupaint **bake targets** (`wm.y_bake_all_targets`, global settings: %dx%d, 1 sample, margin 16/8 px,"
             " FXAA, CPU): `<mat> Color` (sRGB), `<mat> Normal` (tangent, OpenGL/+Y, combined with the Height bump),"
             " `<mat> ORM` (R=AO channel, G=Roughness, B=Metallic 0), `<mat> Height` (normalised, optional).\n" % (
                 cur["res"], cur["res"]))
lines.append("- Timings (s since start): `%s`\n" % json.dumps(cur.get("steps", {})))
lines.append("- Runtime copies: `*_2048.png` (Color/Normal/ORM) are Blender `Image.scale` downsamples of the 4K masters"
             " for Quest/WebXR budgets.\n" if any("_2048" in t for t in tex) and cur["res"] > 2048 else "")
lines.append("### Textures (`textures/`)\n" + "\n".join("- `%s`" % t for t in tex) + "\n")
lines.append("## What worked / failed headless (Ucupaint 3.0.0, Blender 5.2.3 -b)\n")
lines.append("""- WORKED as operators inside `temp_override(window, screen, area=VIEW_3D, region)` (the -b session still has
  `wm.windows[0]`): `wm.y_quick_ypaint_node_setup`, `wm.y_new_layer` (COLOR / NOISE / VORONOI), `wm.y_new_layer_mask`
  (HEMI / NOISE / VORONOI / MODIFIER / AO / EDGE_DETECT tested), `wm.y_bake_to_layer` (AO), `wm.y_bake_all_targets`.
- Do NOT override `object`/`active_object` in that context: the bake's FXAA pass makes a temp plane active and a
  forced active object makes it fail with "Object ... is not enabled for rendering" (seen in the probe).
- FAILED headless: `wm.y_new_mask_modifier` and `wm.y_new_ypaint_modifier` (they add the modifier, then crash on
  UI-only `layer_ui` props, so a retry duplicates it) -> used the internals `MaskModifier.add_new_mask_modifier`
  and `modifier_common.add_new_modifier` + `reconnect_layer_nodes` / `rearrange_layer_nodes`.
- `wm.y_bake_channels` no longer exists in 3.0 (deprecated, unregistered) -> bake targets.
- Masks from existing data (an already-baked AO image reused by several layers, existing colour attributes) use
  `mask_common.add_new_mask(...)` directly; the operator refuses existing names.
- Noise sources default to the 3-channel `Color` output; every NOISE layer/mask is switched to `Fac` (and VORONOI
  masks to `Distance`) via `socket_input_name`, otherwise ramps calibrated on Fac read a compressed grey.
- Quick setup multiplies Color x AO into Base Color; the build re-links Color straight to Base Color so the live
  preview matches the runtime material (AO lives only in ORM.R).
""")
for r in R:
    if r.get("failed"):
        lines.append("- v%03d logged failures: %s\n" % (r["ver"], "; ".join(r["failed"])))
log = os.path.join(adir, "iteration_log.md")
if os.path.exists(log):
    lines.append(open(log, encoding="utf-8").read())
open(os.path.join(adir, "README.md"), "w", encoding="utf-8").write("\n".join(lines))
meta = {"asset": name, "version": ver, "status": ("READY v%03d" % ready) if ready else "WIP",
        "blend": "%s_v%03d.blend" % (name, ver), "source_blend": cur.get("blend_src", cur.get("src", "")),
        "objects": cur.get("objects"), "baked_materials": cur.get("baked_materials"),
        "live_collection": name + "_UcupaintLive", "bake_res": cur["res"], "ao_res": cur.get("aores"),
        "uv": cur.get("uv"), "textures": tex, "timings_s": cur.get("steps"),
        "renders_baked": cur.get("renders_baked"), "renders_live": cur.get("renders_live"),
        "units": "env units (main build scales x4.6)", "palette": "LOCKED 2026-10-24 (E33_RITUAL_FLOOR_DIRECTION.md)"}
json.dump(meta, open(os.path.join(adir, "meta.json"), "w"), indent=1, default=str)
print("wrote README.md + meta.json for", name, "v%03d" % ver)
