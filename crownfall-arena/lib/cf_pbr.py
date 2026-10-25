"""cf_pbr -- image-based CC0 PBR materials for the Crownfall main environment (Claude track).

Textures: assets/CFCL_PBR/textures/<source>_<asset_id>/  (Poly Haven + ambientCG, CC0 1.0; see SOURCES.json)
          each set has <id>_color_2k.jpg (sRGB) + <id>_rad_2k.png (derived pack: R=roughness, G=AO, B=height).

    import cf_pbr as P
    mat = P.get_pbr("BasaltRib")                          # preset (see PRESETS) -> material "CFCL_PBR_BasaltRib"
    mat = P.get_pbr("dark_rock_02", scale_m=8, tint=(0.9, 0.95, 1.0))   # raw set id, explicit params
    P.apply_pbr(obj, "CliffBlocky", slots=["CFCL_Basalt*"])               # replace matching slots only
    P.apply_mapping(scene_objects, ".../pbr_mapping.json", optional=("board_marble",))

How it works (EEVEE + Cycles, no UVs needed):
  * Coordinates = Object coordinates x obj["cfcl_pbr_k"] (the object's world scale, written by apply_pbr) + a
    per-object random offset  ->  texture repeat is in WORLD METRES and stays glued to the object; projection is
    the Image Texture node's BOX mode (blend 0.2-0.35), whose face weights use object-space normals, so it
    matches the object-space coordinates even on rotated/mirrored objects.
    !! Call apply_pbr / refresh_k AFTER the final object transforms (build_main_scene scales the env x4.6).
  * Anti-tiling: two samples per map (second one rotated ~40 deg about (1,1,1), scaled x0.73, offset), blended
    by a world-scale noise with height-aware contrast; plus macro value/hue/roughness variation from two
    low-frequency noises (one relative to scale_m, one fixed at ~70 m) so 20-60 m surfaces do not repeat.
  * Optional "top" layer (moss / forest floor / ash ...): a second texture set blended by world-normal Z x noise,
    height-aware (it fills crevices first).  Use it for moss on rock tops and ground on terrain plateaus.
  * Height (rad.B) drives a Bump node -- normal maps are NOT used in box mode (tangent space needs UVs);
    triplanar=False switches to UV mapping + the GL normal map for UV'd/baked meshes.
  * Images are loaded once and shared between materials (GPU memory: ~21 MB per 2K map incl. mips).
"""
import fnmatch
import json
import math
import os

import bpy

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_DIR = os.path.join(CL, "assets", "CFCL_PBR")
SOURCES = os.path.join(LIB_DIR, "SOURCES.json")
K_PROP = "cfcl_pbr_k"

