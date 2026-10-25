"""Render the hero camera of a main blend with a named look/renderer variant (never saves the blend).
Usage: python lib/run_blender.py scripts/render_variant.py -- <ver> <variant> [pct]
  variant "cycles": same scene, Cycles path tracing (GPU OptiX/CUDA if available, else CPU), adaptive sampling + OIDN.
Output: renders/main/<ver>_<variant>/hero.png"""
import sys, os, time, json
# CF_ROOT lets the same script run from a packed job folder on a Linux render pod
CL = os.environ.get("CF_ROOT") or r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
VER, VAR = argv[0], argv[1]
PCT = int(argv[2]) if len(argv) > 2 else 100
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend"), load_ui=False)
sc = bpy.context.scene
import cf_render as R
CAMS = {"hero": ((0, -30.0, 9.0), (0, 20, 5.5), 24),
        # v022 living pieces: eye level just above the White footmen, looking over them at the Sun Empire + eclipse
        "army": ((-4.0, -19.8, 2.7), (1.0, 20, 6.8), 27),   # v026: wider - no piece cut by the frame edge   # v024: pulled back - front line framed at the shoulders
        "duel": ((0, -17.262, 3.715), (0, 6.118, 2.404), 36),
        # layout check from above (use with "overhead": hides the sky / overhead set dressing and the aerial fog)
        "top": ((0, 16.0, 120.0), (0, 18.0, 0.0), 22),
        # the game's default player view (sceneEngine CAMERA_SHOTS.white (0, 6.4, 8.6) -> (0, 0.35, 0), 46 deg vertical
        # FOV, 1 unit = 1 square = 2.3 m): 46 deg vertical at 16:9 = 23.85 mm on a 36 mm sensor
        "gameplay": ((0, -19.78, 14.72), (0, 0, 0.805), 23.85),
        # same head position, looking up at the creature (VR: the player turns their own head; nothing steers it)
        "lookup": ((0, -19.78, 14.72), (10.0, 80.0, 11.0), 23.85),
        # from the right, past the hand: board, dais and creature in profile
        "side": ((100.0, 88.0, 22.0), (-5.0, 55.0, 6.0), 26)}
CAM_NAME = next((t[3:] for t in VAR.split("-") if t.startswith("cam") and t[3:] in CAMS), "hero")
if CAM_NAME == "hero":
    cam = bpy.data.objects.get("CF_CAM_hero") or R.camera("CF_CAM_hero", *CAMS["hero"])
else:
    cam = R.camera("CF_CAM_" + CAM_NAME, *CAMS[CAM_NAME])
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, PCT
info = {"ver": VER, "variant": VAR}


def use_cycles(samples=384, threshold=0.015):
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    prefs = bpy.context.preferences.addons["cycles"].preferences
    dev = "CPU"
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.refresh_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                dev = kind
                break
        except Exception:
            continue
    cy.device = "GPU" if dev != "CPU" else "CPU"
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = threshold
    cy.adaptive_min_samples = 32
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 8, 3, 3
    cy.transmission_bounces, cy.volume_bounces, cy.transparent_max_bounces = 6, 1, 8
    cy.caustics_reflective = cy.caustics_refractive = False
    cy.volume_step_rate = 4.0
    cy.volume_preview_step_rate = 4.0
    cy.volume_max_steps = 256
    sc.render.use_simplify = True
    sc.cycles.texture_limit_render = "2048"
    info.update(device=dev, samples=samples, threshold=threshold)


