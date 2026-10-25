"""UCUPAINT MATERIAL ARTIST - layered Ucupaint materials + PBR bakes for the Crownfall hero monuments.

python lib/run_blender.py scripts/ucupaint_monuments.py --timeout 3600 -- --target skull --ver 1 --res 4096
  --target skull|hand|altar   --ver N   --res 1024..4096   [--aores 2048] [--norender] [--nobake]

Per run:  append source asset (latest READY) -> Smart-UV atlas -> colour-attribute masks -> Ucupaint stack
-> Ucupaint Bake-to-Layer AO (wide + tight) -> Ucupaint bake targets (Color / Normal / ORM / Height)
-> PNGs in assets/CFCL_Ucupaint_<T>/textures/ -> clean *_Baked Principled material -> linked-duplicate
live objects -> save assets/CFCL_Ucupaint_<T>/CFCL_Ucupaint_<T>_v###.blend -> renders/ucupaint/<t>/iterNN_*.
"""
import sys
import os
import json
import math
import time
import shutil
import traceback

import bpy
from mathutils import Vector

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CL, "lib"))
sys.path.insert(0, os.path.join(CL, "scripts"))
import cf_render as R          # noqa: E402
import ucupaint_lib as UL      # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None, cast=str):
    if "--" + name in argv:
        i = argv.index("--" + name)
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            return cast(argv[i + 1])
        return True
    return default


TARGET = arg("target", "skull")
VER = arg("ver", 1, int)
RES = arg("res", 2048, int)
AORES = arg("aores", min(RES, 2048), int)
NORENDER = bool(arg("norender", False))
NOBAKE = bool(arg("nobake", False))
T0 = time.time()
REPORT = {"target": TARGET, "ver": VER, "res": RES, "aores": AORES, "steps": {}, "worked": [], "failed": []}


def log(*a):
    print("[ucu-mon %6.1fs]" % (time.time() - T0), *a, flush=True)


def hexlin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


# =====================================================================================  target specs
ASSETS = os.path.join(CL, "assets")
# LOCKED palette (research/E33_RITUAL_FLOOR_DIRECTION.md, 2026-10-24): ancient stone = warm grey, rendered
# #5d574e mid / #8a8377 lit; selective moss green #3e4a26-#4a5a2e; sediment / dark earth on the lower third.
# Values below are ALBEDO (sRGB hex), calibrated against cf_render lights by measuring the renders.
SOIL = ["#211c16", "#2c251d", "#382f25", "#463c30"]
MOSS = ["#262a1f", "#353a2c", "#444a37", "#4f5641", "#606652"]   # v004: desaturated olive (coordinator: S .18-.23 rendered, ~#4f5a3a)
SPECS = {
    "skull": dict(
        name="Skull", src_dir="CFCL_Hero_Skull", src_blend="CFCL_Hero_Skull_v006.blend",
        groups=[("Skull", ["CFCL_Hero_Skull", "CFCL_Hero_Skull_Mandible"])],
        render_main="CFCL_Hero_Skull",
        pal=dict(base="#857a69", t_dark="#5f5548", t_mid="#837867", t_light="#a39783", weather="#5a5144",
                 streak="#4c443a", algae="#4f5040", sediment="#2a241e", crack="#191613", edge="#ad9f8a",
                 deep="#120f0c", ochre="#7a6444", mineral="#241a13", erosion="#a39784", vein="#a4987f",
                 damp="#3b342b",
                 soil=SOIL, roots="#2a221b", moss=MOSS, lichen="#8a8476", lichen2="#77715f", lichen_red="#4e1c18"),
        rough=dict(base=0.68, streak=0.6, sediment=0.88, crack=0.88, edge=0.5, soil=0.93, roots=0.78, moss=0.93,
                   lichen=0.86),
        tone_scale=0.75, mottle_scale=5.0, grain_scale=42.0, pit_scale=16.0, moss_scale=20.0, ragged_scale=2.2,
        island_scale=4.5, soil_scale=9.0, moss_scale2=28.0,
        ao_wide=0.35, ao_tight=0.045,
        bump=dict(mottle=0.0022, grain=0.0009, pits=0.0028, chips=0.0015, soil=0.004, roots=0.016, moss=0.009,
                  lichen=0.0012),
        moss_mode="hemi", moss_amt=1.0, hemi_lo=0.70, hemi_hi=0.95, moss_thresh=0.56, cav_moss=0.55,
        moss_upper=(0.55, 0.75), deep=dict(ramp=(0.30, 0.58), tight=(0.55, 0.80)), weather_amt=0.4, ao_deep=0.9,
        fossil=dict(ochre_amt=0.3, erosion_amt=0.5, vein_amt=0.18),   # v009: veins were white scribbles in main
        base_band=(0.10, 0.40), root_band=(0.12, 0.50),
        streak_amt=0.55, algae_amt=0.18, sed_amt=0.9, crack_amt=0.95, edge_amt=0.6, lichen_amt=0.35, roots_amt=1.0,
    ),
    "hand": dict(
        name="Hand", src_dir="CFCL_Hero_Hand", src_blend="CFCL_Hero_Hand_v006.blend",
        groups=[("Hand", ["CFCL_Hero_Hand", "CFCL_Hero_Hand_FingerFragment"])],
        render_main="CFCL_Hero_Hand", mat_tag="_HandStone",
        pal=dict(base="#5a5b56", t_dark="#3d3f3b", t_mid="#595a55", t_light="#76776f", weather="#3e3f3a",
                 streak="#3d3d38", algae="#40443a", sediment="#25231f", crack="#151513", edge="#8e8f88",
                 deep="#0f0f0d", ochre="#665a46", mineral="#1f1c18", erosion="#8b8a80", vein="#a3a296",
                 damp="#33332e",
                 soil=SOIL, roots="#271f19", moss=MOSS, lichen="#7f7a6c", lichen2="#6c6757", lichen_red="#4a1a17"),
        rough=dict(base=0.72, streak=0.62, sediment=0.88, crack=0.9, edge=0.40, soil=0.93, roots=0.78, moss=0.93,
                   lichen=0.86),
        tone_scale=0.8, mottle_scale=5.5, grain_scale=42.0, pit_scale=16.0, moss_scale=20.0, ragged_scale=2.4,
        island_scale=5.0, soil_scale=9.0,
        ao_wide=0.30, ao_tight=0.04,
        bump=dict(mottle=0.0022, grain=0.0009, pits=0.0028, chips=0.0015, soil=0.004, roots=0.012, moss=0.008,
                  lichen=0.0012),
        moss_mode="grad", moss_amt=1.0, moss_thresh=0.50, cav_moss=0.35, soil_over_moss=True,
        base_abs=(1.05, 1.75), roots_abs=(1.0, 2.2),
        deep=dict(ramp=(0.30, 0.58), tight=(0.55, 0.80)), ao_deep=0.6,
        fossil=dict(ochre_amt=0.25, erosion_amt=0.45, vein_amt=0.35),
        base_band=(0.05, 0.28), root_band=(0.08, 0.42),
        streak_amt=0.5, algae_amt=0.25, sed_amt=0.92, crack_amt=0.9, edge_amt=0.9, lichen_amt=0.5, roots_amt=0.95,
    ),
    "altar": dict(
        name="AltarDais", src_dir="CFCL_Arch_AltarDais", src_blend="CFCL_Arch_AltarDais_v008.blend",
        groups=[("AltarSkirt", ["CFCL_Arch_BoardSkirt"]),
                ("AltarFloor", ["CFCL_Arch_DaisFloor", "CFCL_Arch_DaisRubble"]),
                ("AltarApproaches", ["CFCL_Arch_Approaches", "CFCL_Arch_Stele_A", "CFCL_Arch_Stele_B",
                                     "CFCL_Arch_Stele_C", "CFCL_Arch_Stele_D"])],
        render_main="CFCL_Arch_DaisFloor", mat_tag="_AncientStone",
        pal=dict(base="#5a544c", t_dark="#403c36", t_mid="#5a544c", t_light="#736d64", weather="#3c3832",
                 streak="#3d3933", algae="#3f4232", sediment="#26211c", crack="#161512", edge="#78726a",
                 soil=SOIL, roots="#251e18", moss=MOSS, lichen="#7c776a", lichen2="#6a6557", lichen_red="#481a17",
                 block="#3b3833", path="#6c675e", scorch="#171512"),
        rough=dict(base=0.74, streak=0.62, sediment=0.9, crack=0.9, edge=0.55, soil=0.93, roots=0.78, moss=0.93,
                   lichen=0.86, path=0.38, scorch=0.9),
        tone_scale=0.5, mottle_scale=4.0, grain_scale=40.0, pit_scale=18.0, moss_scale=24.0, ragged_scale=3.0,
        island_scale=6.0, soil_scale=10.0,
        ao_wide=0.25, ao_tight=0.02,
        bump=dict(mottle=0.0007, grain=0.0003, pits=0.0008, chips=0.0006, soil=0.002, roots=0.005, moss=0.004,
                  lichen=0.0006),   # v005: cut fine bump ~60 % (flat cut stone read as blotchy "camouflage")
        moss_mode="recess", moss_amt=1.0, moss_thresh=0.50, cav_moss=1.0, islands=(0.30, 0.36), ragged_amt=0.30,
        concave_amt=0.0, convex_ramp=(0.70, 0.98), fix_normals=True,
        # v006: the stacked skirt/floor geometry is heavily self-occluded (tight-AO median 0.72, wide 0.41), so
        # the inverted-AO masks must start much deeper or they speckle every stone face
        sed_ramp=[(0.50, 0.0), (0.78, 1.0)], crack_ramp=[(0.60, 0.0), (0.85, 1.0)], recess_ramp=[(0.40, 0.0), (0.70, 1.0)],
        base_band=None, root_band=None,
        streak_amt=0.4, algae_amt=0.25, sed_amt=0.95, crack_amt=0.95, edge_amt=0.6, lichen_amt=0.5, roots_amt=0.9,
    ),
}
S = SPECS[TARGET]
P = S["pal"]
NAME = "CFCL_Ucupaint_" + S["name"]
ADIR = os.path.join(ASSETS, NAME)
TEX = os.path.join(ADIR, "textures")
RDIR = os.path.join(CL, "renders", "ucupaint", TARGET)
os.makedirs(TEX, exist_ok=True)
os.makedirs(RDIR, exist_ok=True)
SRC_BLEND = os.path.join(ASSETS, S["src_dir"], S["src_blend"])
REPORT["src"] = SRC_BLEND


