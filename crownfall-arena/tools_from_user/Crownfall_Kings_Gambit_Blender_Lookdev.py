"""
CROWNFALL | KING'S GAMBIT ARENA - BLENDER LOOKDEV TOOLKIT
==========================================================
Intended for Blender 4.5 LTS and 5.2 LTS. Requires an existing .blend scene.

HOW TO USE
1) Save a duplicate of your .blend before running any script.
2) In Object Mode select ALL chessboard-floor mesh objects (not the entire world).
   If the chessboard is a single object, select it. If you cannot select it,
   place the 3D cursor at the board center and set USE_SELECTION_BOUNDS=False.
3) Open this .py in Blender's Scripting workspace > Text Editor > Run Script.
4) Look in Outliner for 'KG | LOOKDEV RIG' and in Material Properties for 'KG |'.
5) Leave the original chessboard and landmark meshes where they are.

By default it:
- Builds independent light rig: warm back/rim light, cool fill, optional skull/hand accents.
- Copies and adjusts WORLD shading; leaves the original World data-block untouched.
- Stores original render/color settings, dims existing sun lamps reversibly.
- Creates WEATHERED STONE/BONE/GOLD/EMBERS test materials but does not apply them.
- Adds 3 OPTIONAL cameras without changing your scene's active camera.
- Does NOT replace existing assets, delete original objects, or modify UV maps.

Run again to replace only previously generated lights/cameras/fog/corona.
To revert these lookdev settings, change ACTION='RESTORE' and Run Script.

LIMITATIONS
- The model/camera scale and scene object names are unknown without the .blend.
  Tune the CONFIG below for your project; preview before final renders.
- Doesn't remove fog already in your scene: manually mute old World Volume or
  old fog cubes if the scene is still washed out.
- Blender version details differ; safety guards skip unsupported options.
- Standalone static Python syntax can be checked outside Blender, but actual
  Blender rendering/API behavior must be validated in your saved scene.
"""

import bpy
import math
import json
from mathutils import Vector

# =========================== CONFIG ===========================
ACTION = 'APPLY'               # 'APPLY' or 'RESTORE'
RENDER_MODE = 'PREVIEW'         # 'PREVIEW' (EEVEE) or 'FINAL' (Cycles)
USE_SELECTION_BOUNDS = True    # select all 8x8 floor meshes, or floor parent mesh
FALLBACK_BOARD_WIDTH = 20.0   # Blender world units; use when selection unavailable

# These can be exact Blender object names; blank = try auto-identification.
SKULL_OBJECT_NAME = ''
HAND_OBJECT_NAME = ''
ECLIPSE_OBJECT_NAME = ''

DIM_ORIGINAL_SUNS = True       # reversible; stored values used by RESTORE
ORIGINAL_SUN_MULTIPLIER = 0.35
WORLD_STRENGTH = 0.35
VIEW_EXPOSURE = -0.35

ADD_LOCAL_FOG = False          # OFF because your current screenshots have TOO much haze
FOG_DENSITY = 0.006           # only a localized box BEHIND the board
ADD_ECLIPSE_CORONA = False    # optional: needs ECLIPSE_OBJECT_NAME or identifiable orb
MAKE_CAMERAS = True            # creates new cameras, but does NOT change active camera
MAKE_MATERIAL_PRESETS = True  # does NOT assign to models

PREVIEW_RESOLUTION_PERCENT = 70
PREVIEW_EEVEE_SAMPLES = 64
FINAL_CYCLES_SAMPLES = 128
# ============================================================== 

RIG_NAME = 'KG | LOOKDEV RIG'
TAG = '_kg_lookdev_created'
BACKUP_KEY = '_kg_original_scene_settings_json'
ORIGINAL_SUN_KEY = '_kg_original_sun_energy'


def log(message):
    print('[KING\'S GAMBIT] ' + str(message))


def try_set(obj, prop, value):
    if hasattr(obj, prop):
        try:
            setattr(obj, prop, value)
            return True
        except (AttributeError, TypeError, ValueError, RuntimeError) as exc:
            log('Skipped {}.{}: {}'.format(type(obj).__name__, prop, exc))
    return False