def fog_fix(k=0.5, cone_in=7.0, cone_out=14.0, near=140.0, far=320.0, far_mul=0.45, cone_mul=0.1,
            close=None):
    """Cycles scatters the bounded fog much harder than EEVEE: scale the aerial fog by k, clear a cone around the
    camera->eclipse line (keeps the disc black and the corona strands crisp) and thin it with distance (sky detail)."""
    from mathutils import Vector
    ecl = bpy.data.objects.get("CFCL_Eclipse_Body")
    cs = [ecl.matrix_world @ Vector(c) for c in ecl.bound_box] if ecl else []
    E = sum(cs, Vector()) / 8 if cs else Vector((4, 92, 30))
    C = sc.camera.matrix_world.translation.copy()
    D = (E - C).normalized()
    done = []
    for m in bpy.data.materials:
        if not m.node_tree or not any(m.name.startswith(p) for p in ("CFCL_Fog", "CFCL_MistBank", "CFCL_LavaMist")):
            continue
        nt = m.node_tree
        for v in [n for n in nt.nodes if n.type == "PRINCIPLED_VOLUME"]:
            sock = v.inputs["Density"]
            src = sock.links[0].from_socket if sock.is_linked else None
            N = nt.nodes
            geo = N.new("ShaderNodeNewGeometry")
            rel = N.new("ShaderNodeVectorMath"); rel.operation = "SUBTRACT"
            nt.links.new(geo.outputs["Position"], rel.inputs[0]); rel.inputs[1].default_value = C
            nrm = N.new("ShaderNodeVectorMath"); nrm.operation = "NORMALIZE"; nt.links.new(rel.outputs[0], nrm.inputs[0])
            dot = N.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"
            nt.links.new(nrm.outputs[0], dot.inputs[0]); dot.inputs[1].default_value = D
            cone = N.new("ShaderNodeMapRange"); cone.interpolation_type = "SMOOTHSTEP"
            nt.links.new(dot.outputs["Value"], cone.inputs[0])
            cone.inputs[1].default_value = math.cos(math.radians(cone_out))
            cone.inputs[2].default_value = math.cos(math.radians(cone_in))
            cone.inputs[3].default_value, cone.inputs[4].default_value = 1.0, cone_mul
            ln = N.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"; nt.links.new(rel.outputs[0], ln.inputs[0])
            fade = N.new("ShaderNodeMapRange"); fade.interpolation_type = "SMOOTHSTEP"
            nt.links.new(ln.outputs["Value"], fade.inputs[0])
            fade.inputs[1].default_value, fade.inputs[2].default_value = near, far
            fade.inputs[3].default_value, fade.inputs[4].default_value = 1.0, far_mul
            m1 = N.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
            nt.links.new(cone.outputs[0], m1.inputs[0]); nt.links.new(fade.outputs[0], m1.inputs[1])
            if close:   # thinner fog in the first tens of metres: deeper foreground/mid-ground silhouettes
                cl = N.new("ShaderNodeMapRange"); cl.interpolation_type = "SMOOTHSTEP"
                nt.links.new(ln.outputs["Value"], cl.inputs[0])
                cl.inputs[1].default_value, cl.inputs[2].default_value = close[0], close[1]
                cl.inputs[3].default_value, cl.inputs[4].default_value = close[2], 1.0
                m1b = N.new("ShaderNodeMath"); m1b.operation = "MULTIPLY"
                nt.links.new(m1.outputs[0], m1b.inputs[0]); nt.links.new(cl.outputs[0], m1b.inputs[1])
                m1 = m1b
            m2 = N.new("ShaderNodeMath"); m2.operation = "MULTIPLY"; nt.links.new(m1.outputs[0], m2.inputs[0])
            if src is not None:
                m3 = N.new("ShaderNodeMath"); m3.operation = "MULTIPLY"; nt.links.new(src, m3.inputs[0])
                m3.inputs[1].default_value = k; nt.links.new(m3.outputs[0], m2.inputs[1])
            else:
                m2.inputs[1].default_value = sock.default_value * k
            nt.links.new(m2.outputs[0], sock)
            done.append(m.name)
    info["fog_fix"] = {"k": k, "materials": done, "cone_deg": [cone_in, cone_out], "eclipse": [round(v, 1) for v in E]}