# --------------------------------------------------------------------------------------------- presets
# scale_m = size of one texture repeat in WORLD metres (main scene: environment already scaled x4.6, so these
# are final-scene metres).  Real-world capture sizes (Poly Haven) are noted; we enlarge 2-5x on purpose for the
# colossal/surreal read while keeping the micro-detail plausible at the hero camera (~25-60 m away).
# hsv = (hue shift, saturation mul, value mul) applied to the albedo; rough = (mul, add).
# LOCKED PALETTE (research/E33_RITUAL_FLOOR_DIRECTION.md, 2026-10-24): Obsidian near-black (rendered ~0.04-0.10),
# Ancient stone warm grey #5d574e mid / #8a8377 lit, Crimson, Ember gold; selective moss #3e4a26-#4a5a2e.
# hsv multipliers were solved from each colour map's measured mean (linear max-channel V, saturation S) so the
# albedo lands on: obsidian V~0.028 S~0.22 | ancient stone V~0.17 S~0.16 | dark earth/ash V~0.08 S~0.25 |
# moss V~0.08 S~0.72 hue~0.22.  (Measured map means are listed in assets/CFCL_PBR/README.md.)
MOSS_HSV = (-0.03, 0.72, 0.42)      # Moss002 (V .134 S .92) -> olive #3e4a26-#4a5a2e
MOSS = dict(set="ambientcg_Moss002", scale_m=3.0, hsv=MOSS_HSV, patch=4.0)
EARTH_HSV = (0.0, 0.45, 0.30)       # mud_cracked_dry_riverbed_002 (V .275 S .57) -> dark cracked earth V .083
ASH_HSV = (0.0, 0.50, 0.42)         # burned_ground_01 (V .137 S .47) -> ash V .085
PRESETS = {
    # ---- obsidian / basalt (ribs, cliffs, abyss) -- near-black, slightly glossy fractures
    "BasaltRib":      dict(set="polyhaven_dark_rock_02", scale_m=7.0, hsv=(0.0, 0.55, 0.68), rough=(0.85, -0.04),
                           bump=0.6, streaks=0.35,
                           layers=[dict(MOSS, amount=0.16, nz=(0.55, 0.9))],
                           note="ribs / basalt columns 25-80 m tall: obsidian-dark stratified rock (PH real 2.0 m), "
                                "selective moss only on ledges"),
    "Obsidian":       dict(set="ambientcg_Rock035", scale_m=9.0, flatten=0.55, hsv=(0.0, 0.30, 2.0), rough=(0.75, -0.05), bump=0.55,
                           streaks=0.25, note="near-black blue-black rock (Rock035), glossy fractures: abyss banks"),
    "BasaltDark":     dict(set="ambientcg_Rock035", scale_m=9.0, hsv=(0.0, 0.30, 2.0), rough=(0.75, -0.05), bump=0.55,
                           note="alias of Obsidian kept for older mappings"),
    "CliffBlocky":    dict(set="polyhaven_marble_cliff_03", scale_m=14.0, hsv=(0.0, 0.35, 0.10), rough=(0.9, 0.0),
                           bump=0.45, streaks=0.3,
                           note="orthogonally fractured cliff (E33 cubic cliffs; PH real 5.7 m) darkened to obsidian"),
    "CliffLayered":   dict(set="ambientcg_Rock030", scale_m=12.0, hsv=(0.0, 0.9, 0.40), bump=0.6, streaks=0.3,
                           layers=[dict(MOSS, amount=0.12, nz=(0.55, 0.9))],
                           note="dark grey layered cliff for big walls (60-250 m)"),
    "CliffWarm":      dict(set="polyhaven_cliff_side", scale_m=10.0, hsv=(0.0, 0.35, 0.45), bump=0.6,
                           note="layered sedimentary strata, darkened"),
    "RockFace":       dict(set="polyhaven_rock_face_03", scale_m=8.0, hsv=(0.0, 0.40, 0.35), bump=0.55, streaks=0.25,
                           layers=[dict(MOSS, amount=0.18)],
                           note="general cracked rock face (PH real 2.7 m), dark"),
    "RockMossLayered": dict(set="ambientcg_Rock028", scale_m=10.0, hsv=(0.0, 0.85, 0.75), bump=0.55,
                           note="grey layered rock with moss in the ledges"),
    "MossyRock":      dict(set="polyhaven_mossy_rock", scale_m=6.0, hsv=(-0.02, 0.75, 0.55), bump=0.5, streaks=0.2,
                           note="rock with moss + lichen (PH real 3 m), darkened"),
    "LichenRock":     dict(set="polyhaven_lichen_rock", scale_m=5.0, hsv=(0.0, 0.7, 0.75), bump=0.5,
                           note="dark rock with pale lichen crust (PH real 2 m)"),
    # ---- ground
    "CrackedEarth":   dict(set="polyhaven_mud_cracked_dry_riverbed_002", scale_m=4.5, hsv=EARTH_HSV, bump=0.5,
                           note="dark cracked earth (PH real 2 m)"),
    "Ash":            dict(set="polyhaven_burned_ground_01", scale_m=3.5, hsv=ASH_HSV, bump=0.4,
                           note="burned ground / ash with debris (PH real 1 m)"),
    "ForestFloor":    dict(set="polyhaven_forest_leaves_02", scale_m=4.0, hsv=(0.0, 0.6, 0.45), bump=0.4,
                           note="moss/leaf litter floor (PH real 3 m) -- not in the locked palette, kept for tests"),
    "Dust":           dict(set="polyhaven_sand_01", scale_m=4.0, hsv=(0.0, 0.45, 0.45), bump=0.35,
                           note="trampled sand / dust (PH real 1.5 m)"),
    "CooledLava":     dict(set="ambientcg_Lava002", scale_m=9.0, hsv=(0.0, 0.25, 0.55), rough=(0.85, 0.0), bump=0.6,
                           emit=2.5, emit_core=(0.06, 0.30), emit_up=(0.55, 0.9), emit_color=(1.0, 0.45, 0.12), emit_near="auto",
                           emit_floor=0.0,
                           note="obsidian lava crust; emission map lights the flow cracks ONLY near board/skull/hand"),
    # ---- composite terrain (rock on slopes, layered ground on the up-facing faces)
    "PlateauGround":  dict(set="polyhaven_rock_face_03", scale_m=9.0, hsv=(0.0, 0.40, 0.30), bump=0.7, streaks=0.25,
                           macro=0.35,
                           layers=[dict(set="polyhaven_mud_cracked_dry_riverbed_002", amount=0.80, scale_m=5.0,
                                        hsv=EARTH_HSV, nz=(0.30, 0.75), patch=6.0),
                                   dict(set="polyhaven_burned_ground_01", amount=0.38, scale_m=3.5, hsv=ASH_HSV,
                                        nz=(0.30, 0.75), patch=4.0),
                                   dict(MOSS, amount=0.12)],
                           note="central plateau (46 m): ash + cracked dark earth on top, dark rock flanks, rare moss"),
    "SeatRock":       dict(set="ambientcg_Rock028", scale_m=10.0, hsv=(0.0, 0.75, 0.50), bump=0.65, streaks=0.3,
                           macro=0.3,
                           layers=[dict(set="polyhaven_burned_ground_01", amount=0.45, scale_m=3.5, hsv=ASH_HSV),
                                   dict(MOSS, amount=0.20)],
                           note="skull/hand seats + rear slabs: dark layered rock, ash on the tops, moss pockets"),
    "MoundGround":    dict(set="polyhaven_mossy_rock", scale_m=6.0, hsv=(-0.02, 0.65, 0.30), bump=0.75, streaks=0.3,
                           macro=0.35,
                           layers=[dict(set="polyhaven_burned_ground_01", amount=0.55, scale_m=3.5, hsv=(0.0, 0.5, 0.36)),
                                   dict(MOSS, amount=0.14, nz=(0.45, 0.85))],
                           note="skull/hand bases: mossy rock absorbing the remains, ash and moss on top"),
    # ---- ancient stone (warm grey #5d574e mid / #8a8377 lit) -- masonry / architecture, no rotation anti-tiling
    "MasonryBlocks":  dict(set="polyhaven_large_sandstone_blocks_01", scale_m=6.0, anti_tile=False,
                           hsv=(0.0, 0.33, 0.45), bump=0.6, streaks=0.45,
                           layers=[dict(MOSS, amount=0.20, nz=(0.5, 0.9))],
                           note="large ancient blocks for ruin walls (PH real 3 m -> ~0.8 m blocks)"),
    "Ashlar":         dict(set="polyhaven_stone_wall_05", scale_m=5.0, anti_tile=False, hsv=(0.0, 0.40, 1.65), bump=0.55,
                           streaks=0.45, layers=[dict(MOSS, amount=0.15, nz=(0.5, 0.9))],
                           note="fitted ancient ashlar (PH real 2 m) -- arches, towers, far ruins"),
    "CarvedStone":    dict(set="polyhaven_seaworn_stone_tiles", scale_m=3.5, anti_tile=False, hsv=(0.0, 0.45, 0.55),
                           bump=0.5, streaks=0.3, layers=[dict(MOSS, amount=0.10, nz=(0.6, 0.95), scale_m=2.0)],
                           note="timeworn cast stone blocks -- dais, stair, steles (PH real 2 m)"),
    "AncientStone":   dict(set="polyhaven_rock_face_03", scale_m=6.0, hsv=(0.03, 0.25, 0.52), bump=0.45, streaks=0.35,
                           layers=[dict(MOSS, amount=0.10, nz=(0.6, 0.95), scale_m=2.5)],
                           note="JOINTLESS weathered warm-grey stone for already-modelled carved pieces (dais floor, "
                                "stair, steles) so no texture joints fight the modelled slab joints"),
    "Flagstone":      dict(set="polyhaven_monastery_stone_floor", scale_m=3.6, hsv=(0.0, 0.33, 1.25), bump=0.45,
                           note="irregular flagstone paving for plazas (PH real 1.8 m)"),
    "DarkBlocks":     dict(set="polyhaven_rock_wall_16", scale_m=4.0, anti_tile=False, hsv=(0.0, 0.6, 1.0), bump=0.5,
                           note="obsidian-dark squared blocks"),
    # ---- layers / special
    "Moss":           dict(set="ambientcg_Moss002", scale_m=2.5, hsv=MOSS_HSV, bump=0.3, note="moss layer"),
    "MarbleWhite":    dict(set="ambientcg_Marble012", scale_m=3.0, hsv=(0.0, 0.6, 0.92), rough=(1.0, 0.18), bump=0.05,
                           macro=0.05, note="optional board light squares (honed, not mirror)"),
    "MarbleBlack":    dict(set="ambientcg_Marble016", scale_m=3.0, hsv=(0.0, 0.6, 1.6), rough=(1.0, 0.20), bump=0.05,
                           macro=0.05, note="optional board dark squares (honed)"),
    # v027 (critic: plastic board): one marble slab per 2.3 m square, anti-tiled so no two squares repeat
    "IvoryMarble":    dict(set="ambientcg_Marble014", scale_m=2.3, hsv=(0.0, 0.85, 1.0), rough=(1.0, 0.12), bump=0.06,
                           macro=0.06, note="board light squares: warm ivory polished marble"),
    "ObsidianOnyx":   dict(set="ambientcg_Onyx013", scale_m=2.3, hsv=(0.0, 0.8, 1.0), rough=(0.9, 0.03), bump=0.04,
                           macro=0.05, note="board dark squares: black polished onyx"),
    "GoldInlay":      dict(set="ambientcg_Metal048B", scale_m=0.8, hsv=(0.0, 1.0, 1.0), rough=(1.0, 0.0), bump=0.1,
                           macro=0.04, metallic=1.0, note="board seams + trim: handled gold"),
}