def step(name):
    REPORT["steps"][name] = round(time.time() - T0, 1)
    log("STEP", name)


# =====================================================================================  load
UL.enable()
step("ucupaint_enabled")
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
with bpy.data.libraries.load(SRC_BLEND, link=False) as (src, dst):
    dst.collections = [c for c in src.collections if c.startswith(S["src_dir"]) or c.startswith("CFCL_Arch_AltarDais")]
    all_names = list(src.objects)
scene = bpy.context.scene
loaded = []
for c in dst.collections:
    if c is None:
        continue
    if c.name not in [x.name for x in scene.collection.children_recursive]:
        try:
            scene.collection.children.link(c)
        except RuntimeError:
            pass
    loaded.append(c.name)
# objects not in any collection we loaded
have = {o.name for o in bpy.data.objects}
missing = [n for g in S["groups"] for n in g[1] if n not in have]
if missing:
    with bpy.data.libraries.load(SRC_BLEND, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in missing]
    col = bpy.data.collections.new(S["src_dir"] + "_extra")
    scene.collection.children.link(col)
    for o in dst.objects:
        if o is not None:
            col.objects.link(o)
# drop stand-ins / lights / cameras that might live in the asset collections
for o in list(bpy.data.objects):
    if o.type in ("LIGHT", "CAMERA") or "StandIn" in o.name or "Preview" in o.name:
        bpy.data.objects.remove(o)
REPORT["collections"] = loaded
REPORT["objects"] = sorted(o.name for o in bpy.data.objects)
log("loaded", loaded, REPORT["objects"])
step("loaded")


# =====================================================================================  geometry prep
def components(me):
    """per-vertex connected-component id (union-find)."""
    import numpy as np
    n = len(me.vertices)
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    par = list(range(n))

    def f(x):
        r = x
        while par[r] != r:
            r = par[r]
        while par[x] != r:
            par[x], x = r, par[x]
        return r
    for a, b in e.reshape(-1, 2).tolist():
        ra, rb = f(a), f(b)
        if ra != rb:
            par[ra] = rb
    return np.array([f(i) for i in range(n)], np.int64)