def graze_key(strength=2.0, color=(1.0, 0.74, 0.48), az_from=(-0.95, -0.30), elev_deg=20.0, angle_deg=1.2):
    """Warm low sun raking in from camera-left: reveals roughness, wear and relief on skull, hand and board."""
    from mathutils import Vector
    f = Vector((az_from[0], az_from[1], 0)).normalized() * math.cos(math.radians(elev_deg))
    f.z = math.sin(math.radians(elev_deg))
    ld = bpy.data.lights.new("CFCL_Sun_GrazeKey", "SUN")
    ld.energy, ld.color, ld.angle = strength, color, math.radians(angle_deg)
    ob = bpy.data.objects.new("CFCL_Sun_GrazeKey", ld)
    sc.collection.objects.link(ob)
    ob.rotation_euler = (-f).to_track_quat("-Z", "Y").to_euler()
    info["graze_key"] = {"strength": strength, "from": [round(v, 2) for v in f], "angle_deg": angle_deg}


import math
TOK = set(VAR.split("-"))
if "cycles" in TOK:
    if "test" in TOK:
        use_cycles(samples=8, threshold=0.1)
    elif "hq" in TOK:
        use_cycles(samples=640, threshold=0.01)
        for a, v in (("denoising_prefilter", "ACCURATE"), ("denoising_quality", "HIGH"),
                     ("denoising_input_passes", "RGB_ALBEDO_NORMAL")):
            try:
                setattr(sc.cycles, a, v)
            except Exception:
                pass
    else:
        use_cycles()
if "fog" in TOK:
    fog_fix()
elif "fog2" in TOK:   # v021: the corona reaches ~12-20 deg - clear it fully; thin the near fog for deeper silhouettes
    fog_fix(cone_in=12.0, cone_out=22.0, cone_mul=0.05, close=(20.0, 110.0, 0.35))
elif "fog3" in TOK:   # v024 (critic): fog that thickens with depth - layered dark-in-front / bright-air-behind
    fog_fix(k=0.6, cone_in=12.0, cone_out=22.0, cone_mul=0.05, close=(20.0, 150.0, 0.25), far_mul=0.75)
if "disc" in TOK:     # default specular made the black disc mirror the bright haze (grey sphere)
    for m in bpy.data.materials:
        if m.name.startswith("CFCL_EclipseBody") and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    n.inputs["Specular IOR Level"].default_value = 0.0
                    n.inputs["Roughness"].default_value = 1.0
                    n.inputs["Base Color"].default_value = (0.002, 0.0015, 0.0015, 1.0)
    info["disc"] = "matte black"
