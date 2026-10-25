"""Crownfall (Claude track) - sky, eclipse, atmosphere and light rig.

build_world(scene)        : green-grey sky gradient + warm glow toward the eclipse + world fog volume
build_eclipse(col, ...)   : black body, white-hot thin rim, painterly asymmetric corona, smoke wisps, embers/shards
build_light_rig(col, ...) : eclipse rim sun, cool sky fill, sacred shaft on the board, lava bounce lights
build_lava_mist(col, ...) : low warm-lit volumetric mist layer above the abyss

All positions follow the Claude-track layout contract (board centre = origin).
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector

# Shared layout (Codex-compatible, research §6c ideal). Codex current: (0,19,6.05) r~1.9
ECLIPSE_POS = Vector((0.85, 20.0, 6.2))  # v010: bigger disc -> shift left/up to keep the hand gap and clear the gate crown  # v007: x 3.0->1.5 so the disc stays clear of the (now x1.25) hand in hero + worm views  # x 3.95 -> 3.0 keeps a ~4% W gap from the hand fingertips (pass01)
ECLIPSE_R = 2.7  # v010 critic: disc 9.7% W -> ~13% W


def _mat(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m


def _link(nt, a, ao, b, bi):
    nt.links.new(a.outputs[ao], b.inputs[bi])


def _math(nt, op, a=None, b=None, loc=(0, 0), clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    n.location = loc
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n


# --------------------------------------------------------------------- world
def build_world(scene=None, fog_density=0.0, eclipse_dir=None, palette=None):
    """NOTE: EEVEE treats world volumes as infinite (they swallow the sky) - keep fog_density=0 and use build_fog_volume()."""
    sc = scene or bpy.context.scene
    pal = palette or {}
    w = bpy.data.worlds.get("CFCL_World") or bpy.data.worlds.new("CFCL_World")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    edir = (eclipse_dir or (ECLIPSE_POS - Vector((0, 0, 1.0)))).normalized()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1200, 0)
    # view direction for world = Generated coords (normalised direction)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-1000, 200)
    _link(nt, tc, "Generated", sep, 0)
    # vertical gradient: horizon haze (green-grey) -> zenith (darker teal-charcoal)
    zr = nt.nodes.new("ShaderNodeMapRange")
    zr.location = (-800, 200)
    zr.inputs["From Min"].default_value = -0.15
    zr.inputs["From Max"].default_value = 0.75
    _link(nt, sep, "Z", zr, "Value")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-600, 200)
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.0, (*pal.get('below', (0.085, 0.070, 0.060)), 1)    # warm-dark below horizon (abyss glow haze)
    el[1].position, el[1].color = 1.0, (*pal.get('zenith', (0.026, 0.038, 0.046)), 1)    # zenith
    e = el.new(0.22)
    e.color = (*pal.get('horizon', (0.185, 0.225, 0.215)), 1)                              # horizon green-grey haze
    e = el.new(0.5)
    e.color = (*pal.get('mid', (0.092, 0.115, 0.118)), 1)
    _link(nt, zr, "Result", ramp, "Fac")
    # eclipse glow: dot(dir, eclipse_dir)
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.location = (-800, -200)
    _link(nt, tc, "Generated", dot, 0)
    dot.inputs[1].default_value = edir
    g1 = _math(nt, "POWER", dot.outputs["Value"], 60.0, (-600, -200), clamp=False)
    g2 = _math(nt, "POWER", dot.outputs["Value"], 8.0, (-600, -350))
    g1c = _math(nt, "MAXIMUM", g1.outputs[0], 0.0, (-450, -200))
    g2c = _math(nt, "MAXIMUM", g2.outputs[0], 0.0, (-450, -350))
    gsum = _math(nt, "ADD", _math(nt, "MULTIPLY", g1c.outputs[0], 1.6, (-300, -200)).outputs[0],
                 _math(nt, "MULTIPLY", g2c.outputs[0], 0.25, (-300, -350)).outputs[0], (-150, -250))
    glow_col = nt.nodes.new("ShaderNodeMix")
    glow_col.data_type = "RGBA"
    glow_col.blend_type = "ADD"
    glow_col.location = (0, 0)
    glow_col.clamp_factor = True
    _link(nt, gsum, 0, glow_col, 0)
    _link(nt, ramp, "Color", glow_col, 6)
    glow_col.inputs[7].default_value = (*pal.get('glow', (0.42, 0.22, 0.09)), 1)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (250, 0)
    bg.inputs["Strength"].default_value = 1.0
    sky_out = glow_col.outputs[2]
    if pal.get("clouds", 0) > 0:
        # project view direction onto a cloud deck: (x/z, y/z) -> layered fBm, two decks at different scales
        zc = _math(nt, "MAXIMUM", sep.outputs["Z"], 0.06, (-800, 500))
        cx = _math(nt, "DIVIDE", sep.outputs["X"], zc.outputs[0], (-650, 560))
        cy = _math(nt, "DIVIDE", sep.outputs["Y"], zc.outputs[0], (-650, 460))
        cv = nt.nodes.new("ShaderNodeCombineXYZ"); cv.location = (-500, 500)
        nt.links.new(cx.outputs[0], cv.inputs["X"]); nt.links.new(cy.outputs[0], cv.inputs["Y"])
        layers = []
        for i, (sc_, det, dis) in enumerate(((pal.get("cloud_scale", 1.4), 6.0, 1.2), (pal.get("cloud_scale", 1.4) * 3.1, 4.0, 0.6))):
            nz = nt.nodes.new("ShaderNodeTexNoise"); nz.location = (-350, 600 - 160 * i)
            nz.inputs["Scale"].default_value = sc_; nz.inputs["Detail"].default_value = det
            nz.inputs["Roughness"].default_value = 0.62; nz.inputs["Distortion"].default_value = dis
            if nz.inputs.get("W") is not None:
                nz.inputs["W"].default_value = 0.37 * (i + 1)
            nt.links.new(cv.outputs[0], nz.inputs["Vector"])
            mr = nt.nodes.new("ShaderNodeMapRange"); mr.location = (-180, 600 - 160 * i)
            mr.inputs["From Min"].default_value = 0.42 + 0.06 * i; mr.inputs["From Max"].default_value = 0.70
            nt.links.new(nz.outputs["Fac"], mr.inputs["Value"])
            layers.append(mr.outputs["Result"])
        cm = _math(nt, "MAXIMUM", layers[0], layers[1], (0, 560))
        # fade clouds near the horizon (haze) and keep them off the eclipse glow
        hz = nt.nodes.new("ShaderNodeMapRange"); hz.location = (0, 420)
        hz.inputs["From Min"].default_value = 0.03; hz.inputs["From Max"].default_value = 0.28
        nt.links.new(sep.outputs["Z"], hz.inputs["Value"])
        gl = _math(nt, "SUBTRACT", 1.0, _math(nt, "MINIMUM", gsum.outputs[0], 1.0, (0, 300)).outputs[0], (150, 300))
        cf = _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", cm.outputs[0], hz.outputs["Result"], (150, 500)).outputs[0],
                   gl.outputs[0], (300, 480))
        cfs = _math(nt, "MULTIPLY", cf.outputs[0], pal.get("clouds", 0.8), (450, 480), clamp=True)
        mixc = nt.nodes.new("ShaderNodeMix"); mixc.data_type = "RGBA"; mixc.location = (600, 300); mixc.clamp_factor = True
        nt.links.new(cfs.outputs[0], mixc.inputs[0]); nt.links.new(glow_col.outputs[2], mixc.inputs[6])
        mixc.inputs[7].default_value = (*pal.get("cloud_color", (0.035, 0.042, 0.055)), 1)
        sky_out = mixc.outputs[2]
    nt.links.new(sky_out, bg.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (500, 0)
    _link(nt, bg, "Background", out, "Surface")
    if fog_density > 0:
        vol = nt.nodes.new("ShaderNodeVolumePrincipled")
        vol.location = (250, -300)
        vol.inputs["Density"].default_value = fog_density
        vol.inputs["Color"].default_value = (0.55, 0.62, 0.58, 1)
        vol.inputs["Anisotropy"].default_value = 0.45
        _link(nt, vol, "Volume", out, "Volume")
    return w


# ------------------------------------------------------------------- eclipse
def _corona_material(radius=None):
    radius = radius or ECLIPSE_R
    m = _mat("CFCL_EclipseCorona")
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    nt = m.node_tree
    N = nt.nodes
    tc = N.new("ShaderNodeTexCoord")
    tc.location = (-1800, 0)
    sep = N.new("ShaderNodeSeparateXYZ")
    sep.location = (-1600, 0)
    _link(nt, tc, "Object", sep, 0)
    # r normalised by disc radius
    rlen = N.new("ShaderNodeVectorMath")
    rlen.operation = "LENGTH"
    rlen.location = (-1600, -200)
    _link(nt, tc, "Object", rlen, 0)
    r = _math(nt, "DIVIDE", rlen.outputs["Value"], radius, (-1400, -200))
    # unit direction (cos, sin) -> 3D sample coords for seamless angular noise
    cs = _math(nt, "DIVIDE", sep.outputs["X"], rlen.outputs["Value"], (-1400, 100))
    sn = _math(nt, "DIVIDE", sep.outputs["Y"], rlen.outputs["Value"], (-1400, 0))
    # streak coords: high angular freq, low radial freq -> radial flame streaks
    comb = N.new("ShaderNodeCombineXYZ")
    comb.location = (-1200, 100)
    _link(nt, _math(nt, "MULTIPLY", cs.outputs[0], 7.0, (-1300, 150)), 0, comb, "X")
    _link(nt, _math(nt, "MULTIPLY", sn.outputs[0], 7.0, (-1300, 50)), 0, comb, "Y")
    _link(nt, _math(nt, "MULTIPLY", r.outputs[0], 1.1, (-1300, -50)), 0, comb, "Z")
    streak = N.new("ShaderNodeTexNoise")
    streak.location = (-1000, 100)
    streak.inputs["Scale"].default_value = 1.0
    streak.inputs["Detail"].default_value = 12.0
    streak.inputs["Roughness"].default_value = 0.62
    streak.inputs["Distortion"].default_value = 1.1
    _link(nt, comb, "Vector", streak, "Vector")
    # arcs: low angular freq -> 2-3 brighter flaring arcs (asymmetric, upper-right biased)
    comb2 = N.new("ShaderNodeCombineXYZ")
    comb2.location = (-1200, -350)
    _link(nt, _math(nt, "MULTIPLY", cs.outputs[0], 1.3, (-1300, -300)), 0, comb2, "X")
    _link(nt, _math(nt, "MULTIPLY", sn.outputs[0], 1.3, (-1300, -400)), 0, comb2, "Y")
    comb2.inputs["Z"].default_value = 4.7
    arcs = N.new("ShaderNodeTexNoise")
    arcs.location = (-1000, -350)
    arcs.inputs["Scale"].default_value = 1.0
    arcs.inputs["Detail"].default_value = 1.0
    _link(nt, comb2, "Vector", arcs, "Vector")
    bias = _math(nt, "ADD", _math(nt, "MULTIPLY", _math(nt, "ADD", cs.outputs[0], sn.outputs[0], (-1100, -550)).outputs[0],
                                       0.12, (-950, -550)).outputs[0], arcs.outputs["Fac"], (-800, -450))  # v022: 0.45 -> 0.12, near-360 corona
    arcw = N.new("ShaderNodeMapRange")
    arcw.location = (-650, -400)
    arcw.inputs["From Min"].default_value = 0.35
    arcw.inputs["From Max"].default_value = 0.85
    arcw.inputs["To Min"].default_value = 0.25
    arcw.inputs["To Max"].default_value = 1.9
    _link(nt, bias, 0, arcw, "Value")
    # radial falloff: d = r-1 ; core rim exp(-d*40), glow exp(-d*5*shape), halo exp(-d*1.4)
    d = _math(nt, "SUBTRACT", r.outputs[0], 1.0, (-1200, -700))
    dpos = _math(nt, "MAXIMUM", d.outputs[0], 0.0, (-1050, -700))
    inside = _math(nt, "LESS_THAN", r.outputs[0], 0.995, (-1050, -850))
    rim = _math(nt, "EXPONENT", _math(nt, "MULTIPLY", dpos.outputs[0], -55.0, (-900, -700)).outputs[0], None, (-750, -700))
    # streak-modulated reach: streaks push the flame further out
    # v019 (user review): irregular PLASMA strands - sharpen the streak field so filaments separate with dark gaps
    streak_p = _math(nt, "POWER", _math(nt, "MAXIMUM", streak.outputs["Fac"], 0.0, (-1050, -1000)).outputs[0], 2.4, (-950, -1000))
    reach = _math(nt, "MULTIPLY", dpos.outputs[0],
                  _math(nt, "SUBTRACT", 7.5, _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", streak_p.outputs[0], 2.6, (-900, -1050)).outputs[0], 7.0, (-900, -950)).outputs[0], (-750, -950)).outputs[0],
                  (-600, -900))
    flame = _math(nt, "EXPONENT", _math(nt, "MULTIPLY", reach.outputs[0], -1.0, (-450, -900)).outputs[0], None, (-300, -900))
    halo = _math(nt, "EXPONENT", _math(nt, "MULTIPLY", dpos.outputs[0], -1.6, (-450, -1100)).outputs[0], None, (-300, -1100))
    flame_a0 = _math(nt, "MULTIPLY", flame.outputs[0], arcw.outputs["Result"], (-150, -850))
    # intermittent GAPS in the corona: a low-frequency angular mask drops some sectors to ~20 %
    comb3 = N.new("ShaderNodeCombineXYZ"); comb3.location = (-1200, -1600)
    _link(nt, _math(nt, "MULTIPLY", cs.outputs[0], 2.3, (-1300, -1550)), 0, comb3, "X")
    _link(nt, _math(nt, "MULTIPLY", sn.outputs[0], 2.3, (-1300, -1650)), 0, comb3, "Y")
    comb3.inputs["Z"].default_value = 11.3
    gapn = N.new("ShaderNodeTexNoise"); gapn.location = (-1000, -1600)
    gapn.inputs["Scale"].default_value = 1.0; gapn.inputs["Detail"].default_value = 2.0
    _link(nt, comb3, "Vector", gapn, "Vector")
    gapm = N.new("ShaderNodeMapRange"); gapm.location = (-800, -1600)
    gapm.inputs["From Min"].default_value = 0.38; gapm.inputs["From Max"].default_value = 0.52
    gapm.inputs["To Min"].default_value = 0.2; gapm.inputs["To Max"].default_value = 1.0
    _link(nt, gapn, "Fac", gapm, "Value")
    flame_a = _math(nt, "MULTIPLY", flame_a0.outputs[0], gapm.outputs["Result"], (-50, -900))
    tot = _math(nt, "ADD", _math(nt, "ADD", _math(nt, "MULTIPLY", rim.outputs[0], 1.0, (0, -650)).outputs[0],
                                 flame_a.outputs[0], (150, -750)).outputs[0],
                _math(nt, "MULTIPLY", halo.outputs[0], 0.12, (0, -1100)).outputs[0], (300, -850))
    # fade to zero well before the card edge (card half-size = 3R)
    edge = N.new("ShaderNodeMapRange")
    edge.location = (150, -1250)
    edge.inputs["From Min"].default_value = 1.9
    edge.inputs["From Max"].default_value = 2.85
    edge.inputs["To Min"].default_value = 1.0
    edge.inputs["To Max"].default_value = 0.0
    _link(nt, r, 0, edge, "Value")
    # asymmetric burst lobe toward upper-right (like the reference's fiery eruption)
    lobe_d = _math(nt, "ADD", _math(nt, "MULTIPLY", cs.outputs[0], 0.62, (-200, -1350)).outputs[0],
                   _math(nt, "MULTIPLY", sn.outputs[0], 0.78, (-200, -1450)).outputs[0], (-50, -1400))
    lobe = _math(nt, "POWER", _math(nt, "MAXIMUM", lobe_d.outputs[0], 0.0, (100, -1400)).outputs[0], 3.0, (250, -1400))
    # v022 (critic: corona one-sided): keep only a hint of the upper-right eruption (was 0.6 + 1.1*lobe)
    lobe_m = _math(nt, "ADD", 0.88, _math(nt, "MULTIPLY", lobe.outputs[0], 0.42, (400, -1400)).outputs[0], (550, -1400))
    tot_l = _math(nt, "MULTIPLY", tot.outputs[0], lobe_m.outputs[0], (450, -1150))
    tot_e = _math(nt, "MULTIPLY", tot_l.outputs[0], edge.outputs["Result"], (600, -1150))
    tot_out = _math(nt, "MULTIPLY", tot_e.outputs[0], _math(nt, "SUBTRACT", 1.0, inside.outputs[0], (150, -1000)).outputs[0], (450, -850))
    # colour by intensity
    cr = N.new("ShaderNodeValToRGB")
    cr.location = (650, -600)
    el = cr.color_ramp.elements
    el[0].position, el[0].color = 0.0, (0.16, 0.06, 0.03, 1)
    el[1].position, el[1].color = 1.0, (1.0, 0.93, 0.78, 1)
    e = el.new(0.3)
    e.color = (0.78, 0.20, 0.03, 1)   # deeper ember-orange body (user: more deep orange)
    e = el.new(0.8)
    e.color = (0.98, 0.58, 0.18, 1)   # ember gold; cream only at the very top
    _link(nt, _math(nt, "MINIMUM", tot_out.outputs[0], 1.0, (600, -850)), 0, cr, "Fac")
    em = N.new("ShaderNodeEmission")
    em.location = (950, -600)
    _link(nt, cr, "Color", em, "Color")
    _link(nt, _math(nt, "MULTIPLY", tot_out.outputs[0], 4.4, (800, -850)), 0, em, "Strength")
    tr = N.new("ShaderNodeBsdfTransparent")
    tr.location = (950, -400)
    add = N.new("ShaderNodeAddShader")
    add.location = (1150, -500)
    _link(nt, tr, 0, add, 0)
    _link(nt, em, 0, add, 1)
    out = N.new("ShaderNodeOutputMaterial")
    out.location = (1350, -500)
    _link(nt, add, 0, out, "Surface")
    return m


def _disc_material():
    m = _mat("CFCL_EclipseBody")
    nt = m.node_tree
    N = nt.nodes
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.004, 0.003, 0.003, 1)
    b.inputs["Roughness"].default_value = 0.9
    lw = N.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.08
    p = _math(nt, "POWER", lw.outputs["Facing"], 6.0, (-200, -300))
    b.inputs["Emission Color"].default_value = (1.0, 0.35, 0.08, 1)
    rimE = _math(nt, "MULTIPLY", p.outputs[0], 6.0, (0, -300))
    em2 = N.new("ShaderNodeEmission")
    em2.inputs["Color"].default_value = (0.36, 0.35, 0.34, 1)
    em2.inputs["Strength"].default_value = 0.0   # v010: flat black disc (haze comes from the fog in front)
    nt.links.new(rimE.outputs[0], b.inputs["Emission Strength"])
    addh = N.new("ShaderNodeAddShader")
    nt.links.new(b.outputs["BSDF"], addh.inputs[0])
    nt.links.new(em2.outputs[0], addh.inputs[1])
    out = N.new("ShaderNodeOutputMaterial")
    _link(nt, addh, 0, out, "Surface")
    return m


def _smoke_material():
    m = _mat("CFCL_EclipseSmoke")
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    nt = m.node_tree
    N = nt.nodes
    tc = N.new("ShaderNodeTexCoord")
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.08
    nz.inputs["Detail"].default_value = 6.0
    nz.inputs["Distortion"].default_value = 1.5
    _link(nt, tc, "Object", nz, "Vector")
    # radial fade on the card (Generated 0..1)
    sep = N.new("ShaderNodeSeparateXYZ")
    _link(nt, tc, "Generated", sep, 0)
    dx = _math(nt, "SUBTRACT", sep.outputs["X"], 0.5)
    dy = _math(nt, "SUBTRACT", sep.outputs["Y"], 0.5)
    rr = _math(nt, "SQRT", _math(nt, "ADD", _math(nt, "MULTIPLY", dx.outputs[0], dx.outputs[0]).outputs[0],
                                 _math(nt, "MULTIPLY", dy.outputs[0], dy.outputs[0]).outputs[0]).outputs[0])
    fade = _math(nt, "SUBTRACT", 1.0, _math(nt, "MULTIPLY", rr.outputs[0], 2.0).outputs[0], clamp=True)
    mr = N.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.42
    mr.inputs["From Max"].default_value = 0.62
    _link(nt, nz, "Fac", mr, "Value")
    alpha = _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", mr.outputs["Result"], fade.outputs[0]).outputs[0], 1.0, clamp=True)
    pb = N.new("ShaderNodeBsdfPrincipled")
    pb.inputs["Base Color"].default_value = (0.018, 0.016, 0.015, 1)
    pb.inputs["Roughness"].default_value = 1.0
    tr = N.new("ShaderNodeBsdfTransparent")
    mix = N.new("ShaderNodeMixShader")
    _link(nt, alpha, 0, mix, 0)
    _link(nt, tr, 0, mix, 1)
    _link(nt, pb, 0, mix, 2)
    out = N.new("ShaderNodeOutputMaterial")
    _link(nt, mix, 0, out, "Surface")
    return m


def _ember_material():
    m = _mat("CFCL_EclipseEmber")
    nt = m.node_tree
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.42, 0.10, 1)
    em.inputs["Strength"].default_value = 18.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    _link(nt, em, 0, out, "Surface")
    return m


def _face_toward(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def build_eclipse(col, pos=ECLIPSE_POS, radius=ECLIPSE_R, face_target=(0, -1.0, 0.5), seed=7):
    rnd = random.Random(seed)
    k = radius / 14.0  # sizes below were authored for r=14
    objs = []
    # body
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=radius, location=pos)
    body = bpy.context.active_object
    body.name = "CFCL_Eclipse_Body"
    body.data.materials.append(_disc_material())
    body.data.shade_smooth()
    objs.append(body)
    # corona card (behind body centre, facing camera)
    size = radius * 6.0
    bpy.ops.mesh.primitive_plane_add(size=size, location=pos)
    cor = bpy.context.active_object
    cor.name = "CFCL_Eclipse_Corona"
    _face_toward(cor, face_target)
    cor.location = Vector(pos) + (Vector(pos) - Vector(face_target)).normalized() * (radius * 0.2)
    cor.data.materials.append(_corona_material(radius))
    cor.visible_shadow = False
    objs.append(cor)
    # smoke wisps partially occluding corona (in front of it, slightly)
    smoke = _smoke_material()
    for i in range(5):
        a = rnd.uniform(0, 2 * math.pi)
        rr = radius * rnd.uniform(0.9, 1.9)
        off = Vector((math.cos(a) * rr, 0, math.sin(a) * rr * 0.8))
        bpy.ops.mesh.primitive_plane_add(size=radius * rnd.uniform(1.6, 2.8),
                                         location=Vector(pos) + off + Vector((0, -radius * 1.2, 0)))
        s = bpy.context.active_object
        s.name = f"CFCL_Eclipse_Smoke_{i:02d}"
        _face_toward(s, face_target)
        s.rotation_euler.rotate_axis("Z", rnd.uniform(0, 6.28))
        s.data.materials.append(smoke)
        s.visible_shadow = False
        objs.append(s)
    # embers + dark shards in one mesh each (cheap)
    bm_e = bmesh.new()
    bm_s = bmesh.new()
    M = __import__("mathutils").Matrix
    for i in range(110):
        # sparse sparks rising from the lava channels around the central island (mostly low)
        a = rnd.uniform(0, 2 * math.pi)
        rr = rnd.uniform(1.6, 9.0)
        p = Vector((math.cos(a) * rr, 3 + math.sin(a) * rr * 1.3, -3.5 + 6.5 * rnd.random() ** 2.2))
        bmesh.ops.create_icosphere(bm_e, subdivisions=0, radius=rnd.uniform(0.004, 0.012), matrix=M.Translation(p))
    burst = Vector((0.62, 0.0, 0.78)).normalized()
    for i in range(70):
        # far eruption sparks off the upper-right limb of the eclipse
        a = math.atan2(burst.z, burst.x) + rnd.gauss(0, 0.45)
        rr = radius * rnd.uniform(1.05, 2.3)
        p = Vector(pos) + Vector((math.cos(a) * rr, rnd.uniform(-radius * 0.8, -radius * 0.2), math.sin(a) * rr))
        bmesh.ops.create_icosphere(bm_e, subdivisions=0, radius=rnd.uniform(0.05, 0.16) * k, matrix=M.Translation(p))
    for i in range(28):
        a = math.atan2(burst.z, burst.x) + rnd.gauss(0, 0.6)
        rr = radius * rnd.uniform(1.1, 2.8)
        p = Vector(pos) + Vector((math.cos(a) * rr, rnd.uniform(-radius * 0.5, radius * 0.2), math.sin(a) * rr))
        sz = rnd.uniform(0.15, 1.1) * (1.0 if rnd.random() < 0.85 else 1.7) * k
        res = bmesh.ops.create_icosphere(bm_s, subdivisions=1, radius=sz, matrix=M.Translation(p))
        for v in res["verts"]:
            v.co = p + (v.co - p) * Vector((rnd.uniform(0.4, 1.5), rnd.uniform(0.4, 1.5), rnd.uniform(0.3, 1.7)))
    for name, bm, mat in (("CFCL_Eclipse_Embers", bm_e, _ember_material()), ("CFCL_Eclipse_Shards", bm_s, None)):
        me = bpy.data.meshes.new(name + "_Mesh")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if mat:
            me.materials.append(mat)
            ob.visible_shadow = False
        else:
            sm = bpy.data.materials.get("CFCL_EclipseShard") or bpy.data.materials.new("CFCL_EclipseShard")
            sm.use_nodes = True
            bsdf = sm.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = (0.012, 0.011, 0.010, 1)
                bsdf.inputs["Roughness"].default_value = 0.85
            me.materials.append(sm)
        objs.append(ob)
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
    return objs


# --------------------------------------------------------------- light rig
def _add_light(col, name, kind, loc, energy, color, size=1.0, target=None, rot=None, spot_deg=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.size = size
    elif kind == "SUN":
        ld.angle = math.radians(size)
    elif kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    if kind == "SPOT" and spot_deg:
        ld.spot_size = math.radians(spot_deg)
        ld.spot_blend = 0.6
    ob = bpy.data.objects.new(name, ld)
    col.objects.link(ob)
    ob.location = loc
    if target is not None:
        d = Vector(target) - Vector(loc)
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    elif rot is not None:
        ob.rotation_euler = [math.radians(a) for a in rot]
    return ob


def build_light_rig(col, eclipse_pos=ECLIPSE_POS, board_shaft=True, lava_points=None):
    L = []
    # warm rim from the eclipse (backlight: the scene is lit from behind like the reference)
    L.append(_add_light(col, "CFCL_Sun_EclipseRim", "SUN", eclipse_pos, 1.2, (1.0, 0.66, 0.38), 1.5, target=(0, 0, 0)))
    # raking key from the eclipse side (upper-right-rear, ~33 deg elevation): modelled volumes + cast shadows (pass02 critique #3)
    _ed = Vector((eclipse_pos.x, eclipse_pos.y, 0)); _kz = _ed.length * math.tan(math.radians(30))
    # v007: key light motivated by the eclipse (same azimuth, 30 deg elevation) -> the eclipse rim-lights the world
    L.append(_add_light(col, "CFCL_Sun_EclipseKey", "SUN", (eclipse_pos.x, eclipse_pos.y, _kz), 2.6, (1.0, 0.80, 0.62), 2.5, target=(0, 0, 0)))
    # cool overcast fill from the front-left, low
    L.append(_add_light(col, "CFCL_Sun_CoolFill", "SUN", (15, -40, 28), 0.75, (0.72, 0.84, 0.88), 10.0, target=(0, 6, 0)))
    if board_shaft:
        # sacred shaft: a soft cool-ivory spot from high behind onto the board (god-rays in fog)
        L.append(_add_light(col, "CFCL_Spot_SacredShaft", "SPOT", (0.9, 2.8, 4.6), 700.0, (0.95, 0.92, 0.84), 0.5,
                            target=(0, 0, 0), spot_deg=11))
        # gentle board fill from the player side so squares stay readable
        L.append(_add_light(col, "CFCL_Area_BoardFill", "AREA", (0.0, -1.6, 1.6), 55.0, (0.86, 0.90, 0.92), 1.6, target=(0, 0, 0)))
    pts = lava_points or [((0, 2.2, -2.4), 260.0), ((-2.4, -0.6, -2.4), 180.0), ((2.4, 0.4, -2.4), 180.0),
                          ((-3.2, 6.5, -2.8), 320.0), ((3.6, 7.5, -2.8), 320.0), ((0, -2.4, -2.6), 140.0)]
    for i, (p, e) in enumerate(pts):
        L.append(_add_light(col, f"CFCL_Point_LavaGlow_{i:02d}", "POINT", p, e, (1.0, 0.28, 0.06), 3.0))
    # two red area lights 1-1.5 m below the altar rim near the hero bottom corners, aimed up (under-lighting)
    for i, x in enumerate((-2.9, 2.9)):
        L.append(_add_light(col, f"CFCL_Area_LavaUnder_{i}", "AREA", (x, 1.2, -2.1), 420.0, (1.0, 0.24, 0.06), 2.5, rot=(180, 0, 0)))
    return L


def build_lava_mist(col, z0=-6.0, z1=-0.6, extent=60.0, density=0.12, center_y=8.0, noise_scale=0.12):
    """Height-faded volumetric mist above the lava (thicker low, gone by z1)."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, center_y, (z0 + z1) / 2))
    cube = bpy.context.active_object
    cube.name = "CFCL_LavaMist_Volume"
    cube.scale = (extent, extent, (z1 - z0))
    m = _mat("CFCL_LavaMist")
    nt = m.node_tree
    N = nt.nodes
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    _link(nt, geo, "Position", sep, 0)
    mr = N.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = z0
    mr.inputs["From Max"].default_value = z1
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    _link(nt, sep, "Z", mr, "Value")
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = noise_scale
    nz.inputs["Detail"].default_value = 3.0
    _link(nt, geo, "Position", nz, "Vector")
    nzr = N.new("ShaderNodeMapRange")
    nzr.inputs["From Min"].default_value = 0.35
    nzr.inputs["From Max"].default_value = 0.7
    nzr.inputs["To Min"].default_value = 0.25
    nzr.inputs["To Max"].default_value = 1.0
    _link(nt, nz, "Fac", nzr, "Value")
    dens = _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", mr.outputs["Result"], mr.outputs["Result"]).outputs[0], nzr.outputs["Result"])
    dens2 = _math(nt, "MULTIPLY", dens.outputs[0], density)
    vol = N.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.75, 0.55, 0.45, 1)
    vol.inputs["Anisotropy"].default_value = 0.3
    _link(nt, dens2, 0, vol, "Density")
    out = N.new("ShaderNodeOutputMaterial")
    _link(nt, vol, "Volume", out, "Volume")
    cube.data.materials.append(m)
    for c in cube.users_collection:
        c.objects.unlink(cube)
    col.objects.link(cube)
    return cube


