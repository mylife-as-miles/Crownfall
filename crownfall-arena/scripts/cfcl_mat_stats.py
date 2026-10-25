"""System-python stats for the material sheets (no Blender).

python scripts/cfcl_mat_stats.py 01
Reads renders/CFCL_Materials/iterNN_cells.json + albedo/row PNGs and prints per material:
  linear albedo luminance p5/p50/p95 and mean linear RGB (from the Base-Color-as-emission pass),
  rendered display luma p10/p50/p90 and mean HSV saturation (from the lit row render).
Writes iterNN_stats.json next to the renders.
"""
import json
import os
import sys
import numpy as np
from PIL import Image

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(CL, "renders", "CFCL_Materials")
it = sys.argv[1] if len(sys.argv) > 1 else "01"
cells = json.load(open(os.path.join(D, f"iter{it}_cells.json")))["cells"]


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


out = {}
for key, (x0, y0, x1, y1) in cells.items():
    if ":" not in key:
        continue
    row, mat = key.split(":")
    alb = os.path.join(D, f"iter{it}_albedo_{row}.png")
    lit = os.path.join(D, f"iter{it}_row{row}.png")
    if not os.path.exists(alb):
        continue
    A = np.asarray(Image.open(alb).convert("RGBA"), np.float64) / 255.0
    L = np.asarray(Image.open(lit).convert("RGB"), np.float64) / 255.0
    a = A[y0:y1, x0:x1]
    l = L[y0:y1, x0:x1]
    m = a[..., 3] > 0.9
    if m.sum() < 50:
        continue
    lin = s2l(a[..., :3][m])
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    disp = l[m]
    luma = disp @ np.array([0.2126, 0.7152, 0.0722])
    mx = disp.max(1)
    mn = disp.min(1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    out[mat] = {
        "albedo_lum_p5": round(float(np.percentile(lum, 5)), 3),
        "albedo_lum_p50": round(float(np.percentile(lum, 50)), 3),
        "albedo_lum_p95": round(float(np.percentile(lum, 95)), 3),
        "albedo_rgb_mean": [round(float(v), 3) for v in lin.mean(0)],
        "render_luma_p10": round(float(np.percentile(luma, 10)), 3),
        "render_luma_p50": round(float(np.percentile(luma, 50)), 3),
        "render_luma_p90": round(float(np.percentile(luma, 90)), 3),
        "render_sat_mean": round(float(sat.mean()), 3),
        "px": int(m.sum()),
    }
    o = out[mat]
    print(f"{mat:13s} albedo p5/50/95 {o['albedo_lum_p5']:.3f} {o['albedo_lum_p50']:.3f} {o['albedo_lum_p95']:.3f}"
          f"  rgb {o['albedo_rgb_mean']}  | render luma p10/50/90 {o['render_luma_p10']:.3f} "
          f"{o['render_luma_p50']:.3f} {o['render_luma_p90']:.3f}  S {o['render_sat_mean']:.2f}")
json.dump(out, open(os.path.join(D, f"iter{it}_stats.json"), "w"), indent=1)