def smoothstep(x, a, b):
    import numpy as np
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def prep_attributes(objs):
    """Colour attributes used as Ucupaint VCOL masks (manual, numpy)."""
    import numpy as np
    import cf_materials as CM
    info = {}
    for o in objs:
        me = o.data
        co, nor = UL.vert_arrays(o)
        cvx, ccv = UL.float_attr(o, "cf_convex"), UL.float_attr(o, "cf_concave")
        if cvx is None or ccv is None:
            CM.bake_curvature(o)
            cvx, ccv = UL.float_attr(o, "cf_convex"), UL.float_attr(o, "cf_concave")
        UL.write_gray_attr(o, "UCU_convex", cvx)
        UL.write_gray_attr(o, "UCU_concave", ccv)
        nz = nor[:, 2]
        UL.write_gray_attr(o, "UCU_side", 1.0 - np.abs(nz) ** 1.5)
        z = co[:, 2]
        if S.get("moss_upper"):
            relu = (z - z.min()) / max(z.max() - z.min(), 1e-6)
            up_v = smoothstep(relu, *S["moss_upper"]) if o.name == S["groups"][0][1][0] else np.zeros_like(z)
            UL.write_gray_attr(o, "UCU_upper", up_v)
        if S.get("base_abs") and o.name == S["groups"][0][1][0]:
            # hand v003: soil / roots anchored above the mound top (z 0.8), not to the object's full height
            UL.write_gray_attr(o, "UCU_base", 1.0 - smoothstep(z, *S["base_abs"]))
            UL.write_gray_attr(o, "UCU_roots", 1.0 - smoothstep(z, *S["roots_abs"]))
        elif S["base_band"]:
            rel = (z - z.min()) / max(z.max() - z.min(), 1e-6)
            UL.write_gray_attr(o, "UCU_base", 1.0 - smoothstep(rel, *S["base_band"]))
            UL.write_gray_attr(o, "UCU_roots", 1.0 - smoothstep(rel, *S["root_band"]))
        else:   # altar: lower frieze / cornice underside / rubble core
            UL.write_gray_attr(o, "UCU_base", 1.0 - smoothstep(z, -1.32, -0.98))
            UL.write_gray_attr(o, "UCU_roots", (1.0 - smoothstep(z, -1.30, -0.90)) * 0.8)
        rng = np.random.default_rng(7)
        if TARGET == "hand":
            z = co[:, 2]
            # forearm 0.88 -> palm 0.55 -> fingers 0.27 -> tips 0 (index/middle tips are the highest points)
            # v002: forearm 0.85 -> back of palm 0.50 -> fingers 0.40 -> tips 0 (with the ragged threshold this gives
            # ~80-90 % / ~40 % / ~20-30 % coverage)
            g = 0.85 - 0.35 * smoothstep(z, 2.25, 2.80) - 0.10 * smoothstep(z, 3.05, 3.50)
            g = g - 0.40 * smoothstep(z, 4.30, 4.60)
            g = g - 0.30 * smoothstep(cvx, 0.45, 0.95) * smoothstep(z, 3.0, 3.3)   # curled tips / knuckle crowns
            UL.write_gray_attr(o, "UCU_grad", np.clip(g, 0, 1))
            info[o.name] = {"grad_mean": float(np.clip(g, 0, 1).mean())}
        if TARGET == "altar":
            comp = components(me)
            uniq, inv = np.unique(comp, return_inverse=True)
            rv = rng.random(len(uniq))[inv]
            UL.write_gray_attr(o, "UCU_block", rv)
            x, y, z = co[:, 0], co[:, 1], co[:, 2]
            r = np.sqrt(x * x + y * y) + 1e-6
            # worn paths: radial lanes from the stair (+Y) and the player (-Y) to the skirt, plus ring R1
            lane = (1 - smoothstep(np.abs(x), 0.45, 0.95)) * smoothstep(np.abs(y), 2.35, 2.7)
            ring = 0.45 * (1 - smoothstep(np.abs(r - 3.05), 0.25, 0.55))
            up = smoothstep(nz, 0.6, 0.9)
            UL.write_gray_attr(o, "UCU_path", np.clip(np.maximum(lane, ring) * up, 0, 1))
            # scorch: outer rim / cornice / frieze, strongest toward the lava (+-X and -Y), weak at the stair (+Y)
            ang = np.arctan2(y, x)
            side_w = 0.25 + 0.75 * np.clip(1.0 - np.maximum(0, np.sin(ang)) ** 2 * 0.85, 0, 1)
            outw = (x * nor[:, 0] + y * nor[:, 1]) / r
            sc = smoothstep(r, 3.75, 4.45) * (0.35 + 0.65 * smoothstep(outw, -0.1, 0.6)) * side_w
            sc *= 1 - 0.6 * smoothstep(z, -0.80, -0.70) * up
            heat = UL.float_attr(o, "cf_heat")      # v008 source asset: lava-facing heat attribute
            if heat is not None:
                sc = np.maximum(sc * 0.5, heat)
            UL.write_gray_attr(o, "UCU_scorch", np.clip(sc, 0, 1))
            info[o.name] = {"blocks": int(len(uniq)), "path_mean": float(lane.mean())}
    return info