def save_snapshot(scene):
    if BACKUP_KEY in scene:
        return
    info = {
        'world_name': scene.world.name if scene.world else '',
        'render_engine': scene.render.engine,
        'render_percentage': int(scene.render.resolution_percentage),
        'view_transform': scene.view_settings.view_transform,
        'look': scene.view_settings.look,
        'exposure': float(scene.view_settings.exposure),
        'gamma': float(scene.view_settings.gamma),
    }
    scene[BACKUP_KEY] = json.dumps(info)
    log('Saved original scene settings for RESTORE mode.')


def clear_own_objects():
    col = bpy.data.collections.get(RIG_NAME)
    if not col:
        return
    for obj in list(col.objects):
        if obj.get(TAG, False):
            bpy.data.objects.remove(obj, do_unlink=True)
    # Never delete the collection if the user linked unrelated objects to it.
    if len(col.objects) == 0 and len(col.children) == 0:
        bpy.data.collections.remove(col)


def restore_scene(scene):
    clear_own_objects()
    for light in bpy.data.lights:
        if ORIGINAL_SUN_KEY in light:
            light.energy = float(light[ORIGINAL_SUN_KEY])
            del light[ORIGINAL_SUN_KEY]
    if BACKUP_KEY in scene:
        info = json.loads(scene[BACKUP_KEY])
        old_world = bpy.data.worlds.get(info.get('world_name', ''))
        if old_world:
            scene.world = old_world
        try_set(scene.render, 'engine', info.get('render_engine', scene.render.engine))
        scene.render.resolution_percentage = int(info['render_percentage'])
        try_set(scene.view_settings, 'view_transform', info['view_transform'])
        try_set(scene.view_settings, 'look', info['look'])
        scene.view_settings.exposure = float(info['exposure'])
        scene.view_settings.gamma = float(info['gamma'])
        del scene[BACKUP_KEY]
    log('RESTORE complete. Generated material presets are kept (unassigned).')


def rig_collection(scene):
    col = bpy.data.collections.get(RIG_NAME)
    if col is None:
        col = bpy.data.collections.new(RIG_NAME)
    if scene.collection.children.get(col.name) is None:
        scene.collection.children.link(col)
    return col


def tag_and_link(obj, col):
    col.objects.link(obj)
    obj[TAG] = True
    return obj


def get_object_world_bounds(obj):
    """Eight world-space bbox corners; supports rotations/scales."""
    return [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]


def board_anchor():
    selected = [o for o in bpy.context.selected_objects
                if o.type == 'MESH' and not o.get(TAG, False)]
    if USE_SELECTION_BOUNDS and selected:
        points = [p for o in selected for p in get_object_world_bounds(o)]
        x0, x1 = min(p.x for p in points), max(p.x for p in points)
        y0, y1 = min(p.y for p in points), max(p.y for p in points)
        ztop = max(p.z for p in points)
        span = max(x1 - x0, y1 - y0)
        center = Vector(((x0 + x1) * 0.5, (y0 + y1) * 0.5, ztop))
        if span > 0.0001:
            log('Board inferred from {} selected mesh object(s); width {:.3f}'.format(
                len(selected), span))
            return center, span
        log('Selected bounds extremely small; falling back to 3D cursor.')
    center = bpy.context.scene.cursor.location.copy()
    log('Using 3D cursor as board center; configured width {:.3f}.'.format(
        FALLBACK_BOARD_WIDTH))
    return center, FALLBACK_BOARD_WIDTH


def toward_camera(scene, center):
    cam = scene.camera
    if cam and cam.type == 'CAMERA':
        vec = cam.matrix_world.translation - center
        vec.z = 0
        if vec.length > 0.001:
            return vec.normalized()
    # The screenshots are usually photographed from the -Y side of the board.
    return Vector((0.0, -1.0, 0.0))


