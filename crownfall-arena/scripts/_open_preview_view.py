# GUI helper: after the preview .blend loads, look through the hero camera in Material Preview.
import bpy
def setup():
    sc = bpy.context.scene
    cam = bpy.data.objects.get("CF_CAM_hero") or bpy.data.objects.get("CFCL_CAM_hero")
    if cam:
        sc.camera = cam
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == 'VIEW_3D':
                for sp in area.spaces:
                    if sp.type == 'VIEW_3D':
                        sp.shading.type = 'MATERIAL'
                        sp.region_3d.view_perspective = 'CAMERA'
                        sp.overlay.show_overlays = False
    return None
bpy.app.timers.register(setup, first_interval=1.5)