MEAN_LIN = {
    "polyhaven_rock_face_03": (0.231, 0.144, 0.083), "polyhaven_cliff_side": (0.211, 0.091, 0.033),
    "polyhaven_marble_cliff_03": (0.342, 0.217, 0.114), "polyhaven_dark_rock_02": (0.043, 0.034, 0.025),
    "polyhaven_mossy_rock": (0.161, 0.154, 0.100), "polyhaven_lichen_rock": (0.064, 0.049, 0.034),
    "polyhaven_forest_leaves_02": (0.285, 0.171, 0.051), "polyhaven_burned_ground_01": (0.137, 0.101, 0.072),
    "polyhaven_mud_cracked_dry_riverbed_002": (0.275, 0.187, 0.120), "polyhaven_sand_01": (0.381, 0.305, 0.161),
    "polyhaven_large_sandstone_blocks_01": (0.297, 0.242, 0.146), "polyhaven_stone_wall_05": (0.079, 0.064, 0.045),
    "polyhaven_seaworn_stone_tiles": (0.243, 0.198, 0.150), "polyhaven_monastery_stone_floor": (0.136, 0.094, 0.065),
    "polyhaven_rock_wall_16": (0.033, 0.027, 0.020), "ambientcg_Rock030": (0.081, 0.076, 0.063),
    "ambientcg_Rock028": (0.082, 0.079, 0.061), "ambientcg_Rock035": (0.006, 0.012, 0.014),
    "ambientcg_Lava002": (0.057, 0.036, 0.048), "ambientcg_Moss002": (0.070, 0.134, 0.010),
    "ambientcg_Marble012": (0.418, 0.423, 0.471), "ambientcg_Marble016": (0.051, 0.054, 0.052),
}