def orient_toward(obj, point):
    direction = Vector(point) - obj.location
    if direction.length > 0.0001:
        obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def create_light(col, name, light_type, xyz, target, color, energy,
                 angle=None, area_size=None, spot_size=None):
    light = bpy.data.lights.new(name, type=light_type)
    light.color = color
    light.energy = energy
    if light_type == 'SUN' and angle is not None:
        try_set(light, 'angle', angle)
    if light_type == 'AREA' and area_size is not None:
        try_set(light, 'shape', 'DISK')
        try_set(light, 'size', area_size)
    if light_type == 'SPOT' and spot_size is not None:
        try_set(light, 'spot_size', spot_size)
        try_set(light, 'spot_blend', 0.65)
        try_set(light, 'shadow_soft_size', max(0.05, area_size or 0.2))
    ob = bpy.data.objects.new(name, light)
    tag_and_link(ob, col)
    ob.location = xyz
    orient_toward(ob, target)
    return ob


def find_landmark(exact_name, candidates):
    if exact_name:
        obj = bpy.data.objects.get(exact_name)
        if not obj:
            log('Not found: object name {!r}'.format(exact_name))
        return obj
    matches = [o for o in bpy.context.scene.objects
               if o.type in {'MESH', 'EMPTY'}
               and not o.get(TAG, False)
               and any(token in o.name.lower() for token in candidates)]
    if not matches:
        return None
    # Largest candidate usually is the landmark instead of a single decorative piece.
    return max(matches, key=lambda o: max(o.dimensions))


def landmark_center(ob):
    if ob.type == 'MESH':
        pts = get_object_world_bounds(ob)
        return sum(pts, Vector()) / len(pts)
    return ob.matrix_world.translation.copy()


def sun_dim(scene):
    if not DIM_ORIGINAL_SUNS:
        return
    count = 0
    for ob in scene.objects:
        if ob.type != 'LIGHT' or ob.data.type != 'SUN' or ob.get(TAG, False):
            continue
        lamp = ob.data
        if ORIGINAL_SUN_KEY not in lamp:
            lamp[ORIGINAL_SUN_KEY] = float(lamp.energy)
        lamp.energy = float(lamp[ORIGINAL_SUN_KEY]) * ORIGINAL_SUN_MULTIPLIER
        count += 1
    log('Reversibly dimmed {} existing SUN light(s).'.format(count))


def setup_world(scene):
    backup = json.loads(scene[BACKUP_KEY])
    source = bpy.data.worlds.get(backup.get('world_name', ''))
    if source:
        w = source.copy()
    else:
        w = bpy.data.worlds.new('KG World Base')
    w.name = 'KG | Controlled World'
    w.use_nodes = True
    nt = w.node_tree
    backgrounds = [n for n in nt.nodes if n.type == 'BACKGROUND']
    if not backgrounds:
        b = nt.nodes.new('ShaderNodeBackground')
        b.location = (-200, 0)
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_WORLD'), None)
        if out is None:
            out = nt.nodes.new('ShaderNodeOutputWorld')
        nt.links.new(b.outputs['Background'], out.inputs['Surface'])
        backgrounds = [b]
    for bg in backgrounds:
        color_in = bg.inputs.get('Color')
        strength_in = bg.inputs.get('Strength')
        if color_in and not color_in.is_linked:
            color_in.default_value = (0.19, 0.23, 0.27, 1.0)
        if strength_in and not strength_in.is_linked:
            strength_in.default_value = WORLD_STRENGTH
    scene.world = w
    log('World adjusted on a COPY, original preserved.')


def setup_color(scene):
    try_set(scene.view_settings, 'view_transform', 'AgX')
    # OCIO config differs between versions; never crash for a missing Look.
    for candidate in ('AgX - Medium High Contrast', 'Medium High Contrast'):
        try:
            scene.view_settings.look = candidate
            break
        except (TypeError, ValueError):
            continue
    scene.view_settings.exposure = VIEW_EXPOSURE
    scene.view_settings.gamma = 1.0


