"""Crownfall (Claude track) - procedural material library  (v1, surface agent).

OWNER: surface/vegetation agent.  Everyone else obtains materials only through
`get(name)` / `assign(obj, name)` so upgrades propagate.  Names are stable.

All rock/organic textures are procedural and evaluated in WORLD space
(Geometry > Position), so texel density is physical (metres) and independent
of object scale.  Works in EEVEE (Next) and Cycles, Blender 5.2.

API
---
    get(name, rebuild=False, **kw)        -> bpy.types.Material  (CFCL_<name>)
    assign(obj, name, curvature=False, slot=None, **kw) -> Material
    bake_curvature(obj)                   -> writes POINT float attributes
        `cf_convex` / `cf_concave` (0..1).  Materials read them for edge wear on
        arrises and grime / moss in recesses.  Optional - without them the
        materials fall back to the AO node only.

    With kwargs, get("Basalt", moss=0.0) returns a SEPARATE datablock
    CFCL_Basalt__moss0 (never deletes or steals the default material that
    other objects use).  rebuild=True rebuilds a material in place.

Names: Basalt, AncientStone, BoneStone, HandStone, Moss, MossDry, Lava, LavaCrust, Bronze,
       Bark, Root, Fern, CrimsonLeaf, Vine, Sedge, Fungus, Ember.

Vegetation attribute contract (meshes from cf_vegetation):
    UV map "UVMap"   leaves: x = across blade (-1..1), y = along blade (0..1)
                     tubes : x = around (0..1),       y = along (metres)
    POINT float "cf_part"  0 = leaf blade, 0.5 = stem/rachis, 1 = flower/seed
    POINT float "cf_rand"  per-leaf random 0..1

Common kwargs: moss (0..1 coverage of upward faces), scale (pattern size mult.),
lichen / wet / streaks / cracks / wear / algae / verdigris (0..1 feature amounts).

NOTE for runtime/VR: procedural materials must be baked before GLB export.
"""
import math
import bpy

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

PREFIX = "CFCL_"
VERSION = "v1.0"


def _is_sock(v):
    return isinstance(v, bpy.types.NodeSocket)


