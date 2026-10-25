# Crownfall four-arm sorcerer v3.1

Asset-only handoff of the delivered upper-hand digit-binding correction. No game code, model URLs, runtime assets, deployment settings, or existing files are changed. These files are intentionally outside `web/public/` until integration is requested.

## Files

- `Crownfall_Sorcerer_Digits_v3_1.glb`: standalone skinned GLB, 19,382,272 bytes.
- `source/Crownfall_Sorcerer_Digits_v3_1.blend`: editable compressed Blender 4.3.2 master with packed textures, 18,647,163 bytes. Authoring source only; do not ship it in the runtime bundle.
- `README_Digits_v3_1.txt`: original delivered technical notes, unchanged. Its reference to `Digit_Isolation_Contact_Sheet.png` describes a separate diagnostic deliverable; that image is not included in this upload.
- `SHA256SUMS`: exact checksums of the three delivered files.

## Asset contents

142 bones, one skinned mesh, 71,920 vertices, 80,910 triangles, one PBR material, and three embedded 4096 × 4096 JPEG texture maps. At most four skin influences per vertex. Both upper hands have five fitted two-bone digit chains each; all 20 upper-digit controls are weighted.

Exact exported animation names (case-sensitive):

- `Idle`: 3 seconds, looping.
- `Threat_Cast`: 3 seconds, matching endpoints.
- `Attack`: 2 seconds, one-shot casting strike; body motion is not an exact loop.

GLB is Y-up; Blender source is Z-up and faces -Y. Rest height is approximately 0.981 m. Root remains fixed. Verify facing direction and scale in the target scene rather than assuming a drop-in orientation.

## Integration guidance

Load the GLB with a standard glTF skeletal-animation loader. For Three.js, use `GLTFLoader`, clone independent character instances with `SkeletonUtils.clone`, and give each instance its own `AnimationMixer`. Select the exact exported clip names above. Loop `Idle`; play `Attack` once and transition back to idle.

Crownfall's existing character loader expects its own clip mapping and separate clip URLs. This multi-clip GLB is not yet wired into that mapping. A later integration should explicitly map the exported clips, choose the intended character slot, verify scale/orientation, and profile loading, memory, and playback before shipping. No walk, run, or death clip is supplied.

## Validation and limitations

Upload verification checks the GLB header, clip names, 142-joint skin, triangle count, embedded texture dimensions, file sizes, and SHA-256 integrity. The original delivery notes describe the earlier Blender/reimport and sampled moderate-finger-curl audits; they are not a new engine validation from this upload.

Cloth and hair/tendrils use authored, baked bone animation, not runtime physics. The source hands are low-poly sculptural prongs; moderate curls were checked, but extreme poses and full anatomical fist/grip range were not validated. No new IK interface, corrective shapes, facial expressions, locomotion, collision simulation, or LODs are included.

No Crownfall engine, Three.js runtime, headset, or performance test has been performed for this asset. The 4K textures and roughly 81k triangles may require optimization for the target device. Game lint/build/tests were not run because this commit adds only isolated asset files and documentation, not executable code or runtime references.

## Rights and provenance

This is the user-provided Crownfall creature and its commissioned editing output. No independent upstream authorship or source-license verification is asserted here. This handoff does not grant or assume a new license for the supplied asset, and the repository's general code license should not be taken as a newly verified license for this source model. Confirm applicable source rights before redistribution beyond the authorized repository upload.
