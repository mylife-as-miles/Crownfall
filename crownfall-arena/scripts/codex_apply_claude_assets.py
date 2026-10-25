"""FOR CODEX: bring Claude-track assets into the CURRENT open scene (run inside Codex's Blender session,
e.g. via its own bridge: python work/bridge.py work/claude_environment/scripts/codex_apply_claude_assets.py).

What it does (reversible, never saves, never deletes):
  1. Creates collection CFCL_00_CLAUDE_TRACK in the active scene.
  2. Appends the latest version of each READY Claude asset and places it via its arrangement.json.
  3. Optionally appends the eclipse/fog/light rig (cf_atmos) into CFCL_00_CLAUDE_TRACK/CFCL_Atmos.
  4. Optionally HIDES (hide_render + hide_viewport) Codex v001 counterparts for A/B comparison.
  5. Writes work/claude_environment/reviews/codex_apply_log.json listing everything it added/hid.
To revert: run with MODE="revert" -> removes CFCL_00_CLAUDE_TRACK objects and unhides what it hid.

Edit the CONFIG block below before running.  Tested headless on a COPY of Codex's saved v001 file
(see HANDOFF.md, "Apply-script validation"); not tested inside the live session.
"""
import json
import os
import sys

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
if os.path.join(CL, "lib") not in sys.path:
    sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
import importlib
import cf_integrate as I
import cf_atmos as A
importlib.reload(I)
importlib.reload(A)

# ----------------------------------------------------------------- CONFIG
MODE = globals().get("CFCL_MODE", "apply")          # "apply" | "revert"
ASSETS = globals().get("CFCL_ASSETS", [            # asset folders under work/claude_environment/assets
    "CFCL_Hero_Skull", "CFCL_Hero_Hand", "CFCL_Terrain_Ribs", "CFCL_Terrain_Islands",
    "CFCL_Terrain_Central", "CFCL_Terrain_Abyss", "CFCL_Arch_AltarDais", "CFCL_Arch_RuinsKit"])
WORLD_SCALE = globals().get("CFCL_WORLD_SCALE", 1.0)  # 1.0 = Claude monumental layout (recommended)
ARRANGEMENT = globals().get("CFCL_ARRANGEMENT", "arrangement_codex.json")  # or "arrangement.json" (research ideal)
WITH_ATMOS = globals().get("CFCL_WITH_ATMOS", True)
HIDE_V001 = globals().get("CFCL_HIDE_V001", True)
V001_PATTERNS = [r"^ENV_Hero_Skull", r"^ENV_Hero_Hand", r"^ENV_Basalt_GothicNeedle", r"^ENV_Sky_",
                 r"^ENV_Island_", r"^ENV_Abyss_", r"^ENV_Atmosphere_RenderOnlyDistanceHaze"]
LOG_PATH = os.path.join(CL, "reviews", "codex_apply_log.json")
# ----------------------------------------------------------------------------

sc = bpy.context.scene


def apply():
    if bpy.data.collections.get("CFCL_00_CLAUDE_TRACK"):
        raise RuntimeError("CFCL_00_CLAUDE_TRACK already exists - run revert first")
    root = bpy.data.collections.new("CFCL_00_CLAUDE_TRACK")
    sc.collection.children.link(root)
    log = {"scene": sc.name, "added": {}, "hidden": [], "warnings": [], "world_scale": WORLD_SCALE}
    for a in ASSETS:
        folder = os.path.join(CL, "assets", a)
        if not os.path.isdir(folder):
            log["warnings"].append(f"{a}: not present yet")
            continue
        placed = I.append_asset(folder, root, WORLD_SCALE, log["warnings"], arrangement=ARRANGEMENT)
        log["added"][a] = sorted(placed.keys())
    if WITH_ATMOS:
        acol = bpy.data.collections.new("CFCL_Atmos")
        root.children.link(acol)
        A.build_eclipse(acol)
        A.build_light_rig(acol)
        A.build_lava_mist(acol)
        A.build_fog_volume(acol)
        log["added"]["CFCL_Atmos"] = sorted(o.name for o in acol.objects)
        log["note_world"] = "World not replaced; call cf_atmos.build_world(scene) to use the Claude sky gradient."
    if HIDE_V001:
        log["hidden"] = I.hide_matching(sc, V001_PATTERNS)
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    json.dump(log, open(LOG_PATH, "w"), indent=1)
    print("CFCL_APPLY_DONE", {k: len(v) for k, v in log["added"].items()}, "hidden", len(log["hidden"]), log["warnings"])
    return log


def revert():
    log = json.load(open(LOG_PATH)) if os.path.exists(LOG_PATH) else {"hidden": []}
    root = bpy.data.collections.get("CFCL_00_CLAUDE_TRACK")
    if root:
        for o in list(root.all_objects):
            bpy.data.objects.remove(o, do_unlink=True)
        for c in list(root.children_recursive):
            bpy.data.collections.remove(c)
        bpy.data.collections.remove(root)
    I.unhide(log.get("hidden", []))
    print("CFCL_REVERT_DONE", len(log.get("hidden", [])))


if MODE == "revert":
    revert()
else:
    apply()