_sources_cache = None


def _sources():
    global _sources_cache
    if _sources_cache is None:
        _sources_cache = json.load(open(SOURCES, encoding="utf-8"))["sets"]
    return _sources_cache


def resolve_set(key):
    """'dark_rock_02' | 'polyhaven_dark_rock_02' | 'Rock030' -> SOURCES set key"""
    s = _sources()
    if key in s:
        return key
    for k, v in s.items():
        if v["asset_id"] == key:
            return k
    raise KeyError(f"cf_pbr: unknown texture set {key!r}; have {sorted(s)}")


def _img(set_key, mapname, noncolor):
    rec = _sources()[set_key]
    if mapname not in rec["maps"]:
        return None
    path = os.path.join(LIB_DIR, rec["maps"][mapname])
    name = os.path.basename(path)
    im = bpy.data.images.get(name)
    if im is None or os.path.normcase(bpy.path.abspath(im.filepath)) != os.path.normcase(path):
        im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    return im


# --------------------------------------------------------------------------------------------- node helpers
class _NB:
    def __init__(self, nt):
        self.nt, self.nodes, self.links = nt, nt.nodes, nt.links
        self.x = 0

    def n(self, kind, **props):
        nd = self.nodes.new(kind)
        nd.location = (self.x, -len(self.nodes) * 12 % 1600)
        self.x += 30
        for k, v in props.items():
            if k.startswith("in_"):
                continue
            setattr(nd, k, v)
        for k, v in props.items():
            if k.startswith("in_"):
                self.set(nd.inputs[k[3:].replace("_", " ")], v)
        return nd

    def set(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.links.new(v, sock)
        elif v is not None:
            sock.default_value = v

    def math(self, op, a, b=None, c=None, clamp=False):
        nd = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(nd.inputs[0], a)
        if b is not None:
            self.set(nd.inputs[1], b)
        if c is not None:
            self.set(nd.inputs[2], c)
        return nd.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        nd = self.n("ShaderNodeVectorMath", operation=op)
        self.set(nd.inputs[0], a)
        if b is not None:
            self.set(nd.inputs[1], b)
        if scale is not None:
            self.set(nd.inputs[3], scale)
        return nd.outputs[0]

    def mix(self, fac, a, b, kind="RGBA", blend="MIX", clamp=False):
        nd = self.n("ShaderNodeMix", data_type=kind)
        if kind == "RGBA":
            nd.blend_type = blend
            nd.clamp_result = clamp
        ids = {s.identifier: s for s in nd.inputs}
        sfx = {"RGBA": "Color", "FLOAT": "Float", "VECTOR": "Vector"}[kind]
        self.set(ids["Factor_Float"], fac)
        self.set(ids["A_" + sfx], a)
        self.set(ids["B_" + sfx], b)
        return {s.identifier: s for s in nd.outputs}["Result_" + sfx]

    def ss(self, x, lo, hi, a=0.0, b=1.0, interp="SMOOTHSTEP"):
        nd = self.n("ShaderNodeMapRange", interpolation_type=interp, clamp=True)
        self.set(nd.inputs["Value"], x)
        self.set(nd.inputs["From Min"], lo)
        self.set(nd.inputs["From Max"], hi)
        self.set(nd.inputs["To Min"], a)
        self.set(nd.inputs["To Max"], b)
        return nd.outputs["Result"]

    def noise(self, vec, scale, detail=2.0, rough=0.5):
        nd = self.n("ShaderNodeTexNoise")
        self.set(nd.inputs["Vector"], vec)
        self.set(nd.inputs["Scale"], scale)
        self.set(nd.inputs["Detail"], detail)
        self.set(nd.inputs["Roughness"], rough)
        return nd.outputs["Fac"]

    def sep(self, v):
        nd = self.n("ShaderNodeSeparateColor")
        self.set(nd.inputs[0], v)
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def sepxyz(self, v):
        nd = self.n("ShaderNodeSeparateXYZ")
        self.set(nd.inputs[0], v)
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def hsv(self, col, h=0.5, s=1.0, v=1.0):
        nd = self.n("ShaderNodeHueSaturation")      # inputs: Hue, Saturation, Value, Fac, Color
        for i, v_ in enumerate((h, s, v, 1.0, col)):
            self.set(nd.inputs[i], v_)
        return nd.outputs[0]

    def tex(self, image, vec, box_blend, uv_mode=False):
        nd = self.n("ShaderNodeTexImage", image=image, interpolation="Linear")
        if not uv_mode:
            nd.projection = "BOX"
            nd.projection_blend = box_blend
        nd.extension = "REPEAT"
        self.set(nd.inputs["Vector"], vec)
        return nd.outputs["Color"]


def _coords(nb, uv_mode):
    """world-metre object-space coordinates, + per-object random offset"""
    tc = nb.n("ShaderNodeTexCoord")
    if uv_mode:
        return tc.outputs["UV"], tc.outputs["UV"]
    at = nb.n("ShaderNodeAttribute", attribute_type="OBJECT", attribute_name=K_PROP)
    k = at.outputs["Fac"]
    has = nb.math("GREATER_THAN", k, 1e-5)
    k_eff = nb.math("ADD", nb.math("MULTIPLY", k, has), nb.math("SUBTRACT", 1.0, has))
    p = nb.vmath("SCALE", tc.outputs["Object"], scale=k_eff)
    oi = nb.n("ShaderNodeObjectInfo")
    r = oi.outputs["Random"]
    comb = nb.n("ShaderNodeCombineXYZ")
    nb.set(comb.inputs[0], nb.math("MULTIPLY", r, 173.31))
    nb.set(comb.inputs[1], nb.math("MULTIPLY", r, 91.77))
    nb.set(comb.inputs[2], nb.math("MULTIPLY", r, 57.13))
    pw = nb.n("ShaderNodeNewGeometry").outputs["Position"]       # world position for the macro noises
    return nb.vmath("ADD", p, comb.outputs[0]), pw


def _sample_set(nb, set_key, p, scale_m, box_blend, anti_tile, seed, uv_mode, want_emit=False):
    """returns (color, rough, ao, height, emit) after anti-tiling"""
    col_im = _img(set_key, "color", False)
    rad_im = _img(set_key, "rad", True)
    emit_im = _img(set_key, "emit", False) if want_emit else None
    va = nb.vmath("ADD", nb.vmath("SCALE", p, scale=1.0 / scale_m), (seed * 0.137, seed * 0.311, seed * 0.071))
    ca = nb.tex(col_im, va, box_blend, uv_mode)
    ra = nb.tex(rad_im, va, box_blend, uv_mode)
    ea = nb.tex(emit_im, va, box_blend, uv_mode) if emit_im else None
    if not anti_tile:
        r, a, h = nb.sep(ra)
        return ca, r, a, h, ea
    rot = nb.n("ShaderNodeVectorRotate", rotation_type="AXIS_ANGLE")
    nb.set(rot.inputs["Vector"], p)
    nb.set(rot.inputs["Axis"], (0.577, 0.577, 0.577))
    nb.set(rot.inputs["Angle"], 0.71 + seed * 0.13)
    vb = nb.vmath("ADD", nb.vmath("SCALE", rot.outputs[0], scale=1.0 / (scale_m * 0.73)), (0.37 + seed, 0.61, 0.29))
    cb = nb.tex(col_im, vb, box_blend, uv_mode)
    rb = nb.tex(rad_im, vb, box_blend, uv_mode)
    eb = nb.tex(emit_im, vb, box_blend, uv_mode) if emit_im else None
    _, _, ha = nb.sep(ra)
    _, _, hb = nb.sep(rb)
    n = nb.noise(nb.vmath("ADD", p, (seed * 3.1, 0, 0)), 1.0 / (scale_m * 1.9), detail=3.0, rough=0.55)
    # height-aware blend: (noise - 0.5)*4 + (hb - ha)*1.5 -> 0..1
    m = nb.math("ADD", nb.math("MULTIPLY", nb.math("SUBTRACT", n, 0.5), 4.0),
                nb.math("MULTIPLY", nb.math("SUBTRACT", hb, ha), 1.5))
    m = nb.math("ADD", m, 0.5, clamp=True)
    col = nb.mix(m, ca, cb)
    rad = nb.mix(m, ra, rb)
    emit = nb.mix(m, ea, eb) if emit_im else None
    r, a, h = nb.sep(rad)
    return col, r, a, h, emit


def auto_foci(board=(0.0, 0.0, 24.0, 62.0), hero_r=(10.0, 32.0)):
    """lava-glow foci (x, y, r_full, r_zero) in world metres: board ring + skull + hand (same as build_main_scene)."""
    foci = [tuple(board)]
    for hn in ("CFCL_Hero_Skull", "CFCL_Hero_Hand"):
        o = bpy.data.objects.get(hn)
        if o:
            t = o.matrix_world.translation
            foci.append((round(t.x, 2), round(t.y, 2)) + tuple(hero_r))
    return foci


def _sig(d):
    return json.dumps(d, sort_keys=True, default=str)


def get_pbr(name, scale_m=None, triplanar=True, tint=None, macro_variation=True, **kw):
    """Build (or reuse) material CFCL_PBR_<name>.

    name   : a PRESETS key, or a texture-set id ('dark_rock_02', 'polyhaven_dark_rock_02', 'Rock030').
    scale_m: world metres per texture repeat (defaults to the preset's).
    tint   : RGB multiplier on albedo.  hsv=(hue_shift, sat_mul, val_mul).  rough=(mul, add).
    bump   : bump strength (height map).  box_blend: 0.2-0.35.  anti_tile: True.
    top / top_amount / top_scale_m / top_hsv : a set blended on upward faces (moss, forest floor...).
    layers : list of dict(set, amount, scale_m, hsv, tint, nz=(lo,hi), patch) -- more up-facing layers, in order.
    emit / emit_color : emission strength from the set's emission map (lava).
    emit_near: [(x, y, r_full, r_zero), ...] or "auto" (board + skull + hand) -> emission only near the forms.
    macro  : macro value variation amplitude (0.18 default).
    suffix : material name suffix (otherwise overrides produce a deterministic '__k1v1_k2v2' suffix).
    """
    base = dict(PRESETS.get(name, {}))
    if not base:
        base = dict(set=resolve_set(name), scale_m=6.0, hsv=(0.0, 1.0, 1.0), bump=0.5)
    over = {k: v for k, v in dict(kw, scale_m=scale_m, tint=tint, triplanar=triplanar,
                                    macro_variation=macro_variation).items()
            if v is not None and not (k == "triplanar" and v is True) and not (k == "macro_variation" and v is True)}
    suffix = over.pop("suffix", None)
    cfg = dict(base)
    cfg.update(over)
    cfg["set"] = resolve_set(cfg["set"])
    if cfg.get("top"):
        cfg["top"] = resolve_set(cfg["top"])
    if suffix is None and over:
        def f(v):
            if isinstance(v, (list, tuple)):
                return "-".join(f(x) for x in v)
            return (("%g" % v) if isinstance(v, float) else str(v)).replace(".", "p").replace("_", "")
        suffix = "_".join(f"{k.replace('_', '')}{f(v)}" for k, v in sorted(over.items()))[:40]
    mname = f"CFCL_PBR_{name}" + (f"__{suffix}" if suffix else "")
    sig = _sig(cfg)
    m = bpy.data.materials.get(mname)
    if m is not None and m.get("cfcl_pbr_sig") == sig:
        return m
    if m is None:
        m = bpy.data.materials.new(mname)
    m["cfcl_pbr_sig"] = sig
    m["cfcl_pbr_set"] = cfg["set"]
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    nb = _NB(nt)
    uv_mode = not cfg.get("triplanar", True)
    p, pw = _coords(nb, uv_mode)
    S = float(cfg.get("scale_m", 6.0))
    if uv_mode:
        S = float(cfg.get("uv_scale", 1.0))
    bb = float(cfg.get("box_blend", 0.28))
    at = cfg.get("anti_tile", True)
    want_emit = bool(cfg.get("emit"))
    col, r, ao, h, emit = _sample_set(nb, cfg["set"], p, S, bb, at, 0.0, uv_mode, want_emit)
    if cfg.get("flatten", 0) > 0 and cfg["set"] in MEAN_LIN:
        col = nb.mix(float(cfg["flatten"]), col, tuple(MEAN_LIN[cfg["set"]]) + (1.0,))
    hs = cfg.get("hsv", (0.0, 1.0, 1.0))
    col = nb.hsv(col, 0.5 + hs[0], hs[1], hs[2])
    if cfg.get("tint"):
        col = nb.mix(1.0, col, tuple(cfg["tint"]) + (1.0,), blend="MULTIPLY")
    # AO into albedo (cavity darkening; EEVEE/Cycles AO adds the large-scale part)
    col = nb.mix(nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, ao), cfg.get("ao", 0.85)), col, (0, 0, 0, 1),
                 blend="MIX")
    rm = cfg.get("rough", (1.0, 0.0))
    rough = nb.math("MULTIPLY_ADD", r, rm[0], rm[1])
    height = h
    # ---- macro variation (value + slight hue + roughness)
    if cfg.get("macro_variation", True):
        amp = cfg.get("macro", 0.18)
        n1 = nb.noise(pw, 1.0 / (S * 4.5), detail=2.0, rough=0.5)
        n2 = nb.noise(nb.vmath("ADD", pw, (31.7, 7.3, 0)), 1.0 / 70.0, detail=1.0, rough=0.5)
        nmix = nb.math("ADD", nb.math("MULTIPLY", n1, 0.6), nb.math("MULTIPLY", n2, 0.4))
        val = nb.ss(nmix, 0.30, 0.70, 1.0 - amp, 1.0 + amp * 0.7)
        hue = nb.ss(n2, 0.3, 0.7, 0.5 - 0.015, 0.5 + 0.015)
        col = nb.hsv(col, hue, nb.ss(n1, 0.3, 0.7, 0.85, 1.1), val)
        rough = nb.math("ADD", rough, nb.ss(nmix, 0.3, 0.7, -0.07, 0.07))
    # ---- vertical weathering streaks (stains running down vertical faces)
    if cfg.get("streaks", 0) > 0:
        _, _, nzs = nb.sepxyz(nb.n("ShaderNodeNewGeometry").outputs["Normal"])
        sv = nb.vmath("MULTIPLY", pw, (1.0 / (S * 0.5), 1.0 / (S * 0.5), 1.0 / (S * 5.0)))
        sn = nb.noise(sv, 1.0, detail=4.0, rough=0.6)
        vert = nb.ss(nb.math("ABSOLUTE", nzs), 0.75, 0.35)
        smask = nb.math("MULTIPLY", nb.ss(sn, 0.48, 0.66), vert)
        col = nb.mix(nb.math("MULTIPLY", smask, float(cfg["streaks"])), col, (0.45, 0.43, 0.40, 1.0), blend="MULTIPLY")
        rough = nb.math("ADD", rough, nb.math("MULTIPLY", smask, -0.08 * float(cfg["streaks"])))
    # ---- layer stack on upward faces (ground / ash / moss ...); legacy 'top*' keys become layer 0
    layers = list(cfg.get("layers") or [])
    if cfg.get("top") and cfg.get("top_amount", 0) > 0:
        layers.insert(0, dict(set=cfg["top"], amount=cfg["top_amount"], scale_m=cfg.get("top_scale_m", 3.0),
                              hsv=cfg.get("top_hsv", (0.0, 1.0, 1.0)), nz=cfg.get("top_nz", (0.35, 0.80)),
                              patch=cfg.get("top_patch", 5.0)))
    nz = None
    for li, L in enumerate(layers):
        if float(L.get("amount", 0)) <= 0:
            continue
        if nz is None:
            _, _, nz = nb.sepxyz(nb.n("ShaderNodeNewGeometry").outputs["Normal"])
        TS = float(L.get("scale_m", 3.0))
        tcol, tr, tao, th, _ = _sample_set(nb, resolve_set(L["set"]), p, TS, bb, L.get("anti_tile", at), 1.0 + li, uv_mode)
        ths = L.get("hsv", (0.0, 1.0, 1.0))
        tcol = nb.hsv(tcol, 0.5 + ths[0], ths[1], ths[2])
        if L.get("tint"):
            tcol = nb.mix(1.0, tcol, tuple(L["tint"]) + (1.0,), blend="MULTIPLY")
        tcol = nb.mix(nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, tao), 0.7), tcol, (0, 0, 0, 1))
        amt = float(L["amount"])
        # (1) faces that point up (normal Z, broken up by a mid noise)
        tn = nb.noise(nb.vmath("ADD", pw, (li * 7.7, 0, 0)), 1.0 / (TS * 2.2), detail=3.0, rough=0.6)
        x = nb.math("ADD", nz, nb.math("MULTIPLY", nb.math("SUBTRACT", tn, 0.5), 0.7))
        lo, hi = L.get("nz", (0.35, 0.80))
        up = nb.ss(x, lo, hi)
        # (2) patchiness: only ~amount of the up-facing area is covered (large organic patches)
        pn = nb.noise(nb.vmath("ADD", pw, (11.3 + li * 19.1, 5.9, 2.1)), 1.0 / (TS * L.get("patch", 5.0)), detail=4.0, rough=0.6)
        spread = nb.math("MULTIPLY_ADD", nb.math("SUBTRACT", pn, 0.5), 3.2, 0.5)
        patch = nb.ss(spread, 1.0 - amt - 0.12, 1.0 - amt + 0.12)
        mask = nb.math("MULTIPLY", up, patch)
        # (3) height-aware edge: the layer fills crevices first
        mask = nb.math("ADD", nb.math("MULTIPLY", nb.math("SUBTRACT", mask, 0.5), 2.6),
                       nb.math("ADD", 0.5, nb.math("MULTIPLY", nb.math("SUBTRACT", th, height), 0.8)), clamp=True)
        col = nb.mix(mask, col, tcol)
        rough = nb.mix(mask, rough, nb.math("MULTIPLY_ADD", tr, 1.0, L.get("rough_add", 0.05)), kind="FLOAT")
        height = nb.mix(mask, height, nb.math("MULTIPLY_ADD", th, 0.6, 0.35), kind="FLOAT")
    # ---- shading
    bsdf = nb.n("ShaderNodeBsdfPrincipled")
    nb.set(bsdf.inputs["Base Color"], col)
    nb.set(bsdf.inputs["Roughness"], nb.math("ADD", rough, 0.0, clamp=True))
    try:
        bsdf.inputs["Specular IOR Level"].default_value = cfg.get("spec", 0.45)
        if cfg.get("metallic") is not None:
            bsdf.inputs["Metallic"].default_value = float(cfg["metallic"])
    except KeyError:
        pass
    bump = nb.n("ShaderNodeBump")
    nb.set(bump.inputs["Height"], height)
    nb.set(bump.inputs["Strength"], float(cfg.get("bump", 0.5)))
    nb.set(bump.inputs["Distance"], float(cfg.get("bump_dist", 0.02 * S if not uv_mode else 0.02)))
    if uv_mode and cfg.get("normal_map", True) and _img(cfg["set"], "nrm_gl", True):
        nm = nb.n("ShaderNodeNormalMap", space="TANGENT")
        nb.set(nm.inputs["Color"], nb.tex(_img(cfg["set"], "nrm_gl", True), p, bb, True))
        nb.set(bump.inputs["Normal"], nm.outputs["Normal"])
    nb.set(bsdf.inputs["Normal"], bump.outputs["Normal"])
    if want_emit and emit is not None:
        if cfg.get("emit_core"):
            lo_, hi_ = cfg["emit_core"]
            er, eg, eb = nb.sep(emit)                       # max channel (a red map has low luminance)
            emax = nb.math("MAXIMUM", nb.math("MAXIMUM", er, eg), eb)
            emit = nb.ss(emax, lo_, hi_)
        if cfg.get("emit_up"):
            _, _, enz = nb.sepxyz(nb.n("ShaderNodeNewGeometry").outputs["Normal"])
            emit = nb.math("MULTIPLY", emit, nb.ss(enz, cfg["emit_up"][0], cfg["emit_up"][1]))
        ec = nb.mix(1.0, emit, tuple(cfg.get("emit_color", (1, 0.4, 0.1))) + (1.0,), blend="MULTIPLY")
        nb.set(bsdf.inputs["Emission Color"], ec)
        es = float(cfg["emit"])
        foci = cfg.get("emit_near")
        if foci == "auto":
            foci = auto_foci()
        if foci:
            xy = nb.n("ShaderNodeCombineXYZ")
            px, py, _ = nb.sepxyz(pw)
            nb.set(xy.inputs[0], px)
            nb.set(xy.inputs[1], py)
            acc = None
            for (cx, cy, r0, r1) in foci:
                d = nb.n("ShaderNodeVectorMath", operation="DISTANCE")
                nb.set(d.inputs[0], xy.outputs[0])
                nb.set(d.inputs[1], (cx, cy, 0.0))
                mi = nb.ss(d.outputs["Value"], r0, r1, 1.0, cfg.get("emit_floor", 0.0))
                acc = mi if acc is None else nb.math("MAXIMUM", acc, mi)
            nb.set(bsdf.inputs["Emission Strength"], nb.math("MULTIPLY", acc, es))
        else:
            nb.set(bsdf.inputs["Emission Strength"], es)
    out = nb.n("ShaderNodeOutputMaterial")
    nb.set(out.inputs["Surface"], bsdf.outputs[0])
    m.diffuse_color = (0.3, 0.3, 0.3, 1)
    return m