def build_fog_volume(col, center=(0, 22, 4), size=(160, 160, 40), density=0.024, z_ref=-4.0, falloff=5.0,
                     color=(0.40, 0.58, 0.56), anisotropy=0.3, name="CFCL_Fog", emission=None):
    """Bounded aerial-perspective fog (camera may be inside). Density decays exponentially with height."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    cube = bpy.context.active_object
    cube.name = name + "_Volume"
    cube.scale = size
    m = _mat(name)
    nt = m.node_tree
    N = nt.nodes
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    _link(nt, geo, "Position", sep, 0)
    h = _math(nt, "DIVIDE", _math(nt, "SUBTRACT", sep.outputs["Z"], z_ref).outputs[0], -falloff)
    e = _math(nt, "EXPONENT", h.outputs[0])
    dens = _math(nt, "MINIMUM", _math(nt, "MULTIPLY", e.outputs[0], density).outputs[0], density * 4)
    vol = N.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (*color, 1)
    vol.inputs["Anisotropy"].default_value = anisotropy
    _link(nt, dens, 0, vol, "Density")
    if emission:
        vol.inputs["Emission Color"].default_value = (*emission[:3], 1)
        _link(nt, _math(nt, "MULTIPLY", e.outputs[0], emission[3]), 0, vol, "Emission Strength")
    out = N.new("ShaderNodeOutputMaterial")
    _link(nt, vol, "Volume", out, "Volume")
    cube.data.materials.append(m)
    cube.visible_shadow = False
    for c in cube.users_collection:
        c.objects.unlink(cube)
    col.objects.link(cube)
    return cube


def build_sky_clouds(col, seed=11, count=9):
    """Large dark smoke banks in the upper sky corners (reference: dark swirling cloud frames the top)."""
    rnd = random.Random(seed)
    smoke = bpy.data.materials.get("CFCL_EclipseSmoke") or _smoke_material()
    objs = []
    for i in range(count):
        side = -1 if i % 2 == 0 else 1
        x = side * rnd.uniform(6, 16)
        y = rnd.uniform(18, 30)
        z = rnd.uniform(7.5, 13)
        bpy.ops.mesh.primitive_plane_add(size=rnd.uniform(12, 20), location=(x, y, z))
        o = bpy.context.active_object
        o.name = f"CFCL_Sky_SmokeBank_{i:02d}"
        _face_toward(o, (0, -1.3, 0.3))
        o.rotation_euler.rotate_axis("Z", rnd.uniform(0, 6.28))
        o.data.materials.append(smoke)
        o.visible_shadow = False
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
        objs.append(o)
    return objs