def disc_matte(k=0.92, feather=0.12, black=(0.004, 0.0035, 0.0035)):
    """Compositing holdout: bloom (and haze) wash the eclipse disc to grey (centre luma 0.13 in Cycles v022). Project the
    body into this camera and lay a soft black matte over k*R after the glare/vignette, leaving the limb + corona."""
    from mathutils import Vector
    from bpy_extras.object_utils import world_to_camera_view
    ecl = bpy.data.objects.get("CFCL_Eclipse_Body")
    ng = getattr(sc, "compositing_node_group", None)
    if not (ecl and ng):
        info["disc_matte"] = "skipped (no eclipse or compositor)"
        return
    bpy.context.view_layer.update()
    cs = [ecl.matrix_world @ Vector(c) for c in ecl.bound_box]
    E = sum(cs, Vector()) / 8
    rad = max((c - E).length for c in cs) / math.sqrt(3)          # sphere radius from its bbox corners
    rgt = sc.camera.matrix_world.to_3x3() @ Vector((1, 0, 0))
    p0, p1 = world_to_camera_view(sc, sc.camera, E), world_to_camera_view(sc, sc.camera, E + rgt * rad)
    W = sc.render.resolution_x
    H = sc.render.resolution_y
    rpx = abs(p1.x - p0.x) * W
    out = next((n for n in ng.nodes if n.bl_idname in ("NodeGroupOutput", "CompositorNodeComposite")), None)
    if out is None or not out.inputs[0].is_linked:
        info["disc_matte"] = "skipped (no output link)"
        return
    last = out.inputs[0].links[0].from_socket
    em = ng.nodes.new("CompositorNodeEllipseMask")
    em.inputs["Value"].default_value = 1.0
    size = (2 * rpx * k / W, 2 * rpx * k / W)      # Blender 5.2 EllipseMask Size is relative to the image width on both axes
    names = [s.name for s in em.inputs]
    if "Position" in names:
        em.inputs["Position"].default_value = (p0.x, p0.y)
        em.inputs["Size"].default_value = size
    else:                                   # older property API
        em.x, em.y, em.width, em.height = p0.x, p0.y, size[0], size[1]
    bl = ng.nodes.new("CompositorNodeBlur")
    try:
        f = rpx * feather * sc.render.resolution_percentage / 100.0      # blur works in output pixels
        bl.inputs["Size"].default_value = (f, f)
    except Exception:
        pass
    ng.links.new(em.outputs[0], bl.inputs["Image"])
    mx = ng.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MIX"
    ng.links.new(bl.outputs[0], mx.inputs[0])
    ng.links.new(last, mx.inputs[6])
    mx.inputs[7].default_value = (*black, 1.0)
    last2 = mx.outputs[2]
    if "ring" in TOK:   # v026 (critic: "flat black sticker"): thin crimson-gold limb + faint inner gradient
        def ell(kk, blur_px):
            e = ng.nodes.new("CompositorNodeEllipseMask")
            e.inputs["Value"].default_value = 1.0
            e.inputs["Position"].default_value = (p0.x, p0.y)
            e.inputs["Size"].default_value = (2 * rpx * kk / W, 2 * rpx * kk / W)
            b2 = ng.nodes.new("CompositorNodeBlur")
            b2.inputs["Size"].default_value = (blur_px, blur_px)
            ng.links.new(e.outputs[0], b2.inputs["Image"])
            return b2.outputs[0]
        pct = sc.render.resolution_percentage / 100.0
        outer, inner = ell(1.005, 2.0 * pct), ell(0.965, 2.0 * pct)
        band = ng.nodes.new("ShaderNodeMath"); band.operation = "SUBTRACT"; band.use_clamp = True
        ng.links.new(outer, band.inputs[0]); ng.links.new(inner, band.inputs[1])
        rmx = ng.nodes.new("ShaderNodeMix"); rmx.data_type = "RGBA"; rmx.blend_type = "ADD"
        ng.links.new(band.outputs[0], rmx.inputs[0]); ng.links.new(last2, rmx.inputs[6])
        rmx.inputs[7].default_value = (1.6, 0.42, 0.10, 1.0)
        # faint gradient: lift the lower-left of the disc a hair, as if lit by the haze below it
        grad = ell(0.9, rpx * 0.6 * pct)
        gmx = ng.nodes.new("ShaderNodeMix"); gmx.data_type = "RGBA"; gmx.blend_type = "ADD"
        gm = ng.nodes.new("ShaderNodeMath"); gm.operation = "MULTIPLY"; gm.inputs[1].default_value = 0.02
        ng.links.new(grad, gm.inputs[0]); ng.links.new(gm.outputs[0], gmx.inputs[0])
        ng.links.new(rmx.outputs[2], gmx.inputs[6]); gmx.inputs[7].default_value = (0.9, 0.5, 0.35, 1.0)
        last2 = gmx.outputs[2]
    ng.links.new(last2, out.inputs[0])
    info["disc_matte"] = {"center_uv": [round(p0.x, 4), round(p0.y, 4)], "radius_px": round(rpx, 1), "inputs": names,
                          "ring": "ring" in TOK}


