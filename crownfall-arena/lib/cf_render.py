"""Crownfall (Claude track) - preview render rig + scene utilities.

Consistent lighting so every agent's previews are comparable:
  - cool overcast sky (green-grey), low strength
  - cool soft key from upper front-left
  - warm eclipse rim from high behind
  - lava under-bounce (orange, from below)
Colour management: AgX, Medium High Contrast look (falls back gracefully).
"""
import math
import json
import os
import bpy
from mathutils import Vector

BLENDER_EXE = r"C:\Users\MILES\AppData\Local\Programs\Blender Foundation\Blender 5.2\blender.exe"
ROOT = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create"
CL = os.path.join(ROOT, "work", "claude_environment")
BOARD_BLEND = os.path.join(ROOT, "outputs", "Crownfall_Board_v001", "Crownfall_Board_v001.blend")


def _set(obj, attr, val):
    try:
        setattr(obj, attr, val)
        return True
    except Exception:
        return False


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def setup_render(scene=None, engine="EEVEE", res=(1280, 720), samples=48, film_transparent=False,
                 volumetrics=False, fog_density=0.0):
    sc = scene or bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE" if engine.upper().startswith("EEVEE") else "CYCLES"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = film_transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB" if not film_transparent else "RGBA"
    vs = sc.view_settings
    _set(vs, "view_transform", "AgX")
    for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
        if _set(vs, "look", look):
            break
    vs.exposure = 0.0
    if sc.render.engine == "BLENDER_EEVEE":
        ee = sc.eevee
        _set(ee, "taa_render_samples", samples)
        _set(ee, "use_raytracing", True)
        _set(ee, "use_shadows", True)
        _set(ee, "shadow_ray_count", 2)
        _set(ee, "shadow_step_count", 8)
        _set(ee, "use_volumetric_shadows", True)
        _set(ee, "volumetric_tile_size", "8")
        _set(ee, "volumetric_end", 250.0)
        _set(ee, "use_fast_gi", True)
        _set(ee, "shadow_pool_size", "256")
        _set(ee, "fast_gi_distance", 2.0)
    else:
        cy = sc.cycles
        cy.samples = samples
        _set(cy, "use_denoising", True)
        _set(cy, "device", "GPU")
    return sc


def setup_world(scene=None, top=(0.050, 0.062, 0.058), horizon=(0.115, 0.128, 0.118), strength=1.0,
                fog_density=0.0, fog_color=(0.42, 0.47, 0.44), fog_anisotropy=0.2):
    sc = scene or bpy.context.scene
    w = bpy.data.worlds.new("CFCL_PreviewWorld")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    rmp = nt.nodes.new("ShaderNodeValToRGB")
    rmp.color_ramp.elements[0].position = 0.45
    rmp.color_ramp.elements[0].color = (*horizon, 1)
    rmp.color_ramp.elements[1].position = 0.9
    rmp.color_ramp.elements[1].color = (*top, 1)
    nt.links.new(sep.outputs["Z"], rmp.inputs["Fac"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(rmp.outputs["Color"], bg.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    if fog_density > 0:
        vol = nt.nodes.new("ShaderNodeVolumePrincipled")
        vol.inputs["Density"].default_value = fog_density
        vol.inputs["Color"].default_value = (*fog_color, 1)
        vol.inputs["Anisotropy"].default_value = fog_anisotropy
        nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return w


def add_light(name, kind, loc, rot_deg, energy, color, size=1.0, collection=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.size = size
    elif kind == "SUN":
        ld.angle = math.radians(size)
    ob = bpy.data.objects.new(name, ld)
    (collection or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot_deg]
    return ob


def standard_lights(scale=1.0, lava=True, collection=None):
    """Key / eclipse rim / lava bounce.  `scale` ~ subject size in metres."""
    L = []
    L.append(add_light("CFCL_Key_CoolSun", "SUN", (0, 0, 10), (52, 0, -38), 1.7, (0.80, 0.88, 0.90), 6.0, collection))
    L.append(add_light("CFCL_Rim_Eclipse", "SUN", (0, 0, 10), (-58, 0, 172), 3.2, (1.0, 0.62, 0.32), 2.0, collection))
    if lava:
        L.append(add_light("CFCL_Bounce_Lava", "AREA", (0, -0.3 * scale, -1.2 * scale), (180, 0, 0),
                           120.0 * scale * scale, (1.0, 0.30, 0.08), 3.0 * scale, collection))
    return L


def camera(name, loc, target, lens=35.0, collection=None, sensor=36.0):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = sensor
    cd.clip_start = 0.02
    cd.clip_end = 2000
    ob = bpy.data.objects.new(name, cd)
    (collection or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    look_at(ob, target)
    return ob


def look_at(ob, target):
    d = Vector(target) - Vector(ob.location)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_to(path, cam=None, scene=None):
    sc = scene or bpy.context.scene
    if cam is not None:
        sc.camera = cam
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[cf_render] wrote", path, flush=True)
    return path


def bounds(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    return mn, mx


def turntable(objs, out_prefix, views=(("front", 0, 12), ("q_left", -40, 18), ("side", 90, 8), ("q_back", 150, 22)),
              lens=50.0, dist_mult=2.2, res=(1100, 800), samples=48, ground=True, engine="EEVEE"):
    """Render subject from several azimuths. Returns list of written paths."""
    sc = bpy.context.scene
    setup_render(sc, engine, res, samples)
    if sc.world is None:
        setup_world(sc)
    mn, mx = bounds(objs)
    ctr = (mn + mx) / 2
    size = max((mx - mn).length, 0.01)
    if not any(o.name.startswith("CFCL_Key") for o in sc.objects):
        standard_lights(size * 0.5)
    if ground and "CFCL_PreviewGround" not in bpy.data.objects:
        bpy.ops.mesh.primitive_circle_add(vertices=64, radius=size * 3, fill_type="NGON",
                                          location=(ctr.x, ctr.y, mn.z - 0.002))
        g = bpy.context.active_object
        g.name = "CFCL_PreviewGround"
        gm = bpy.data.materials.get("CFCL_PreviewGroundMat") or bpy.data.materials.new("CFCL_PreviewGroundMat")
        gm.use_nodes = True
        b = gm.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Base Color"].default_value = (0.035, 0.032, 0.028, 1)
            b.inputs["Roughness"].default_value = 0.9
        g.data.materials.append(gm)
    paths = []
    fov = 2 * math.atan(18.0 / lens)
    dist = (size * 0.5) / math.tan(fov / 2) * dist_mult * 0.5 + size * 0.3
    for name, az, el in views:
        a, e = math.radians(az), math.radians(el)
        loc = ctr + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam = camera("CFCL_TT_" + name, loc, ctr, lens)
        paths.append(render_to(f"{out_prefix}_{name}.png", cam))
    return paths


def tri_count(objs):
    t = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH":
            continue
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        t += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    return t


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def append_board(collection_name="CFCL_Board_LinkedReadOnly"):
    """Append (copy) the board objects from the source .blend into this scene, read-only use.
    Never saves back to the source file."""
    with bpy.data.libraries.load(BOARD_BLEND, link=False) as (src, dst):
        dst.collections = [c for c in src.collections if c.startswith("01_BOARD_EXPORT")]
    col = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(col)
    for c in dst.collections:
        if c is None:
            continue
        col.children.link(c)
    return col
