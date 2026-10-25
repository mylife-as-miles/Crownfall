"""Convert height EXRs to normalised grey PNG previews.  args: <exr> [<exr>...]"""
import sys, os
import bpy, numpy as np
for p in sys.argv[sys.argv.index("--") + 1:]:
    img = bpy.data.images.load(p, check_existing=False)
    a = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)[..., 0]
    lo, hi = np.percentile(a, 0.5), np.percentile(a, 99.5)
    n = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    pv = bpy.data.images.new("pv", a.shape[1], a.shape[0], alpha=False)
    pv.colorspace_settings.name = "Non-Color"
    rgba = np.ones((a.shape[0], a.shape[1], 4), np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = n
    pv.pixels.foreach_set(rgba.ravel()); pv.update()
    pv.filepath_raw = p.replace("_height.exr", "_preview.png"); pv.file_format = "PNG"; pv.save()
    print("PV", pv.filepath_raw, float(lo), float(hi))