if "skygrade" in TOK:     # v026 (critic: top 45% an even cream haze): crimson-brown away from the eclipse
    from mathutils import Vector
    ecl = bpy.data.objects.get("CFCL_Eclipse_Body")
    E = (sum((ecl.matrix_world @ Vector(c) for c in ecl.bound_box), Vector()) / 8) if ecl else Vector((3.9, 92, 30.5))
    C = sc.camera.matrix_world.translation.copy()
    D = (E - C).normalized()
    n_s = 0
    for m in bpy.data.materials:
        if not (m.name.startswith("CFCL_SkyShatter_SkyFace") and m.node_tree):
            continue
        nt = m.node_tree
        for n in list(nt.nodes):
            sk = n.inputs.get("Color") if n.type == "EMISSION" else (n.inputs.get("Emission Color") if n.type == "BSDF_PRINCIPLED" else None)
            if sk is None:
                continue
            geo = nt.nodes.new("ShaderNodeNewGeometry")
            rel = nt.nodes.new("ShaderNodeVectorMath"); rel.operation = "SUBTRACT"; rel.inputs[1].default_value = C
            nt.links.new(geo.outputs["Position"], rel.inputs[0])
            nrm = nt.nodes.new("ShaderNodeVectorMath"); nrm.operation = "NORMALIZE"; nt.links.new(rel.outputs[0], nrm.inputs[0])
            dot = nt.nodes.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"; dot.inputs[1].default_value = D
            nt.links.new(nrm.outputs[0], dot.inputs[0])
            mr = nt.nodes.new("ShaderNodeMapRange"); mr.interpolation_type = "SMOOTHSTEP"
            mr.inputs[1].default_value, mr.inputs[2].default_value = math.cos(math.radians(55)), math.cos(math.radians(14))
            nt.links.new(dot.outputs["Value"], mr.inputs[0])
            tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = "RGBA"; tint.blend_type = "MIX"
            nt.links.new(mr.outputs[0], tint.inputs[0])
            tint.inputs[6].default_value = (0.42, 0.13, 0.08, 1.0)      # far from the eclipse: crimson-brown, dimmer
            tint.inputs[7].default_value = (1.0, 0.92, 0.82, 1.0)       # near the eclipse: keep the heat
            mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs[0].default_value = 1.0
            if sk.is_linked:
                nt.links.new(sk.links[0].from_socket, mul.inputs[6])
            else:
                mul.inputs[6].default_value = sk.default_value
            nt.links.new(tint.outputs[2], mul.inputs[7])
            nt.links.new(mul.outputs[2], sk)
            n_s += 1
    info["skygrade"] = n_s
if "frame" in TOK:       # v026 (critic): push the framing edges / top to near-black (offset vignette, after glare)
    ng = getattr(sc, "compositing_node_group", None)
    out = next((n for n in ng.nodes if n.bl_idname in ("NodeGroupOutput", "CompositorNodeComposite")), None) if ng else None
    if out is not None and out.inputs[0].is_linked:
        last = out.inputs[0].links[0].from_socket
        em = ng.nodes.new("CompositorNodeEllipseMask"); em.inputs["Value"].default_value = 1.0
        em.inputs["Position"].default_value = (0.5, 0.42)
        em.inputs["Size"].default_value = (1.25, 0.95)
        bl = ng.nodes.new("CompositorNodeBlur")
        f = 260.0 * sc.render.resolution_percentage / 100.0
        bl.inputs["Size"].default_value = (f, f)
        ng.links.new(em.outputs[0], bl.inputs["Image"])
        rng = ng.nodes.new("ShaderNodeMapRange"); rng.inputs[3].default_value = 0.55; rng.inputs[4].default_value = 1.0
        ng.links.new(bl.outputs[0], rng.inputs[0])
        mm = ng.nodes.new("ShaderNodeMix"); mm.data_type = "RGBA"; mm.blend_type = "MULTIPLY"; mm.inputs[0].default_value = 1.0
        ng.links.new(last, mm.inputs[6]); ng.links.new(rng.outputs[0], mm.inputs[7])
        ng.links.new(mm.outputs[2], out.inputs[0])
        info["frame"] = "edges x0.55"
if "discmatte" in TOK:
    disc_matte()
if "tiles3" in TOK:      # v025: obsidian = dark base + moderate gloss (tiles2 alone mirrored the warm sky as copper)
    TOK.add("tiles2")
if "tiles2" in TOK:      # v024 (critic): veined ivory ~0.7 albedo + glossy obsidian dark squares
    TOK.add("tiles")