# =====================================================================================  Ucupaint stack
def build_stack(obj, node, imgs):
    """Bottom -> top.  imgs: dict ao_wide / ao_tight images (Ucupaint bake-to-layer results)."""
    yp = node.node_tree.yp
    rgh = S["rough"]
    bmp = S["bump"]
    A = lambda *a, **k: UL.add_layer(obj, node, *a, **k)       # noqa: E731
    M = lambda *a, **k: UL.add_mask(obj, node, *a, **k)        # noqa: E731

    def ao_mask(L, key, name, stops, blend="MULTIPLY", intensity=1.0):
        m = M(L, "IMAGE", name, image=imgs[key], blend=blend, intensity=intensity)
        UL.mask_invert(L, m)
        UL.mask_ramp(L, m, stops)
        return m

    # 1 Base stone
    L = A("Base Stone", "COLOR", color=hexlin(P["base"]))
    UL.lch(L, yp, "Roughness", value=rgh["base"])
    # 1b Roughness variation (review: "much of the surface has similar roughness") - polished vs powdery patches
    # (v008: no generic roughness-noise layer - main's cf_wear pass adds a 3-scale breakup on top)
    # 2 Large tonal variation (noise -> palette ramp)
    L = A("Tone Large", "NOISE", src={"Scale": S["tone_scale"], "Detail": 3.0, "Roughness": 0.55, "Distortion": 0.25},
          intensity=0.92)
    UL.layer_ramp(L, [(0.30, hexlin(P["t_dark"])), (0.50, hexlin(P["t_mid"])), (0.70, hexlin(P["t_light"]))])
    # 3 Per-block tone (altar)
    if TARGET == "altar" and S.get("block_tone", False):
        # v007: OFF - v008's stones are ~800 small mesh components (relief strokes, chips, strips), so a random tone
        # per component became a dark/light mosaic ("camouflage") on every face
        L = A("Block Tone", "COLOR", color=hexlin(P["block"]), intensity=0.55)
        M(L, "VCOL", "blockvar", vcol="UCU_block", blend="MULTIPLY")
    # 4 Mottling (overlay) + height
    L = A("Mottle", "NOISE", blend="OVERLAY", intensity=0.30,
          src={"Scale": S["mottle_scale"], "Detail": 8.0, "Roughness": 0.62, "Distortion": 0.0})
    UL.lch(L, yp, "Height", blend="ADD", bump=bmp["mottle"])
    # 4b Large dark weathering patches (v003: more large-scale value variation, ancient look)
    L = A("Weathering Dark", "COLOR", color=hexlin(P["weather"]), intensity=S.get("weather_amt", 0.55))
    UL.lch(L, yp, "Roughness", value=0.76)
    m = M(L, "NOISE", "weather patches", src={"Scale": 0.9, "Detail": 4.0, "Roughness": 0.55, "Distortion": 0.3},
          translation=(2.0, 5.0, 1.0))
    UL.mask_ramp(L, m, [(0.50, 0.0), (0.64, 1.0)])
    # 5 Grain (height only)
    L = A("Grain Height", "NOISE", channel="Height", blend="ADD",
          src={"Scale": S["grain_scale"], "Detail": 4.0, "Roughness": 0.6})
    UL.lch(L, yp, "Height", blend="ADD", bump=bmp["grain"])
    # 6 Erosion pits (voronoi distance -> pits, height SUBTRACT), only in weathered patches
    L = A("Erosion Pits", "VORONOI", channel="Height", blend="SUBTRACT", out="Distance",
          src={"Scale": S["pit_scale"], "Randomness": 1.0})
    UL.layer_ramp(L, [(0.0, 1.0), (0.16, 0.0)])
    UL.lch(L, yp, "Height", blend="SUBTRACT", bump=bmp["pits"])
    m = M(L, "NOISE", "weathered patches", src={"Scale": 1.4, "Detail": 4.0, "Roughness": 0.55})
    UL.mask_ramp(L, m, [(0.42, 0.0), (0.58, 1.0)])
    # 7 Stains / streaks running down (vertical-stretched noise x side-facing)
    L = A("Stain Streaks", "COLOR", color=hexlin(P["streak"]), intensity=S["streak_amt"])
    UL.lch(L, yp, "Roughness", value=rgh["streak"])
    M(L, "VCOL", "side", vcol="UCU_side", blend="MULTIPLY")
    m = M(L, "NOISE", "streak noise", src={"Scale": 1.0, "Detail": 6.0, "Roughness": 0.62},
          scale=(9.0, 9.0, 0.45))
    UL.mask_ramp(L, m, [(0.50, 0.0), (0.63, 1.0)])
    m = M(L, "NOISE", "streak breakup", src={"Scale": 1.4, "Detail": 3.0, "Roughness": 0.5},
          translation=(4.0, 9.0, 2.0))
    UL.mask_ramp(L, m, [(0.44, 0.0), (0.60, 1.0)])
    # 8 Green-grey stain (selective)
    L = A("Green Stain", "COLOR", color=hexlin(P["algae"]), intensity=S["algae_amt"])
    m = M(L, "NOISE", "stain patches", src={"Scale": 1.3, "Detail": 4.0, "Roughness": 0.55})
    UL.mask_ramp(L, m, [(0.50, 0.0), (0.66, 1.0)])
    M(L, "VCOL", "stain side", vcol="UCU_side", blend="MULTIPLY", intensity=0.7)
    # 8b Fossil mineral tint: iron-ochre staining patches (partly fossilised look)
    if S.get("fossil"):
        L = A("Iron Ochre Stain", "COLOR", color=hexlin(P["ochre"]), intensity=S["fossil"]["ochre_amt"])
        UL.lch(L, yp, "Roughness", value=0.74)
        m = M(L, "NOISE", "ochre patches", src={"Scale": 1.1, "Detail": 5.0, "Roughness": 0.6},
              translation=(9.0, 3.0, 4.0))
        UL.mask_ramp(L, m, [(0.53, 0.0), (0.66, 1.0)])
        m = M(L, "NOISE", "ochre grain", src={"Scale": 7.0, "Detail": 4.0, "Roughness": 0.6})
        UL.mask_ramp(L, m, [(0.35, 0.3), (0.6, 1.0)])
    # 9 Sediment collected in cavities (Ucupaint-baked wide AO, inverted) + concave attribute
    L = A("Sediment Cavities", "COLOR", color=hexlin(P["sediment"]), intensity=S["sed_amt"])
    UL.lch(L, yp, "Roughness", value=rgh["sediment"])
    ao_mask(L, "ao_wide", "ao wide inv", list(S.get("sed_ramp", [(0.15, 0.0), (0.55, 1.0)])))
    if S.get("concave_amt", 0.3) > 0:
        M(L, "VCOL", "concave", vcol="UCU_concave", blend="ADD", intensity=S.get("concave_amt", 0.3))
    m = M(L, "NOISE", "sediment breakup", src={"Scale": 3.5, "Detail": 6.0, "Roughness": 0.6})
    UL.mask_ramp(L, m, [(0.32, 0.5), (0.62, 1.0)])
    # 10 Cracks / sutures / carved grooves darkened (Ucupaint-baked tight AO, inverted)
    L = A("Cracks Dark", "COLOR", color=hexlin(P["crack"]), intensity=S["crack_amt"])
    UL.lch(L, yp, "Roughness", value=rgh["crack"])
    ao_mask(L, "ao_tight", "ao tight inv", list(S.get("crack_ramp", [(0.35, 0.0), (0.65, 1.0)])))
    # 10a Dark mineral (manganese/iron) staining inside cavities, slightly glossy, spilling out in drips
    if S.get("fossil"):
        L = A("Mineral Staining", "COLOR", color=hexlin(P["mineral"]), intensity=0.85)
        UL.lch(L, yp, "Roughness", value=0.5)
        ao_mask(L, "ao_wide", "cavity mineral", [(0.22, 0.0), (0.52, 1.0)])
        m = M(L, "NOISE", "mineral drips", blend="ADD", intensity=0.35,
              src={"Scale": 1.0, "Detail": 5.0, "Roughness": 0.6}, scale=(8.0, 8.0, 0.5), translation=(1.0, 6.0, 2.0))
        UL.mask_ramp(L, m, [(0.55, 0.0), (0.68, 1.0)])
        m = M(L, "NOISE", "mineral breakup", src={"Scale": 4.0, "Detail": 5.0, "Roughness": 0.6})
        UL.mask_ramp(L, m, [(0.32, 0.45), (0.6, 1.0)])
    # 10b Deep cavities (skull v005: orbits, nasal aperture, between teeth, temporal fossa must render <= 0.08)
    if S.get("deep"):
        L = A("Deep Cavities", "COLOR", color=hexlin(P["deep"]), intensity=1.0)
        UL.lch(L, yp, "Roughness", value=0.96)
        ao_mask(L, "ao_deep" if "ao_deep" in imgs else "ao_wide", "deep occlusion",
                [(S["deep"]["ramp"][0], 0.0), (S["deep"]["ramp"][1], 1.0)])
        ao_mask(L, "ao_tight", "tooth gaps", [(S["deep"]["tight"][0], 0.0), (S["deep"]["tight"][1], 1.0)],
                blend="LIGHTEN")
    # 10c Fracture erosion: powdery lighter halo + pitting around cracks (band of tight AO, crack core excluded)
    if S.get("fossil"):
        L = A("Fracture Erosion", "COLOR", color=hexlin(P["erosion"]), intensity=S["fossil"]["erosion_amt"])
        UL.lch(L, yp, "Roughness", value=0.9)
        UL.lch(L, yp, "Height", blend="SUBTRACT", value=1.0, bump=0.0015)
        ao_mask(L, "ao_tight", "near fracture", [(0.10, 0.0), (0.26, 1.0)])
        ao_mask(L, "ao_tight", "not crack core", [(0.36, 1.0), (0.52, 0.0)])
        m = M(L, "NOISE", "erosion grain", src={"Scale": 14.0, "Detail": 4.0, "Roughness": 0.65})
        UL.mask_ramp(L, m, [(0.40, 0.2), (0.58, 1.0)])
        # 10d Calcite / mineral veins (fossilised): thin pale lines, slightly glossy
        L = A("Mineral Veins", "COLOR", color=hexlin(P["vein"]), intensity=S["fossil"]["vein_amt"])
        UL.lch(L, yp, "Roughness", value=0.42)
        m = M(L, "NOISE", "vein lines", src={"Scale": 1.6, "Detail": 4.0, "Roughness": 0.55, "Distortion": 0.6},
              translation=(5.0, 1.0, 8.0))
        UL.mask_ramp(L, m, [(0.492, 0.0), (0.4985, 1.0), (0.5015, 1.0), (0.508, 0.0)])
        m = M(L, "NOISE", "vein breakup", src={"Scale": 1.3, "Detail": 3.0, "Roughness": 0.5})
        UL.mask_ramp(L, m, [(0.48, 0.0), (0.58, 1.0)])
    # 11 Worn polished paths (altar)
    if TARGET == "altar":
        L = A("Worn Paths", "COLOR", color=hexlin(P["path"]), intensity=0.7)
        UL.lch(L, yp, "Roughness", value=rgh["path"])
        M(L, "VCOL", "path", vcol="UCU_path", blend="MULTIPLY")
        m = M(L, "NOISE", "path breakup", src={"Scale": 2.0, "Detail": 5.0, "Roughness": 0.55})
        UL.mask_ramp(L, m, [(0.35, 0.5), (0.6, 1.0)])
    # 12 Chipped edges: fresh lighter stone on arrises, chips slightly recessed
    L = A("Edge Chips", "COLOR", color=hexlin(P["edge"]), intensity=S["edge_amt"])
    UL.lch(L, yp, "Roughness", value=rgh["edge"])
    UL.lch(L, yp, "Height", blend="SUBTRACT", value=1.0, bump=bmp["chips"])
    m = M(L, "VCOL", "convex", vcol="UCU_convex", blend="MULTIPLY")
    UL.mask_ramp(L, m, [(S.get("convex_ramp", (0.45, 0.85))[0], 0.0), (S.get("convex_ramp", (0.45, 0.85))[1], 1.0)])
    m = M(L, "NOISE", "chip breakup", src={"Scale": 6.0, "Detail": 4.0, "Roughness": 0.6})
    UL.mask_ramp(L, m, [(0.50, 0.0), (0.56, 1.0)])
    # 13 Scorch (altar, lava side)
    if TARGET == "altar":
        L = A("Scorch Soot", "COLOR", color=hexlin(P["scorch"]), intensity=0.85)
        UL.lch(L, yp, "Roughness", value=rgh["scorch"])
        M(L, "VCOL", "scorch", vcol="UCU_scorch", blend="MULTIPLY")
        m = M(L, "NOISE", "soot plumes", src={"Scale": 1.6, "Detail": 6.0, "Roughness": 0.6},
              scale=(1.0, 1.0, 0.45))
        UL.mask_ramp(L, m, [(0.35, 0.2), (0.62, 1.0)])
    # 12b Damp: darker and glossy where moisture collects (low sheltered zone, undersides, cavities)
    if S.get("fossil"):
        L = A("Damp Moisture", "COLOR", color=hexlin(P["damp"]), intensity=0.45)
        UL.lch(L, yp, "Roughness", value=0.3)
        M(L, "VCOL", "low damp zone", vcol="UCU_roots", blend="MULTIPLY")
        m = M(L, "HEMI", "undersides", blend="ADD", intensity=0.6, hemi_vector=(0.0, 0.0, 1.0), hemi_space="OBJECT",
              hemi_prev_normal=False)
        UL.mask_ramp(L, m, [(0.25, 1.0), (0.45, 0.0)])
        m = M(L, "NOISE", "damp breakup", src={"Scale": 2.5, "Detail": 5.0, "Roughness": 0.6})
        UL.mask_ramp(L, m, [(0.42, 0.0), (0.6, 1.0)])

    def soil_roots():
        # 14 Soil / dark earth rising up the lower third (+ into low cavities), ragged edge
        L = A("Soil Base", "NOISE", src={"Scale": S["soil_scale"], "Detail": 7.0, "Roughness": 0.66, "Distortion": 0.3})
        sp = [hexlin(c) for c in P["soil"]]
        UL.layer_ramp(L, [(0.32, sp[0]), (0.45, sp[1]), (0.56, sp[2]), (0.70, sp[3])])
        UL.lch(L, yp, "Roughness", value=rgh["soil"])
        UL.lch(L, yp, "Height", blend="ADD", bump=bmp["soil"])
        M(L, "VCOL", "lower third", vcol="UCU_base", blend="MULTIPLY")
        ao_mask(L, "ao_wide", "low cavity soil", [(0.2, 0.0), (0.6, 1.0)], blend="ADD", intensity=0.35)
        M(L, "NOISE", "soil ragged", blend="LINEAR_LIGHT", intensity=0.5,
          src={"Scale": 2.6, "Detail": 8.0, "Roughness": 0.66})
        m = M(L, "MODIFIER", "soil threshold", blend="MIX", modifier_type="RAMP")
        UL.modmask_ramp(m, [(0.44, 0.0), (0.56, 1.0)])
        # 15 Exposed roots crawling over the lower parts (painted tendrils with real height)
        L = A("Roots", "COLOR", color=hexlin(P["roots"]), intensity=S["roots_amt"])
        UL.lch(L, yp, "Roughness", value=rgh["roots"])
        UL.lch(L, yp, "Height", blend="ADD", value=1.0, bump=bmp["roots"])
        m = M(L, "NOISE", "tendril A", blend="MIX", src={"Scale": 1.2, "Detail": 3.0, "Roughness": 0.5},
              scale=(2.2, 2.2, 0.7))
        UL.mask_ramp(L, m, [(0.455, 0.0), (0.488, 1.0), (0.512, 1.0), (0.545, 0.0)])
        m = M(L, "NOISE", "tendril B", blend="LIGHTEN", src={"Scale": 2.4, "Detail": 2.0, "Roughness": 0.5},
              scale=(2.0, 2.0, 0.85), translation=(3.3, 1.7, 0.4))
        UL.mask_ramp(L, m, [(0.470, 0.0), (0.492, 1.0), (0.508, 1.0), (0.530, 0.0)])
        M(L, "VCOL", "root zone", vcol="UCU_roots", blend="MULTIPLY")
        m = M(L, "NOISE", "root breakup", src={"Scale": 2.2, "Detail": 3.0, "Roughness": 0.5})
        UL.mask_ramp(L, m, [(0.40, 0.0), (0.50, 1.0)])
        return L
    def moss_layer():
        # 16 Moss (selective green): clump-noise -> moss palette; top / crevices / gradient; ragged; stone islands
        L = A("Moss", "NOISE", src={"Scale": S["moss_scale"], "Detail": 7.0, "Roughness": 0.68, "Distortion": 0.35},
              intensity=S["moss_amt"])
        mp = [hexlin(c) for c in P["moss"]]
        UL.layer_ramp(L, [(0.28, mp[0]), (0.40, mp[1]), (0.52, mp[2]), (0.62, mp[3]), (0.74, mp[4])])
        UL.lch(L, yp, "Roughness", value=rgh["moss"])
        UL.lch(L, yp, "Height", blend="ADD", bump=bmp["moss"])
        if S["moss_mode"] == "hemi":
            m = M(L, "HEMI", "up facing", blend="MULTIPLY", hemi_vector=(0.0, 0.0, 1.0), hemi_space="OBJECT",
                  hemi_prev_normal=False)
            try:
                hs = UL.C().get_mask_source(m)
                REPORT["hemi_tree"] = [(n.type, getattr(n, "operation", "")) for n in hs.node_tree.nodes]
            except Exception as e:
                REPORT["hemi_tree"] = repr(e)
            UL.mask_ramp(L, m, [(S["hemi_lo"], 0.0), (S["hemi_hi"], 1.0)])
            if S.get("fossil"):
                # v007: crown only where up-facing, then moisture traps anywhere: sutures/cracks, the damp low zone
                if S.get("moss_upper"):
                    M(L, "VCOL", "upper cranium only", vcol="UCU_upper", blend="MULTIPLY")
                ao_mask(L, "ao_tight", "crevice moss", [(0.18, 0.0), (0.45, 1.0)], blend="ADD",
                        intensity=S["cav_moss"])
                M(L, "VCOL", "damp low moss", vcol="UCU_roots", blend="ADD", intensity=0.3)
            else:
                ao_mask(L, "ao_tight", "crevice moss", [(0.15, 0.0), (0.5, 1.0)], blend="ADD", intensity=S["cav_moss"])
                if S.get("moss_upper"):
                    M(L, "VCOL", "upper cranium only", vcol="UCU_upper", blend="MULTIPLY")
        elif S["moss_mode"] == "grad":
            M(L, "VCOL", "forearm->tips gradient", vcol="UCU_grad", blend="MULTIPLY")
            ao_mask(L, "ao_wide", "crease moss", [(0.1, 0.0), (0.5, 1.0)], blend="ADD", intensity=S["cav_moss"])
        else:   # recess: carvings / joints / recesses only
            ao_mask(L, "ao_tight", "recess", list(S.get("recess_ramp", [(0.08, 0.0), (0.35, 1.0)])))
            ao_mask(L, "ao_wide", "joint basin", [(0.25, 0.0), (0.6, 1.0)], blend="ADD", intensity=0.5)
            m = M(L, "HEMI", "not underside", blend="MULTIPLY", hemi_vector=(0.0, 0.0, 1.0), hemi_space="OBJECT",
                  hemi_prev_normal=False)
            UL.mask_ramp(L, m, [(0.2, 0.0), (0.55, 1.0)])
        M(L, "NOISE", "ragged", blend="LINEAR_LIGHT", intensity=S.get("ragged_amt", 0.65),
          src={"Scale": S["ragged_scale"], "Detail": 8.0, "Roughness": 0.66, "Distortion": 0.2})
        m = M(L, "MODIFIER", "threshold", blend="MIX", modifier_type="RAMP")
        UL.modmask_ramp(m, [(S["moss_thresh"] - 0.04, 0.0), (S["moss_thresh"] + 0.04, 1.0)])
        m = M(L, "NOISE", "stone islands", blend="MULTIPLY",
              src={"Scale": S["island_scale"], "Detail": 6.0, "Roughness": 0.62})
        UL.mask_ramp(L, m, [(S.get("islands", (0.40, 0.46))[0], 0.0), (S.get("islands", (0.40, 0.46))[1], 1.0)])
        if S.get("fossil") and "ao_deep" in imgs:
            m = M(L, "IMAGE", "not in deep cavities", image=imgs["ao_deep"], blend="MULTIPLY")
            UL.mask_ramp(L, m, [(0.45, 0.0), (0.7, 1.0)])
        try:
            hc = L.channels[UL.ch_index(yp, "Height")]
            hc.enable_transition_bump = True
            hc.transition_bump_distance = bmp["moss"] * 0.8
            REPORT["worked"].append("transition bump on Moss height channel")
        except Exception as e:
            REPORT["failed"].append("transition bump: " + repr(e))
        return L
    if S.get("soil_over_moss"):
        moss_layer()
        soil_roots()
    else:
        soil_roots()
        moss_layer()
    # 17 Pale lichen rosettes (sparse)
    L = A("Lichen Pale", "VORONOI", src={"Scale": 9.0}, intensity=S["lichen_amt"])
    UL.layer_ramp(L, [(0.0, hexlin(P["lichen"])), (1.0, hexlin(P["lichen2"]))])
    UL.lch(L, yp, "Roughness", value=rgh["lichen"])
    m = M(L, "VORONOI", "rosettes", src={"Scale": 14.0})
    UL.mask_ramp(L, m, [(0.10, 1.0), (0.20, 0.0)])
    m = M(L, "NOISE", "rarity", src={"Scale": 1.6, "Detail": 3.0, "Roughness": 0.5})
    UL.mask_ramp(L, m, [(0.57, 0.0), (0.64, 1.0)])
    m = M(L, "HEMI", "not underside", blend="MULTIPLY", hemi_vector=(0.0, 0.0, 1.0), hemi_space="OBJECT",
          hemi_prev_normal=False)
    UL.mask_ramp(L, m, [(0.15, 0.0), (0.45, 1.0)])
    # 18 Dark-red lichen flecks (secondary palette accent, very sparse)
    L = A("Lichen Crimson", "COLOR", color=hexlin(P["lichen_red"]), intensity=0.8)
    UL.lch(L, yp, "Roughness", value=0.8)
    m = M(L, "VORONOI", "flecks", src={"Scale": 22.0})
    UL.mask_ramp(L, m, [(0.06, 1.0), (0.13, 0.0)])
    m = M(L, "NOISE", "fleck rarity", src={"Scale": 2.1, "Detail": 3.0, "Roughness": 0.5},
          translation=(7.0, 2.0, 1.0))
    UL.mask_ramp(L, m, [(0.63, 0.0), (0.68, 1.0)])
    return UL.describe(yp)


