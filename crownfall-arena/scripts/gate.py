"""Regression gate for hero renders (critic v016): mean >= 0.30, crushed <= 5%, cool >= 10%."""
import sys, os, json
CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CL, "research")); import measure_refs as MR
g = json.load(open(os.path.join(CL, "layout_overrides.json"))).get("gate", {})
import numpy as np
rgb = MR.load(sys.argv[1])[0]
s = MR.stats(rgb)
# crushed EXCLUDING the eclipse disc (black by design per critic): project the eclipse into the hero camera
H, W = rgb.shape[:2]
cam, tgt, lens = np.array([0, -30.0, 9.0]), np.array([0, 20.0, 5.5]), 24.0
f = tgt - cam; f /= np.linalg.norm(f); r = np.cross(f, [0, 0, 1]); r /= np.linalg.norm(r); u = np.cross(r, f)
E, R = np.array(g.get("eclipse_world", [3.9, 92.0, 30.5])), g.get("eclipse_r", 12.4)
v = E - cam; z = v @ f
cx = W / 2 * (1 + (v @ r) / z * lens / 18.0); cy = H / 2 * (1 - (v @ u) / z * lens / (18.0 * H / W))
rp = R / z * lens / 18.0 * W / 2
yy, xx = np.mgrid[0:H, 0:W]
outside = (xx - cx) ** 2 + (yy - cy) ** 2 > (rp * 1.03) ** 2
y = rgb @ np.array([0.2126, 0.7152, 0.0722])
crushed_ex = float(((y < 0.08) & outside).sum() / outside.sum())
s["frac_luma_below_0.08"] = crushed_ex
res = {"luma_mean": (round(s["luma_mean"], 3), s["luma_mean"] >= g.get("luma_mean_min", 0.3)),
       "crushed": (round(s["frac_luma_below_0.08"], 3), s["frac_luma_below_0.08"] <= g.get("crushed_max", 0.05)),
       "cool": (round(s["frac_cool_tinted"], 3), s["frac_cool_tinted"] >= g.get("cool_min", 0.1)),
       "disc_px": [round(float(cx)), round(float(cy)), round(float(rp))], "rms": round(s["luma_rms_contrast"], 3), "warm": round(s["frac_warm_saturated"], 3)}
print("GATE", "PASS" if all(v[1] for v in res.values() if isinstance(v, tuple)) else "FAIL", json.dumps(res))