if "tiles" in TOK:       # critic v020: white tiles were the brightest thing in frame, competing with the eclipse
    for m in bpy.data.materials:
        if m.name.startswith("CFCL_BoardArena_Marble") and m.node_tree:
            for n in [n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]:
                s = n.inputs["Base Color"]
                mul = m.node_tree.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
                mul.inputs[0].default_value = 1.0
                mul.inputs[7].default_value = (0.72, 0.70, 0.66, 1.0) if "tiles2" in TOK else (0.78, 0.76, 0.72, 1.0)
                if s.is_linked:
                    m.node_tree.links.new(s.links[0].from_socket, mul.inputs[6])
                else:
                    mul.inputs[6].default_value = s.default_value
                m.node_tree.links.new(mul.outputs[2], s)
    info["tiles"] = "white tiles x0.76 warm"
if "rim" in TOK:         # critic v020: let the eclipse rim the skull, hand and pillars
    o = bpy.data.objects.get("CFCL_Sun_EclipseRim")
    if o and o.data:
        o.data.energy *= 2.5
        info["rim"] = round(o.data.energy, 2)
if "declutter" in TOK:   # v021: weak / clutter pieces near the skull silhouette
    gone = []
    for nm in ("KB3D_SkullFlank_Entrance", "CFCL_FarLand_Frag_CliffRuins", "CFCL_Rib_A_mid_14"):
        o = bpy.data.objects.get(nm)
        if o:
            o.hide_render = True
            gone.append(nm)
    info["declutter"] = gone
if "key" in TOK:
    graze_key()
elif "keyhalf" in TOK:    # round 2: full key lifted every shadow; half keeps silhouettes and still models form
    graze_key(strength=1.0)
if "tiles2" in TOK:      # glossy obsidian dark squares
    for m in bpy.data.materials:
        if m.name.startswith("CFCL_BoardArena_TileBasalt") and m.node_tree:
            for n in [n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]:
                r_ = n.inputs["Roughness"]
                mm = m.node_tree.nodes.new("ShaderNodeMath"); mm.operation = "MULTIPLY"
                mm.inputs[1].default_value = 0.5 if "tiles3" in TOK else 0.35
                if r_.is_linked:
                    m.node_tree.links.new(r_.links[0].from_socket, mm.inputs[0])
                else:
                    mm.inputs[0].default_value = r_.default_value
                m.node_tree.links.new(mm.outputs[0], r_)
                if "tiles3" in TOK:
                    bc = n.inputs["Base Color"]
                    dk = m.node_tree.nodes.new("ShaderNodeMix"); dk.data_type = "RGBA"; dk.blend_type = "MULTIPLY"
                    dk.inputs[0].default_value = 1.0; dk.inputs[7].default_value = (0.45, 0.44, 0.46, 1.0)
                    if bc.is_linked:
                        m.node_tree.links.new(bc.links[0].from_socket, dk.inputs[6])
                    else:
                        dk.inputs[6].default_value = bc.default_value
                    m.node_tree.links.new(dk.outputs[2], bc)
    info["tiles2"] = "ivory x0.70, obsidian " + ("albedo x0.45 roughness x0.5" if "tiles3" in TOK else "roughness x0.35")
if "lava2" in TOK:       # v024 (critic): the lava barely registered
    n_l = 0
    for m in bpy.data.materials:
        if m.name.startswith("CFCL_Lava") and m.node_tree:
            for n in list(m.node_tree.nodes):
                sk = n.inputs.get("Emission Strength") if n.type == "BSDF_PRINCIPLED" else (n.inputs.get("Strength") if n.type == "EMISSION" else None)
                if sk is None:
                    continue
                mm = m.node_tree.nodes.new("ShaderNodeMath"); mm.operation = "MULTIPLY"; mm.inputs[1].default_value = 2.0
                if sk.is_linked:
                    m.node_tree.links.new(sk.links[0].from_socket, mm.inputs[0])
                else:
                    mm.inputs[0].default_value = sk.default_value
                m.node_tree.links.new(mm.outputs[0], sk)
                n_l += 1
    info["lava2"] = n_l