def bypass_ao_multiply(mat, node):
    """Quick setup multiplies Color x AO into Base Color; the runtime material keeps AO in ORM.R only, so the
    live preview does the same (fair live-vs-baked comparison)."""
    nt = mat.node_tree
    bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    for n in list(nt.nodes):
        if n.type in ("MIX", "MIX_RGB") and not n.outputs[0].links:
            nt.nodes.remove(n)


def gltf_settings_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    g.nodes.new("NodeGroupInput")
    return g


def baked_material(gname, paths):
    m = bpy.data.materials.new(NAME + ("_" + gname if len(S["groups"]) > 1 else "") + S.get("mat_tag", "") + "_Baked")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.location = (250, 0)
    nt.links.new(b.outputs[0], out.inputs[0])
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    uv.location = (-700, 0)

    def tex(path, nonc, y):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(path, check_existing=True)
        t.image.colorspace_settings.name = "Non-Color" if nonc else "sRGB"
        t.location = (-420, y)
        nt.links.new(uv.outputs[0], t.inputs[0])
        return t
    tc = tex(paths["color"], False, 300)
    nt.links.new(tc.outputs["Color"], b.inputs["Base Color"])
    to = tex(paths["orm"], True, 0)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-120, 0)
    nt.links.new(to.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], b.inputs["Roughness"])
    nt.links.new(sep.outputs[2], b.inputs["Metallic"])
    tn = tex(paths["normal"], True, -300)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.space = "TANGENT"
    nm.uv_map = "UVMap"
    nm.location = (-120, -300)
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], b.inputs["Normal"])
    gg = nt.nodes.new("ShaderNodeGroup")
    gg.node_tree = gltf_settings_group()
    gg.location = (250, -420)
    nt.links.new(sep.outputs[0], gg.inputs["Occlusion"])
    return m


