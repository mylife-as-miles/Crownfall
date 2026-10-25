"""CFCL_Sky_Shatter - 2-D composition check of the layout through every key camera (system python + PIL, no Blender).

python scripts/sky_shatter_preview.py [tag]   -> renders/sky_shatter/layout_<tag>_<cam>.png + printed stats
Red = keep-clear zones (board / skull / hand boxes, eclipse x2.0 clear ellipse).  Gold = beyond light.
Plates: slate = in place, steel = hinged, cyan = peeling, magenta = detached.  Brown = landmasses, white dots = debris.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sky_shatter_layout as L  # noqa: E402

TAG = sys.argv[1] if len(sys.argv) > 1 else "v1"
OUT = os.path.join(L.CL, "renders", "sky_shatter")
os.makedirs(OUT, exist_ok=True)
W, H = 960, 540


def hull2(pts):
    pts = sorted(set(map(tuple, pts)))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def px(cam, P):
    U, V, z = L.project(cam, P)
    return np.stack([U * W, V * H], 1), z


dome = L.build_dome()
print("dome stats", dome["stats"])
chips = {st["key"]: L.stream_chips(st) for st in L.STREAMS}
trails = {lm["key"]: L.stream_chips(L.trail_spec(lm)) for lm in L.LANDMASSES}
for k, c in list(chips.items()) + list(trails.items()):
    print(f"stream {k}: {len(c['pos'])} chips (dropped {c['dropped']} in keep-clear zones)")
for lm in L.LANDMASSES:
    bad = L.violates_any(L.lm_hull(lm), ecl_k=2.0)
    d = {c: round(float(np.linalg.norm(np.array(lm["loc"]) - np.array(L.CAMS[c][0]))), 0) for c in ("hero", "worm")}
    print(f"landmass {lm['key']}: violates {bad} dist {d}")
for cb in L.CLOUD_BANKS:
    bad = [c for c in ("hero", "worm") if L.violates(c, L.cloud_hull(cb), ecl_k=1.3, keys=())]
    far = {c: round(float(np.linalg.norm(L.cloud_hull(cb) - np.array(L.CAMS[c][0]), axis=1).max())) for c in ("hero", "worm")}
    print(f"cloud {cb['key']}: overlaps eclipse/monuments {bad}  farthest corner {far} m (EEVEE volumetric_end 414)")

rds, ths, bdirs, bcol, bstr = L.beyond_grid()
for cam in list(L.CAMS):
    im = Image.new("RGB", (W, H), (70, 74, 82))
    dr = ImageDraw.Draw(im, "RGBA")
    # beyond shell
    BP = bdirs * L.BEYOND_R
    for i in range(len(rds) - 1):
        for j in range(len(ths) - 1):
            quad = np.array([BP[i, j], BP[i + 1, j], BP[i + 1, j + 1], BP[i, j + 1]])
            q, z = px(cam, quad)
            if not np.all(np.isfinite(q)) or np.abs(q).max() > 5000:
                continue
            s = min(1.0, bstr[i, j] / 6.0)
            c = tuple(int(255 * min(1, v * (0.45 + 0.55 * s))) for v in bcol[i, j])
            dr.polygon([tuple(p) for p in q], fill=c)
    # plates, far to near
    items = []
    for p in dome["plates"]:
        Pw = L.plate_world(p, L.DOME_R)
        loop = np.concatenate([Pw[:, 0], Pw[-1, :], Pw[::-1, -1], Pw[0, ::-1]])
        q, z = px(cam, loop)
        if not np.all(np.isfinite(q)):
            continue
        col = {"inplace": (38, 44, 58), "hinged": (64, 76, 98), "peel": (60, 140, 160), "curl": (230, 120, 40), "detached": (170, 60, 150)}[
            p["state"]]
        items.append((float(np.nanmean(z)), "poly", q, col))
    for s_ in dome["shards"]:
        q, z = px(cam, s_["pos"][None])
        if np.isfinite(q).all():
            r = max(1.0, 0.5 * s_["size"] / z[0] * L.CAMS[cam][2] / 18 * W)
            items.append((float(z[0]), "dot", (q[0], r), (120, 70, 140)))
    for cb in L.CLOUD_BANKS:
        q, z = px(cam, L.cloud_hull(cb))
        if np.isfinite(q).all():
            items.append((float(np.mean(z)), "hull", q, (150, 160, 175, 120)))
    for lm in L.LANDMASSES:
        q, z = px(cam, L.lm_hull(lm))
        if np.isfinite(q).all():
            items.append((float(np.mean(z)), "hull", q, (110, 86, 64, 255)))
    for k, c in list(chips.items()) + list(trails.items()):
        q, z = px(cam, c["pos"])
        ok = np.isfinite(q).all(1) & (z > 1)
        for (x, y), zz, s in zip(q[ok], z[ok], c["scale"][ok]):
            r = max(0.6, 0.5 * s / zz * L.CAMS[cam][2] / 18 * W)
            items.append((float(zz), "dot", ((x, y), r), (225, 220, 205)))
    items.sort(key=lambda t: -t[0])
    for z, kind, q, col in items:
        if kind == "poly":
            dr.polygon([tuple(p) for p in q], fill=col)
        elif kind == "hull":
            h = hull2([tuple(np.round(p, 1)) for p in q])
            if len(h) >= 3:
                dr.polygon(h, fill=col)
        else:
            (x, y), r = q
            dr.ellipse([x - r, y - r, x + r, y + r], fill=col)
    # ground below a 600 m horizon
    a = np.linspace(-math.pi, math.pi, 721)
    hz = np.stack([np.cos(a) * 600, np.sin(a) * 600, np.zeros_like(a)], 1)
    q, z = px(cam, hz)
    ok = np.isfinite(q).all(1) & (q[:, 0] > -200) & (q[:, 0] < W + 200)
    if ok.any():
        pts = [tuple(p) for p in q[ok][np.argsort(q[ok][:, 0])]]
        dr.polygon(pts + [(pts[-1][0], H + 10), (pts[0][0], H + 10)], fill=(46, 40, 34, 255))
    # keep-clear zones + eclipse
    rects, ell = L.zones(cam)
    for key, a_, b_, c_, d_ in rects:
        dr.rectangle([a_ * W, b_ * H, c_ * W, d_ * H], outline=(255, 40, 40), width=2)
        dr.text((a_ * W + 3, b_ * H + 2), key, fill=(255, 80, 80))
    if ell:
        eu, ev, ru, rv = ell
        dr.ellipse([(eu - ru) * W, (ev - rv) * H, (eu + ru) * W, (ev + rv) * H], outline=(255, 40, 40), width=2)
        dr.ellipse([(eu - ru / 2) * W, (ev - rv / 2) * H, (eu + ru / 2) * W, (ev + rv / 2) * H], fill=(8, 6, 6))
    dr.text((8, 8), f"{cam}  {TAG}", fill=(255, 255, 255))
    p_ = os.path.join(OUT, f"layout_{TAG}_{cam}.png")
    im.save(p_)
    print("wrote", p_)
