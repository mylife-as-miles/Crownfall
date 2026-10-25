"""System-python helper: write assets/CFCL_Tools_*/meta.json from the latest build logs (no Blender needed).
python scripts/tools_write_meta.py <Asset> <status READY|IN_PROGRESS> [note]
"""
import glob, json, os, re, sys

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
asset, status = sys.argv[1], sys.argv[2]
note = sys.argv[3] if len(sys.argv) > 3 else ""
d = os.path.join(CL, "assets", asset)
blends = sorted(glob.glob(os.path.join(d, f"{asset}_v[0-9][0-9][0-9].blend")))
logs = sorted(glob.glob(os.path.join(d, "build_log_v[0-9][0-9][0-9].json")))
log = json.load(open(logs[-1])) if logs else {}
arr = json.load(open(os.path.join(d, "arrangement.json"))) if os.path.exists(os.path.join(d, "arrangement.json")) else {}
meta = {"asset": asset, "status": status, "latest_blend": os.path.basename(blends[-1]) if blends else None,
        "arrangement_blend": arr.get("blend"), "units": "env (main build: world = env*4.6 + (0,0,1.94))",
        "script": {"CFCL_Tools_Arches": "scripts/tools_arches.py", "CFCL_Tools_Trees": "scripts/tools_trees.py",
                   "CFCL_Tools_Ivy": "scripts/tools_ivy.py", "CFCL_Tools_FarLandscape": "scripts/tools_tm_bake.py + scripts/tools_farlandscape.py",
                   "CFCL_Tools_Debris": "scripts/tools_debris.py"}.get(asset),
        "placements": len(arr.get("placements", [])), "note": note}
for k in ("pieces", "trees", "targets", "objects", "surfaces", "tris_total", "layers", "erosion", "remap", "tm_height"):
    if k in log:
        meta[k] = log[k]
meta["renders"] = log.get("renders")
json.dump(meta, open(os.path.join(d, "meta.json"), "w"), indent=1, default=str)
print("meta written", asset, meta["latest_blend"], status)
