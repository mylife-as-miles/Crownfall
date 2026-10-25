"""Apply the cf_wear pass to an existing main blend and save it as <ver>w (test harness, never overwrites the source).
Usage: python lib/run_blender.py scripts/wear_test.py -- <src_ver> <dst_ver>"""
import sys, os, json, time
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST = argv[0], argv[1]
assert SRC != DST
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{SRC}.blend"), load_ui=False)
import cf_wear as W
t = time.time()
ov = json.load(open(os.path.join(CL, "layout_overrides.json")))
log = W.apply(bpy.context.scene, ov.get("wear", {}), {})
log["seconds"] = round(time.time() - t, 1)
print("WEARLOG", json.dumps({k: v for k, v in log.items() if k != "vegnear_detail"}), flush=True)
out = os.path.join(CL, "main", f"Crownfall_Main_{DST}.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
json.dump(log, open(os.path.join(CL, "logs", f"wear_{DST}.json"), "w"), indent=1)
print("SAVED", out)
