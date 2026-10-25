import sys, time, os
sys.path.insert(0, r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment\lib")
import bpy, numpy as np
import cf_sdf as S, cf_materials as M, cf_render as R
t0=time.time()
R.reset_scene()
def f(P):
    Q=S.warp(P,0.04,2.0,seed=3)
    d=S.ellipsoid(Q,(0,0,1.0),(0.7,0.85,0.75))
    d=S.smin(d,S.ellipsoid(Q,(0,-0.45,0.55),(0.5,0.4,0.4)),0.15)
    for sx in (-1,1):
        d=S.ssub(d,S.sphere(Q,(0.25*sx,-0.8,0.85),0.2),0.05)
    d=d+0.015*S.ridged(P,6,3,seed=2)
    return d
v,q=S.mesh_sdf(f,(-0.9,-1.0,0.0),(0.9,1.0,1.9),0.015)
ob=S.to_blender_mesh("SmokeSkull",v,q)
M.assign(ob,"BoneStone")
print("mesh time",time.time()-t0, "tris", R.tri_count([ob]))
col=R.append_board()
print("board objs",[o.name for o in bpy.data.objects if o.users_collection and o.type=='MESH'][:8])
for o in col.all_objects: o.location.x += 1.2
R.setup_world(bpy.context.scene)
R.turntable([ob],os.path.join(R.CL,"renders","_smoke"),views=(("front",-25,15),),res=(800,600),samples=32)
print("total",time.time()-t0)