# =====================================================================================  main build
groups = []
for gname, onames in S["groups"]:
    objs = [bpy.data.objects[n] for n in onames if n in bpy.data.objects]
    groups.append((gname, objs))
target_objs = [o for _, objs in groups for o in objs]
for o in target_objs:
    o.hide_render = False
    o.hide_viewport = False
    REPORT.setdefault("src_materials", {})[o.name] = [m.name for m in o.data.materials if m]

if S.get("fix_normals"):
    # altar v008: many of v008's stone parts have INWARD face normals. Renders hide it (back faces are shaded
    # toward the camera) but Cycles AO rays fire into the solid -> whole visible faces bake AO = 0 -> every
    # inverted-AO mask (sediment / cracks / recess moss) floods those faces ("camouflage").  Shape unchanged.
    import numpy as np
    for o in target_objs:
        n0 = np.empty(len(o.data.polygons) * 3, np.float32)
        o.data.polygons.foreach_get("normal", n0)
        UL.set_active(o)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.reveal()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        n1 = np.empty(len(o.data.polygons) * 3, np.float32)
        o.data.polygons.foreach_get("normal", n1)
        flipped = int(((n0.reshape(-1, 3) * n1.reshape(-1, 3)).sum(1) < 0).sum())
        REPORT.setdefault("normals_fixed", {})[o.name] = {"faces": len(o.data.polygons), "flipped": flipped}
    log("normals", REPORT.get("normals_fixed"))