# ---------------------------------------------------------------- node helper
class NB:
    """Small node-building helper (socket-level expression style)."""

    def __init__(self, mat):
        try:
            mat.use_nodes = True
        except Exception:
            pass
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self._k = 0
        self._cache = {}

    # ---- basic
    def _auto(self):
        self._k += 1
        return (-3200 + (self._k % 16) * 210, 1800 - (self._k // 16) * 240)

    def n(self, kind, loc=None, label=None, **props):
        nd = self.nt.nodes.new(kind)
        nd.location = loc if loc is not None else self._auto()
        if label:
            nd.label = label
        for k, v in props.items():
            if k.startswith("in_"):
                self.set_in(nd, k[3:].replace("__", " "), v)
            else:
                try:
                    setattr(nd, k, v)
                except Exception as e:  # pragma: no cover
                    print("[cf_materials] prop", kind, k, e)
        return nd

    @staticmethod
    def set_in(nd, name, value):
        sock = nd.inputs.get(name)
        if sock is None:
            print("[cf_materials] missing input", nd.bl_idname, name)
            return
        try:
            sock.default_value = value
        except Exception:
            try:
                sock.default_value = (value, value, value, 1.0)
            except Exception as e:
                print("[cf_materials] could not set", nd.bl_idname, name, e)

    def l(self, a, out, b, inp):
        o = a.outputs[out] if isinstance(out, (int, str)) else out
        i = b.inputs[inp] if isinstance(inp, (int, str)) else inp
        self.nt.links.new(o, i)

    def link(self, v, sock):
        if v is None:
            return
        if _is_sock(v):
            self.nt.links.new(v, sock)
            return
        try:
            sock.default_value = v
            return
        except Exception:
            pass
        try:
            if isinstance(v, (tuple, list)) and len(v) == 3:
                sock.default_value = (*v, 1.0)
            else:
                sock.default_value = (v, v, v, 1.0)
        except Exception as e:  # pragma: no cover
            print("[cf_materials] link default failed", sock.name, v, e)

    # ---- scalar math (all return output sockets)
    def m(self, op, a, b=None, c=None, clamp=False):
        nd = self.n("ShaderNodeMath", operation=op)
        nd.use_clamp = clamp
        for i, v in enumerate((a, b, c)):
            if v is not None:
                self.link(v, nd.inputs[i])
        return nd.outputs[0]

    def add(self, a, b, clamp=False):
        return self.m("ADD", a, b, clamp=clamp)

    def sub(self, a, b, clamp=False):
        return self.m("SUBTRACT", a, b, clamp=clamp)

    def mul(self, a, b, clamp=False):
        return self.m("MULTIPLY", a, b, clamp=clamp)

    def mad(self, a, b, c, clamp=False):
        return self.m("MULTIPLY_ADD", a, b, c, clamp=clamp)

    def mx(self, a, b):
        return self.m("MAXIMUM", a, b)

    def mn(self, a, b):
        return self.m("MINIMUM", a, b)

    def c01(self, a):
        return self.m("ADD", a, 0.0, clamp=True)

    def absv(self, a):
        return self.m("ABSOLUTE", a)

    def powv(self, a, e):
        return self.m("POWER", a, e)

    def _mr(self, x, lo, hi, a, b, interp):
        nd = self.n("ShaderNodeMapRange")
        nd.clamp = True
        try:
            nd.interpolation_type = interp
        except Exception:
            pass
        self.link(x, nd.inputs[0])
        for i, v in ((1, lo), (2, hi), (3, a), (4, b)):
            self.link(v, nd.inputs[i])
        return nd.outputs[0]

    def ss(self, x, lo, hi, a=0.0, b=1.0):
        """smoothstep remap x:[lo,hi] -> [a,b] (clamped)."""
        return self._mr(x, lo, hi, a, b, "SMOOTHSTEP")

    def lin(self, x, lo, hi, a=0.0, b=1.0):
        return self._mr(x, lo, hi, a, b, "LINEAR")

    # ---- colour
    def cmix(self, fac, a, b, blend="MIX"):
        nd = self.n("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        nd.clamp_factor = True
        self.link(fac, nd.inputs[0])
        self.link(a, nd.inputs[6])
        self.link(b, nd.inputs[7])
        return nd.outputs[2]

    def hsv(self, col, h=0.5, s=1.0, v=1.0):
        nd = self.n("ShaderNodeHueSaturation")
        self.link(h, nd.inputs["Hue"])
        self.link(s, nd.inputs["Saturation"])
        self.link(v, nd.inputs["Value"])
        self.link(1.0, nd.inputs["Fac"])
        self.link(col, nd.inputs["Color"])
        return nd.outputs["Color"]

    def rampc(self, x, stops, interp="LINEAR"):
        nd = self.n("ShaderNodeValToRGB")
        el = nd.color_ramp.elements
        try:
            nd.color_ramp.interpolation = interp
        except Exception:
            pass
        while len(el) > len(stops):
            el.remove(el[-1])
        while len(el) < len(stops):
            el.new(0.5)
        for e, (p, c) in zip(el, stops):
            e.position = p
            e.color = (*c, 1.0) if len(c) == 3 else c
        self.link(x, nd.inputs["Fac"])
        return nd.outputs["Color"]

    def seprgb(self, col):
        nd = self.n("ShaderNodeSeparateColor")
        self.link(col, nd.inputs[0])
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    # ---- vectors
    def vop(self, op, a, b=None, s=None):
        nd = self.n("ShaderNodeVectorMath", operation=op)
        self.link(a, nd.inputs[0])
        if b is not None:
            self.link(b, nd.inputs[1])
        if s is not None:
            self.link(s, nd.inputs["Scale"])
        return nd.outputs["Vector"] if op not in ("LENGTH", "DOT_PRODUCT", "DISTANCE") else nd.outputs["Value"]

    def vsep(self, v):
        nd = self.n("ShaderNodeSeparateXYZ")
        self.link(v, nd.inputs[0])
        return nd.outputs["X"], nd.outputs["Y"], nd.outputs["Z"]

    def vcomb(self, x, y, z):
        nd = self.n("ShaderNodeCombineXYZ")
        self.link(x, nd.inputs[0])
        self.link(y, nd.inputs[1])
        self.link(z, nd.inputs[2])
        return nd.outputs[0]

    # ---- textures (return nodes)
    def tn(self, vec, scale, detail=4.0, rough=0.55, dist=0.0, lac=2.0, ntype="FBM"):
        nd = self.n("ShaderNodeTexNoise")
        try:
            nd.noise_type = ntype
        except Exception:
            pass
        self.link(vec, nd.inputs["Vector"])
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Detail"].default_value = detail
        nd.inputs["Roughness"].default_value = rough
        nd.inputs["Distortion"].default_value = dist
        if nd.inputs.get("Lacunarity"):
            nd.inputs["Lacunarity"].default_value = lac
        return nd

    def tv(self, vec, scale, feature="F1", rand=1.0):
        nd = self.n("ShaderNodeTexVoronoi")
        nd.feature = feature
        self.link(vec, nd.inputs["Vector"])
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Randomness"].default_value = rand
        return nd

    # ---- cached inputs
    def geo(self):
        if "geo" not in self._cache:
            self._cache["geo"] = self.n("ShaderNodeNewGeometry")
        return self._cache["geo"]

    def pos(self, scale=1.0):
        p = self.geo().outputs["Position"]
        if scale != 1.0:
            p = self.vop("SCALE", p, s=1.0 / scale)
        return p

    def nz(self):
        if "nz" not in self._cache:
            self._cache["nz"] = self.vsep(self.geo().outputs["Normal"])[2]
        return self._cache["nz"]

    def attr(self, name, out="Fac"):
        key = "attr_" + name
        if key not in self._cache:
            nd = self.n("ShaderNodeAttribute")
            nd.attribute_type = "GEOMETRY"
            nd.attribute_name = name
            self._cache[key] = nd
        return self._cache[key].outputs[out]

    def objrand(self):
        if "obr" not in self._cache:
            self._cache["obr"] = self.n("ShaderNodeObjectInfo")
        return self._cache["obr"].outputs["Random"]

    def cavity(self, dist):
        """1-AO: 0 open, ->1 in recesses (EEVEE horizon scan / Cycles rays)."""
        nd = self.n("ShaderNodeAmbientOcclusion")
        nd.inputs["Distance"].default_value = dist
        try:
            nd.samples = 8
        except Exception:
            pass
        return self.sub(1.0, nd.outputs["AO"])

    def principled(self, col, rough, normal=None, metallic=None, extra=None):
        b = self.n("ShaderNodeBsdfPrincipled")
        out = self.n("ShaderNodeOutputMaterial")
        self.link(col, b.inputs["Base Color"])
        self.link(rough, b.inputs["Roughness"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        if metallic is not None:
            self.link(metallic, b.inputs["Metallic"])
        for k, v in (extra or {}).items():
            s = b.inputs.get(k)
            if s is not None:
                self.link(v, s)
        self.nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
        return b, out

    def bump(self, height, strength, dist, normal=None):
        nd = self.n("ShaderNodeBump")
        self.link(height, nd.inputs["Height"])
        nd.inputs["Strength"].default_value = strength
        nd.inputs["Distance"].default_value = dist
        if normal is not None:
            self.link(normal, nd.inputs["Normal"])
        return nd.outputs["Normal"]

    # ---- v0 compatibility helpers (node-returning) -------------------------
    def world_pos(self, scale=1.0, loc=None):
        return self.geo(), self.pos(1.0 / scale if scale != 1.0 else 1.0)

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0, loc=None, ntype="FBM"):
        return self.tn(vec, scale, detail, rough, dist, ntype=ntype)

    def voronoi(self, vec, scale, feature="F1", loc=None, rand=1.0):
        return self.tv(vec, scale, feature, rand)

    def ramp(self, inp, stops, loc=None):
        return self.rampc(inp, stops).node

    def maprange(self, inp, a, b, c=0.0, d=1.0, loc=None, clamp=True):
        return self.ss(inp, a, b, c, d).node

    def math(self, op, a, b=None, loc=None, clamp=False):
        return self.m(op, a, b, clamp=clamp).node

    def mix(self, fac, a, b, loc=None, blend="MIX"):
        return self.cmix(fac, a, b, blend).node

    def bsdf(self, loc=None):
        b = self.n("ShaderNodeBsdfPrincipled")
        out = self.n("ShaderNodeOutputMaterial")
        self.nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
        return b, out

    def up_mask(self, lo=0.45, hi=0.85, loc=None):
        return self.ss(self.nz(), lo, hi).node


def _new(name):
    """Get-or-create CFCL_<name>; an existing datablock is rebuilt IN PLACE so users keep it."""
    full = PREFIX + name
    m = bpy.data.materials.get(full)
    if m is None:
        m = bpy.data.materials.new(full)
    try:
        m["cf_lib_version"] = VERSION
    except Exception:
        pass
    return m


def _warp(nb, pos, scale, amount, detail=2.0):
    w = nb.tn(pos, scale, detail, 0.5).outputs["Color"]
    w = nb.vop("SUBTRACT", w, (0.5, 0.5, 0.5))
    return nb.vop("ADD", pos, nb.vop("SCALE", w, s=amount))


# ---------------------------------------------------------------- moss
# Desaturated olive moss (research ref study 3a: base #4f5a3a = lin (0.078,0.102,0.042), HSV S ~0.3 albedo,
# renders S 0.18-0.23; bright yellow-green only on light-struck tips).
MOSS_GREEN = [(0.25, (0.028, 0.037, 0.030)), (0.40, (0.046, 0.060, 0.046)), (0.52, (0.062, 0.083, 0.060)),
              (0.64, (0.082, 0.104, 0.072)), (0.78, (0.108, 0.128, 0.088))]
MOSS_DRY = [(0.25, (0.040, 0.037, 0.021)), (0.40, (0.068, 0.062, 0.034)), (0.52, (0.098, 0.090, 0.047)),
            (0.64, (0.128, 0.116, 0.061)), (0.78, (0.160, 0.144, 0.078))]


def _moss_color(nb, pos, dry=False, scale=1.0):
    """Velvet moss colour: clump domes (lit tips) vs gaps (shadow), mottling. -> (col, height, tips)."""
    clump = nb.tn(pos, 24.0 / scale, 2.0, 0.5, 0.3).outputs["Fac"]
    tips = nb.ss(clump, 0.35, 0.75)
    mott = nb.tn(pos, 3.2 / scale, 4.0, 0.55).outputs["Fac"]
    fine = nb.tn(pos, 115.0 / scale, 3.0, 0.6).outputs["Fac"]
    t = nb.mad(tips, 0.30, nb.mad(mott, 0.32, nb.mad(fine, 0.20, 0.09)))
    col = nb.rampc(t, MOSS_DRY if dry else MOSS_GREEN)
    vor = nb.tv(pos, 45.0 / scale, "F1")
    dome = nb.lin(vor.outputs["Distance"], 0.0, 0.7, 1.0, 0.0)
    h = nb.mad(tips, 0.6, nb.mad(dome, 0.35, nb.mul(fine, 0.3)))
    return col, h, tips


def _moss_layer(nb, pos, strength, lo=0.45, hi=0.80, cav=None, dry_mix=0.18, scale=1.0, open_w=0.22,
                strength_sock=None):
    """Moss on stone (critic spec): mask = up-facing (normal.z lo->hi) x (open_w + crevice/AO term)
    x (1 - arris) x multi-scale breakup, bare-stone islands, soft ragged edge.  Flat open planes get only small
    sparse clusters; joints, wall bases and cracks fill.  open_w raises coverage of open tops (skull crown).
    strength_sock (optional socket 0..1) replaces the float strength per pixel (hand gradient).  -> (mask, col, h)"""
    up = nb.ss(nb.nz(), lo, hi)
    big = nb.tn(pos, 0.5 / scale, 3.0, 0.5, 0.3).outputs["Fac"]
    mid = nb.tn(pos, 2.0 / scale, 5.0, 0.6, 0.6).outputs["Fac"]
    fin = nb.tn(pos, 9.0 / scale, 4.0, 0.6).outputs["Fac"]
    edg = nb.tn(pos, 30.0 / scale, 4.0, 0.7).outputs["Fac"]
    arr, _ = _arris(nb, pos, scale, 0.04)
    if cav is not None:
        base = nb.mul(up, nb.mad(nb.ss(cav, 0.05, 0.5), 0.95, open_w))
    else:
        base = nb.mul(up, open_w)
    base = nb.mul(base, nb.sub(1.0, nb.mul(arr, 0.75)))
    cov = nb.mul(base, nb.mad(big, 0.8, 0.6))
    cov = nb.add(cov, nb.mad(mid, 0.38, -0.19))
    cov = nb.add(cov, nb.mad(fin, 0.24, -0.12))
    cov = nb.add(cov, nb.mad(edg, 0.12, -0.06))
    thr = nb.mad(strength_sock, -0.42, 0.62) if strength_sock is not None else 0.62 - 0.42 * float(strength)
    mask = nb.ss(nb.sub(cov, thr), -0.05, 0.12)
    thin = nb.lin(nb.tn(pos, 5.5 / scale, 3.0, 0.6, 0.3).outputs["Fac"], 0.3, 0.7, 0.6, 1.0)  # sparse vs dense moss
    mask = nb.mul(mask, thin)
    isl = nb.ss(nb.tn(pos, 3.5 / scale, 3.0, 0.55, 0.5).outputs["Fac"], 0.62, 0.69)      # bare-stone islands
    mask = nb.mul(mask, nb.sub(1.0, nb.mul(isl, 0.9)))
    if strength_sock is None:
        mask = nb.mul(mask, min(1.0, float(strength) * 5.0))
    col, h, tips = _moss_color(nb, pos, False, scale)
    if dry_mix > 0:
        dcol, _, _ = _moss_color(nb, pos, True, scale)
        dsel = nb.mul(nb.ss(nb.tn(pos, 0.8 / scale, 3.0).outputs["Fac"], 0.56, 0.66), dry_mix * 2.5)
        col = nb.cmix(nb.c01(dsel), col, dcol)
    band = nb.mul(nb.ss(mask, 0.0, 0.35), nb.ss(mask, 0.85, 0.45))     # thin darker moss at patch edges
    col = nb.cmix(nb.mul(band, 0.6), col, (0.040, 0.042, 0.030))
    return mask, col, h


def _apply_moss(nb, col, rough, height, pos, strength, lo=0.45, hi=0.80, cav=None, scale=1.0, hamp=1.4,
                open_w=0.22, strength_sock=None):
    if strength_sock is None and strength <= 0:
        return col, rough, height, None
    mask, mcol, mh = _moss_layer(nb, pos, strength, lo, hi, cav, scale=scale, open_w=open_w,
                                 strength_sock=strength_sock)
    col = nb.cmix(mask, col, mcol)
    rough = nb.mad(nb.sub(0.93, rough), mask, rough)
    height = nb.add(height, nb.mul(mask, nb.mad(mh, 0.6 * hamp, 0.5 * hamp)))
    return col, rough, height, mask


def _arris(nb, pos, scale=1.0, dist=0.03):
    """Convex-edge (arris) mask without baked attributes: 1 - inside-AO (EEVEE + Cycles), max'ed with the
    optional cf_convex attribute.  -> (arris 0..1, chip mask 0..1 for 0.5-2 cm chips on the arrises)."""
    key = ("arris", round(dist * scale, 4))
    if key in nb._cache:
        return nb._cache[key]
    ao = nb.n("ShaderNodeAmbientOcclusion")
    try:
        ao.inside = True
        ao.samples = 8
    except Exception:
        pass
    ao.inputs["Distance"].default_value = dist * scale
    arr = nb.ss(nb.sub(1.0, ao.outputs["AO"]), 0.15, 0.6)
    arr = nb.mx(arr, nb.attr("cf_convex"))
    chipv = nb.tv(_warp(nb, pos, 40.0 / scale, 0.006 * scale), 55.0 / scale, "F1")
    chip = nb.mul(nb.ss(chipv.outputs["Distance"], 0.0, 0.45, 1.0, 0.0),
                  nb.ss(nb.tn(pos, 6.0 / scale, 3.0).outputs["Fac"], 0.42, 0.58))
    chip = nb.mul(chip, arr)
    nb._cache[key] = (arr, chip)
    return arr, chip


def _weather(nb, pos, col, rough, scale=1.0, amt=1.0):
    """Medium-scale (0.3-2 m) tone/roughness patches: bleached-dry vs damp-dark."""
    w = nb.tn(pos, 1.1 / scale, 3.0, 0.5, 0.4).outputs["Fac"]
    w2 = nb.tn(pos, 0.45 / scale, 2.0).outputs["Fac"]
    dry = nb.mul(nb.ss(w, 0.49, 0.63), amt)
    damp = nb.mul(nb.mul(nb.ss(w, 0.49, 0.36), nb.ss(w2, 0.38, 0.58)), amt)
    col = nb.hsv(col, s=nb.lin(dry, 0.0, 1.0, 1.0, 0.9),
                 v=nb.mul(nb.lin(dry, 0.0, 1.0, 1.0, 1.16), nb.lin(damp, 0.0, 1.0, 1.0, 0.72)))
    rough = nb.mad(dry, 0.08, nb.mad(damp, -0.14, rough))
    return col, rough


def _lichen(nb, pos, amount, scale, size=1.0, rare_lo=0.58, rare_hi=0.68, seed_off=(0, 0, 0)):
    """Lichen rosettes: voronoi discs gated by a rarity noise. -> (mask, cell_random)"""
    p = nb.vop("ADD", pos, seed_off) if seed_off != (0, 0, 0) else pos
    grain = nb.tn(p, 40.0 / scale, 3.0, 0.6).outputs["Fac"]
    lv = nb.tv(_warp(nb, p, 9.0 / scale, 0.035 * scale), 6.0 / (scale * size), "F1")
    blob = nb.tn(p, 14.0 / scale, 3.0, 0.6).outputs["Fac"]
    d = nb.mad(grain, 0.30, nb.mad(blob, 0.25, nb.sub(lv.outputs["Distance"], 0.27)))
    spot = nb.ss(d, 0.07, 0.15, 1.0, 0.0)
    rare = nb.ss(nb.tn(p, 0.55 / scale, 3.0).outputs["Fac"], rare_lo, rare_hi)
    mask = nb.mul(nb.mul(spot, rare), amount)
    r = nb.seprgb(lv.outputs["Color"])[0]
    return mask, r, grain


# ---------------------------------------------------------------- recipes
# Albedo targets follow research/reference_study.md 3a (linear Base Color starts):
#   basalt 0.04 (#3a3733), ancient stone 0.13 olive-grey (#6b665a), bone 0.25 (#8f8a76), hand 0.18 (#77756a),
#   moss 0.078/0.102/0.042 (#4f5a3a), crimson leaf 0.156/0.010/0.014 (#6e1a1f), fern (#4d5836), lava crust (#1a1512).
def make_basalt(moss=0.35, lichen=1.0, wet=1.0, columns=1.0, scale=1.0, _name="Basalt"):
    """Near-black charcoal basalt: warm-brown / cool-grey zones, columnar facets (roughness + normal on
    vertical faces only), vesicle pits, fresh lighter breaks on arrises, rare ochre lichen, wet-dark streaks,
    moss on ledges."""
    m = _new(_name)
    nb = NB(m)
    pos = nb.pos(scale)
    wpos = _warp(nb, pos, 0.22, 0.9)
    big = nb.tn(wpos, 0.16, 3.0, 0.5).outputs["Fac"]
    mid = nb.tn(wpos, 1.15, 6.0, 0.6, 0.25).outputs["Fac"]
    grain = nb.tn(pos, 26.0, 6.0, 0.65).outputs["Fac"]
    tone = nb.rampc(big, [(0.30, (0.032, 0.034, 0.036)), (0.50, (0.042, 0.038, 0.033)),
                          (0.70, (0.046, 0.036, 0.027))])
    val = nb.mul(nb.lin(mid, 0.3, 0.7, 0.70, 1.28), nb.lin(grain, 0.3, 0.7, 0.88, 1.10))
    nzabs = nb.absv(nb.nz())
    side = nb.ss(nzabs, 0.45, 0.82, 1.0, 0.0)
    # columnar facets: tall voronoi cells (z squashed), only expressed on vertical faces
    cpos = nb.vop("MULTIPLY", wpos, (1.25, 1.25, 0.10))
    cv_e = nb.tv(cpos, 1.0, "DISTANCE_TO_EDGE")
    cv_f = nb.tv(cpos, 1.0, "F1")
    crand = nb.seprgb(cv_f.outputs["Color"])[0]
    brk = nb.ss(nb.tn(pos, 0.55, 3.0).outputs["Fac"], 0.42, 0.56)
    joint = nb.mul(nb.mul(nb.ss(cv_e.outputs["Distance"], 0.0, 0.03, 1.0, 0.0), side), nb.mul(brk, columns))
    colvar = nb.mad(nb.lin(crand, 0.0, 1.0, -0.16, 0.14), side, 1.0)
    # vesicle pits in patches
    ves = nb.tv(pos, 65.0, "F1")
    vpatch = nb.ss(nb.tn(pos, 2.2, 3.0).outputs["Fac"], 0.48, 0.62)
    pit = nb.mul(nb.ss(ves.outputs["Distance"], 0.0, 0.16, 1.0, 0.0), vpatch)
    # wet-dark streaks running down vertical faces
    spos = nb.vop("MULTIPLY", pos, (5.0, 5.0, 0.32))
    st = nb.tn(spos, 1.0, 4.0, 0.55).outputs["Fac"]
    wetm = nb.mul(nb.mul(nb.ss(st, 0.56, 0.70), nb.ss(nzabs, 0.5, 0.88, 1.0, 0.0)),
                  nb.mul(nb.ss(nb.tn(pos, 0.35, 2.0).outputs["Fac"], 0.42, 0.58), wet))
    cvx = nb.attr("cf_convex")
    ccv = nb.attr("cf_concave")
    cav = nb.c01(nb.mad(nb.cavity(0.4), 0.8, ccv))
    lich, lr, lgrain = _lichen(nb, pos, lichen * 1.0, scale, 0.9, 0.62, 0.70)
    lich = nb.mul(lich, nb.ss(nb.nz(), -0.4, 0.1))
    lcol = nb.rampc(lgrain, [(0.35, (0.150, 0.088, 0.026)), (0.65, (0.230, 0.155, 0.058))])
    c = nb.hsv(tone, v=nb.mul(val, colvar))
    c = nb.cmix(nb.mul(joint, 0.75), c, (0.010, 0.010, 0.010))
    c = nb.cmix(nb.mul(pit, 0.55), c, (0.012, 0.011, 0.010))
    barr, bchips = _arris(nb, pos, scale, 0.03)
    c = nb.cmix(nb.mul(nb.mx(nb.mul(barr, 0.6), bchips), 0.7), c, (0.075, 0.070, 0.062))   # fresh breaks
    c = nb.cmix(nb.mul(cav, 0.55), c, (0.013, 0.013, 0.012))
    c = nb.cmix(wetm, c, (0.48, 0.48, 0.48), "MULTIPLY")
    c = nb.cmix(lich, c, lcol)
    rough = nb.mad(nb.sub(grain, 0.5), 0.14, nb.mad(nb.mul(nb.sub(crand, 0.5), side), 0.16, 0.72))
    rough = nb.mad(nb.sub(0.42, rough), nb.mul(nb.mx(cvx, bchips), 0.7), rough)
    rough = nb.mad(nb.sub(0.30, rough), wetm, rough)
    rough = nb.mad(nb.sub(0.93, rough), lich, rough)
    rel = nb.tn(wpos, 5.5, 5.0, 0.62, 0.4).outputs["Fac"]
    h = nb.mad(mid, 0.45, nb.mad(rel, 0.5, nb.mul(grain, 0.18)))
    h = nb.sub(h, nb.mad(joint, 0.6, nb.mul(pit, 0.25)))
    h = nb.mad(lich, 0.06, nb.mad(cvx, 0.1, h))
    c, rough = _weather(nb, pos, c, rough, scale, 0.8)
    c, rough, h, _ = _apply_moss(nb, c, rough, h, pos, moss, 0.5, 0.85, cav, open_w=0.18)
    nrm = nb.bump(h, 0.7, 0.018 * scale)
    nb.principled(c, rough, nrm, extra={"Specular IOR Level": 0.45})
    return m


def make_ancient_stone(moss=0.42, lichen=1.0, streaks=1.0, cracks=1.0, wear=1.0, scale=1.0, _name="AncientStone"):
    """Carved olive-grey limestone (albedo ~0.10-0.20, mid #6b665a): recess grime (AO + cf_concave),
    rain streaks, lichen, brighter worn arrises (cf_convex), sparse cracks, moss blanket on upward faces."""
    m = _new(_name)
    nb = NB(m)
    pos = nb.pos(scale)
    wpos = _warp(nb, pos, 0.35, 0.5)
    big = nb.tn(wpos, 0.35, 3.0, 0.5).outputs["Fac"]
    mid = nb.tn(wpos, 2.6, 6.0, 0.6, 0.2).outputs["Fac"]
    grain = nb.tn(pos, 32.0, 6.0, 0.65).outputs["Fac"]
    tone = nb.rampc(big, [(0.30, (0.096, 0.094, 0.080)), (0.50, (0.132, 0.128, 0.110)),
                          (0.72, (0.165, 0.160, 0.138))])
    val = nb.mul(nb.lin(mid, 0.3, 0.7, 0.76, 1.18), nb.lin(grain, 0.3, 0.7, 0.92, 1.06))
    spk = nb.tv(pos, 140.0, "F1")
    speck = nb.mul(nb.ss(spk.outputs["Distance"], 0.0, 0.18, 1.0, 0.0),
                   nb.ss(nb.tn(pos, 9.0, 2.0).outputs["Fac"], 0.5, 0.62))
    nzabs = nb.absv(nb.nz())
    side = nb.ss(nzabs, 0.45, 0.85, 1.0, 0.0)
    st = nb.tn(nb.vop("MULTIPLY", pos, (2.6, 2.6, 0.18)), 1.0, 2.0, 0.45).outputs["Fac"]
    smask = nb.ss(nb.tn(pos, 0.5, 2.0).outputs["Fac"], 0.45, 0.60)
    streak_d = nb.mul(nb.mul(nb.ss(st, 0.55, 0.72), side), nb.mul(smask, streaks))
    streak_l = nb.mul(nb.mul(nb.ss(st, 0.32, 0.22), side), 0.5 * streaks)
    cvx = nb.attr("cf_convex")
    ccv = nb.attr("cf_concave")
    grime = nb.c01(nb.mad(nb.cavity(0.35), 0.9, nb.mul(ccv, 0.9)))
    cpos = _warp(nb, pos, 1.5, 0.25)
    cr = nb.tv(cpos, 1.6, "DISTANCE_TO_EDGE")
    crk = nb.mul(nb.ss(cr.outputs["Distance"], 0.0, 0.012, 1.0, 0.0),
                 nb.mul(nb.ss(nb.tn(pos, 0.9, 2.0).outputs["Fac"], 0.52, 0.60), cracks))
    lich, lr, lgrain = _lichen(nb, pos, lichen, scale, 1.0, 0.55, 0.66)
    lcol = nb.cmix(nb.ss(lr, 0.80, 0.82), nb.hsv((0.185, 0.188, 0.150), v=nb.lin(lgrain, 0.3, 0.7, 0.85, 1.12)),
                   (0.200, 0.095, 0.030))
    blk = nb.mul(nb.mul(nb.ss(nb.tv(pos, 30.0, "F1").outputs["Distance"], 0.0, 0.12, 1.0, 0.0),
                        nb.ss(nb.tn(pos, 1.1, 2.0).outputs["Fac"], 0.60, 0.70)), lichen)
    chip = nb.ss(nb.tn(pos, 14.0, 4.0).outputs["Fac"], 0.42, 0.60)
    arr, chips = _arris(nb, pos, scale, 0.03)
    ew = nb.c01(nb.mul(nb.mul(arr, nb.mad(chip, 0.6, 0.55)), wear * 1.2))
    ew = nb.mx(ew, nb.mul(chips, wear))
    c = nb.hsv(tone, v=val)
    c = nb.cmix(nb.mul(speck, 0.5), c, (0.055, 0.052, 0.042))
    c = nb.cmix(streak_l, c, (0.185, 0.180, 0.158))
    c = nb.cmix(nb.mul(streak_d, 0.55), c, (0.060, 0.061, 0.052))
    c = nb.cmix(nb.mul(grime, 0.85), c, (0.034, 0.034, 0.026))
    c = nb.cmix(nb.mul(ew, 0.8), c, (0.215, 0.208, 0.180))
    c = nb.cmix(nb.mul(crk, 0.6), c, (0.030, 0.029, 0.025))
    c = nb.cmix(lich, c, lcol)
    c = nb.cmix(nb.mul(blk, 0.8), c, (0.018, 0.018, 0.015))
    ero = nb.tn(wpos, 7.0, 5.0, 0.62, 0.3).outputs["Fac"]                       # 10-15 cm erosion relief
    crust = nb.ss(nb.tn(_warp(nb, pos, 1.6, 0.2), 0.9, 4.0, 0.6).outputs["Fac"], 0.56, 0.70)
    c = nb.cmix(nb.mul(crust, 0.7), c, (0.060, 0.060, 0.052))                  # dark weathering crust colonies
    pits = nb.mul(nb.ss(nb.tv(pos, 24.0, "F1").outputs["Distance"], 0.0, 0.22, 1.0, 0.0),
                  nb.ss(nb.tn(pos, 2.5, 2.0).outputs["Fac"], 0.5, 0.62))
    c = nb.cmix(nb.mul(pits, 0.5), c, (0.05, 0.05, 0.042))
    rough = nb.mad(nb.sub(grain, 0.5), 0.10, 0.74)
    rough = nb.mad(nb.sub(0.50, rough), ew, rough)
    rough = nb.mad(nb.sub(0.92, rough), lich, rough)
    h = nb.mad(mid, 0.35, nb.mad(ero, 0.55, nb.mul(grain, 0.2)))
    h = nb.sub(h, nb.mad(crk, 0.8, nb.mad(speck, 0.1, nb.mad(pits, 0.35, nb.mul(grime, 0.15)))))
    h = nb.mad(lich, 0.08, nb.mad(ew, 0.12, nb.mad(crust, 0.08, nb.mad(chips, -0.6, h))))
    c, rough = _weather(nb, pos, c, rough, scale, 1.0)
    c, rough, h, _ = _apply_moss(nb, c, rough, h, pos, moss, 0.45, 0.80, grime, open_w=0.22)
    nrm = nb.bump(h, 0.75, 0.014 * scale)
    nb.principled(c, rough, nrm, extra={"Specular IOR Level": 0.42})
    return m


def make_bone_stone(moss=0.7, algae=1.0, lichen=0.6, value=1.0, scale=1.0, moss_grad=None, _name="BoneStone"):
    """Petrified bone: warm ivory-grey (mid #8f8a76 = lin 0.25, max <= 0.33), porous, greenish grime in
    cavities, dark sutures/crazing, green algae + rain streaks, thick moss on top and in cavities.
    value<1 darkens the whole tone (HandStone uses 0.72)."""
    m = _new(_name)
    nb = NB(m)
    pos = nb.pos(scale)
    wpos = _warp(nb, pos, 0.5, 0.45)
    big = nb.tn(wpos, 0.30, 3.0, 0.5).outputs["Fac"]
    mid = nb.tn(wpos, 2.0, 6.0, 0.6, 0.25).outputs["Fac"]
    grain = nb.tn(pos, 30.0, 6.0, 0.65).outputs["Fac"]
    v = float(value)
    tone = nb.rampc(big, [(0.30, (0.100 * v, 0.099 * v, 0.080 * v)), (0.50, (0.132 * v, 0.129 * v, 0.103 * v)),
                          (0.72, (0.162 * v, 0.158 * v, 0.127 * v))])
    val = nb.mul(nb.lin(mid, 0.3, 0.7, 0.85, 1.10), nb.lin(grain, 0.3, 0.7, 0.92, 1.06))
    pore = nb.mul(nb.ss(nb.tv(pos, 38.0, "F1").outputs["Distance"], 0.0, 0.2, 1.0, 0.0),
                  nb.ss(nb.tn(pos, 3.0, 3.0).outputs["Fac"], 0.45, 0.60))
    cn1 = nb.tn(wpos, 5.0, 4.0, 0.55).outputs["Fac"]
    craz = nb.mul(nb.ss(nb.absv(nb.sub(cn1, 0.5)), 0.0, 0.008, 1.0, 0.0),
                  nb.mul(nb.ss(nb.tn(pos, 3.1, 2.0).outputs["Fac"], 0.60, 0.68), 0.4))
    cn2 = nb.tn(_warp(nb, pos, 7.0, 0.03), 0.9, 3.0, 0.5).outputs["Fac"]
    sut = nb.mul(nb.ss(nb.absv(nb.sub(cn2, 0.5)), 0.0, 0.006, 1.0, 0.0),
                 nb.ss(nb.tn(pos, 0.6, 2.0).outputs["Fac"], 0.50, 0.58))
    ccv = nb.attr("cf_concave")
    cvx = nb.attr("cf_convex")
    stain = nb.c01(nb.mad(nb.cavity(0.7), 1.1, ccv))
    nzabs = nb.absv(nb.nz())
    side = nb.ss(nzabs, 0.45, 0.85, 1.0, 0.0)
    st = nb.tn(nb.vop("MULTIPLY", pos, (2.5, 2.5, 0.22)), 1.0, 5.0, 0.6).outputs["Fac"]
    alg = nb.mul(nb.mul(nb.ss(st, 0.55, 0.70), side), algae)
    st2 = nb.tn(nb.vop("MULTIPLY", nb.vop("ADD", pos, (13.1, 7.7, 3.3)), (4.0, 4.0, 0.3)), 1.0, 4.0, 0.6).outputs["Fac"]
    rain = nb.mul(nb.ss(st2, 0.58, 0.74), side)
    lich, lr, lgrain = _lichen(nb, pos, lichen, scale, 1.1, 0.6, 0.7, (5.0, 3.0, 1.0))
    c = nb.hsv(tone, v=val)
    c = nb.cmix(nb.mul(pore, 0.55), c, (0.070 * v, 0.062 * v, 0.045 * v))
    c = nb.cmix(nb.mul(rain, 0.5), c, (0.085 * v, 0.082 * v, 0.066 * v))
    c = nb.cmix(nb.mul(alg, 0.75), c, (0.070, 0.084, 0.050))
    c = nb.cmix(nb.mul(stain, 0.85), c, (0.072 * v, 0.080 * v, 0.054 * v))   # greenish grime (#6d6f5c family)
    c = nb.cmix(nb.mul(craz, 0.6), c, (0.055, 0.050, 0.038))
    c = nb.cmix(nb.mul(sut, 0.9), c, (0.028, 0.026, 0.018))
    oarr, ochips = _arris(nb, pos, scale, 0.03)
    c = nb.cmix(nb.mx(nb.mul(oarr, 0.3), nb.mul(ochips, 0.7)), c, (0.190 * v, 0.183 * v, 0.148 * v))
    c = nb.cmix(lich, c, (0.185, 0.190, 0.150))
    gpatch = nb.ss(nb.tn(pos, 0.9, 3.0, 0.5, 0.3).outputs["Fac"], 0.47, 0.66)
    c = nb.cmix(nb.mul(gpatch, 0.6), c, (0.105 * v, 0.110 * v, 0.082 * v))   # grey-green weathered patches
    rough = nb.mad(nb.sub(grain, 0.5), 0.12, 0.68)
    rough = nb.mad(nb.sub(0.62, rough), alg, rough)
    c, rough = _weather(nb, pos, c, rough, scale, 0.8)
    h = nb.mad(mid, 0.4, nb.mul(grain, 0.18))
    h = nb.sub(h, nb.mad(pore, 0.3, nb.mad(craz, 0.25, nb.mul(sut, 0.9))))
    if moss_grad is not None:
        # hand: dense on the forearm (low in the object's bbox), sparse on the fingers (high)
        tc = nb.n("ShaderNodeTexCoord")
        gz = nb.vsep(tc.outputs["Generated"])[2]
        ssock = nb.lin(gz, moss_grad[2], moss_grad[3], moss_grad[0], moss_grad[1])
        c, rough, h, _ = _apply_moss(nb, c, rough, h, pos, moss, -0.45, 0.35, stain, hamp=1.6, open_w=0.75,
                                     strength_sock=ssock)
    else:
        c, rough, h, _ = _apply_moss(nb, c, rough, h, pos, moss, 0.30, 0.75, stain, hamp=1.6, open_w=0.55)
    nrm = nb.bump(h, 0.5, 0.016 * scale)
    nb.principled(c, rough, nrm, extra={"Specular IOR Level": 0.4})
    return m


def make_hand_stone(moss=0.85, algae=1.0, lichen=0.7, scale=1.0, grad=(0.95, 0.30, 0.42, 0.72),
                    _name="HandStone"):
    """Colossal hand stone: BoneStone recipe, darker (#77756a family) and mossier.  Moss follows a height
    gradient in the object's bounding box (Generated Z): strength grad[0] at/below grad[2] (forearm, ~80-90 %
    coverage incl. vertical sides) -> grad[1] at/above grad[3] (fingers, ~20-30 %).  grad=None -> normal moss."""
    return make_bone_stone(moss=moss, algae=algae, lichen=lichen, value=0.78, scale=scale, moss_grad=grad,
                           _name=_name)


def make_moss(dry=False, scale=1.0, _name=None):
    """Velvet moss: desaturated olive, clumped domes (lit tips / dark gaps), soft sheen, fine bump.
    dry=True -> ochre-olive MossDry."""
    m = _new(_name or ("MossDry" if dry else "Moss"))
    nb = NB(m)
    pos = nb.pos(scale)
    col, h, tips = _moss_color(nb, pos, dry, scale)
    if not dry:
        # sparse dry/ochre patches inside green moss
        dcol, _, _ = _moss_color(nb, pos, True, scale)
        col = nb.cmix(nb.mul(nb.ss(nb.tn(pos, 1.3, 3.0).outputs["Fac"], 0.60, 0.70), 0.7), col, dcol)
    shade = nb.cavity(0.06)
    col = nb.cmix(nb.mul(shade, 0.55), col, (0.012, 0.015, 0.008))
    # dress() moss shells write cf_edge (1 at the patch boundary): thin, darker, browner moss toward the edge
    edge = nb.attr("cf_edge")
    col = nb.cmix(nb.mul(edge, 0.75), col, (0.036, 0.038, 0.024))
    fine = nb.tn(pos, 160.0 / scale, 3.0, 0.6).outputs["Fac"]
    hh = nb.mad(h, 1.0, nb.mul(fine, 0.5))
    nrm = nb.bump(hh, 0.75, 0.006 * scale)
    sheen_tint = (0.85, 0.90, 0.70) if not dry else (0.92, 0.85, 0.65)
    nb.principled(col, nb.lin(tips, 0.0, 1.0, 0.95, 0.85), nrm,
                  extra={"Sheen Weight": 0.25, "Sheen Roughness": 0.4, "Sheen Tint": (*sheen_tint, 1.0),
                         "Specular IOR Level": 0.25})
    return m


def make_moss_dry(scale=1.0, _name="MossDry"):
    return make_moss(dry=True, scale=scale, _name=_name)


def _flow_pos(nb, pos, stretch, angle):
    """Rotate world XY by -angle (deg) and stretch plates `stretch`x along the flow (local X)."""
    p = pos
    if angle:
        nd = nb.n("ShaderNodeVectorRotate", rotation_type="Z_AXIS", invert=True)
        nb.link(pos, nd.inputs["Vector"])
        nd.inputs["Angle"].default_value = math.radians(angle)
        p = nd.outputs["Vector"]
    if stretch != 1.0:
        p = nb.vop("MULTIPLY", p, (1.0 / stretch, 1.0, 1.0))
    return p


def make_lava(glow=1.0, core=4.0, scale=1.0, heat=1.0, stretch=1.8, flow_angle=0.0, _name="Lava"):
    """Lava (research 4g/7): 60-70% dark crust (#1a1512), emission ONLY in cracks between plates and
    on thin hot crust.  Only ~1/3 of the crack network glows (noise gate); hot regions vary at ~10 m.
    Strengths under AgX: thin-crust glow ~0.25, halo ~0.5, cracks ~1.4, rare thin cores ~`core`
    (<=0.5% area, max ~#ffa060).  Plates ~0.8 m (scale mult.) stretched `stretch`x along flow
    (local X rotated by flow_angle deg).  glow scales all emission; heat scales the hot fraction."""
    m = _new(_name)
    nb = NB(m)
    pos = nb.pos(scale)
    fpos = _flow_pos(nb, pos, stretch, flow_angle)
    wpos = _warp(nb, _warp(nb, fpos, 0.6, 0.55, 3.0), 2.2, 0.12, 2.0)
    d0 = nb.tv(wpos, 0.95, "DISTANCE_TO_EDGE").outputs["Distance"]
    wvar = nb.lin(nb.tn(pos, 0.6, 2.0).outputs["Fac"], 0.3, 0.7, 0.55, 1.6)        # seam width variation
    d = nb.m("DIVIDE", d0, wvar)
    d2 = nb.tv(_warp(nb, wpos, 3.0, 0.08), 6.5, "DISTANCE_TO_EDGE").outputs["Distance"]
    flow = nb.vop("MULTIPLY", fpos, (0.25, 1.0, 1.0))                                 # bands along the flow
    Hf = nb.ss(nb.tn(flow, 0.22, 2.0, 0.5, 0.4).outputs["Fac"], 0.42, 0.62)
    H = nb.mul(nb.mul(Hf, nb.ss(nb.tn(pos, 0.07, 2.0).outputs["Fac"], 0.30, 0.55)), heat)  # hot regions
    gate = nb.ss(nb.tn(pos, 0.9, 3.0).outputs["Fac"], 0.50, 0.62)                   # which cracks glow
    Hs = nb.mul(H, gate)
    hot = nb.ss(nb.tn(pos, 0.45, 2.0).outputs["Fac"], 0.58, 0.70)                   # rare hot spots -> cores
    bank = nb.sub(1.0, nb.mul(nb.cavity(0.8), 0.8))                                  # darker crust at banks
    crack = nb.mul(nb.ss(d, 0.0, 0.035, 1.0, 0.0), nb.mul(Hs, bank))
    corem = nb.mul(nb.mul(nb.ss(d, 0.0, 0.009, 1.0, 0.0), nb.mul(Hs, hot)), bank)
    halo = nb.mul(nb.powv(nb.ss(d, 0.0, 0.11, 1.0, 0.0), 2.0), nb.mul(nb.mad(gate, 0.7, 0.3), nb.mul(H, bank)))
    thin = nb.mul(nb.mul(nb.ss(nb.tn(pos, 2.4, 4.0).outputs["Fac"], 0.55, 0.78), H), bank)   # thin hot crust
    micro = nb.mul(nb.mul(nb.ss(d2, 0.0, 0.03, 1.0, 0.0), Hs), nb.mul(nb.ss(d, 0.02, 0.2, 0.6, 0.1), bank))
    g = float(glow)
    e = nb.vop("SCALE", (1.0, 0.06, 0.018), s=nb.mul(thin, 0.25 * g))
    e = nb.vop("ADD", e, nb.vop("SCALE", (1.0, 0.075, 0.022), s=nb.mul(halo, 0.5 * g)))
    e = nb.vop("ADD", e, nb.vop("SCALE", (1.0, 0.115, 0.035), s=nb.mul(crack, 1.4 * g)))
    e = nb.vop("ADD", e, nb.vop("SCALE", (1.0, 0.30, 0.09), s=nb.mul(corem, float(core) * g)))
    e = nb.vop("ADD", e, nb.vop("SCALE", (1.0, 0.10, 0.03), s=nb.mul(micro, 0.6 * g)))
    cn = nb.tn(pos, 5.0, 6.0, 0.6).outputs["Fac"]
    crust = nb.rampc(cn, [(0.3, (0.007, 0.0055, 0.0045)), (0.8, (0.020, 0.015, 0.012))])
    crust = nb.cmix(nb.mul(nb.mx(halo, thin), 0.6), crust, (0.028, 0.008, 0.005))
    fx = nb.vsep(fpos)[0]
    ropew = nb.tn(pos, 1.2, 2.0).outputs["Fac"]
    rope = nb.m("PINGPONG", nb.mad(ropew, 1.6, nb.mul(fx, 9.0 * stretch)), 0.5)          # ropes across the flow
    bankm = nb.ss(nb.cavity(0.8), 0.15, 0.55)
    ropy = nb.mul(nb.ss(rope, 0.1, 0.45), bankm)
    crust = nb.cmix(nb.mul(ropy, 0.35), crust, (0.024, 0.019, 0.015))
    rough = nb.lin(nb.tn(pos, 1.8, 3.0).outputs["Fac"], 0.3, 0.7, 0.70, 0.92)
    h = nb.mad(nb.ss(d, 0.0, 0.10), 1.0, nb.mad(cn, 0.3, nb.mul(nb.ss(d2, 0.0, 0.03, 1.0, 0.0), -0.12)))
    h = nb.mad(ropy, 0.6, h)
    nrm = nb.bump(h, 0.7, 0.05 * scale)
    nb.principled(crust, rough, nrm, extra={"Emission Color": e, "Emission Strength": 1.0,
                                             "Specular IOR Level": 0.45})
    return m


def make_lava_crust(embers=1.0, scale=1.0, _name="LavaCrust"):
    """Cooled lava rock: near-black plates, rust oxidation, very dim red deep cracks, rare ember speckles."""
    m = _new(_name)
    nb = NB(m)
    pos = nb.pos(scale)
    wpos = _warp(nb, pos, 0.4, 0.8, 3.0)
    d = nb.tv(wpos, 0.9, "DISTANCE_TO_EDGE").outputs["Distance"]
    big = nb.tn(pos, 0.6, 3.0).outputs["Fac"]
    fine = nb.tn(pos, 22.0, 6.0, 0.62).outputs["Fac"]
    tone = nb.rampc(big, [(0.3, (0.010, 0.0085, 0.0075)), (0.6, (0.022, 0.018, 0.015)),
                          (0.8, (0.040, 0.022, 0.014))])
    c = nb.hsv(tone, v=nb.lin(fine, 0.3, 0.7, 0.8, 1.2))
    crack = nb.ss(d, 0.0, 0.02, 1.0, 0.0)
    c = nb.cmix(nb.mul(crack, 0.8), c, (0.005, 0.0045, 0.004))
    hot = nb.mul(nb.ss(d, 0.0, 0.008, 1.0, 0.0), nb.ss(nb.tn(pos, 0.25, 2.0).outputs["Fac"], 0.5, 0.65))
    sp = nb.tv(pos, 18.0, "F1").outputs["Distance"]
    emb = nb.mul(nb.mul(nb.ss(sp, 0.0, 0.07, 1.0, 0.0), nb.ss(nb.tn(pos, 1.5, 2.0).outputs["Fac"], 0.56, 0.66)),
                 embers)
    e = nb.vop("SCALE", (0.5, 0.05, 0.02), s=hot)
    e = nb.vop("ADD", e, nb.vop("SCALE", (2.5, 0.6, 0.15), s=emb))
    h = nb.mad(nb.ss(d, 0.0, 0.08), 1.0, nb.mul(fine, 0.3))
    nrm = nb.bump(h, 0.6, 0.03 * scale)
    nb.principled(c, nb.lin(fine, 0.3, 0.7, 0.80, 0.95), nrm,
                  extra={"Emission Color": e, "Emission Strength": 1.0, "Specular IOR Level": 0.4})
    return m


def make_bronze(verdigris=1.0, scale=1.0, _name="Bronze"):
    """Aged bronze: dark brown oxide patina, polished metal on arrises (cf_convex), verdigris crust in recesses."""
    m = _new(_name)
    nb = NB(m)
    pos = nb.pos(scale)
    n1 = nb.tn(pos, 6.0, 6.0, 0.6, 0.3).outputs["Fac"]
    n2 = nb.tn(pos, 1.5, 3.0).outputs["Fac"]
    cvx = nb.attr("cf_convex")
    ccv = nb.attr("cf_concave")
    cav = nb.c01(nb.mad(nb.cavity(0.15), 1.2, ccv))
    pat = nb.c01(nb.mad(nb.ss(n1, 0.30, 0.55), 0.6, 0.45))
    pol = nb.c01(nb.mad(cvx, 1.3, nb.mul(nb.ss(n1, 0.25, 0.15), 0.4)))
    pat = nb.mul(pat, nb.sub(1.0, pol))
    verd = nb.c01(nb.mul(nb.add(nb.mul(cav, nb.ss(n2, 0.45, 0.7)), nb.mul(nb.ss(n1, 0.72, 0.8), 0.3)), verdigris * 0.6))
    vcol = nb.rampc(nb.tn(pos, 20.0, 4.0).outputs["Fac"], [(0.35, (0.060, 0.150, 0.110)), (0.7, (0.120, 0.240, 0.175))])
    c = nb.cmix(pat, (0.112, 0.075, 0.034), (0.040, 0.028, 0.017))   # base #5e4d34 -> dark oxide
    c = nb.cmix(nb.mul(cav, 0.8), c, (0.022, 0.017, 0.012))            # darker oxide in link interiors / recesses
    c = nb.cmix(verd, c, vcol)
    metal = nb.mul(nb.sub(1.0, verd), nb.sub(0.9, nb.mul(pat, 0.45)))
    rough = nb.mad(pat, 0.10, 0.55)
    rough = nb.mad(nb.sub(0.85, rough), verd, rough)
    h = nb.mad(verd, 0.6, nb.mul(n1, 0.2))
    nrm = nb.bump(h, 0.4, 0.004 * scale)
    nb.principled(c, rough, nrm, metallic=metal)
    return m


def make_bark(moss=0.15, lichen=0.25, scale=1.0, _name="Bark"):
    """Bark / exposed root: dark grey-brown with fibrous furrows along the UV length (tubes from
    cf_vegetation: UV y = metres along), light moss on top, pale lichen."""
    m = _new(_name)
    nb = NB(m)
    pos = nb.pos(scale)
    uv = nb.attr("UVMap", "Vector")
    ux, uy, _ = nb.vsep(uv)
    fvec = nb.vcomb(nb.mul(ux, 7.0), nb.mul(uy, 0.9), 0.0)
    fib = nb.tn(fvec, 1.0, 5.0, 0.6, 0.4).outputs["Fac"]
    furrow = nb.ss(fib, 0.38, 0.62)
    wn = nb.tn(pos, 5.0, 4.0, 0.55).outputs["Fac"]
    fine = nb.tn(pos, 45.0, 4.0, 0.6).outputs["Fac"]
    tone = nb.rampc(wn, [(0.3, (0.024, 0.019, 0.014)), (0.55, (0.046, 0.037, 0.028)), (0.8, (0.072, 0.061, 0.048))])
    c = nb.hsv(tone, v=nb.mad(furrow, 0.75, 0.55))
    lich, lr, lg = _lichen(nb, pos, lichen, scale, 0.6, 0.55, 0.65)
    c = nb.cmix(lich, c, (0.15, 0.155, 0.125))
    rough = nb.lin(fine, 0.3, 0.7, 0.78, 0.92)
    h = nb.mad(furrow, 1.0, nb.mul(fine, 0.3))
    c, rough, h, _ = _apply_moss(nb, c, rough, h, pos, moss, 0.55, 0.9, open_w=0.5)
    nrm = nb.bump(h, 0.7, 0.006 * scale)
    nb.principled(c, rough, nrm, extra={"Specular IOR Level": 0.35})
    return m


def make_root(moss=0.3, lichen=0.35, scale=1.0, _name="Root"):
    return make_bark(moss=moss, lichen=lichen, scale=scale, _name=_name)


# ---------------------------------------------------------------- foliage
def _foliage(_name, pal, vein_col, stem_col, flower_col, dead_col, dead_frac=0.06, transl=0.3, rough=0.5,
             vein_amt=0.7, tip_col=None, tip_amt=0.0, edge_col=None, spec=0.4, transl_boost=1.8):
    m = _new(_name)
    nb = NB(m)
    uv = nb.attr("UVMap", "Vector")
    u, v, _ = nb.vsep(uv)
    part = nb.attr("cf_part")
    rnd = nb.attr("cf_rand")
    orr = nb.objrand()
    au = nb.absv(u)
    pick = nb.m("FRACT", nb.mad(orr, 0.37, rnd))
    base = nb.rampc(pick, pal)
    c = nb.hsv(base, v=nb.lin(v, 0.0, 1.0, 0.80, 1.08))
    # veins: midrib + oblique secondary veins
    midr = nb.ss(au, 0.0, 0.10, 1.0, 0.0)
    tri = nb.m("PINGPONG", nb.mul(nb.sub(v, nb.mul(au, 0.55)), 7.0), 0.5)
    sidev = nb.mul(nb.ss(tri, 0.0, 0.07, 1.0, 0.0), nb.mul(nb.ss(au, 0.10, 0.22), nb.ss(au, 0.92, 0.75)))
    veins = nb.mx(midr, nb.mul(sidev, 0.6))
    c = nb.cmix(nb.mul(veins, vein_amt), c, vein_col)
    if edge_col is not None:
        c = nb.cmix(nb.mul(nb.ss(au, 0.78, 1.0), 0.6), c, edge_col)
    if tip_col is not None and tip_amt > 0:
        tsel = nb.mul(nb.ss(v, 0.62, 0.95), nb.lin(nb.m("FRACT", nb.mul(rnd, 5.31)), 0.0, 1.0, 0.3, 1.0))
        c = nb.cmix(nb.mul(tsel, tip_amt), c, tip_col)
    dead = nb.ss(nb.m("FRACT", nb.mul(rnd, 7.13)), 1.0 - dead_frac, 1.0 - dead_frac + 0.01)
    c = nb.cmix(dead, c, dead_col)
    stem = nb.mul(nb.ss(part, 0.3, 0.42), nb.ss(part, 0.85, 0.72))
    flw = nb.ss(part, 0.8, 0.92)
    c = nb.cmix(stem, c, stem_col)
    c = nb.cmix(flw, c, flower_col)
    nrm = nb.bump(nb.mul(veins, -1.0), 0.25, 0.002)
    b, out = nb.principled(c, rough, nrm, extra={"Specular IOR Level": spec})
    tr = nb.n("ShaderNodeBsdfTranslucent")
    nb.link(nb.hsv(c, s=1.1, v=transl_boost), tr.inputs["Color"])
    nb.link(nrm, tr.inputs["Normal"])
    ms = nb.n("ShaderNodeMixShader")
    nb.link(nb.mul(nb.sub(1.0, stem), transl), ms.inputs[0])
    nb.nt.links.new(b.outputs["BSDF"], ms.inputs[1])
    nb.nt.links.new(tr.outputs["BSDF"], ms.inputs[2])
    nb.nt.links.new(ms.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = False
    for attr, val in (("thickness_mode", "SLAB"),):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    return m


def make_fern(_name="Fern"):
    """Fern fronds: yellowish olive (#4d5836), lighter rachis/midrib, a few brown dead fronds."""
    return _foliage(_name,
                    [(0.0, (0.040, 0.055, 0.020)), (0.40, (0.058, 0.078, 0.028)), (0.75, (0.074, 0.098, 0.037)),
                     (1.0, (0.094, 0.116, 0.045))],
                    vein_col=(0.100, 0.118, 0.050), stem_col=(0.050, 0.055, 0.026),
                    flower_col=(0.05, 0.04, 0.02), dead_col=(0.080, 0.052, 0.024), dead_frac=0.07,
                    transl=0.3, rough=0.6, vein_amt=0.5, edge_col=(0.035, 0.046, 0.018))


def make_crimson(_name="CrimsonLeaf"):
    """Crimson undergrowth: oxblood leaves (#6e1a1f), darker veins, dark stems (#3b1a14), scarlet-crimson
    flower spikes, translucency (backlit to ~#8f3a35)."""
    return _foliage(_name,
                    [(0.0, (0.066, 0.013, 0.014)), (0.40, (0.095, 0.018, 0.019)), (0.75, (0.125, 0.023, 0.023)),
                     (1.0, (0.155, 0.030, 0.027))],
                    vein_col=(0.045, 0.008, 0.009), stem_col=(0.044, 0.0103, 0.007),
                    flower_col=(0.200, 0.024, 0.030), dead_col=(0.075, 0.032, 0.018), dead_frac=0.04,
                    transl=0.28, rough=0.5, vein_amt=0.6, edge_col=(0.055, 0.009, 0.010), transl_boost=1.3)


def make_vine(_name="Vine"):
    return _foliage(_name,
                    [(0.0, (0.040, 0.054, 0.022)), (0.5, (0.060, 0.080, 0.032)), (1.0, (0.085, 0.104, 0.042))],
                    vein_col=(0.080, 0.095, 0.040), stem_col=(0.042, 0.036, 0.022),
                    flower_col=(0.06, 0.05, 0.02), dead_col=(0.085, 0.060, 0.026), dead_frac=0.07,
                    transl=0.28, rough=0.55, vein_amt=0.4, edge_col=(0.03, 0.04, 0.016))


def make_sedge(_name="Sedge"):
    """Dark olive sedge/grass blades with straw-dry tips."""
    return _foliage(_name,
                    [(0.0, (0.044, 0.050, 0.022)), (0.5, (0.060, 0.066, 0.030)), (1.0, (0.084, 0.088, 0.040))],
                    vein_col=(0.07, 0.08, 0.035), stem_col=(0.065, 0.058, 0.032),
                    flower_col=(0.060, 0.046, 0.028), dead_col=(0.115, 0.098, 0.055), dead_frac=0.10,
                    transl=0.25, rough=0.6, vein_amt=0.2, tip_col=(0.125, 0.106, 0.058), tip_amt=0.8)


def make_fungus(scale=1.0, _name="Fungus"):
    """Shelf / bracket fungi: concentric ochre-brown growth zones on the cap (UV x = radial 0..1),
    pale cream rim, pale pored underside (cf_part 0.5)."""
    m = _new(_name)
    nb = NB(m)
    uv = nb.attr("UVMap", "Vector")
    r, a, _ = nb.vsep(uv)
    part = nb.attr("cf_part")
    pos = nb.pos(scale)
    wob = nb.tn(pos, 12.0, 3.0).outputs["Fac"]
    zones = nb.m("PINGPONG", nb.mul(nb.mad(wob, 0.25, r), 6.0), 0.5)
    top = nb.rampc(zones, [(0.0, (0.050, 0.032, 0.018)), (0.25, (0.095, 0.062, 0.032)), (0.5, (0.150, 0.110, 0.060))])
    top = nb.hsv(top, v=nb.lin(nb.objrand(), 0.0, 1.0, 0.8, 1.15))
    top = nb.cmix(nb.ss(r, 0.86, 0.98), top, (0.235, 0.205, 0.150))
    under = (0.210, 0.185, 0.135)
    under_m = nb.ss(part, 0.3, 0.45)
    c = nb.cmix(under_m, top, under)
    fine = nb.tn(pos, 80.0, 3.0).outputs["Fac"]
    nrm = nb.bump(nb.mad(zones, 0.6, nb.mul(fine, 0.3)), 0.3, 0.002 * scale)
    nb.principled(c, nb.lin(under_m, 0.0, 1.0, 0.62, 0.85), nrm, extra={"Specular IOR Level": 0.35,
                                                                       "Subsurface Weight": 0.08})
    m.use_backface_culling = False
    return m


def make_ember(strength=6.0, _name="Ember"):
    """Tiny emissive sparks (use on small particles); per-object random brightness."""
    m = _new(_name)
    nb = NB(m)
    br = nb.lin(nb.objrand(), 0.0, 1.0, 0.35, 1.4)
    col = nb.cmix(nb.objrand(), (1.0, 0.22, 0.06), (1.0, 0.42, 0.13))
    nb.principled((0.02, 0.01, 0.005), 0.6, extra={"Emission Color": col,
                                                    "Emission Strength": nb.mul(br, float(strength))})
    return m


RECIPES = {
    "Basalt": make_basalt,
    "AncientStone": make_ancient_stone,
    "BoneStone": make_bone_stone,
    "HandStone": make_hand_stone,
    "Moss": make_moss,
    "MossDry": make_moss_dry,
    "Lava": make_lava,
    "LavaCrust": make_lava_crust,
    "Bronze": make_bronze,
    "Fern": make_fern,
    "CrimsonLeaf": make_crimson,
    "Bark": make_bark,
    "Root": make_root,
    "Vine": make_vine,
    "Sedge": make_sedge,
    "Fungus": make_fungus,
    "Ember": make_ember,
}


def _variant_name(name, kw):
    if not kw:
        return name
    parts = []
    for k in sorted(kw):
        v = kw[k]
        s = ("%g" % v) if isinstance(v, (int, float)) else str(v)
        parts.append((k + s).replace(".", "p").replace("-", "m"))
    return name + "__" + "_".join(parts)


def get(name, rebuild=False, **kw):
    """Return material CFCL_<name> (or CFCL_<name>__<kwargs> variant), building it on first use."""
    if name not in RECIPES:
        raise KeyError("cf_materials: unknown material %r (have %s)" % (name, sorted(RECIPES)))
    vname = _variant_name(name, kw)
    m = bpy.data.materials.get(PREFIX + vname)
    if m is not None and not rebuild:
        return m
    return RECIPES[name](_name=vname, **kw)


def assign(obj, name, curvature=False, slot=None, **kw):
    """Assign CFCL_<name> to obj (replaces all slots unless slot index given).
    curvature=True also bakes cf_convex/cf_concave attributes for edge wear / cavity grime."""
    mat = get(name, **kw)
    if curvature:
        try:
            bake_curvature(obj)
        except Exception as e:  # pragma: no cover
            print("[cf_materials] curvature bake failed", obj.name, e)
    if slot is None:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    else:
        while len(obj.data.materials) <= slot:
            obj.data.materials.append(None)
        obj.data.materials[slot] = mat
    return mat


# ---------------------------------------------------------------- curvature bake
def curvature_arrays(co, nor, edges, smooth_iters=2):
    """Per-vertex mean-curvature estimate kappa (1/m in the units of `co`; + convex, - concave).
    kappa ~ 1/R for a sphere of radius R.  co/nor (n,3), edges (m,2) int."""
    n = len(co)
    e0, e1 = edges[:, 0], edges[:, 1]
    cnt = np.bincount(e0, minlength=n) + np.bincount(e1, minlength=n)
    cnt = np.maximum(cnt, 1).astype(np.float64)
    acc = np.zeros((n, 3))
    for i in range(3):
        acc[:, i] = np.bincount(e0, weights=co[e1, i], minlength=n) + np.bincount(e1, weights=co[e0, i], minlength=n)
    lap = acc / cnt[:, None] - co
    el = np.linalg.norm(co[e0] - co[e1], axis=1)
    ml = (np.bincount(e0, weights=el, minlength=n) + np.bincount(e1, weights=el, minlength=n)) / cnt + 1e-9
    k = -2.0 * (lap * nor).sum(1) / (ml * ml)
    for _ in range(smooth_iters):
        s = np.bincount(e0, weights=k[e1], minlength=n) + np.bincount(e1, weights=k[e0], minlength=n)
        k = 0.5 * k + 0.5 * s / cnt
    return k


def bake_curvature(obj, k_lo=2.5, k_hi=20.0, smooth_iters=2):
    """Write POINT float attributes cf_convex / cf_concave (0..1) on obj's mesh.
    Uses absolute world-space curvature: 0 below k_lo (1/m, i.e. radius > 1/k_lo m), 1 above k_hi
    (radius < 1/k_hi m).  Defaults: arrises/chips with R < 5 cm -> 1, broad forms R > 40 cm -> 0.
    Returns kappa array (1/m)."""
    if np is None:
        return None
    me = obj.data
    n = len(me.vertices)
    if n < 4 or len(me.edges) < 3:
        return None
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    nor = np.empty(n * 3, np.float32)
    try:
        me.vertex_normals.foreach_get("vector", nor)
    except Exception:
        me.vertices.foreach_get("normal", nor)
    nor = nor.reshape(-1, 3).astype(np.float64)
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    k = curvature_arrays(co, nor, e, smooth_iters)
    try:
        s = sum(abs(x) for x in obj.matrix_world.to_scale()) / 3.0
        k = k / max(s, 1e-6)
    except Exception:
        pass
    den = max(k_hi - k_lo, 1e-6)
    for nm, arr in (("cf_convex", np.clip((k - k_lo) / den, 0, 1)), ("cf_concave", np.clip((-k - k_lo) / den, 0, 1))):
        a = me.attributes.get(nm)
        if a is None:
            a = me.attributes.new(nm, "FLOAT", "POINT")
        a.data.foreach_set("value", arr.astype(np.float32))
    return k