if "light2" in TOK:      # v024 (critic #1): a strong low backlight from the eclipse; world + fill down ~1.5 stops
    from mathutils import Vector
    w = sc.world
    if w and w.node_tree:
        for n in w.node_tree.nodes:
            if n.type == "BACKGROUND" and not n.inputs["Strength"].is_linked:
                n.inputs["Strength"].default_value *= 0.5    # v024b: -1 stop (x0.35 crushed the backlit army to 19% black)
    for nm, mul in (("CFCL_Sun_CoolFill", 0.4), ("CFCL_Sun_GrazeKey", 0.8)):
        o = bpy.data.objects.get(nm)
        if o and o.data:
            o.data.energy *= mul
    rim = bpy.data.objects.get("CFCL_Sun_EclipseRim")
    if rim and rim.data:
        travel = Vector((-0.042, -1.0, -math.tan(math.radians(12.0)))).normalized()   # from the eclipse, low over the board
        rim.rotation_euler = travel.to_track_quat("-Z", "Y").to_euler()
        rim.data.energy, rim.data.color, rim.data.angle = 6.5, (1.0, 0.60, 0.30), math.radians(1.5)
    info["light2"] = {"world": "x0.5", "fill": "x0.4", "graze": "x0.8", "rim_W": 6.5, "rim_elev_deg": 12}
if "fill" in TOK:        # v025: v024 hero crushed 19% to black - soft cool fill from the camera side, +~0.5 stop
    from mathutils import Vector
    w = sc.world
    if w and w.node_tree:
        for n in w.node_tree.nodes:
            if n.type == "BACKGROUND" and not n.inputs["Strength"].is_linked:
                n.inputs["Strength"].default_value *= 1.25
    tgt = Vector(CAMS[CAM_NAME][1])
    fwd = (tgt - sc.camera.matrix_world.translation).normalized()
    travel = Vector((fwd.x, fwd.y, 0)).normalized()
    travel.z = -math.tan(math.radians(16.0))
    fd = bpy.data.lights.new("CFCL_Sun_CamFill", "SUN")
    fd.energy, fd.color, fd.angle = 0.45, (0.74, 0.82, 0.92), math.radians(12.0)
    fo = bpy.data.objects.new("CFCL_Sun_CamFill", fd)
    sc.collection.objects.link(fo)
    fo.rotation_euler = travel.normalized().to_track_quat("-Z", "Y").to_euler()
    info["fill"] = {"world": "x1.25", "cam_fill_W": 0.45}
if "overhead" in TOK:    # top view: drop everything that would sit between a bird's-eye camera and the arena
    import re as _re
    from mathutils import Vector
    _rx = _re.compile(r"Sky|Cloud|Smoke|Fog|Mist|Volume|Shatter|Eclipse|Ember|Haze|Corona|Dust", _re.I)
    _hid = 0
    for o in sc.objects:
        if o.type in ("MESH", "VOLUME", "CURVE") and not o.hide_render:
            zmin = min((o.matrix_world @ Vector(c)).z for c in o.bound_box)
            if _rx.search(o.name) or zmin > 13.0:
                o.hide_render = True
                _hid += 1
    w = sc.world
    if w and w.node_tree:
        for n in w.node_tree.nodes:
            if n.type in ("PRINCIPLED_VOLUME", "VOLUME_SCATTER", "VOLUME_ABSORPTION") and "Density" in n.inputs:
                n.inputs["Density"].default_value = 0.0
    info["overhead_hidden"] = _hid
out = os.path.join(CL, "renders", "main", f"{VER}_{VAR}", f"{CAM_NAME}.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
t = time.time()
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
info["seconds"] = round(time.time() - t, 1)
json.dump(info, open(out.replace(".png", "_info.json"), "w"), indent=1)
print("VARIANT", json.dumps(info), flush=True)
