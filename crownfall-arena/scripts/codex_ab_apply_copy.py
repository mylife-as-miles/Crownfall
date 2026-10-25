"""A/B test on a COPY of Codex's latest saved scene (never touches Codex's file or live session).

A = Codex's saved scene rendered as-is through its own front camera.
B = same copy with Codex's hero skull/hand/altar support HIDDEN (not deleted) and the Claude-track
    skull, upright hand and carved altar drum placed at Codex's own foot points.
Outputs: renders/codex_ab/<tag>_A_codex.png, <tag>_B_codex_plus_claude.png, side-by-side, json log,
         and preview/CodexV002_plus_Claude_<tag>.blend (the B scene, for opening in a separate window).

Usage: python lib/run_blender.py scripts/codex_ab_apply_copy.py --timeout 3000 -- <tag>
"""
import sys, os, re, json, math, time, shutil
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
ROOT = os.path.dirname(os.path.dirname(CL))
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAG = argv[0] if argv else "ab01"
SRC = os.path.join(ROOT, "outputs", "Crownfall_Environment_v002", "Crownfall_Environment_v002_WORKING.blend")
OUT = os.path.join(CL, "renders", "codex_ab")
os.makedirs(OUT, exist_ok=True)
COPY = os.path.join(CL, "preview", f"_codex_v002_copy_{TAG}.blend")
LOG = {"tag": TAG, "source": SRC, "source_mtime": time.ctime(os.path.getmtime(SRC)), "hidden": [], "added": [], "notes": []}
t0 = time.time()

# 1) copy first, open the copy (the original is only read by shutil)
shutil.copy2(SRC, COPY)
bpy.ops.wm.open_mainfile(filepath=COPY, load_ui=False)
sc = bpy.context.scene
LOG["scene"] = sc.name
LOG["engine"] = sc.render.engine
cam = bpy.data.objects.get("ENV_Camera_01_CinematicFront") or sc.camera
sc.camera = cam
LOG["camera"] = {"name": cam.name, "loc": [round(v, 3) for v in cam.location], "lens": cam.data.lens}
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1400, 788, 100
sc.render.image_settings.file_format = "PNG"
if sc.render.engine == "CYCLES":
    sc.cycles.samples = min(sc.cycles.samples, 64)
    LOG["notes"].append("Cycles samples capped at 64 for the A/B (same for A and B)")
else:
    try:
        sc.eevee.taa_render_samples = min(sc.eevee.taa_render_samples, 64)
    except Exception:
        pass


def render(path):
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return round(time.time() - t, 1)


# 2) A: Codex as-is
LOG["A_seconds"] = render(os.path.join(OUT, f"{TAG}_A_codex.png"))

# 3) hide Codex counterparts (+ all their descendants)
PATTERNS = [r"^ENV_Hero_CC0Skull", r"^ENV_Hero_Skull", r"^ENV_Hero_Hand", r"^ENV_Altar_BoardSupport$"]
rx = [re.compile(p) for p in PATTERNS]
foot = {}
for o in list(sc.objects):
    if any(r.search(o.name) for r in rx):
        foot.setdefault(o.name, [round(v, 3) for v in o.matrix_world.translation])
        stack = [o]
        while stack:
            x = stack.pop()
            if not x.hide_render:
                x.hide_render = True
                x.hide_viewport = True
                LOG["hidden"].append(x.name)
            stack.extend(x.children)
LOG["codex_hero_origins"] = foot

# 4) append Claude assets and move each group so its main object lands at Codex's foot point
ctx = json.load(open(os.path.join(ROOT, "work", "environment_context.json")))
cb = ctx.get("connected_banks10", {})


def foot_point(key, default):
    for k, v in cb.items():
        if key in k and isinstance(v, dict) and "foot_point_m" in v:
            return Vector(v["foot_point_m"])
    return Vector(default)


SKULL_FOOT = foot_point("Skull05", (-3.34, 7.13, -0.32))
HAND_FOOT = foot_point("Hero_Hand", (3.53, 9.91, -0.14))
col = bpy.data.collections.new("CFCL_00_CLAUDE_TRACK_AB")
sc.collection.children.link(col)


def append_group(blend, main_name, foot, yaw_deg, names=None):
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if (names is None or n in names)]
    objs = [o for o in dst.objects if o is not None]
    for o in objs:
        col.objects.link(o)
    main = next(o for o in objs if o.name.startswith(main_name))
    m0 = main.matrix_world.copy()
    m1 = Matrix.Translation(foot) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
    # keep the group's relative layout; drop m0's own yaw so yaw_deg is absolute
    loc0, rot0, _ = m0.decompose()
    m0_noscale = Matrix.Translation(loc0) @ rot0.to_matrix().to_4x4()
    delta = m1 @ m0_noscale.inverted()
    for o in objs:
        if o.parent is None:
            o.matrix_world = delta @ o.matrix_world
    LOG["added"] += [o.name for o in objs]
    return objs


A = os.path.join(CL, "assets")
# skull: face ~30 deg toward the board/camera from Codex's foot point
sk = append_group(os.path.join(A, "CFCL_Hero_Skull", "CFCL_Hero_Skull_v004.blend"), "CFCL_Hero_Skull", SKULL_FOOT, 30.0)
# hand: upright READY v004 pose, palm toward the board
hd = append_group(os.path.join(A, "CFCL_Hero_Hand", "CFCL_Hero_Hand_v004.blend"), "CFCL_Hero_Hand", HAND_FOOT, -20.0)
# altar drum only (identity at world origin; the optional dais floor is NOT used in Codex's court)
drum_names = ["CFCL_Arch_AltarDrum", "CFCL_Arch_AltarDrum_Bronze", "CFCL_Arch_AltarOffering_Pebbles", "CFCL_Arch_AltarOffering_Bones"]
with bpy.data.libraries.load(os.path.join(A, "CFCL_Arch_AltarDais", "CFCL_Arch_AltarDais_v003.blend"), link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n in drum_names]
for o in dst.objects:
    if o is not None:
        col.objects.link(o)
        LOG["added"].append(o.name)
LOG["skull_foot"] = list(SKULL_FOOT)
LOG["hand_foot"] = list(HAND_FOOT)

# 5) B render + save the B scene copy for viewing
LOG["B_seconds"] = render(os.path.join(OUT, f"{TAG}_B_codex_plus_claude.png"))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CL, "preview", f"CodexV002_plus_Claude_{TAG}.blend"), compress=True)
try:
    os.remove(COPY)
except OSError:
    pass
LOG["seconds_total"] = round(time.time() - t0, 1)
json.dump(LOG, open(os.path.join(OUT, f"{TAG}_log.json"), "w"), indent=1)
print("AB_DONE", json.dumps({k: LOG[k] for k in ("engine", "camera", "A_seconds", "B_seconds", "seconds_total")}))
print("HIDDEN", len(LOG["hidden"]), LOG["hidden"][:12])