# --------------------------------------------------------------------------------------------- application
def world_k(obj):
    s = obj.matrix_world.to_scale()
    return (abs(s.x) + abs(s.y) + abs(s.z)) / 3.0


def refresh_k(objs):
    for o in objs:
        if o.type == "MESH":
            o[K_PROP] = world_k(o)


def apply_pbr(obj, name, slots=None, **kw):
    """Assign CFCL_PBR_<name> to obj.  slots: list of fnmatch patterns on the current slot material names
    (None = every slot; an object without slots gets one).  Writes obj['cfcl_pbr_k'] (call after transforms).
    Returns the number of slots replaced."""
    mat = get_pbr(name, **kw)
    obj[K_PROP] = world_k(obj)
    if not obj.material_slots:
        obj.data.materials.append(mat)
        return 1
    n = 0
    for s in obj.material_slots:
        cur = s.material.name if s.material else ""
        if slots is None or any(fnmatch.fnmatchcase(cur, p) for p in slots):
            s.material = mat
            n += 1
    return n


def _match(name, pats):
    return any(fnmatch.fnmatchcase(name, p) for p in pats)


def apply_mapping(objects, mapping_path=None, optional=(), log=None, dry_run=False):
    """Apply assets/CFCL_PBR/pbr_mapping.json to objects (iterable).  First matching rule wins per slot.
    optional: names of keys under "optional" to enable (e.g. ("board_marble",)).  Returns a report dict."""
    mapping_path = mapping_path or os.path.join(LIB_DIR, "pbr_mapping.json")
    cfg = json.load(open(mapping_path, encoding="utf-8"))
    rules = []
    for opt in optional:                       # optional rules are explicit opt-ins: they bypass 'keep'
        rules += [dict(r, _opt=True) for r in cfg.get("optional", {}).get(opt, {}).get("rules", [])]
    rules += cfg["rules"]
    keep = cfg.get("keep", [])
    rep = {"objects": 0, "slots": 0, "by_material": {}, "kept": 0}
    for o in objects:
        if o.type != "MESH":
            continue
        kept_obj = _match(o.name, keep)
        rep["kept"] += int(kept_obj)
        done_slots = set()
        touched = False
        for r in rules:
            if kept_obj and not r.get("_opt"):
                continue
            if not _match(o.name, r["objects"]):
                continue
            if any(_match(o.name, [x]) for x in r.get("exclude", [])):
                continue
            for i, s in enumerate(o.material_slots):
                if i in done_slots:
                    continue
                cur = s.material.name if s.material else ""
                if r.get("slots") and not _match(cur, r["slots"]):
                    continue
                if not r.get("_opt") and _match(cur, cfg.get("keep_materials", [])):
                    continue
                if not dry_run:
                    mat = get_pbr(r["material"], **r.get("kw", {}))
                    s.material = mat
                    o[K_PROP] = world_k(o)
                    rep["by_material"][mat.name] = rep["by_material"].get(mat.name, 0) + 1
                done_slots.add(i)
                rep["slots"] += 1
                touched = True
        rep["objects"] += int(touched)
        if not touched and not kept_obj:
            rep.setdefault("unmatched", []).append(o.name)
    if log is not None:
        log.update(rep)
    return rep
