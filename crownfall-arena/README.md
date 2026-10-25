# Crownfall arena — backup-first Codex Cloud handoff

**The current user request is backup/continuity only. Do not start renders, paid GPU jobs, Meshy generations, RunPod pods, purchases, account creation or runtime redesign. Do not read, copy or print credentials.** The preserved historical handoff's next-art steps are context, not fresh authorization. Read `USER_HANDOFF_AS_SUPPLIED.txt`, then the preserved `CODEX_CONTINUE_PROMPT.md` and `HANDOFF.md`; ask for new art/render work only when the user requests it.

This branch is a portable backup in `mylife-as-miles/Crownfall`, branch `codex/cloud-arena-handoff`. Arena files belong under `crownfall-arena/`; original pipeline sources are preserved unchanged in `lib/`, `scripts/`, `layout_overrides.json` and the handoff documents. Claude retains authorship of those sources. No MCP connection or port9876 is needed in the cloud.

## Recover the latest source

The urgent backup uses **ordinary Git archive chunks** because GitHub rejected the LFS upload for exhausted storage/bandwidth quota. Do **not** make a successful `git lfs pull` a recovery prerequisite for this packed scene. Fetch/checkout the complete handoff branch normally, then:

```sh
python crownfall-arena/cloud_bootstrap.py extract --arena ./crownfall-arena
python crownfall-arena/cloud_bootstrap.py check --arena ./crownfall-arena
python crownfall-arena/cloud_bootstrap.py prepare --arena ./crownfall-arena
```

Commands above run from the repository root. `extract` first detects `crownfall-arena/main/archive_parts/Crownfall_Main_v029_sorcerer.blend.zip.parts.json`. It validates every ordinary-Git part's byte count and SHA256, concatenates the listed parts in manifest order, and verifies the full ZIP byte count and SHA256 before extraction. The expected ZIP is 751,775,996 bytes, SHA256 `199a7cf53baedc271ba748dc23e94bdce66346452028a780463913f57ea9372c`. No LFS command runs when this parts manifest is present. Missing/truncated/hash-mismatched parts stop recovery explicitly.

Only the older optional direct-LFS path runs `git lfs pull` when no chunk manifest exists; it may still fail under the repository quota and is not required for the ordinary-Git backup. A Git LFS pointer is not a usable ZIP or scene. The completed ZIP contains the single basename `Crownfall_Main_v029_sorcerer.blend`, extracting to `crownfall-arena/main/Crownfall_Main_v029_sorcerer.blend` (753,580,859 uncompressed bytes). Existing unpacked scenes are kept.

The latest packed v029 scene contains its geometry, textures, armies, rig and animations. **Continue that scene instead of rebuilding.** Approximately 5.5 GB of asset archives/vendor caches and 12 GB of historical scene versions were intentionally omitted for an urgent laptop backup. A full `build_main_scene.py` rebuild can require those omitted archives. Their absence does not invalidate the packed latest scene. Verify the remote branch and every chunk completed before relying on the backup; the initial failed LFS upload contained no uploaded objects.

## Linux paths and rendering boundary

`cloud_bootstrap.py` uses `BLENDER_BIN` or `blender` on PATH. It installs nothing. `prepare` creates `.cloud_runtime/lib` and `.cloud_runtime/scripts`, replacing top-level hardcoded `CL`/`ROOT` assignments only in those copies. Original source scripts stay unchanged. `CF_ROOT` points at `crownfall-arena`; the wrapper runs the copied `scripts/render_variant.py` with `runpy`, while reading the packed scene/data from the arena directory. The cloud runner uses Linux `flock`, at most two Blender processes, timeouts and logs, without Windows `tasklist`, the hardcoded Windows executable or MCP.

No Blender launch or Linux render validation was performed while staging this helper. A later authorized local/cloud render can use:

```sh
# ONLY after the user explicitly requests rendering; never as automatic setup:
BLENDER_BIN=/path/to/blender python crownfall-arena/cloud_bootstrap.py render --arena ./crownfall-arena --allow-render --version v029_sorcerer --variant keyhalf-disc-skygrade-rim-lava2-light2-fill --pct 50
```

Camera variants append `-camgameplay`, `-camlookup` or `-camside`. Original output convention is `renders/main/<version>_<variant>/<camera>.png`. Optional variant tokens or full rebuilding may still need external files omitted from the backup; report missing data rather than downloading services or silently changing the scene. Prefer Blender5.2.x compatibility with the source built in5.2.3.

## Current source contract and honest limits

- This is the **latest Claude arena**, not the older Codex0.760m board scene. Preserve its8×8 board, **2.3m squares**, centres `((f−3.5)*2.3, (r−3.5)*2.3, 0)`, dark a1 on the−Y side, armies and current composition.
- v029 adds the four-armed creature with its original rig/embedded material and baked clips `Idle`, `Threat_Cast`, `Attack`. Keep one active action, preserve skeleton/parent scale and do not invent a canonical identity/faction.
- The supplied handoff records v029 preview renders as unfinished. Do not claim the latest placement or visuals have been accepted.
- Existing v020 GLB is a historical geometry-only export. **No v029 GLB has been exported/validated.** The packed `.blend` is the authoritative continuation source.
- No AAA/photoreal/9-of-10 claim, engine integration, VR/headset performance, hand tracking or runtime validation follows from this backup. No paid-job authorization or credentials are bundled.
- Source licence and NoAI restrictions in preserved handoffs still apply. In particular, do not send NoAI assets or their renders to generative services.
