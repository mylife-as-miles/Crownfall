# CFCL_Sorcerer — the supplied four-armed creature in the King's Gambit arena (first placement)

This is a first placement preview. It has no canonical identity or faction yet, and no VFX were added.
- The scene `main/Crownfall_Main_v029_sorcerer.blend` is v028_hero plus this placement. v028 itself is not modified.
- Built by `scripts/sorcerer_place.py -- v028_hero final front_eclipse_8x v029_sorcerer`.

## Source (unchanged)
- `vendor/sorcerer_v3_1/` holds the user-supplied files, copied from Downloads on 2026-10-25:
  - `Crownfall_Sorcerer_Digits_v3_1.blend`, sha256 bee6065e…;
  - `Crownfall_Sorcerer_Digits_v3_1.glb`, sha256 6044ee19….
- Rig `Crownfall_FourArm_Rig`: 142 bones (Mixamo body plus four arms, fingers, Hair_*, Cape_* and tendrils). It has no
  constraints, drivers or physics; cape, robe, hair and tendril motion are baked.
- Mesh `Crownfall_Sorcerer_Deform`: 80,910 tris and one material, `Crownfall_AgedGold_Emerald_PBR`. Its three 4K JPEG
  maps (base colour, normal, roughness-metallic) are packed.
- Clips, with exact names identical in the .blend and the GLB:

  | Clip | Frames at 24 fps | Duration |
  |---|---|---|
  | `Idle` | 1–73 | 3.0 s (GLB 3.042 s) |
  | `Threat_Cast` | 1–73 | 3.0 s |
  | `Attack` | 1–49 | 2.0 s (GLB 2.042 s) |

- Measured in the creature's own units (`inspect.json`, every frame of every clip):
  - height 0.982;
  - the lowest point (robe hem) is at z = 0 in every frame of all three clips;
  - widest reach is 0.445 from the rig axis (the Attack lunge reaches 0.37 forward).

## Placement (`placement.json`)
- **Scale:** 8 × a standing piece (2.3 m), so 18.4 m tall, i.e. uniform scale 18.737. The scale sits on the parent
  empty `CFCL_Sorcerer_Root` only. The rig keeps an identity transform under it, and the skeleton is unchanged.
- **Position:** (10, 80) m, about 70 m beyond the board's far edge and right of centre.
  - It stands on `CFCL_Sorcerer_Dais`, a stepped 16-sided drum in the arena's dais stone, rising from the abyss floor
    (z −6.9) to a flat top at z 1.0 with radius 9.84 m.
  - Yaw −7.1° turns it to face the board centre.
- **Hero composition:**
  - its head sits just under the eclipse disc;
  - it stands between the skull (left) and the stone hand (right) without overlapping either;
  - the board and both armies are unobstructed.
- **Placement candidates:** `renders/sorcerer/cand_*.png`, `candidates.json`.
  - Behind the monuments (left mesa, tower crown, right ridge) it was hidden or stacked on the skull.
  - At 10× it either sank behind the far ruins or, behind the eclipse plane, was washed out by the corona.
- **Animation:** the NLA tracks are muted; `Idle` is the active action and nothing else drives the bones.
  - Preview renders hold Idle frame 37.
  - To show another clip, set `rig.animation_data.action` to `Threat_Cast` or `Attack`.
- **Contact:** robe hem against the dais top over every frame of all three clips.

  | Clip | Penetration | Largest gap |
  |---|---|---|
  | Idle | 0 | 0 |
  | Threat_Cast | 0 | 0.3 mm |
  | Attack | 0 | 3 mm |

- **Lighting:** one restrained warm rim light, `CFCL_Sorcerer_Rim`, a 0.6H disc area light behind and above the
  creature at 5.4 kW.
  - Nothing is emissive.
  - The material and textures are untouched: the wear pass and PBR mapping never ran on it, because it was added after
    the build.

## Not done yet (by request: Blender first)
- No runtime, three.js or VR integration, and no performance numbers. A test page exists in `runtime/sorcerer_test/`
  but was not used for measurements.
- No VFX.
- No animation recording yet.
