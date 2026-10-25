"""Probe (no output asset): load the CC0 canyon banks + altar dais in ENV units and report the banks' inner-face
profile so the lava clefts / central rock can be fitted between the dais and the banks.  Writes
renders/terrain/probe_banks.json."""
import os
import sys
import json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
from terrain_common import np, bpy, R

import cf_integrate as CI

R.reset_scene()
root = T.new_collection("probe")
out = {}
for asset in ("CFCL_FromCodex_CC0Banks", "CFCL_Arch_AltarDais"):
    folder = os.path.join(T.ASSETS, asset)
    w = []
    placed = CI.append_asset(folder, root, warnings=w)
    out[asset + "_warnings"] = w
    bpy.context.view_layer.update()
    info = {}
    for n, o in placed.items():
        if o.type != "MESH" or o.hide_render:
            continue
        mn, mx = R.bounds([o])
        info[n] = dict(min=[round(v, 3) for v in mn], max=[round(v, 3) for v in mx])
        if asset == "CFCL_FromCodex_CC0Banks" and "MainBank" in n:
            M = o.matrix_world
            V = np.array([(M @ v.co)[:] for v in o.data.vertices])
            prof = {}
            for y0 in np.arange(-2.0, 21.0, 1.0):
                sel = (V[:, 1] >= y0) & (V[:, 1] < y0 + 1.0)
                if not sel.any():
                    continue
                Vs = V[sel]
                row = {}
                for zl, zh in ((-3.0, -1.5), (-1.5, -0.7), (-0.7, 3.0)):
                    s2 = (Vs[:, 2] >= zl) & (Vs[:, 2] < zh)
                    if s2.any():
                        ax = np.abs(Vs[s2, 0])
                        row[f"z{zl}..{zh}"] = round(float(ax.min()), 2)
                row["ztop"] = round(float(Vs[:, 2].max()), 2)
                prof[f"{y0:.0f}"] = row
            info[n]["inner_abs_x_by_y"] = prof
    out[asset] = info
T.write_json(os.path.join(T.RENDERS, "probe_banks.json"), out)
print(json.dumps(out, indent=1)[:6000])