for gname, objs in groups:
    t = time.time()
    marg = 0.003 if RES >= 4096 else 0.004
    # (MINIMUM_STRETCH collapsed the atlas to ~0 coverage on the skull in v001's first attempt -> not used)
    # (ABF/LSCM on the charts failed on ~36 islands -> v002 first attempt reached only 1.5 % coverage)
    meth = None
    marg = 0.0016 if RES >= 4096 else 0.003
    for dirs, mf in (("14", 150), ("cube", 300)):
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        info = UL.chart_project(objs, margin=marg, dirs=dirs, min_faces=mf)
        cov = UL.texel_stats(objs, RES)["uv_coverage"]
        log("chart_project", dirs, mf, "coverage", cov, info)
        if cov > 0.2:
            meth = ("charts from smoothed normals (%s dirs, min %d faces), orthographic projection per chart, "
                    "Pack Islands CONCAVE margin %.3f" % (dirs, mf, marg))
            break
        REPORT["failed"].append("chart_project %s coverage %.3f" % (dirs, cov))
    if meth is None:
        raise RuntimeError("UV unwrap failed")
    REPORT.setdefault("uv", {})[gname] = UL.texel_stats(objs, RES)
    REPORT["uv"][gname].update(UL.stretch_stats(objs))
    REPORT["uv"][gname]["method"] = meth
    REPORT["uv"][gname]["chart_regions_seams"] = info
    REPORT["uv"][gname]["islands"] = {o.name: UL.uv_islands(o) for o in objs}
    REPORT["uv"][gname]["secs"] = round(time.time() - t, 1)
    log("UV", gname, REPORT["uv"][gname])
step("uv_done")
REPORT["attr_info"] = prep_attributes(target_objs)
step("attributes_done")

BAKED = {}
for gname, objs in groups:
    main = objs[0]
    mname = NAME + ("_" + gname if len(groups) > 1 else "")
    mat, node, yp, r = UL.setup_yp(main, mname)
    for o in objs[1:]:
        o.data.materials.clear()
        o.data.materials.append(mat)
    REPORT["worked"].append("y_quick_ypaint_node_setup " + r)
    # Ucupaint Bake-to-Layer: AO wide -> AO channel layer (feeds ORM.R); AO tight -> utility image
    imgs = {}
    passes = [("ao_wide", S["ao_wide"], "LAYER"), ("ao_tight", S["ao_tight"], "LAYER")]
    if S.get("ao_deep"):   # skull v006: long-reach AO so the 0.6 m-deep orbits / nasal / fossae go dark
        passes.append(("ao_deep", S["ao_deep"], "LAYER"))
    for key, dist, tgt in passes:
        iname = "%s_%s" % (mname, key)
        img, rr, secs = UL.bake_ao_layer(main, node, iname, AORES, dist, samples=24, target=tgt)
        REPORT["steps"]["bake_" + key + "_" + gname] = secs
        if img is None:
            img = [i for i in bpy.data.images if i.name.startswith(iname)][-1]
        imgs[key] = img
        UL.save_png(img, os.path.join(TEX, "%s_util_%s_v%03d.png" % (mname, key, VER)))
    # the tight-AO layer is only a utility source: disable its AO-channel contribution
    for l in yp.layers:
        src_node = UL.C().get_layer_source(l)
        if l.type == "IMAGE" and src_node is not None and getattr(src_node, "image", None) in (imgs["ao_tight"],
                                                                                            imgs.get("ao_deep")):
            l.enable = False
            REPORT["worked"].append("ao_tight utility layer disabled: " + l.name)
    REPORT.setdefault("ao_layers", {})[gname] = [(l.name, l.type, l.enable) for l in yp.layers]
    REPORT["worked"].append("y_bake_to_layer AO x2 (" + gname + ")")
    stack = build_stack(main, node, imgs)
    REPORT.setdefault("stack", {})[gname] = stack
    bypass_ao_multiply(mat, node)
    step("stack_" + gname)
    if NOBAKE:
        continue
    res, rr, secs = UL.bake_targets(main, node, RES, samples=1, margin=16 if RES >= 4096 else 8)
    REPORT["steps"]["bake_targets_" + gname] = secs
    REPORT["worked"].append("y_bake_all_targets " + rr + " " + gname)
    paths = {}
    for btname, img in res.items():
        if img is None:
            REPORT["failed"].append("no image for bake target " + btname)
            continue
        key = btname.split()[-1].lower()
        p = os.path.join(TEX, "%s_%s_%d_v%03d.png" % (mname, key, RES, VER))
        UL.save_png(img, p)
        paths[key] = p
        if RES > 2048 and key in ("color", "normal", "orm"):
            # runtime-size copy for Quest/WebXR (master stays at RES)
            try:
                small = img.copy()
                small.scale(2048, 2048)
                UL.save_png(small, os.path.join(TEX, "%s_%s_2048_v%03d.png" % (mname, key, VER)))
                bpy.data.images.remove(small)
            except Exception as e:
                REPORT["failed"].append("2K copy %s: %r" % (key, e))
    BAKED[gname] = (mat, node, paths)
    step("baked_" + gname)

# =====================================================================================  baked material + live dups
live_col = bpy.data.collections.new(NAME + "_UcupaintLive")
scene.collection.children.link(live_col)
LIVE = []
for gname, objs in groups:
    if gname not in BAKED:
        continue
    mat, node, paths = BAKED[gname]
    node.node_tree.yp.use_baked = False
    bm = baked_material(gname, paths)
    for o in objs:
        d = o.copy()
        d.data = o.data.copy()     # own mesh copy: main's cf_wear vegnear bake only targets single-user meshes
        d.name = o.name + "_UcuLive"
        live_col.objects.link(d)
        d.material_slots[0].link = "OBJECT"
        d.material_slots[0].material = mat
        o.data.materials.clear()
        o.data.materials.append(bm)
        LIVE.append((o, d))
    REPORT.setdefault("baked_materials", []).append(bm.name)