def setup_render(scene):
    if RENDER_MODE.upper() == 'FINAL':
        try_set(scene.render, 'engine', 'CYCLES')
        scene.render.resolution_percentage = 100
        if hasattr(scene, 'cycles'):
            try_set(scene.cycles, 'samples', FINAL_CYCLES_SAMPLES)
            # GPU support and VRAM vary; do not force GPU automatically.
            try_set(scene.cycles, 'device', 'CPU')
            try_set(scene.cycles, 'use_denoising', True)
    else:
        e = 'BLENDER_EEVEE' if bpy.app.version >= (5, 0, 0) else 'BLENDER_EEVEE_NEXT'
        try_set(scene.render, 'engine', e)
        scene.render.resolution_percentage = PREVIEW_RESOLUTION_PERCENT
        if hasattr(scene, 'eevee'):
            try_set(scene.eevee, 'taa_render_samples', PREVIEW_EEVEE_SAMPLES)
    log('Render preset: {}.'.format(RENDER_MODE))


def volume_material():
    mat = bpy.data.materials.get('KG | FOG (local volume)')
    if mat:
        return mat
    mat = bpy.data.materials.new('KG | FOG (local volume)')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    vol = nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.50, 0.57, 0.62, 1)
    vol.inputs['Density'].default_value = FOG_DENSITY
    if vol.inputs.get('Anisotropy'):
        vol.inputs['Anisotropy'].default_value = 0.35
    mat.node_tree.links.new(vol.outputs['Volume'], output.inputs['Volume'])
    return mat


