"""CFCL_Sky_Shatter - "the sky is falling apart" (E33_07 / E33_12 direction).  WORLD METRES, appended unscaled.

Builds (layout from scripts/sky_shatter_layout.py, pure numpy):
  CFCL_SkyShatter_Dome          fractured sky shell (R 520 m) radiating from the eclipse direction, plates hinged /
                                detached / peeled near the eclipse, shard field, emissive ember-gold BEYOND shell (R 615)
  CFCL_SkyShatter_Landmasses    4 torn-loose inverted cliff masses with ruins + hanging roots
  CFCL_SkyShatter_DebrisStreams 3 rising debris streams + 4 landmass trails (Geometry-Nodes instances of 10 chip protos)
  CFCL_SkyShatter_Clouds_Volume cinematic: 5 bounded Principled-Volume banks (mesh boxes; never a world volume)
  CFCL_SkyShatter_Clouds_Cards  runtime: the same banks as alpha cards with baked PNG textures (three.js/GLB)
then saves assets/CFCL_Sky_Shatter/CFCL_Sky_Shatter_v###.blend (asset only) + meta/arrangements, and renders a
minimal test scene (board slab, skull/hand stand-ins, cf_atmos world + fog + light rig + eclipse) from hero/worm/wide.

python lib/run_blender.py scripts/sky_shatter.py --timeout 3000 -- --ver 1 --iter 1 [--cams hero,worm,wide]
       [--res 960x540] [--samples 32] [--norender]
"""
import json
import math
import os
import sys
import time

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
for _p in (os.path.join(CL, "lib"), os.path.join(CL, "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import numpy as np  # noqa: E402
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import cf_render as R  # noqa: E402
import cf_atmos as A  # noqa: E402
import cf_sdf as S  # noqa: E402
import terrain_common as T  # noqa: E402
import sky_shatter_layout as L  # noqa: E402
import sky_shatter_megastructure as MS  # noqa: E402

F32 = np.float32
ASSET = "CFCL_Sky_Shatter"
args = T.get_args()
VER = int(args.get("ver", 1))
ITER = int(args.get("iter", VER))
CAMS = str(args.get("cams", "hero,worm,wide")).split(",")
RES = tuple(int(v) for v in str(args.get("res", "960x540")).split("x"))
SAMPLES = int(args.get("samples", 32))
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "sky_shatter")
TEXDIR = os.path.join(ADIR, "textures")
for d in (ADIR, RDIR, TEXDIR):
    os.makedirs(d, exist_ok=True)
t_start = time.time()
LOG = {"version": VER, "iter": ITER, "warnings": []}


def log(*a):
    print("[sky_shatter]", *a, flush=True)


# =============================================================== helpers
def new_col(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def mesh_from(name, V, faces, col, mat_idx=None, mats=(), smooth=True, sharp=None):
    V = np.ascontiguousarray(np.asarray(V, F32))
    me = bpy.data.meshes.new(name + "_Mesh")
    if isinstance(faces, np.ndarray):
        flat = faces.astype(np.int32).ravel()
        sizes = np.full(len(faces), faces.shape[1], np.int32)
    else:
        sizes = np.array([len(f) for f in faces], np.int32)
        flat = np.concatenate([np.asarray(f, np.int32) for f in faces]) if len(faces) else np.zeros(0, np.int32)
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", V.ravel())
    if len(sizes):
        me.loops.add(len(flat))
        me.loops.foreach_set("vertex_index", flat)
        me.polygons.add(len(sizes))
        me.polygons.foreach_set("loop_start", np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    for m in mats:
        me.materials.append(m)
    if mat_idx is not None and len(sizes):
        me.polygons.foreach_set("material_index", np.asarray(mat_idx, np.int32))
    if len(sizes):
        if smooth:
            me.shade_smooth()
            if sharp is not None:
                try:
                    me.set_sharp_from_angle(angle=math.radians(sharp))
                except Exception:
                    pass
        else:
            me.shade_flat()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.visible_shadow = False
    return ob


def set_attr(me, name, kind, values, domain="POINT"):
    a = me.attributes.get(name) or me.attributes.new(name, kind, domain)
    v = np.ascontiguousarray(np.asarray(values, F32 if kind != "INT" else np.int32)).ravel()
    key = {"FLOAT": "value", "INT": "value", "FLOAT_VECTOR": "vector", "FLOAT_COLOR": "color", "FLOAT2": "vector"}[kind]
    a.data.foreach_set(key, v)
    return a


def set_color(me, rgb, name="Col"):
    rgba = np.concatenate([np.asarray(rgb, F32), np.ones((len(rgb), 1), F32)], 1)
    set_attr(me, name, "FLOAT_COLOR", rgba)
    try:
        me.color_attributes.active_color_name = name
        me.color_attributes.render_color_index = me.color_attributes.find(name)
    except Exception:
        pass


def recenter(ob):
    """origin -> bbox centre (keeps world geometry)."""
    me = ob.data
    n = len(me.vertices)
    co = np.zeros(n * 3, F32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    c = (co.min(0) + co.max(0)) * 0.5
    me.vertices.foreach_set("co", (co - c).ravel())
    me.update()
    ob.location = ob.matrix_world @ Vector(c.tolist())


# =============================================================== materials
def _mat(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m


class NB:
    def __init__(self, m):
        self.m, self.nt = m, m.node_tree
        self.N, self.Lk = self.nt.nodes, self.nt.links

    def n(self, t, **kw):
        nd = self.N.new(t)
        for k, v in kw.items():
            setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.Lk.new(a, b)

    def attr(self, name, kind="GEOMETRY"):
        a = self.n("ShaderNodeAttribute")
        a.attribute_name = name
        a.attribute_type = kind
        return a

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs[0]

    def vmath(self, op, a, b=None):
        m = self.n("ShaderNodeVectorMath", operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (tuple, list)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs["Vector"] if op not in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else m.outputs["Value"]

    def mix(self, fac, a, b, blend="MIX"):
        m = self.n("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_factor=True)
        for sock, v in ((m.inputs[0], fac), (m.inputs[6], a), (m.inputs[7], b)):
            if isinstance(v, (int, float)):
                sock.default_value = v
            elif isinstance(v, (tuple, list)):
                sock.default_value = (*v[:3], 1.0) if len(v) == 3 else v
            else:
                self.link(v, sock)
        return m.outputs[2]

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0):
        t = self.n("ShaderNodeTexNoise")
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        t.inputs["Distortion"].default_value = dist
        if vec is not None:
            self.link(vec, t.inputs["Vector"])
        return t

    def maprange(self, v, a, b, c=0.0, d=1.0, smooth=False):
        m = self.n("ShaderNodeMapRange", clamp=True)
        if smooth:
            m.interpolation_type = "SMOOTHSTEP"
        self.link(v, m.inputs["Value"])
        m.inputs["From Min"].default_value, m.inputs["From Max"].default_value = a, b
        m.inputs["To Min"].default_value, m.inputs["To Max"].default_value = c, d
        return m.outputs["Result"]

    def out(self, shader, volume=None):
        o = self.n("ShaderNodeOutputMaterial")
        if shader is not None:
            self.link(shader, o.inputs["Surface"])
        if volume is not None:
            self.link(volume, o.inputs["Volume"])
        return o


HAZE_CAM = (0.0, -22.0, 6.0)


def add_aerial(m, near=140.0, far=620.0, amount=0.78):
    """controlled atmospheric perspective for sky-borne solids (they sit above the main fog box, z>112 m): mix the
    surface toward a self-lit haze whose colour warms toward the tear.  far = lighter + lower contrast."""
    b = NB(m)
    out = [n for n in b.N if n.type == "OUTPUT_MATERIAL"][0]
    src = out.inputs["Surface"].links[0].from_socket
    geo = b.n("ShaderNodeNewGeometry")
    dist = b.vmath("DISTANCE", geo.outputs["Position"], HAZE_CAM)
    fac = b.math("MULTIPLY", b.math("POWER", b.maprange(dist, near, far, 0.0, 1.0), 0.85), amount)
    vdir = b.vmath("NORMALIZE", b.vmath("SUBTRACT", geo.outputs["Position"], HAZE_CAM))
    toward = b.math("POWER", b.math("MAXIMUM", b.vmath("DOT_PRODUCT", vdir, tuple(float(v) for v in L.EPI)), 0.0), 8.0)
    sv = b.n("ShaderNodeSeparateXYZ")
    b.link(vdir, sv.inputs[0])
    hi = b.maprange(b.math("ARCSINE", sv.outputs["Z"]), math.radians(4), math.radians(30), 0.0, 1.0, smooth=True)
    col = b.mix(toward, b.mix(hi, (0.165, 0.152, 0.14), (0.055, 0.062, 0.075)), (0.26, 0.19, 0.13))
    em = b.n("ShaderNodeEmission")
    b.link(col, em.inputs["Color"])
    mx = b.n("ShaderNodeMixShader")
    b.link(fac, mx.inputs[0])
    b.link(src, mx.inputs[1])
    b.link(em.outputs[0], mx.inputs[2])
    b.link(mx.outputs[0], out.inputs["Surface"])
    return m


def mat_sky_face():
    """inner face of the sky plates: self-lit storm-sky painting (vertex colour, baked to the plate so it moves with
    it) + fine cloud detail + crisp ember line along the cracks + faint diffuse response."""
    m = _mat("CFCL_SkyShatter_SkyFace")
    b = NB(m)
    col = b.attr("Col").outputs["Color"]
    dirv = b.attr("cf_dir").outputs["Vector"]
    edge = b.attr("cf_edge").outputs["Fac"]
    heat = b.attr("cf_heat").outputs["Fac"]
    # billows: h(q) = cauliflower height from smooth-F1 voronoi at 2 scales on the plate's ORIGINAL sky direction
    # (so the texture travels with the plate); lighting = slope of h toward the tear -> lit edges / cool shadow
    epi = tuple(float(v) for v in L.EPI)
    dd = b.vmath("DOT_PRODUCT", dirv, epi)
    sc_ = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(dirv, sc_.inputs[0])
    b.link(dd, sc_.inputs["Scale"])
    sub_ = b.n("ShaderNodeVectorMath", operation="SUBTRACT")
    sub_.inputs[0].default_value = epi
    b.link(sc_.outputs["Vector"], sub_.inputs[1])
    tng = b.vmath("NORMALIZE", sub_.outputs["Vector"])          # tangent pointing toward the tear
    warpn = b.noise(dirv, 9.0, 3.0, 0.55, 0.0)
    wsub = b.vmath("SUBTRACT", warpn.outputs["Color"], (0.5, 0.5, 0.5))
    wsc = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(wsub, wsc.inputs[0])
    wsc.inputs["Scale"].default_value = 0.035
    qv = b.vmath("ADD", dirv, wsc.outputs["Vector"])

    def h_at(vec):     # domain-warped fBm billows (cloud masses, not cells)
        nz = b.noise(vec, 8.0, 6.0, 0.6, 0.45)
        return b.maprange(nz.outputs["Fac"], 0.35, 0.75, 0.0, 1.0, smooth=True)

    h0 = h_at(qv)
    osc = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(tng, osc.inputs[0])
    osc.inputs["Scale"].default_value = 0.006
    h1 = h_at(b.vmath("ADD", qv, osc.outputs["Vector"]))
    lit = b.math("ADD", b.math("MULTIPLY", b.math("SUBTRACT", h1, h0), 5.0), 0.5, clamp=True)
    shade = b.math("ADD", b.math("MULTIPLY", lit, 0.75), b.math("ADD", b.math("MULTIPLY", h0, 0.25), 0.42))
    near = b.math("EXPONENT", b.math("MULTIPLY", b.math("SUBTRACT", 1.0, dd), -14.0))   # ~1 at the tear
    mul = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(col, mul.inputs[0])
    b.link(shade, mul.inputs["Scale"])
    bw = b.n("ShaderNodeRGBToBW")
    b.link(col, bw.inputs[0])
    lumf = b.math("MINIMUM", b.math("MAXIMUM", b.math("MULTIPLY", bw.outputs[0], 6.0), 0.08), 1.0)   # dark plates stay dark
    wk = b.math("MULTIPLY", b.math("MULTIPLY", b.math("POWER", lit, 4.0), b.math("ADD", b.math("MULTIPLY", near, 0.35), 0.05)), lumf)
    warm = b.n("ShaderNodeVectorMath", operation="SCALE")
    warm.inputs[0].default_value = (0.95, 0.55, 0.24)
    b.link(wk, warm.inputs["Scale"])
    mulw = b.vmath("ADD", mul.outputs["Vector"], warm.outputs["Vector"])
    crisp = b.math("MULTIPLY", b.math("EXPONENT", b.math("MULTIPLY", edge, -1.0 / 1.1)),
                   b.math("ADD", b.math("MULTIPLY", heat, 2.6), 0.02))
    ember = b.n("ShaderNodeVectorMath", operation="SCALE")
    ember.inputs[0].default_value = (1.0, 0.55, 0.18)
    b.link(crisp, ember.inputs["Scale"])
    tot = b.vmath("ADD", mulw, ember.outputs["Vector"])
    em = b.n("ShaderNodeEmission")
    b.link(tot, em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    df = b.n("ShaderNodeBsdfDiffuse")
    dsc = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(col, dsc.inputs[0])
    dsc.inputs["Scale"].default_value = 0.25
    b.link(dsc.outputs["Vector"], df.inputs["Color"])
    add = b.n("ShaderNodeAddShader")
    b.link(em.outputs[0], add.inputs[0])
    b.link(df.outputs[0], add.inputs[1])
    b.out(add.outputs[0])
    return m


def mat_underside():
    m = _mat("CFCL_SkyShatter_Underside")
    b = NB(m)
    geo = b.n("ShaderNodeNewGeometry")
    nz = b.noise(geo.outputs["Position"], 0.045, 5.0, 0.6, 0.3)
    c = b.mix(nz.outputs["Fac"], (0.016, 0.02, 0.028), (0.05, 0.06, 0.078))
    p = b.n("ShaderNodeBsdfPrincipled")
    b.link(c, p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.85
    bump = b.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.4
    b.link(b.noise(geo.outputs["Position"], 0.25, 4.0).outputs["Fac"], bump.inputs["Height"])
    b.link(bump.outputs["Normal"], p.inputs["Normal"])
    b.out(p.outputs[0])
    return m


def mat_rim():
    """broken edges of the sky plates: obsidian with ember heat (hotter near the eclipse)."""
    m = _mat("CFCL_SkyShatter_Rim")
    b = NB(m)
    heat = b.attr("cf_heat").outputs["Fac"]
    geo = b.n("ShaderNodeNewGeometry")
    nz = b.noise(geo.outputs["Position"], 0.12, 4.0, 0.6, 0.6)
    flick = b.maprange(nz.outputs["Fac"], 0.35, 0.7, 0.35, 1.0)
    p = b.n("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (0.03, 0.028, 0.03, 1)
    p.inputs["Roughness"].default_value = 0.45
    p.inputs["Emission Color"].default_value = (1.0, 0.46, 0.13, 1)
    b.link(b.math("MULTIPLY", b.math("ADD", b.math("MULTIPLY", heat, 6.5), 0.03), flick), p.inputs["Emission Strength"])
    b.out(p.outputs[0])
    return m


def mat_beyond():
    m = _mat("CFCL_SkyShatter_Beyond")
    b = NB(m)
    col = b.attr("Col").outputs["Color"]
    glow = b.attr("cf_glow").outputs["Fac"]
    uv = b.n("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(uv.outputs["UV"], sep.inputs[0])
    th = b.math("MULTIPLY", sep.outputs["X"], 2 * math.pi)
    cs, sn = b.math("COSINE", th), b.math("SINE", th)
    streaks = []
    for (k, kr, sc_) in ((7.0, 2.2, 1.0), (24.0, 0.9, 1.0)):
        cb = b.n("ShaderNodeCombineXYZ")
        b.link(b.math("MULTIPLY", cs, k), cb.inputs["X"])
        b.link(b.math("MULTIPLY", sn, k), cb.inputs["Y"])
        b.link(b.math("MULTIPLY", sep.outputs["Y"], kr * 10), cb.inputs["Z"])
        nz = b.noise(cb.outputs[0], sc_, 4.0, 0.6, 0.3)
        streaks.append(nz.outputs["Fac"])
    f = b.math("MULTIPLY", b.maprange(streaks[0], 0.3, 0.72, 0.55, 1.35), b.maprange(streaks[1], 0.3, 0.72, 0.75, 1.2))
    em = b.n("ShaderNodeEmission")
    b.link(col, em.inputs["Color"])
    b.link(b.math("MULTIPLY", glow, f), em.inputs["Strength"])
    b.out(em.outputs[0])
    return m


def mat_rock():
    m = _mat("CFCL_SkyShatter_Rock")
    b = NB(m)
    col = b.attr("Col").outputs["Color"]
    geo = b.n("ShaderNodeNewGeometry")
    n1 = b.noise(geo.outputs["Position"], 0.06, 5.0, 0.6, 0.4)
    n2 = b.noise(geo.outputs["Position"], 0.6, 3.0, 0.6)
    v = b.math("ADD", b.math("MULTIPLY", n1.outputs["Fac"], 0.7), b.math("MULTIPLY", n2.outputs["Fac"], 0.5))
    ao = b.n("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 6.0
    ao.samples = 8
    cav = b.math("ADD", b.math("MULTIPLY", b.math("POWER", ao.outputs["AO"], 1.6), 0.85), 0.15)
    mul = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(col, mul.inputs[0])
    b.link(b.math("MULTIPLY", b.math("ADD", v, 0.42), cav), mul.inputs["Scale"])
    p = b.n("ShaderNodeBsdfPrincipled")
    b.link(mul.outputs["Vector"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.9
    bump = b.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.55
    b.link(b.noise(geo.outputs["Position"], 0.35, 5.0, 0.62).outputs["Fac"], bump.inputs["Height"])
    b.link(bump.outputs["Normal"], p.inputs["Normal"])
    # bounce fill: the backlit undersides take light from the hazy lit atmosphere below / around them
    sepn = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Normal"], sepn.inputs[0])
    down = b.math("MAXIMUM", b.math("MULTIPLY", sepn.outputs["Z"], -1.0), 0.0)
    fill = b.math("ADD", b.math("MULTIPLY", down, 0.30), 0.10)
    fcol = b.n("ShaderNodeVectorMath", operation="MULTIPLY")
    b.link(mul.outputs["Vector"], fcol.inputs[0])
    fcol.inputs[1].default_value = (0.95, 0.80, 0.66)
    fsc = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(fcol.outputs["Vector"], fsc.inputs[0])
    b.link(b.math("MULTIPLY", fill, cav), fsc.inputs["Scale"])
    # warm rim on silhouette edges whose normals turn toward the tear
    lw = b.n("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    tdot = b.math("MAXIMUM", b.vmath("DOT_PRODUCT", geo.outputs["Normal"], tuple(float(v) for v in L.EPI)), 0.0)
    rim = b.math("MULTIPLY", b.math("MULTIPLY", b.math("POWER", lw.outputs["Facing"], 2.5), b.math("ADD", tdot, 0.15)), 2.2)
    rsc = b.n("ShaderNodeVectorMath", operation="SCALE")
    rsc.inputs[0].default_value = (1.0, 0.58, 0.26)
    b.link(rim, rsc.inputs["Scale"])
    em = b.n("ShaderNodeEmission")
    b.link(b.vmath("ADD", fsc.outputs["Vector"], rsc.outputs["Vector"]), em.inputs["Color"])
    add = b.n("ShaderNodeAddShader")
    b.link(p.outputs[0], add.inputs[0])
    b.link(em.outputs[0], add.inputs[1])
    b.out(add.outputs[0])
    return m


def mat_stone(name="CFCL_SkyShatter_RuinStone", c0=(0.20, 0.185, 0.165), c1=(0.42, 0.395, 0.355), scale=0.3):
    m = _mat(name)
    b = NB(m)
    geo = b.n("ShaderNodeNewGeometry")
    oi = b.n("ShaderNodeObjectInfo")
    n1 = b.noise(geo.outputs["Position"], scale, 5.0, 0.6, 0.3)
    c = b.mix(b.math("ADD", b.math("MULTIPLY", n1.outputs["Fac"], 0.8), b.math("MULTIPLY", oi.outputs["Random"], 0.35)),
              c0, c1)
    p = b.n("ShaderNodeBsdfPrincipled")
    b.link(c, p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.88
    bump = b.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.5
    b.link(b.noise(geo.outputs["Position"], scale * 6, 4.0).outputs["Fac"], bump.inputs["Height"])
    b.link(bump.outputs["Normal"], p.inputs["Normal"])
    b.out(p.outputs[0])
    return m


def _uv_parts(b):
    a = b.attr("cf_uv")
    sp = b.n("ShaderNodeSeparateXYZ")
    b.link(a.outputs["Vector"], sp.inputs[0])
    return sp.outputs["X"], sp.outputs["Y"]


def _corona_rim(b, scale):
    """warm light from the corona catching the faces that look toward the disc (inner edges of the rings)."""
    geo = b.n("ShaderNodeNewGeometry")
    toE = b.vmath("NORMALIZE", b.vmath("SUBTRACT", tuple(float(v) for v in L.ECL_C), geo.outputs["Position"]))
    d = b.math("MAXIMUM", b.vmath("DOT_PRODUCT", geo.outputs["Normal"], toE), 0.0)
    rim = b.n("ShaderNodeVectorMath", operation="SCALE")
    rim.inputs[0].default_value = (1.0, 0.56, 0.24)
    b.link(b.math("MULTIPLY", b.math("POWER", d, 1.5), scale), rim.inputs["Scale"])
    return rim.outputs["Vector"]


def _finish(b, p, base_col, fill, rim_scale):
    em = b.n("ShaderNodeEmission")
    fs = b.n("ShaderNodeVectorMath", operation="SCALE")
    b.link(base_col, fs.inputs[0])
    fs.inputs["Scale"].default_value = fill
    tot = b.vmath("ADD", fs.outputs["Vector"], _corona_rim(b, rim_scale)) if rim_scale else fs.outputs["Vector"]
    b.link(tot, em.inputs["Color"])
    add = b.n("ShaderNodeAddShader")
    b.link(p.outputs[0], add.inputs[0])
    b.link(em.outputs[0], add.inputs[1])
    b.out(add.outputs[0])


def mat_ring_stone():
    """carved stone ring band: lozenge chain along the arc + chevron borders (board vocabulary), worn."""
    m = _mat("CFCL_SkyShatter_RingStone")
    b = NB(m)
    u, v = _uv_parts(b)
    av = b.math("ABSOLUTE", v)
    q = b.math("MULTIPLY", b.math("ABSOLUTE", b.math("SUBTRACT", b.math("FRACT", b.math("ADD", b.math("DIVIDE", u, 2.6), 0.5)), 0.5)), 2.0)
    dia = b.math("ABSOLUTE", b.math("SUBTRACT", b.math("ADD", q, b.math("MULTIPLY", av, 2.4)), 0.78))
    g1 = b.maprange(dia, 0.05, 0.12, 1.0, 0.0, smooth=True)
    inner = b.math("LESS_THAN", av, 0.3)
    chev = b.math("MULTIPLY", b.math("LESS_THAN", b.math("FRACT", b.math("ADD", b.math("DIVIDE", u, 1.5), b.math("MULTIPLY", av, 2.2))), 0.16),
                  b.math("GREATER_THAN", av, 0.33))
    groove = b.math("MAXIMUM", b.math("MULTIPLY", g1, inner), b.math("MULTIPLY", chev, b.math("LESS_THAN", av, 0.46)))
    geo = b.n("ShaderNodeNewGeometry")
    nz = b.noise(geo.outputs["Position"], 0.7, 4.0, 0.6)
    stone = b.mix(nz.outputs["Fac"], (0.15, 0.142, 0.128), (0.27, 0.255, 0.225))
    col = b.mix(groove, stone, (0.045, 0.042, 0.04))
    p = b.n("ShaderNodeBsdfPrincipled")
    b.link(col, p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.85
    bump = b.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.7
    b.link(b.math("SUBTRACT", 1.0, groove), bump.inputs["Height"])
    b.link(bump.outputs["Normal"], p.inputs["Normal"])
    _finish(b, p, col, 0.16, 0.9)
    return m


def mat_ring_metal():
    """aged bronze / dark iron plates (alternating along the arc), riveted edge bands, plate seams, green patina."""
    m = _mat("CFCL_SkyShatter_RingMetal")
    b = NB(m)
    u, v = _uv_parts(b)
    av = b.math("ABSOLUTE", v)
    plate = b.math("FLOORED_MODULO", b.math("FLOOR", b.math("DIVIDE", u, 9.0)), 2.0)
    seam = b.math("LESS_THAN", b.math("FRACT", b.math("DIVIDE", u, 9.0)), 0.015)
    du = b.math("MULTIPLY", b.math("SUBTRACT", b.math("FRACT", b.math("DIVIDE", u, 0.85)), 0.5), 0.85)
    dv = b.math("SUBTRACT", av, 0.37)
    dist = b.math("SQRT", b.math("ADD", b.math("MULTIPLY", du, du), b.math("MULTIPLY", dv, dv)))
    rivet = b.maprange(dist, 0.07, 0.13, 1.0, 0.0, smooth=True)
    geo = b.n("ShaderNodeNewGeometry")
    pat = b.maprange(b.noise(geo.outputs["Position"], 0.18, 5.0, 0.65, 0.4).outputs["Fac"], 0.52, 0.68, 0.0, 1.0)
    metal = b.mix(plate, (0.12, 0.074, 0.034), (0.05, 0.048, 0.052))
    col = b.mix(b.math("MULTIPLY", pat, 0.85), metal, (0.06, 0.10, 0.08))
    col = b.mix(b.math("MULTIPLY", rivet, 0.7), col, (0.20, 0.15, 0.09))
    col = b.mix(seam, col, (0.015, 0.014, 0.013))
    p = b.n("ShaderNodeBsdfPrincipled")
    b.link(col, p.inputs["Base Color"])
    p.inputs["Metallic"].default_value = 0.8
    b.link(b.math("ADD", 0.38, b.math("MULTIPLY", pat, 0.45)), p.inputs["Roughness"])
    bump = b.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.8
    b.link(b.math("SUBTRACT", rivet, seam), bump.inputs["Height"])
    b.link(bump.outputs["Normal"], p.inputs["Normal"])
    _finish(b, p, col, 0.12, 1.1)
    return m


def mat_masonry(name="CFCL_SkyShatter_Masonry", c0=(0.15, 0.142, 0.128), c1=(0.30, 0.282, 0.25), joints=True):
    """coursed ancient masonry (world-space courses 1.35 m, staggered head joints) - reads at ~300 m."""
    m = _mat(name)
    b = NB(m)
    geo = b.n("ShaderNodeNewGeometry")
    sp = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Position"], sp.inputs[0])
    nz = b.noise(geo.outputs["Position"], 0.35, 5.0, 0.6, 0.3)
    stone = b.mix(nz.outputs["Fac"], c0, c1)
    if joints:
        crs = b.math("DIVIDE", sp.outputs["Z"], 1.35)
        jh = b.math("LESS_THAN", b.math("FRACT", crs), 0.075)
        stag = b.math("MULTIPLY", b.math("FLOOR", crs), 0.5)
        jv = b.math("LESS_THAN", b.math("FRACT", b.math("ADD", b.math("DIVIDE", b.math("ADD", sp.outputs["X"], sp.outputs["Y"]), 2.4), stag)), 0.05)
        joint = b.math("MAXIMUM", jh, jv)
        col = b.mix(joint, stone, (0.04, 0.037, 0.034))
    else:
        joint = None
        col = stone
    p = b.n("ShaderNodeBsdfPrincipled")
    b.link(col, p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.88
    if joint is not None:
        bump = b.n("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.6
        b.link(b.math("SUBTRACT", 1.0, joint), bump.inputs["Height"])
        b.link(bump.outputs["Normal"], p.inputs["Normal"])
    sepn = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Normal"], sepn.inputs[0])
    _finish(b, p, col, 0.14, 0.0)
    return m


def mat_flat(name, rgb, rough=0.9):
    m = _mat(name)
    b = NB(m)
    p = b.n("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Roughness"].default_value = rough
    b.out(p.outputs[0])
    return m


def mat_cloud_volume():
    """bounded billow volume (v2): ellipsoid envelope in object space x world-scale (75 m / 22 m) domain-distorted
    noise -> irregular banks, soft density ramp, flattened base; faint ember emission on thin edges facing the tear,
    cool scattering albedo."""
    m = _mat("CFCL_SkyShatter_CloudVolume")
    b = NB(m)
    tc = b.n("ShaderNodeTexCoord")
    oi = b.n("ShaderNodeObjectInfo")
    geo = b.n("ShaderNodeNewGeometry")
    p = tc.outputs["Object"]
    env = b.math("SUBTRACT", 1.0, b.vmath("LENGTH", p))
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(p, sep.inputs[0])
    zf = b.maprange(sep.outputs["Z"], -0.85, -0.35, 0.0, 1.0, smooth=True)
    rnd = b.n("ShaderNodeCombineXYZ")
    b.link(b.math("MULTIPLY", oi.outputs["Random"], 17.0), rnd.inputs["X"])
    b.link(b.math("MULTIPLY", oi.outputs["Random"], 31.0), rnd.inputs["Y"])
    b.link(b.math("MULTIPLY", oi.outputs["Random"], 7.0), rnd.inputs["Z"])
    q1 = b.vmath("ADD", b.vmath("MULTIPLY", geo.outputs["Position"], (1 / 75.0, 1 / 75.0, 1 / 45.0)), rnd.outputs[0])
    q2 = b.vmath("ADD", b.vmath("MULTIPLY", geo.outputs["Position"], (1 / 22.0, 1 / 22.0, 1 / 16.0)), rnd.outputs[0])
    n1 = b.noise(q1, 1.0, 6.0, 0.6, 0.8)
    n2 = b.noise(q2, 1.0, 4.0, 0.6, 0.3)
    bill = b.math("ADD", b.math("MULTIPLY", env, 1.1),
                  b.math("ADD", b.math("MULTIPLY", b.math("SUBTRACT", n1.outputs["Fac"], 0.5), 1.4),
                         b.math("MULTIPLY", b.math("SUBTRACT", n2.outputs["Fac"], 0.5), 0.45)))
    bill = b.math("SUBTRACT", bill, 0.12)
    core = b.math("MULTIPLY", b.maprange(bill, 0.0, 0.5, 0.0, 1.0, smooth=True), zf)
    dens = b.math("MULTIPLY", core, 0.03)
    thin = b.math("MULTIPLY", b.maprange(bill, 0.0, 0.3, 1.0, 0.0, smooth=True), b.math("GREATER_THAN", core, 0.01))
    epi = tuple(float(v) for v in L.EPI_POINT)
    tdir = b.vmath("NORMALIZE", b.vmath("MULTIPLY", b.vmath("SUBTRACT", epi, oi.outputs["Location"]), (1.0, 0.3, 1.0)))
    pdir = b.vmath("NORMALIZE", b.vmath("MULTIPLY", b.vmath("SUBTRACT", geo.outputs["Position"], oi.outputs["Location"]),
                                        (1.0, 0.3, 1.0)))
    facing = b.math("MAXIMUM", b.vmath("DOT_PRODUCT", tdir, pdir), 0.0)
    glow = b.math("MULTIPLY", b.math("MULTIPLY", thin, b.math("POWER", facing, 1.6)), 0.025)
    pv_ = b.n("ShaderNodeVolumePrincipled")
    pv_.inputs["Color"].default_value = (0.36, 0.40, 0.47, 1)
    b.link(dens, pv_.inputs["Density"])
    pv_.inputs["Anisotropy"].default_value = 0.45
    pv_.inputs["Emission Color"].default_value = (1.0, 0.56, 0.22, 1)
    b.link(glow, pv_.inputs["Emission Strength"])
    b.out(None, pv_.outputs[0])
    return m


def mat_cloud_card(name, img, strength=1.0):
    m = _mat(name)
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass
    b = NB(m)
    tx = b.n("ShaderNodeTexImage")
    tx.image = img
    tx.extension = "CLIP"
    em = b.n("ShaderNodeEmission")
    b.link(tx.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = strength
    tr = b.n("ShaderNodeBsdfTransparent")
    mx = b.n("ShaderNodeMixShader")
    b.link(tx.outputs["Alpha"], mx.inputs[0])
    b.link(tr.outputs[0], mx.inputs[1])
    b.link(em.outputs[0], mx.inputs[2])
    b.out(mx.outputs[0])
    return m


# =============================================================== 1. dome
def build_dome(col, mats):
    t0 = time.time()
    D = L.build_dome()
    LOG["dome_stats"] = D["stats"]
    n = len(L.GRID_S)
    loop = [(i, 0) for i in range(n)] + [(n - 1, j) for j in range(1, n)] + \
           [(i, n - 1) for i in range(n - 2, -1, -1)] + [(0, j) for j in range(n - 2, 0, -1)]
    q = np.array([(i * n + j, (i + 1) * n + j, (i + 1) * n + j + 1, i * n + j + 1)
                  for i in range(n - 1) for j in range(n - 1)], np.int32)

    def plate_geo(p):
        thick = p["state"] == "fall" or (p["ring"] <= 2 and p["state"] in ("hinged", "curl") and p["angle"] > 12 * L.D2R)
        T_ = 20.0 if thick else L.DOME_T
        Pi = L.plate_world(p, L.DOME_R).reshape(-1, 3)
        Po = L.plate_world(p, L.DOME_R + T_).reshape(-1, 3)
        if thick:      # bevel: inset the outer face -> slanted, chunky broken edges
            ce = Po.mean(0)
            ext = np.linalg.norm(Po - ce, axis=1).max()
            Po = ce + (Po - ce) * max(0.6, 1.0 - 1.1 * T_ / ext)
        nn = n * n
        V = np.vstack([Pi, Po])
        F = [tuple(f) for f in q] + [tuple((f + nn)[::-1]) for f in q]
        mi = [0] * len(q) + [1] * len(q)
        for a, b_ in zip(loop, loop[1:] + loop[:1]):
            ia, ib = a[0] * n + a[1], b_[0] * n + b_[1]
            F.append((ia, ib, ib + nn, ia + nn))
            mi.append(2)
        dirs = np.vstack([p["dirs"].reshape(-1, 3)] * 2)
        edge = np.concatenate([p["edge"].ravel()] * 2)
        heat = np.full(len(V), p["heat"])
        sky = L.sky_paint(p["dirs"].reshape(-1, 3), p["edge"].ravel(), np.full(nn, p["heat"]))
        if p["state"] in ("detached", "peel", "curl", "fall") or p["ring"] == 1 or (p["state"] == "hinged" and p["angle"] >= 10 * L.D2R):
            sky = sky * 0.32 + np.array((0.01, 0.012, 0.018), F32)
        under = np.tile(np.array([[0.035, 0.045, 0.06]], F32), (nn, 1))
        return V, F, mi, dirs, edge, heat, np.vstack([sky, under])

    shell = [p for p in D["plates"] if p["state"] == "inplace" or (p["state"] == "hinged" and p["angle"] < 10 * L.D2R)]
    LOG["peels"] = [{"ring": p["ring"], "curl_deg": round(p["angle"] / L.D2R, 1)} for p in D["plates"] if p["state"] == "curl"]
    moving = [p for p in D["plates"] if p not in shell]
    objs = []

    def make(name, plates):
        Vs, Fs, Ms, Ds, Es, Hs, Cs = [], [], [], [], [], [], []
        off = 0
        for p in plates:
            V, F, mi, dirs, edge, heat, colr = plate_geo(p)
            Vs.append(V)
            Fs += [tuple(i + off for i in f) for f in F]
            Ms += mi
            Ds.append(dirs)
            Es.append(edge)
            Hs.append(heat)
            Cs.append(colr)
            off += len(V)
        ob = mesh_from(name, np.vstack(Vs), Fs, col, Ms, (mats["sky"], mats["under"], mats["rim"]), True, 35)
        me = ob.data
        set_attr(me, "cf_dir", "FLOAT_VECTOR", np.vstack(Ds))
        set_attr(me, "cf_edge", "FLOAT", np.concatenate(Es))
        set_attr(me, "cf_heat", "FLOAT", np.concatenate(Hs))
        set_color(me, np.vstack(Cs))
        bmesh_recalc(ob)
        recenter(ob)
        objs.append(ob)
        return ob

    make("CFCL_SkyShatter_Dome_Shell", shell)
    for i, p in enumerate(sorted(moving, key=lambda p: p["rho_c"])):
        ob = make(f"CFCL_SkyShatter_Dome_Falling_{i:02d}", [p])
        ob["cf_state"] = p["state"]
        ob["cf_angle_deg"] = round(p["angle"] / L.D2R, 1)
        ob["cf_ring"] = p["ring"]
    # shards (pieces of the blown-out plates)
    rng = np.random.default_rng(77)
    V, F, Mi, H = [], [], [], []
    off = 0
    for s_ in D["shards"]:
        k = s_["nv"]
        ang = np.sort(rng.uniform(0, 2 * math.pi, k))
        rad = s_["size"] * rng.uniform(0.35, 0.6, k) * np.array([1.0 if i % 2 == 0 else rng.uniform(0.5, 1.0)
                                                               for i in range(k)])
        poly = np.stack([np.cos(ang) * rad * 1.4, np.sin(ang) * rad * 0.8, np.zeros(k)], 1)
        th = 0.10 * s_["size"]
        pts = np.vstack([poly + (0, 0, th / 2), poly - (0, 0, th / 2)])
        Rm = np.asarray(S.rot_matrix(*(np.degrees(s_["rot"]))), float)
        pts = pts @ Rm.T + s_["pos"]
        V.append(pts)
        F.append(tuple(range(off, off + k)))
        F.append(tuple(range(off + 2 * k - 1, off + k - 1, -1)))
        Mi += [0, 0]
        for i in range(k):
            j = (i + 1) % k
            F.append((off + j, off + i, off + k + i, off + k + j))
            Mi.append(1)
        H.append(np.full(2 * k, s_["heat"]))
        off += 2 * k
    ob = mesh_from("CFCL_SkyShatter_Dome_Shards", np.vstack(V), F, col, Mi, (mats["under"], mats["rim"]), False)
    set_attr(ob.data, "cf_heat", "FLOAT", np.concatenate(H))
    bmesh_recalc(ob)
    recenter(ob)
    objs.append(ob)
    # beyond shell
    rds, ths, bd, bc, bs = L.beyond_grid()
    nr, nt = len(rds), len(ths)
    V = (bd * L.BEYOND_R).reshape(-1, 3)
    el = np.degrees(np.arcsin(np.clip(bd[..., 2], -1, 1)))
    F, UVs = [], []
    for i in range(nr - 1):
        for j in range(nt - 1):
            ids = (i * nt + j, i * nt + j + 1, (i + 1) * nt + j + 1, (i + 1) * nt + j)
            if max(el.ravel()[list(ids)]) < -4.0:
                continue
            F.append(ids)
    ob = mesh_from("CFCL_SkyShatter_Beyond", V, F, col, None, (mats["beyond"],), True)
    me = ob.data
    set_color(me, bc.reshape(-1, 3))
    set_attr(me, "cf_glow", "FLOAT", bs.ravel())
    uvl = me.uv_layers.new(name="UVMap")
    li = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", li)
    TT, RR = np.meshgrid(ths, rds)
    uvv = np.stack([(TT / (2 * math.pi)).ravel(), (RR / 112.0).ravel()], 1)
    uvl.data.foreach_set("uv", uvv[li].astype(F32).ravel())
    recenter(ob)
    objs.append(ob)
    log(f"dome: {len(shell)} shell plates, {len(moving)} falling plates, {len(D['shards'])} shards "
        f"({time.time() - t0:.1f}s) stats {D['stats']}")
    return objs


def build_mechanism(col, mats):
    Mx = MS.mechanism(np.random.default_rng(5))
    LOG["mechanism"] = Mx["info"]
    objs = []
    for key, acc, slots in (("Rings", Mx["rings"], (mats["ring_stone"], mats["ring_metal"])),
                            ("Drift", Mx["drift"], (mats["ring_stone"], mats["ring_metal"])),
                            ("Foundations", Mx["chunks"], (mats["masonry"],))):
        if not acc.F:
            continue
        ob = mesh_from(f"CFCL_SkyShatter_Mech_{key}", acc.verts(), acc.F, col, acc.T, slots, True, 32)
        bmesh_recalc(ob)
        set_attr(ob.data, "cf_uv", "FLOAT2", acc.uvs())
        recenter(ob)
        objs.append(ob)
    log("mechanism", [(o.name, R.tri_count([o])) for o in objs])
    return objs


def bmesh_recalc(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


# =============================================================== 2. landmasses
class Acc:
    def __init__(self):
        self.V, self.F, self.n = [], [], 0

    def add(self, V, F):
        V = np.asarray(V, float)
        self.V.append(V)
        self.F += [tuple(int(i) + self.n for i in f) for f in F]
        self.n += len(V)

    def verts(self):
        return np.vstack(self.V) if self.V else np.zeros((0, 3))


_BOXF = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]


def box(acc, c, size, rz=0.0, tilt=(0.0, 0.0), topj=None, rng=None):
    sx, sy, sz = size
    V = np.array([(x, y, z) for x in (-sx / 2, sx / 2) for y in (-sy / 2, sy / 2) for z in (0, sz)], float)
    if topj and rng is not None:
        V[V[:, 2] > 0, 2] -= rng.uniform(0, topj, 4)
    Rm = np.asarray(S.rot_matrix(tilt[0], tilt[1], rz), float)
    acc.add(V @ Rm.T + np.asarray(c, float), _BOXF)


def prism(acc, c, r, h, nseg=8, rz=0.0, tilt=(0.0, 0.0), topj=0.0, rng=None, cap=None):
    a = np.linspace(0, 2 * math.pi, nseg, endpoint=False) + rz
    bot = np.stack([np.cos(a) * r, np.sin(a) * r, np.zeros(nseg)], 1)
    top = np.stack([np.cos(a) * r * 0.94, np.sin(a) * r * 0.94, np.full(nseg, h)], 1)
    if topj and rng is not None:
        tilt_dir = rng.uniform(0, 2 * math.pi)
        top[:, 2] -= topj * (0.5 + 0.5 * np.cos(a - tilt_dir)) + rng.uniform(0, topj * 0.25, nseg)
    V = np.vstack([bot, top])
    F = [tuple(range(nseg - 1, -1, -1)), tuple(range(nseg, 2 * nseg))]
    F += [(i, (i + 1) % nseg, nseg + (i + 1) % nseg, nseg + i) for i in range(nseg)]
    Rm = np.asarray(S.rot_matrix(tilt[0], tilt[1], 0), float)
    acc.add(V @ Rm.T + np.asarray(c, float), F)
    if cap:
        box(acc, (c[0], c[1], c[2] + h - 0.15 * r), (2.6 * r, 2.6 * r, 0.9 * r), rz, tilt)


def arch(acc, c, span, thick, pier_w, pier_h, rz, rng, missing=0.25):
    ca, sa = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    ax = np.array((ca, sa, 0.0))
    c = np.asarray(c, float)
    for s in (-1, 1):
        pc = c + ax * s * (span / 2 + pier_w / 2)
        box(acc, pc, (pier_w, thick, pier_h * rng.uniform(0.85, 1.0)), rz, topj=0, rng=rng)
    nv = 11
    rr = span / 2 + pier_w / 2
    for k in range(nv):
        if 0 < k < nv - 1 and rng.random() < missing:
            continue
        a = math.pi * (k + 0.5) / nv
        p = c + ax * (-math.cos(a) * rr) + np.array((0, 0, pier_h + math.sin(a) * rr - pier_w * 0.35))
        Rm = np.asarray(S.rot_matrix(0, math.degrees(a - math.pi / 2), rz), float)
        V = np.array([(x, y, z) for x in (-0.16 * rr, 0.16 * rr) for y in (-thick / 2, thick / 2)
                      for z in (-pier_w * 0.45, pier_w * 0.45)], float)
        acc.add(V @ Rm.T + p, _BOXF)


def wall(acc, c, length, thick, h, rz, rng, nseg=7):
    ca, sa = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    ax = np.array((ca, sa, 0.0))
    seg = length / nseg
    for k in range(nseg):
        if rng.random() < 0.18:
            continue
        hh = h * rng.uniform(0.35, 1.0) if rng.random() < 0.6 else h
        pc = np.asarray(c, float) + ax * (-length / 2 + (k + 0.5) * seg)
        box(acc, pc, (seg * 0.98, thick, hh), rz, topj=0.25 * hh, rng=rng)
        if rng.random() < 0.35 and hh > 0.6 * h:   # window lintel band
            box(acc, pc + (0, 0, hh * 0.98), (seg * 1.05, thick * 1.25, 0.08 * h), rz)


def tower(acc, c, w, h, rz, rng):
    box(acc, c, (w, w, h), rz, topj=0.28 * h, rng=rng)
    box(acc, np.asarray(c, float) + (0, 0, h * 0.42), (w * 1.12, w * 1.12, 0.05 * h), rz)
    box(acc, np.asarray(c, float), (w * 1.25, w * 1.25, 0.12 * h), rz)


def tube(acc, pts, r0, r1, nseg=6):
    pts = np.asarray(pts, float)
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        a = np.cross(t, (1.0, 0, 0)) if abs(t[0]) < 0.9 else np.cross(t, (0, 1.0, 0))
        a /= np.linalg.norm(a)
        b_ = np.cross(t, a)
        r = r0 + (r1 - r0) * i / (n - 1)
        ang = np.linspace(0, 2 * math.pi, nseg, endpoint=False)
        rings.append(p + r * (np.cos(ang)[:, None] * a + np.sin(ang)[:, None] * b_))
    V = np.vstack(rings + [pts[-1:]])
    F = []
    for i in range(n - 1):
        for k in range(nseg):
            F.append((i * nseg + k, i * nseg + (k + 1) % nseg, (i + 1) * nseg + (k + 1) % nseg, (i + 1) * nseg + k))
    tip = n * nseg
    for k in range(nseg):
        F.append(((n - 1) * nseg + k, (n - 1) * nseg + (k + 1) % nseg, tip))
    acc.add(V, F)


def ruins_for(lm, ztop, rng):
    acc = Acc()
    R0 = lm["R"]
    ex, ey = lm["el"]
    kind = lm["ruins"]
    sc = R0 / 40.0

    def zat(x, y):
        return float(ztop(x, y)) - 1.5 * sc

    def spot(rmax=0.55):
        a = rng.uniform(0, 2 * math.pi)
        r = R0 * rmax * math.sqrt(rng.random())
        return r * math.cos(a) * ex, r * math.sin(a) * ey

    if "arch" in kind:
        x, y = spot(0.3)
        arch(acc, (x, y, zat(x, y)), 17 * sc, 4.0 * sc, 4.2 * sc, 16 * sc, rng.uniform(0, 180), rng, 0.2)
    if "wall" in kind or "arch" in kind:
        for _ in range(2):
            x, y = spot(0.5)
            wall(acc, (x, y, zat(x, y)), rng.uniform(22, 34) * sc, 2.6 * sc, rng.uniform(11, 17) * sc,
                 rng.uniform(0, 180), rng)
    if "tower" in kind or "stump" in kind:
        for _ in range(2 if "towers" in kind else 1):
            x, y = spot(0.45)
            tower(acc, (x, y, zat(x, y)), rng.uniform(8, 11) * sc, rng.uniform(24, 36) * sc, rng.uniform(0, 90), rng)
    if "colonnade" in kind:
        x0, y0 = spot(0.3)
        rz = rng.uniform(0, 180)
        ax = np.array((math.cos(math.radians(rz)), math.sin(math.radians(rz))))
        for k in range(6):
            if rng.random() < 0.2:
                continue
            x, y = x0 + ax[0] * (k - 2.5) * 7 * sc, y0 + ax[1] * (k - 2.5) * 7 * sc
            prism(acc, (x, y, zat(x, y)), 1.5 * sc, rng.uniform(9, 21) * sc, 8, 0, (rng.normal(0, 3), rng.normal(0, 3)),
                  4 * sc, rng, cap=rng.random() < 0.4)
        x, y = spot(0.5)  # fallen drum
        prism(acc, (x, y, zat(x, y) + 1.5 * sc), 1.5 * sc, 12 * sc, 8, 0, (88, rng.uniform(0, 180)), 0, rng)
    if "bridge" in kind:
        # broken arched bridge running off the edge of the mass, snapped mid-span
        a = rng.uniform(0, 2 * math.pi)
        dirv = np.array((math.cos(a), math.sin(a), 0.0))
        start = np.array((math.cos(a) * R0 * ex * 0.55, math.sin(a) * R0 * ey * 0.55, 0.0))
        rz = math.degrees(a)
        for k in range(5):
            p = start + dirv * k * 9 * sc
            z = zat(p[0] * 0.5, p[1] * 0.5) - k * 0.8 * sc
            box(acc, (p[0], p[1], z + 7 * sc), (9.4 * sc, 6 * sc, 2.2 * sc), rz, tilt=(0, k * 1.5))
            box(acc, (p[0], p[1], z - 10 * sc + k * 0.3), (2.5 * sc, 4 * sc, 17 * sc - k * 2.5 * sc), rz, topj=0,
                rng=rng)
    # rubble blocks
    for _ in range(int(10 * max(1, sc))):
        x, y = spot(0.7)
        s = rng.uniform(1.5, 4.5) * sc
        box(acc, (x, y, zat(x, y)), (s, s * rng.uniform(0.5, 1), s * rng.uniform(0.4, 0.8)), rng.uniform(0, 180),
            (rng.normal(0, 12), rng.normal(0, 12)))
    return acc


def build_landmasses(col, mats):
    objs = []
    info = []
    for lm in L.LANDMASSES:
        t0 = time.time()
        SD = L.make_landmass_sdf(lm)
        vox = lm["R"] / 36.0
        v, qd = S.mesh_sdf(SD["f_main"], SD["bmin"], SD["bmax"], vox, verbose=False)
        Vs, Qs, off = [v], [qd], len(v)
        n_chunks = 0
        for ch in SD["chunks"]:
            c, hf, Rb = ch["c"], ch["half"], ch["Rb"].astype(F32)
            ext = float(np.linalg.norm(hf)) * 1.15 + 2 * vox
            fch = (lambda c=c, hf=hf, Rb=Rb: (lambda P: np.maximum(SD["f"](P), S.box(P, c, hf, R=Rb))))()
            cv, cq = S.mesh_sdf(fch, c - ext, c + ext, vox * 0.8, verbose=False)
            if len(cv) < 60:
                continue
            cen = cv.mean(0)
            cv = (cv - cen) @ ch["Rt"].T.astype(F32) + cen + ch["t"].astype(F32)
            Vs.append(cv)
            Qs.append(cq + off)
            off += len(cv)
            n_chunks += 1
        sfx = "_far" if lm.get("haze") == "far" else ""
        ob = mesh_from(f"CFCL_SkyShatter_Landmass_{lm['key']}", np.vstack(Vs), np.vstack(Qs), col, None,
                       (mats["rock" + sfx],), True)
        T.drop_small_parts(ob, 60)
        T.decimate_to(ob, lm.get("target", 24000))
        T.shade(ob, True, 38)
        # strata vertex colours (local frame, before placement)
        me = ob.data
        nv = len(me.vertices)
        co = np.zeros(nv * 3, F32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        nr = np.zeros(nv * 3, F32)
        me.vertices.foreach_get("normal", nr)
        nr = nr.reshape(-1, 3)
        u = np.clip(-co[:, 2] / lm["D"], 0, 1)
        bands = S.fbm((np.stack([co[:, 0] * 0.006, co[:, 1] * 0.006, co[:, 2] * 0.09], 1)).astype(F32), 1.0, 3,
                      seed=lm["seed"])
        pal = np.array([(0.26, 0.235, 0.205), (0.15, 0.137, 0.124), (0.075, 0.07, 0.068), (0.21, 0.15, 0.105),
                        (0.048, 0.046, 0.045)])
        bi = np.clip(((bands * 0.5 + 0.5) * 4.99).astype(int), 0, 4)
        c = pal[bi] * (1.0 - 0.4 * u[:, None])
        stain = S.fbm((co * np.array((0.05, 0.05, 0.012), F32)).astype(F32), 1.0, 3, seed=lm["seed"] + 9)
        c *= (0.75 + 0.35 * (stain[:, None] * 0.5 + 0.5))          # vertical weathering streaks
        top = (nr[:, 2] > 0.55) & (co[:, 2] > -0.12 * lm["D"])
        moss = S.fbm((co * 0.03).astype(F32), 1.0, 3, seed=lm["seed"] + 5) > -0.1
        c[top & moss] = (0.07, 0.085, 0.045)
        c[top & ~moss] = (0.23, 0.21, 0.18)
        set_color(me, c)
        rng = np.random.default_rng(lm["seed"] + 3)
        dcm = L.lm_matrix(lm).T @ (np.array(L.CAMS["hero"][0]) - np.array(lm["loc"]))
        A_ = MS.megastructure(lm, SD["ztop"], math.atan2(dcm[1], dcm[0]), rng, light=(lm["key"] != "L"))
        ru = mesh_from(f"CFCL_SkyShatter_Landmass_{lm['key']}_Megastructure", A_.verts(), A_.F, col, A_.T,
                       (mats["masonry" + sfx], mats["carved" + sfx]), False)
        bmesh_recalc(ru)
        racc = Acc()
        for (x0, y0, z0, rr) in SD["sockets"]:
            ln = rng.uniform(0.3, 0.7) * lm["D"]
            outv = np.array((x0, y0, 0.0))
            outv = outv / (np.linalg.norm(outv) + 1e-6)
            ph, amp = rng.uniform(0, 6.28), rng.uniform(0.06, 0.16) * ln
            side = np.cross(outv, (0, 0, 1.0))
            pts = [np.array((x0, y0, z0)) + outv * (0.12 * ln * (i / 9) ** 0.7) + side * amp * math.sin(ph + i * 0.9)
                   + (0, 0, -ln * (i / 9) ** 1.15) + rng.normal(0, 0.012 * ln, 3) * (i > 0) for i in range(10)]
            tube(racc, pts, max(1.6, rr * 0.75), 0.25, 7)
            for _ in range(int(rng.integers(1, 3))):    # side tendrils
                p0 = pts[int(rng.integers(2, 5))]
                sd = outv + rng.normal(0, 0.5, 3) * (1, 1, 0)
                pts2 = [p0 + np.array((sd[0] * 0.12 * ln * i / 4, sd[1] * 0.12 * ln * i / 4, -0.16 * ln * i / 4))
                        for i in range(5)]
                tube(racc, pts2, max(0.6, rr * 0.3), 0.15, 5)
        rt = mesh_from(f"CFCL_SkyShatter_Landmass_{lm['key']}_Roots", racc.verts(), racc.F, col, None,
                       (mats["root" + sfx],), True)
        Mw = Matrix.Translation(Vector(lm["loc"])) @ Matrix(np.asarray(S.rot_matrix(*lm["rot"]), float).tolist()).to_4x4()
        for o in (ob, ru, rt):
            o.matrix_world = Mw
        objs += [ob, ru, rt]
        info.append({"key": lm["key"], "chunks": n_chunks, "tris_rock": R.tri_count([ob]),
                     "tris_ruins": R.tri_count([ru]), "tris_roots": R.tri_count([rt]), "s": round(time.time() - t0, 1)})
        log("landmass", info[-1])
    LOG["landmasses"] = info
    return objs


# =============================================================== 3. debris streams (GN instancing)
def chip_protos():
    rng = np.random.default_rng(4242)
    P = []

    def norm(V):
        V = np.asarray(V, float)
        V = V - (V.min(0) + V.max(0)) / 2
        return V / np.abs(V).max() * 0.5

    for i in range(4):     # 0-3 fractured rock
        if i < 2:
            V, F = T.block_chunk(rng, 1.0, ncut=4 + i)
        else:
            V, F = T.convex_shard(rng, 1.0, squash=(1.0, 0.8 - 0.2 * (i - 2), 0.6 - 0.2 * (i - 2)), npts=12)
        P.append((norm(V), F, 0))
    for dims, nc in (((1.0, 0.55, 0.45), 3), ((1.0, 0.5, 0.5), 4), ((1.0, 0.75, 0.16), 3), ((1.0, 0.9, 0.2), 4)):
        V, F = T.block_chunk(rng, 1.0, dims=dims, ncut=nc)     # 4-7 masonry / slabs / torn ground plate
        P.append((norm(V), F, 1))
    acc = Acc()                                             # 8 column drum
    prism(acc, (0, 0, -0.3), 0.35, 0.6, 8, 0, (0, 0), 0.12, rng)
    P.append((acc.verts(), acc.F, 1))
    V, F = T.convex_shard(rng, 1.0, squash=(1.0, 0.5, 0.14), npts=10)   # 9 thin sliver
    P.append((norm(V), F, 0))
    return P


def chip_group(K):
    ng = bpy.data.node_groups.get("CFCL_SkyShatter_ChipScatter")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("CFCL_SkyShatter_ChipScatter", "GeometryNodeTree")
    ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    try:
        ng.is_modifier = True
    except Exception:
        pass
    N, Lk = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")

    def named(name, dt):
        n = N.new("GeometryNodeInputNamedAttribute")
        n.data_type = dt
        n.inputs["Name"].default_value = name
        return n.outputs["Attribute"]

    a_pt, a_pid, a_proto = named("cf_pt", "FLOAT"), named("cf_pid", "FLOAT"), named("cf_proto", "INT")
    a_rot, a_scale = named("cf_rot", "FLOAT_VECTOR"), named("cf_scale", "FLOAT")
    sep = N.new("GeometryNodeSeparateGeometry")
    sep.domain = "POINT"
    Lk.new(gi.outputs[0], sep.inputs["Geometry"])
    Lk.new(a_pt, sep.inputs["Selection"])
    e2r = N.new("FunctionNodeEulerToRotation")
    Lk.new(a_rot, e2r.inputs[0])
    join = N.new("GeometryNodeJoinGeometry")
    for k in range(K):
        c1 = N.new("ShaderNodeMath")
        c1.operation = "COMPARE"
        Lk.new(a_pid, c1.inputs[0])
        c1.inputs[1].default_value = float(k)
        c1.inputs[2].default_value = 0.25
        sk = N.new("GeometryNodeSeparateGeometry")
        sk.domain = "POINT"
        Lk.new(sep.outputs["Inverted"], sk.inputs["Geometry"])
        Lk.new(c1.outputs[0], sk.inputs["Selection"])
        c2 = N.new("ShaderNodeMath")
        c2.operation = "COMPARE"
        Lk.new(a_proto, c2.inputs[0])
        c2.inputs[1].default_value = float(k)
        c2.inputs[2].default_value = 0.25
        io = N.new("GeometryNodeInstanceOnPoints")
        Lk.new(sep.outputs["Selection"], io.inputs["Points"])
        Lk.new(c2.outputs[0], io.inputs["Selection"])
        Lk.new(sk.outputs["Selection"], io.inputs["Instance"])
        Lk.new(e2r.outputs[0], io.inputs["Rotation"])
        Lk.new(a_scale, io.inputs["Scale"])
        Lk.new(io.outputs["Instances"], join.inputs["Geometry"])
    Lk.new(join.outputs[0], go.inputs[0])
    return ng


def chip_object(name, ch, protos, col, mats):
    origin = ch["pos"][np.argmin(ch["t"])] if len(ch["pos"]) else np.zeros(3)
    pts = ch["pos"] - origin
    Vs, F, Mi = [pts], [], []
    pt, pid = [np.ones(len(pts))], [np.full(len(pts), -1.0)]
    off = len(pts)
    for k, (pv, pf, mi) in enumerate(protos):
        Vs.append(pv)
        F += [tuple(int(i) + off for i in f) for f in pf]
        Mi += [mi] * len(pf)
        pt.append(np.zeros(len(pv)))
        pid.append(np.full(len(pv), float(k)))
        off += len(pv)
    ob = mesh_from(name, np.vstack(Vs), F, col, Mi, (mats["chip_rock"], mats["chip_mason"]), False)
    me = ob.data
    ntot = len(me.vertices)
    npt = len(pts)

    def pad(a, fill=0.0):
        a = np.asarray(a, float)
        return np.concatenate([a, np.full((ntot - npt,) + a.shape[1:], fill)])

    set_attr(me, "cf_pt", "FLOAT", np.concatenate(pt))
    set_attr(me, "cf_pid", "FLOAT", np.concatenate(pid))
    set_attr(me, "cf_proto", "INT", pad(ch["proto"]).astype(np.int32))
    set_attr(me, "cf_rot", "FLOAT_VECTOR", pad(ch["rot"]))
    set_attr(me, "cf_scale", "FLOAT", pad(ch["scale"], 1.0))
    ob.location = Vector(origin.tolist())
    mod = ob.modifiers.new("CFCL_ChipScatter", "NODES")
    mod.node_group = chip_group(len(protos))
    ob["cf_instances"] = int(npt)
    return ob


def build_streams(col, mats):
    protos = chip_protos()
    ptris = [sum(len(f) - 2 for f in pf) for _, pf, _ in protos]
    objs, info = [], []
    specs = [(st, "Stream") for st in L.STREAMS] + [(L.trail_spec(lm), "Trail") for lm in L.LANDMASSES] + \
        [(ft, "Trail") for ft in L.FALL_TRAILS]
    for st, kind in specs:
        ch = L.stream_chips(st)
        key = st["key"].replace("Trail_", "")
        ob = chip_object(f"CFCL_SkyShatter_{kind}_{key}", ch, protos, col, mats)
        inst_tris = int(sum(ptris[k] for k in ch["proto"]))
        info.append({"object": ob.name, "instances": int(len(ch["pos"])), "dropped_keep_clear": ch["dropped"],
                     "instanced_tris": inst_tris})
        objs.append(ob)
    LOG["streams"] = info
    LOG["chip_proto_tris"] = ptris
    log("streams", info)
    return objs, ptris


# =============================================================== 4. clouds
def _vnoise(h, w, cells, rng):
    g = rng.random((cells[0] + 3, cells[1] + 3))
    ys = np.linspace(0, cells[0], h, endpoint=False) + 1
    xs = np.linspace(0, cells[1], w, endpoint=False) + 1
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]


def _blur(a, r):
    for ax in (0, 1):
        pad = [(r + 1, r) if i == ax else (0, 0) for i in range(2)]
        c = np.cumsum(np.pad(a, pad, mode="edge"), axis=ax)
        n = c.shape[ax]
        a = (np.take(c, range(2 * r + 1, n), axis=ax) - np.take(c, range(0, n - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return a


def cloud_texture(key, seed, w=1024, h=512):
    """procedural cloud-bank sprite (row 0 = bottom).  Cauliflower billows: heightfield = union of spheres at 3 puff
    levels (big masses, medium billows on their tops, small curls on those), domain-warped, fbm-eroded edges,
    dissolving flat base.  Lighting baked from the heightfield normals: warm ember rim on the side facing the tear,
    cool storm cores."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    xn, yn = xx / w, yy / h
    asp = w / h

    def fbm(oct_=6, c0=(3, 6)):
        return sum(_vnoise(h, w, (c0[0] * 2 ** o, c0[1] * 2 ** o), rng) * 0.5 ** o for o in range(oct_)) / 1.97

    fb, fx, fy = fbm(), fbm(4), fbm(4)
    xw, yw = xn + 0.025 * (fx - 0.5), yn + 0.05 * (fy - 0.5)
    H = np.zeros((h, w))
    puffs = []
    for i in range(7):
        cx = 0.12 + 0.76 * (i + rng.uniform(-0.3, 0.3)) / 6
        r = rng.uniform(0.15, 0.24) * (1 - 0.45 * abs(cx - 0.5))
        puffs.append((cx, rng.uniform(0.22, 0.34), r))
    lvl = list(puffs)
    for scale_, n_, ang in ((0.45, 4, (15, 165)), (0.45, 3, (10, 170))):
        nxt = []
        for (cx, cy, r) in lvl:
            for _ in range(n_):
                a_ = np.radians(rng.uniform(*ang))
                rr = r * scale_ * rng.uniform(0.75, 1.2)
                nxt.append((cx + np.cos(a_) * r * 0.82 / asp, cy + np.sin(a_) * r * 0.82, rr))
        puffs += nxt
        lvl = nxt
    kk = 0.025
    acc = np.zeros((h, w))
    for (cx, cy, r) in puffs:
        d2 = ((xw - cx) * asp) ** 2 + (yw - cy) ** 2
        acc += np.exp(np.sqrt(np.clip(r * r - d2, 0, None)) / kk) * (d2 < r * r)
    H = np.where(acc > 0, kk * np.log(np.maximum(acc, 1e-30)), 0.0)
    fb2 = fbm(5, (12, 24))
    inside = np.clip(H / 0.02, 0, 1)
    Hn = H + 0.07 * (fb - 0.5) + 0.06 * (fb2 - 0.5) * (1 - inside) - 0.02 * (1 - (acc > 0))
    alpha = np.clip((Hn - 0.006) / 0.05, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    alpha *= np.clip((yw - 0.06) / 0.16, 0, 1) * np.clip((xn - 0.01) / 0.08, 0, 1) * np.clip((0.99 - xn) / 0.08, 0, 1)
    Hs = _blur(H, 5) + 0.012 * (fb2 - 0.5)
    gy, gx = np.gradient(Hs)
    nrm = np.stack([-gx * w * 0.16, -gy * h * 0.16, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Ld = {"LitRight": (0.75, 0.35, 0.55), "LitLeft": (-0.75, 0.35, 0.55), "Backlit": (0.1, -0.8, 0.45),
          "Storm": (0.3, 0.75, 0.55)}[key]
    Ld = np.array(Ld) / np.linalg.norm(Ld)
    dif = np.clip(nrm @ Ld, 0, 1)
    sky = np.clip(nrm[..., 1] * 0.5 + 0.5, 0, 1)
    edge = alpha * np.clip(1 - Hn / 0.05, 0, 1)
    core = np.array((0.03, 0.036, 0.05))
    lit = np.array((0.25, 0.28, 0.34))
    warm = np.array((1.0, 0.55, 0.22))
    wk = 0.0 if key == "Storm" else 1.0
    col = core * (0.7 + 0.6 * sky)[..., None] + (lit - core) * (dif ** 1.2)[..., None] * 0.8 \
        + warm * (wk * (edge * dif * 2.6 + 0.18 * dif ** 2 + 0.35 * dif ** 5))[..., None]
    col *= (0.55 + 0.45 * np.clip((yw - 0.1) / 0.35, 0, 1))[..., None] * (0.85 + 0.3 * fb)[..., None]
    srgb = np.clip(col, 0, 1) ** (1 / 2.2)
    rgba = np.concatenate([srgb, alpha[..., None]], -1).astype(F32)
    name = f"CFCL_SkyShatter_Cloud_{key}"
    img = bpy.data.images.get(name) or bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(TEXDIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def build_clouds(colv, colc, mats):
    vobjs, cobjs = [], []
    for cb in L.CLOUD_BANKS:
        if not cb.get("vol", True):
            continue
        me = bpy.data.meshes.new(f"CFCL_SkyShatter_CloudVol_{cb['key']}_Mesh")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=2.0)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(f"CFCL_SkyShatter_CloudVol_{cb['key']}", me)
        colv.objects.link(ob)
        me.materials.append(mats["cloudvol"])
        ob.location = cb["c"]
        ob.scale = cb["half"]
        if cb.get("gap"):
            ob.scale = (cb["half"][0], cb["half"][1], cb["half"][2] * 0.8)
        ob.rotation_euler = (0, 0, math.radians(cb["yaw"]))
        ob.visible_shadow = False
        vobjs.append(ob)
    imgs = {k: cloud_texture(k, 900 + i) for i, k in enumerate(("LitRight", "LitLeft", "Backlit", "Storm"))}
    cm = {k: mat_cloud_card(f"CFCL_SkyShatter_CloudCard_{k}", im, 1.0) for k, im in imgs.items()}
    look = np.array((3.0, -22.0, 5.0))
    for cb in L.CLOUD_BANKS:
        for i, (c, w, h, tex) in enumerate(L.cloud_cards(cb)):
            V = np.array([(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)])
            ob = mesh_from(f"CFCL_SkyShatter_CloudCard_{cb['key']}_{i}", V, [(0, 1, 2, 3)], colc, None, (cm[tex],), True)
            uv = ob.data.uv_layers.new(name="UVMap")
            uv.data.foreach_set("uv", np.array([0, 0, 1, 0, 1, 1, 0, 1], F32))
            d = Vector((look - c).tolist())
            ob.rotation_euler = d.to_track_quat("-Y", "Z").to_euler()
            ob.location = Vector(c.tolist())
            cobjs.append(ob)
    return vobjs, cobjs


# =============================================================== build asset
R.reset_scene()
sc = bpy.context.scene
root = new_col(ASSET)
c_dome = new_col("CFCL_SkyShatter_Dome", root)
c_land = new_col("CFCL_SkyShatter_Landmasses", root)
c_strm = new_col("CFCL_SkyShatter_DebrisStreams", root)
c_cvol = new_col("CFCL_SkyShatter_Clouds_Volume", root)
c_ccrd = new_col("CFCL_SkyShatter_Clouds_Cards", root)
c_mech = new_col("CFCL_SkyShatter_Mechanism", root)
MATS = {"sky": mat_sky_face(), "under": mat_underside(), "rim": mat_rim(), "beyond": mat_beyond(), "rock": mat_rock(),
        "ruin": mat_stone(), "root": mat_flat("CFCL_SkyShatter_Root", (0.05, 0.038, 0.03)),
        "chip_rock": mat_stone("CFCL_SkyShatter_ChipRock", (0.035, 0.033, 0.032), (0.16, 0.145, 0.13), 0.9),
        "chip_mason": mat_stone("CFCL_SkyShatter_ChipMasonry", (0.10, 0.092, 0.082), (0.26, 0.24, 0.215), 1.2),
        "cloudvol": mat_cloud_volume(), "ring_stone": mat_ring_stone(), "ring_metal": mat_ring_metal(),
        "masonry": mat_masonry(), "carved": mat_masonry("CFCL_SkyShatter_CarvedDark", (0.07, 0.066, 0.06),
                                                         (0.14, 0.132, 0.12), joints=False)}
for _k in ("rock", "ruin", "root", "masonry", "carved"):          # far variants for the hazier landmass (haze="far")
    MATS[_k + "_far"] = MATS[_k].copy()
    MATS[_k + "_far"].name = MATS[_k].name + "_Far"
    add_aerial(MATS[_k + "_far"], near=40.0, far=460.0, amount=0.9)
for _k in ("rock", "ruin", "root", "masonry", "carved"):
    add_aerial(MATS[_k], amount=0.35)
for _k in ("chip_rock", "chip_mason"):
    add_aerial(MATS[_k])
add_aerial(MATS["under"], amount=0.35)
dome_objs = build_dome(c_dome, MATS)
land_objs = build_landmasses(c_land, MATS)
strm_objs, PTRIS = build_streams(c_strm, MATS)
cvol_objs, ccrd_objs = build_clouds(c_cvol, c_ccrd, MATS)
mech_objs = build_mechanism(c_mech, MATS)
for o in bpy.data.objects:
    o.visible_shadow = False
bpy.context.view_layer.update()

# ---------------------------------------------------------------- stats
groups = {"CFCL_SkyShatter_Dome": dome_objs, "CFCL_SkyShatter_Landmasses": land_objs,
          "CFCL_SkyShatter_DebrisStreams": strm_objs, "CFCL_SkyShatter_Clouds_Volume": cvol_objs,
          "CFCL_SkyShatter_Clouds_Cards": ccrd_objs, "CFCL_SkyShatter_Mechanism": mech_objs}
meta_objs = []
tot = {}
for g, obs in groups.items():
    s_ = 0
    for o in obs:
        if o.name.startswith("CFCL_SkyShatter_Stream_") or o.name.startswith("CFCL_SkyShatter_Trail_"):
            t_real = int(sum(PTRIS))  # prototypes counted once per object (stored in the object's mesh)
            inst = int(sum(PTRIS[k] for k in np.asarray(
                [v.value for v in o.data.attributes["cf_proto"].data])[:o["cf_instances"]]))
        else:
            t_real = R.tri_count([o])
            inst = 0
        mn, mx = R.bounds([o])
        meta_objs.append({"name": o.name, "collection": g, "tris": t_real, "instanced_tris": inst,
                          "instances": int(o.get("cf_instances", 0)),
                          "bounds_min": [round(v, 1) for v in mn], "bounds_max": [round(v, 1) for v in mx],
                          "materials": [m.name for m in o.data.materials if m]})
        s_ += t_real
    tot[g] = s_
LOG["tris_by_collection"] = tot
LOG["tris_total_unique"] = int(sum(tot.values()))
LOG["tris_cinematic_unique"] = int(sum(v for k, v in tot.items() if k != "CFCL_SkyShatter_Clouds_Cards"))
LOG["tris_runtime_unique"] = int(sum(v for k, v in tot.items() if k != "CFCL_SkyShatter_Clouds_Volume"))
LOG["instanced_tris_total"] = int(sum(o["instanced_tris"] for o in meta_objs))
log("tris", tot, "total", LOG["tris_total_unique"], "instanced", LOG["instanced_tris_total"])

blend = os.path.join(ADIR, f"{ASSET}_v{VER:03d}.blend")
NOSAVE = bool(args.get("nosave"))      # check renders only: never overwrite a saved version / its meta
if not NOSAVE:
    bpy.ops.wm.save_as_mainfile(filepath=blend, copy=True, compress=True)
    log("SAVED", blend)
coll_names = list(groups)
arr = lambda cols: {"asset": ASSET, "blend": os.path.basename(blend), "units": "world metres (append unscaled)",
                    "placements": [{"source": "COLLECTION:" + c, "name": c, "location": [0, 0, 0],
                                    "rotation_deg": [0, 0, 0], "scale": 1.0} for c in cols]}
if NOSAVE:
    ADIR = os.path.join(RDIR, "_nosave_meta")
    os.makedirs(ADIR, exist_ok=True)
SFX = "_stage" if args.get("stage") else ""     # staged: main build keeps reading the validated arrangement.json
R.write_json(os.path.join(ADIR, f"arrangement{SFX}.json"), arr(coll_names))
R.write_json(os.path.join(ADIR, f"arrangement_runtime{SFX}.json"),
             arr([c for c in coll_names if c != "CFCL_SkyShatter_Clouds_Volume"]))
R.write_json(os.path.join(ADIR, f"meta{SFX}.json"), {
    "asset": ASSET, "version": VER, "blend": os.path.basename(blend), "units": "world metres, +Z up, board centre = origin",
    "collections": {
        "CFCL_SkyShatter_Dome": "both profiles (vertex colours carry the sky painting; beyond = vertex colour x cf_glow)",
        "CFCL_SkyShatter_Landmasses": "both profiles (procedural rock/stone shaders over vertex colours; bake for GLB)",
        "CFCL_SkyShatter_DebrisStreams": "both profiles (Geometry-Nodes instances of 10 chip prototypes)",
        "CFCL_SkyShatter_Mechanism": "both profiles (celestial mechanism: 3 broken concentric rings 1.36R/1.68R/2.45R, spokes, foundation blocks, drifting pieces; cf_uv attribute drives the carving/rivets)",
        "CFCL_SkyShatter_Clouds_Volume": "CINEMATIC ONLY (EEVEE volumes: 2 high banks + split horizon haze)",
        "CFCL_SkyShatter_Clouds_Cards": "both profiles (alpha cards, baked PNG textures, packed); the only clouds at runtime"},
    "arrangements": {"arrangement.json": "cinematic (cards + volumes)", "arrangement_runtime.json": "runtime (cards, no volumes)"},
    "epicentre_point": [round(float(v), 2) for v in L.EPI_POINT], "dome_radius": L.DOME_R, "beyond_radius": L.BEYOND_R,
    "stats": LOG, "objects": meta_objs})

# =============================================================== test scene (NOT saved into the asset)
if not args.get("norender"):
    K = 4.6
    DZ = 0.76 * K - 0.054 * (2.3 / 0.08)
    M_ENV = Matrix.Translation((0, 0, DZ)) @ Matrix.Scale(K, 4)
    ov = json.load(open(os.path.join(CL, "layout_overrides.json")))
    LOOK = ov.get("looks", {}).get("cinematic", {})
    R.setup_render(sc, "EEVEE", RES, SAMPLES)
    for k_, v_ in (("volumetric_end", 90.0 * K), ("volumetric_tile_size", "4"), ("volumetric_samples", 64),
                   ("volumetric_light_clamp", 0.0), ("shadow_resolution_scale", 1.0)):
        try:
            setattr(sc.eevee, k_, v_)
        except Exception:
            pass
    tst = new_col("CF_TEST_STANDINS")
    atm = new_col("CF_TEST_ATMOS")
    A.build_world(sc, palette=LOOK.get("world"))
    before = set(bpy.data.objects)
    A.build_eclipse(atm)
    A.build_light_rig(atm)
    for o in set(bpy.data.objects) - before:
        if o.parent is None:
            o.matrix_world = M_ENV @ o.matrix_world
        if o.type == "LIGHT":
            d = o.data
            if d.type in ("POINT", "SPOT", "AREA"):
                d.energy *= K * K * (0.22 if "Lava" in o.name else 1.0)
                if d.type == "AREA":
                    d.size *= K
                else:
                    d.shadow_soft_size *= K
    for n_, mul in LOOK.get("light_mult", {}).items():
        o = bpy.data.objects.get(n_)
        if o:
            o.data.energy *= mul
    for n_, c_ in LOOK.get("light_color", {}).items():
        o = bpy.data.objects.get(n_)
        if o:
            o.data.color = c_
    for n_ in LOOK.get("hide_lights", []):
        o = bpy.data.objects.get(n_)
        if o:
            o.hide_render = True
    sc.view_settings.exposure = LOOK.get("exposure", 0.0)
    fog = A.build_fog_volume(atm, center=(0, 22 * K, 4 * K + DZ), size=(160 * K, 160 * K, 40 * K),
                             density=ov.get("fog_density", 0.03) / K, z_ref=-4.0 * K + DZ, falloff=5.0 * K,
                             color=tuple(LOOK.get("fog_color", (0.4, 0.58, 0.56))),
                             anisotropy=LOOK.get("fog_anisotropy", 0.3))
    fm = bpy.data.materials.get("CFCL_Fog")       # main-build radial layering (clear near the arena)
    nt = fm.node_tree
    for nd in list(nt.nodes):
        if nd.type == "PRINCIPLED_VOLUME":
            b = NB(fm)
            g = b.n("ShaderNodeNewGeometry")
            sp = b.n("ShaderNodeSeparateXYZ")
            b.link(g.outputs["Position"], sp.inputs[0])
            cb_ = b.n("ShaderNodeCombineXYZ")
            b.link(sp.outputs["X"], cb_.inputs["X"])
            b.link(sp.outputs["Y"], cb_.inputs["Y"])
            ln = b.vmath("LENGTH", cb_.outputs[0])
            mr = b.maprange(ln, LOOK.get("fog_clear_r", 30.0), LOOK.get("fog_full_r", 170.0),
                            LOOK.get("fog_near_mult", 0.12), 1.0, smooth=True)
            src = nd.inputs["Density"].links[0].from_socket
            nt.links.remove(nd.inputs["Density"].links[0])
            b.link(b.math("MULTIPLY", src, mr), nd.inputs["Density"])

    def standin(name, kind, loc, scale, rgb, rot=(0, 0, 0), **kw):
        if kind == "cube":
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
        elif kind == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.0, location=loc)
        elif kind == "cyl":
            bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get("v", 24), radius=1.0, depth=1.0, location=loc)
        o = bpy.context.active_object
        o.name = name
        o.scale = scale
        o.rotation_euler = [math.radians(a) for a in rot]
        for c_ in list(o.users_collection):
            c_.objects.unlink(o)
        tst.objects.link(o)
        o.data.materials.append(mat_flat("CFT_" + name, rgb, 0.8))
        return o

    standin("CFT_Ground", "cyl", (0, 0, -6.0), (1200, 1200, 4), (0.035, 0.032, 0.03), v=64)
    standin("CFT_Dais", "cyl", (0, 0, -2.2), (16, 16, 4.2), (0.09, 0.085, 0.08), v=48)
    brd = standin("CFT_Board", "cube", (0, 0, -0.75), (21.85, 21.85, 1.5), (0.5, 0.5, 0.5))
    bm_ = brd.data.materials[0]
    b = NB(bm_)
    chk = b.n("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = 4.0
    chk.inputs["Color1"].default_value = (0.62, 0.58, 0.52, 1)
    chk.inputs["Color2"].default_value = (0.16, 0.14, 0.12, 1)
    tcb = b.n("ShaderNodeTexCoord")
    b.link(tcb.outputs["Generated"], chk.inputs["Vector"])
    pr = [n_ for n_ in b.N if n_.type == "BSDF_PRINCIPLED"][0]
    b.link(chk.outputs["Color"], pr.inputs["Base Color"])
    standin("CFT_Skull", "sphere", (-12.5, 44.0, 6.2), (6.6, 6.0, 6.0), (0.36, 0.34, 0.30))
    standin("CFT_SkullJaw", "cube", (-12.0, 41.0, 1.2), (8, 5, 3.5), (0.32, 0.30, 0.27))
    HX = 4.0   # hand moved ~4 m +X in world (user note 2026-10-24)
    for nm, a, b2, r_ in (("Forearm", (21.5 + HX, 46.5, -1), (19.5 + HX, 47.0, 17), 3.2),):
        mid = (np.array(a) + np.array(b2)) / 2
        o = standin("CFT_Hand" + nm, "cyl", tuple(mid), (r_, r_, float(np.linalg.norm(np.array(b2) - np.array(a)))),
                    (0.17, 0.19, 0.16))
        o.rotation_euler = Vector(tuple(np.array(b2) - np.array(a))).to_track_quat("Z", "Y").to_euler()
    standin("CFT_HandPalm", "cube", (18.8 + HX, 47.0, 21.5), (8.5, 3.2, 9.5), (0.17, 0.19, 0.16), rot=(0, -12, 0))
    for i, (x0, top) in enumerate(((15.6 + HX, 33.5), (17.8 + HX, 34.5), (20.0 + HX, 32.0), (22.0 + HX, 28.5))):
        a, b2 = np.array((x0 + 0.8, 47.0, 25.5)), np.array((x0 - 1.8, 47.0, top))
        mid = (a + b2) / 2
        o = standin(f"CFT_HandFinger{i}", "cyl", tuple(mid), (1.1, 1.1, float(np.linalg.norm(b2 - a))), (0.17, 0.19, 0.16))
        o.rotation_euler = Vector(tuple(b2 - a)).to_track_quat("Z", "Y").to_euler()
    # low far ridges for a horizon line
    rng = np.random.default_rng(5)
    for i in range(26):
        a = rng.uniform(-math.pi, math.pi)
        r = rng.uniform(170, 420)
        standin(f"CFT_Ridge{i}", "cube", (math.cos(a) * r, math.sin(a) * r, -6), (rng.uniform(40, 110), rng.uniform(25, 60),
                rng.uniform(10, 34)), (0.05, 0.045, 0.04), rot=(0, 0, math.degrees(a) + 90))
    for o in tst.objects:
        o.visible_shadow = True
    try:
        sc.eevee.shadow_pool_size = "2048"
    except Exception:
        pass
    renders = {}
    rt_cams = [c for c in str(args.get("runtime_cams", "worm")).split(",") if c]
    passes = [(cn, "cinematic") for cn in CAMS] + [(cn, "runtime") for cn in rt_cams]
    for cn, prof in passes:
        c_cvol.hide_render = prof != "cinematic"
        c_ccrd.hide_render = False
        loc, tgt, lens = L.CAMS[cn]
        cam = bpy.data.objects.get("CFT_CAM_" + cn) or R.camera("CFT_CAM_" + cn, loc, tgt, lens)
        cam.data.clip_end = 4000
        suffix = "" if prof == "cinematic" else "_runtime"
        p_ = os.path.join(RDIR, f"iter{ITER:02d}_{cn}{suffix}.png")
        t1 = time.time()
        R.render_to(p_, cam)
        renders[cn + "_" + prof] = {"path": p_, "s": round(time.time() - t1, 1)}
        log("rendered", cn, prof, renders[cn + "_" + prof])
    LOG["renders"] = renders
LOG["seconds"] = round(time.time() - t_start, 1)
R.write_json(os.path.join(RDIR, f"iter{ITER:02d}_log.json"), LOG)
log("DONE", json.dumps({k: LOG[k] for k in ("tris_by_collection", "tris_total_unique", "instanced_tris_total", "seconds")}))