live_col.hide_render = True
step("materials_done")

# clean orphans (old procedural CFCL_* materials of the re-materialed objects)
try:
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
except Exception:
    pass
blend_path = os.path.join(ADIR, "%s_v%03d.blend" % (NAME, VER))
for img in bpy.data.images:
    if img.filepath and img.filepath.startswith(TEX):
        img.filepath = bpy.path.relpath(img.filepath, start=ADIR)
bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True, relative_remap=True)
REPORT["blend"] = blend_path
step("saved")

# arrangement.json (same placements, pointing at our blend)
try:
    arr = json.load(open(os.path.join(ASSETS, S["src_dir"], "arrangement.json")))
    arr["asset"] = NAME
    arr["blend"] = os.path.basename(blend_path)
    arr["note"] = "copied from %s/arrangement.json; objects keep their names, stone uses *_Baked materials" % S["src_dir"]
    json.dump(arr, open(os.path.join(ADIR, "arrangement.json"), "w"), indent=2)
except Exception as e:
    REPORT["failed"].append("arrangement: " + repr(e))


# =====================================================================================  renders
def render_set(prefix):
    sc = bpy.context.scene
    R.setup_render(sc, "EEVEE", (1100, 800), 48)
    if sc.world is None or not sc.world.name.startswith("CFCL_Preview"):
        R.setup_world(sc)
    for o in [o for o in bpy.data.objects if o.type in ("LIGHT", "CAMERA")]:
        bpy.data.objects.remove(o)
    tobjs = [o for o in target_objs]
    if TARGET == "altar":   # frame the dais core, not the 15 m approaches
        tobjs = [bpy.data.objects[n] for n in ("CFCL_Arch_BoardSkirt", "CFCL_Arch_DaisFloor") if n in bpy.data.objects]
    mn, mx = R.bounds(tobjs)
    ctr = (mn + mx) / 2
    size = (mx - mn).length
    R.standard_lights(min(size * 0.5, 6.0))
    if "CFCL_PreviewGround" not in bpy.data.objects:
        bpy.ops.mesh.primitive_circle_add(vertices=64, radius=size * 3, fill_type="NGON",
                                          location=(ctr.x, ctr.y, mn.z - 0.01))
        g = bpy.context.active_object
        g.name = "CFCL_PreviewGround"
        gm = bpy.data.materials.new("CFCL_PreviewGroundMat")
        gm.use_nodes = True
        bb = gm.node_tree.nodes.get("Principled BSDF")
        bb.inputs["Base Color"].default_value = (0.035, 0.032, 0.028, 1)
        bb.inputs["Roughness"].default_value = 0.9
        g.data.materials.append(gm)
    shots = []
    if TARGET == "skull":
        views = [("front", 0, 10, 50), ("q_left", -40, 18, 50), ("side", 90, 8, 50), ("q_back", 150, 25, 50)]
        close = [("close_crown", Vector((0.0, -0.4, 2.3)), Vector((0.0, -3.2, 3.6)), 50),
                 ("close_face", Vector((0.15, -1.0, 1.25)), Vector((0.9, -4.2, 1.6)), 55),
                 ("close_base", Vector((0.0, -1.1, 0.35)), Vector((1.3, -4.4, 0.9)), 50)]
    elif TARGET == "hand":
        views = [("front", -15, 8, 50), ("q_left", -55, 14, 50), ("side", 70, 8, 50), ("q_back", 160, 18, 50)]
        close = [("close_fingers", Vector((-0.6, 0.3, 4.0)), Vector((-1.0, -3.4, 4.3)), 60),
                 ("close_forearm", Vector((-0.2, 0.3, 1.5)), Vector((0.6, -3.0, 2.0)), 55)]
    else:
        views = [("front", 0, 28, 40), ("q_left", -45, 32, 40), ("side", 90, 22, 40), ("q_back", 160, 35, 40)]
        close = [("close_skirt", Vector((-1.9, -2.6, -0.62)), Vector((-1.2, -5.2, 0.25)), 45),
                 ("close_rim", Vector((3.6, -2.4, -0.9)), Vector((6.0, -5.4, 0.2)), 40)]
    for name, az, el, lens in views:
        a, e = math.radians(az), math.radians(el)
        fov = 2 * math.atan(18.0 / lens)
        dist = (size * 0.5) / math.tan(fov / 2) * 1.05 + size * 0.15
        loc = ctr + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam = R.camera("TT_" + name, loc, ctr, lens)
        shots.append(R.render_to("%s_%s.png" % (prefix, name), cam))
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    for name, tgt, loc, lens in close:
        cam = R.camera("CU_" + name, loc, tgt, lens)
        shots.append(R.render_to("%s_%s.png" % (prefix, name), cam))
    if prefix.endswith("_baked"):
        # albedo check: the standard rig is warm-dominant (rim 3.2 orange + lava bounce); one neutral-white key only
        hidden = []
        for o in bpy.data.objects:
            if o.type == "LIGHT" and ("Rim" in o.name or "Bounce" in o.name):
                o.hide_render = True
                hidden.append(o)
        key = [o for o in bpy.data.objects if o.type == "LIGHT" and "Key" in o.name][0]
        kc, ke = tuple(key.data.color), key.data.energy
        key.data.color = (1.0, 1.0, 1.0)
        key.data.energy = 3.0
        name, tgt, loc, lens = close[1]
        cam = R.camera("CUN_" + name, loc, tgt, lens)
        shots.append(R.render_to("%s_neutral_%s.png" % (prefix, name), cam))
        for o in hidden:
            o.hide_render = False
        key.data.color, key.data.energy = kc, ke
    return shots


if not NORENDER and LIVE:
    if TARGET == "altar":
        # dark stand-in board slab for context (never saved)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.59))
        sb = bpy.context.active_object
        sb.name = "StandIn_Board"
        sb.scale = (4.75, 4.75, 0.34)
        smat = bpy.data.materials.new("StandInBoardMat")
        smat.use_nodes = True
        smat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.045, 0.04, 1)
        sb.data.materials.append(smat)
    pre = os.path.join(RDIR, "iter%02d" % VER)
    try:
        # baked (runtime) first
        live_col.hide_render = True
        REPORT["renders_baked"] = render_set(pre + "_baked")
        step("renders_baked")
        for o, d in LIVE:
            o.hide_render = True
        live_col.hide_render = False
        for o, d in LIVE:
            d.hide_render = False
        REPORT["renders_live"] = render_set(pre + "_live")
        step("renders_live")
    except Exception as e:
        traceback.print_exc()
        REPORT["failed"].append("render: " + repr(e))

REPORT["total_secs"] = round(time.time() - T0, 1)
json.dump(REPORT, open(os.path.join(ADIR, "build_report_v%03d.json" % VER), "w"), indent=1, default=str)
log("DONE", REPORT["total_secs"], "s")