def create_fog(col, center, board_size, toward_cam):
    # Physical volume behind the arena; leaves the chessboard unobscured.
    back = -toward_cam
    right = Vector((-toward_cam.y, toward_cam.x, 0.0))
    verts = [(x, y, z) for x, y, z in (
        (-.5,-.5,-.5), (.5,-.5,-.5), (.5,.5,-.5), (-.5,.5,-.5),
        (-.5,-.5,.5), (.5,-.5,.5), (.5,.5,.5), (-.5,.5,.5))]
    faces = [(0,3,2,1), (4,5,6,7), (0,1,5,4), (1,2,6,5),
             (2,3,7,6), (3,0,4,7)]
    mesh = bpy.data.meshes.new('KG | Fog Region Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new('KG | Background Mist (adjust density)', mesh)
    tag_and_link(ob, col)
    ob.location = center + back * board_size * 1.6 + Vector((0, 0, board_size * 0.7))
    ob.rotation_euler.z = math.atan2(-back.x, back.y)
    ob.scale = (board_size * 3.5, board_size * 1.8, board_size * 2.3)
    ob.display_type = 'WIRE'
    # Correct absorption for scales radically different from default 20 units.
    mat = volume_material()
    volume_node = next((n for n in mat.node_tree.nodes
                        if n.bl_idname == 'ShaderNodeVolumePrincipled'), None)
    if volume_node is not None:
        volume_node.inputs['Density'].default_value = (
            FOG_DENSITY * 20.0 / max(board_size, 0.1))
    ob.data.materials.append(mat)
    log('Created subtle local mist behind board; inspect in Rendered view.')


def create_corona(col, eclipse, scene):
    center = landmark_center(eclipse)
    radius = max(eclipse.dimensions) * 0.5
    if radius < 0.01:
        log('Eclipse dimensions invalid. Skipping corona.')
        return
    to_cam = (scene.camera.matrix_world.translation - center) if scene.camera else Vector((0, -1, 0.1))
    if to_cam.length < 0.001:
        to_cam = Vector((0, -1, 0.1))
    to_cam.normalize()
    segment_count = 256
    verts, faces = [], []
    for i in range(segment_count):
        a = 2 * math.pi * i / segment_count
        jitter = 0.019 * math.sin(9*a) + 0.018 * math.sin(17*a+0.7)
        inner = radius * (1.022 + jitter)
        outer = radius * (1.085 + 0.031 * math.sin(11*a + 0.35))
        verts.append((math.cos(a)*inner, math.sin(a)*inner, 0))
        verts.append((math.cos(a)*outer, math.sin(a)*outer, 0))
    for i in range(segment_count):
        j = (i + 1) % segment_count
        faces.append((i*2, j*2, j*2+1, i*2+1))
    mesh = bpy.data.meshes.new('KG | Corona Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    mat = bpy.data.materials.get('KG | Solar Corona / Emissive')
    if not mat:
        mat = bpy.data.materials.new('KG | Solar Corona / Emissive')
        mat.use_nodes = True
        ns = mat.node_tree.nodes
        ns.clear()
        emission = ns.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (1.0, 0.25, 0.045, 1)
        emission.inputs['Strength'].default_value = 6.0
        out = ns.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(emission.outputs['Emission'], out.inputs['Surface'])
    mesh.materials.append(mat)
    ob = bpy.data.objects.new('KG | Eclipse Corona (emissive rim)', mesh)
    tag_and_link(ob, col)
    ob.location = center - to_cam * (radius * 0.07)
    ob.rotation_euler = Vector((0,0,1)).rotation_difference(to_cam).to_euler()
    log('Created optional corona (requires glare/bloom in Compositor for soft halo).')


def new_procedural_stone(name, dark, light, roughness=0.82, fine_scale=70, bump=0.02):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    out.location = (700, 120)
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (400, 120)
    bsdf.inputs['Roughness'].default_value = roughness
    uv = nodes.new('ShaderNodeTexCoord')
    uv.location = (-800, 100)
    broad = nodes.new('ShaderNodeTexNoise')
    broad.location = (-530, 270)
    broad.inputs['Scale'].default_value = 4.2
    broad.inputs['Detail'].default_value = 4.0
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.location = (-250, 280)
    ramp.color_ramp.elements[0].position = 0.28
    ramp.color_ramp.elements[0].color = dark
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = light
    fine = nodes.new('ShaderNodeTexNoise')
    fine.location = (-530, -130)
    fine.inputs['Scale'].default_value = fine_scale
    fine.inputs['Detail'].default_value = 2.0
    bump_node = nodes.new('ShaderNodeBump')
    bump_node.location = (100, -100)
    bump_node.inputs['Strength'].default_value = 0.19
    bump_node.inputs['Distance'].default_value = bump
    links = mat.node_tree.links
    links.new(uv.outputs['Generated'], broad.inputs['Vector'])
    links.new(uv.outputs['Generated'], fine.inputs['Vector'])
    links.new(broad.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(fine.outputs['Fac'], bump_node.inputs['Height'])
    links.new(bump_node.outputs['Normal'], bsdf.inputs['Normal'])
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


def new_metal(name, color):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Metallic'].default_value = 0.88
        bsdf.inputs['Roughness'].default_value = 0.32
    return mat


def create_material_presets():
    new_procedural_stone('KG | WEATHERED LIMESTONE',
                         (0.11, 0.115, 0.11, 1), (0.42, 0.39, 0.33, 1),
                         roughness=0.88, bump=0.021)
    new_procedural_stone('KG | ANCIENT OBSIDIAN',
                         (0.012, 0.016, 0.020, 1), (0.080, 0.085, 0.09, 1),
                         roughness=0.69, bump=0.012)
    new_procedural_stone('KG | FOSSIL SKULL BONE',
                         (0.19, 0.17, 0.13, 1), (0.66, 0.58, 0.46, 1),
                         roughness=0.87, bump=0.022)
    new_metal('KG | AGED ROYAL GOLD', (0.43, 0.26, 0.095, 1))
    log('Material presets created; NOT assigned to existing meshes.')


def create_camera(col, name, pos, target, focal_mm, board_size):
    cam = bpy.data.cameras.new(name)
    cam.lens = focal_mm
    cam.clip_end = max(1000, board_size * 100)
    ob = bpy.data.objects.new(name, cam)
    tag_and_link(ob, col)
    ob.location = pos
    orient_toward(ob, target)
    return ob


def create_shots(col, center, s, toward_cam):
    back = -toward_cam
    right = Vector((-toward_cam.y, toward_cam.x, 0.0))
    up = Vector((0, 0, 1))
    create_camera(col, 'KG | CAMERA | HERO_WIDE',
                  center + toward_cam*s*1.55 + right*s*0.18 + up*s*0.78,
                  center + back*s*0.52 + up*s*0.24, 28, s)
    create_camera(col, 'KG | CAMERA | DUEL_GROUND',
                  center + toward_cam*s*0.79 + up*s*0.17,
                  center + back*s*0.28 + up*s*0.11, 36, s)
    create_camera(col, 'KG | CAMERA | MAP_TOPDOWN',
                  center + toward_cam*s*0.06 + up*s*2.2,
                  center, 45, s)
    log('Created three camera suggestions; active camera unchanged.')


def main():
    scene = bpy.context.scene
    if not scene:
        raise RuntimeError('No scene loaded.')
    if ACTION.upper() == 'RESTORE':
        restore_scene(scene)
        return
    if ACTION.upper() != 'APPLY':
        raise ValueError("ACTION must be 'APPLY' or 'RESTORE'.")

    center, s = board_anchor()
    if s <= 0:
        raise RuntimeError('Board size must be positive.')
    to_cam = toward_camera(scene, center)
    back = -to_cam
    right = Vector((-to_cam.y, to_cam.x, 0))
    up = Vector((0, 0, 1))

    save_snapshot(scene)
    clear_own_objects()
    col = rig_collection(scene)

    sun_dim(scene)
    setup_world(scene)
    setup_color(scene)
    setup_render(scene)

    # Dramatic rim behind the battlefield + subtle, cooler visibility fill.
    create_light(col, 'KG | LIGHT | ECLIPSE WARM RIM', 'SUN',
                 center + back*s*1.6 + right*s*0.45 + up*s*1.9,
                 center, (1.0, 0.64, 0.38), 2.0, angle=math.radians(3.2))
    power_scale = (s / 20.0) ** 2
    create_light(col, 'KG | LIGHT | BOARD COOL FILL', 'AREA',
                 center + to_cam*s*0.90 - right*s*0.42 + up*s*0.80,
                 center, (0.57, 0.72, 1.0), 1200*power_scale,
                 area_size=s*0.75)

    skull = find_landmark(SKULL_OBJECT_NAME, ('skull', 'cranium'))
    if skull:
        where = landmark_center(skull)
        create_light(col, 'KG | LIGHT | SKULL SIDE ACCENT', 'SPOT',
                     where + to_cam*s*0.43 - right*s*0.40 + up*s*0.65,
                     where, (1.0, 0.67, 0.43), 1700*power_scale,
                     area_size=s*0.15, spot_size=1.2)
        log('Skull accent targeted: {}'.format(skull.name))
    else:
        log('Skull not detected: set SKULL_OBJECT_NAME to enable accent.')

    hand = find_landmark(HAND_OBJECT_NAME, ('hand', 'palm'))
    if hand:
        where = landmark_center(hand)
        create_light(col, 'KG | LIGHT | HAND COOL ACCENT', 'SPOT',
                     where + to_cam*s*0.38 + right*s*0.40 + up*s*0.62,
                     where, (0.47, 0.64, 0.83), 1350*power_scale,
                     area_size=s*0.14, spot_size=1.25)
        log('Hand accent targeted: {}'.format(hand.name))
    else:
        log('Hand not detected: set HAND_OBJECT_NAME to enable accent.')

    if ADD_LOCAL_FOG:
        create_fog(col, center, s, to_cam)
    if ADD_ECLIPSE_CORONA:
        eclipse = find_landmark(ECLIPSE_OBJECT_NAME, ('eclipse', 'black_sun', 'dark_sun'))
        if eclipse:
            create_corona(col, eclipse, scene)
        else:
            log('Eclipse object not found; set ECLIPSE_OBJECT_NAME.')
    if MAKE_CAMERAS:
        create_shots(col, center, s, to_cam)
    if MAKE_MATERIAL_PRESETS:
        create_material_presets()

    log('APPLY finished! Render a test at F12. Compare shadows and landmark visibility.')
    log('If still beige/grey: disable old global/world fog before adding local mist.')
    log("If your project renders too dark: tune WORLD_STRENGTH and VIEW_EXPOSURE, or set DIM_ORIGINAL_SUNS=False.")


if __name__ == '__main__':
    main()
