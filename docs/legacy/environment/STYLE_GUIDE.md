# The Bannerhold — architectural style guide

How the kits turn blueprint masses into authored architecture. The blueprint states *what* stands
where (masses, roofs, materials, traditions, age, quality, repairs, tags); this guide states *how it
looks*. Numbers are working values for the kit tables (`kits/nations/style.ts`, the material
library) and for Blender-authored prefabs; change them here first, then in code.

## 1. Principles

1. **Silhouette and hierarchy before clutter.** Read the holding at 150 m as five or six shapes —
   hall, tower, wall line, roofscape, landmark — before any prop. Landmarks own the tallest or most
   distinctive silhouette in their district.
2. **Believable scale.** Doors 2.0–2.4 m (common) and 2.6–3.0 m (lordly); storeys 2.6 m (cottage),
   2.8–3.2 m (common), 3.6–4.5 m (lordly halls); stair risers ≤ 0.2 m; parapets 1.0–1.2 m; figures
   1.7–1.8 m. Nothing is scaled up for readability; readability comes from contrast and framing.
3. **Ground first.** Every building meets the terrain through a foundation that explains the
   slope: plinths, undercrofts, terrace cuts, stilts, podiums (`foundation.kind`). Retaining walls
   appear wherever a platform edge is marked `retaining-wall`; nothing floats and nothing sinks into the ground.
4. **Openings carry the culture.** Window shape, size, rhythm and frame material are the strongest
   nation signal after roofs (table §3). Keep a consistent bay rhythm per tradition; vary it by
   class, never randomly.
5. **Wear is specific.** Every building records its condition and repairs. Render them as authored
   marks (§6), never as uniform grime.
6. **Restraint in colour.** Each nation keeps two dominant material values and one accent family;
   heraldry supplies the saturated colour.
7. **Impressive with post-processing off.** Materials, geometry, light and composition carry the
   frame; fog and bloom are seasoning.

## 2. Kit language and modules

| Element | Rule |
| --- | --- |
| Masses | Rectangles, rounds and octagons from the blueprint; kits add plinths, wall courses, openings, chimneys, buttresses and trims inside the mass outline, and roof overhangs outside it |
| Roof forms | `steep-gable` 55–62°; `gable` 38–48°; `half-hip` gable with the top third hipped; `hip` 35–45°; `pyramid` and `spire` (spire height ≥ 1.2 × base); `conical` on round towers; `lean-to` 15–25° rising toward local −Z (or −X); `curved-ridge` a keel or upturned-eave profile (§4, §5); `sod-gable` 35–45° with turf to the eaves; `flat-parapet` parapet 0.8–1.2 m; `dome`, `barrel-vault`; `sawtooth` north-light teeth at 3–4 m pitch; `setback-crown` stepping back 1–1.5 m per stage; `open-frame` bare rafters or steel frame (unfinished work) |
| Ridge heights | Use the blueprint `ridgeHeight` exactly: it is checked against VR eyelines and camera clearances |
| Overhangs | Per tradition (§3); verges only on gables |
| Chimneys and stacks | Blueprint `chimney`/`stack` masses are fixed; tags `chimney`/`smoke` add small flues and smoke sources |
| Heraldry | Only at `slots.bannerMounts`; kinds `standard`, `shield`, `pennant`, `emblem`, `tapestry`, `veiled-standard`, `signal-flag` |
| Openings LOD | `lod: hero` gets full openings, frames and courses at every desktop profile; `mid` loses courses on low; `background` keeps silhouette, roof and a window rhythm only |

## 3. Construction traditions

Blueprint `tradition` keys and the parameters the architecture kit needs. Columns map onto
`TraditionStyle` in `kits/nations/style.ts` (window shape, width × height, sill, bay; door; plinth;
overhang/verge; jetty, buttresses, parapet gables, string courses). "Kit kind" names the existing
style kind or a kind the kit table still needs.

| Tradition | Kit kind | Walls | Plinth | Windows (w × h, sill, bay, frame) | Door | Overhang / verge | Features | Roofs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kv-ashlar-gothic` | gothic | Basalt ashlar; black marble only on the costliest surface | Ashlar +0.2 m, water table | Lancet 1.1 × 2.6, sill 1.1, bay 3.2, limestone frames 0.17 proud 0.18 | Pointed 1.7 × 2.9, limestone | 0.3 / 0 | Stepped buttresses, string courses, parapet gables | Steep-gable slate or lead (lead trims), spires, conical turrets |
| `kv-rubble-jettied` | jettied | Rubble ground storey, oak frame and lime plaster above | Rubble +0.12 | Rect 0.85 × 1.1, sill 0.95, bay 2.2, dark oak | Rect 1.05 × 2.05 | 0.45 / 0.32 | Jetty 0.38 m per upper storey on the long faces | Steep-gable slate or shingle, half-hips |
| `kv-cottage` | cottage | Low rubble | Rubble +0.1 | Small 0.62 × 0.7, sill 0.95, bay 2.6 | Rect 0.95 × 1.85 | 0.55 / 0.38 | Deep window reveals | Steep-gable thatch or shingle; lean-tos against rock |
| `sf-cut-sandstone` | desert | Sandstone ashlar, lime-plastered faces | Ashlar +0.12, water table | Round-headed 0.8 × 1.4 behind lattice screens, sill 1.4, bay 2.8; lordly faces add 1.2 × 2.6 lattice bays | Round-headed 1.5 × 2.6; iwan portals 4–8 m wide | 0.15 / 0.1 | Carved frieze bands, crenellated parapets, windcatcher vents | Flat-parapet, glazed domes, windcatchers |
| `sf-courtyard-house` | desert (court) — new kind | Mudbrick plaster over rubble | Rubble +0.2 | Street side small and high 0.5 × 0.6, sill 2.0; court side 0.9 × 1.6 | Round-headed 1.1 × 2.1 | 0.1 / 0 | Blank street walls, drain spouts, palm-timber shade frames | Flat-parapet roof terraces, small windcatchers |
| `sf-works` | works — new kind | Sandstone rubble and iron sheet | Rubble +0.1 | Slits 0.3 × 1.0 and vents | Wide 3 × 3 | 0.3 / 0.2 | Flues, iron canopies | Flat, iron lean-tos, chimneys |
| `ag-longhall-timber` | timber | Black oak staves and planks | Fieldstone +0.4 | Small 0.5 × 0.5, sill 1.2, bay 3.4, or smoke louvres only | Round-headed 1.4 × 2.4, carved frame | 0.8–1.2 / 0.6 | Crossed carved bargeboards at the gable peaks, outer posts | Curved-ridge keel (≈ 25° at the eaves to ≈ 50° at the ridge), sod or split shingle |
| `ag-turf-house` | turf — new kind (cottage today) | Wattle and daub, turf | Fieldstone footing +0.1; pit-houses sunk 0.6–1 m | 0.4 × 0.4 or none; smoke holes | Low 0.9 × 1.7 | 0.6 / 0.4 | Turf down to 0.7–2.4 m eaves | Sod-gable, reed thatch |
| `ag-fieldstone-work` | earthwork — new kind | Dry-laid fieldstone, earth banks | — | — | — | — | Kerbs; standing stones 3.5–5.5 m tall | None |
| `kw-charter-heritage` | heritage — new kind | Soot brick on cast-iron frames | Granite +0.3 | Tall rect 1.2 × 2.4 with lattice screens, sill 0.9, bay 3.0; shopfronts 3 × 2.8 | Rect 1.6 × 2.8 under a tiled canopy | 1.2 / 0.8 | Upturned curved eaves on brackets, brick string courses, lanterns | Curved-ridge with upturned eaves in dark glazed tile; copper barrel vaults |
| `kw-ferroconcrete` | ferro — new kind | Board-marked concrete | Concrete +0.15 | Rect 1.4 × 1.5 in a strict grid, sill 0.9, bay 3.0, steel frames | Rect 1.0 × 2.2, steel | 0.2 (parapet) | External galleries every storey on worker blocks, stair cores, balconies, rooftop tanks and vents | Flat-parapet, felt |
| `kw-sheet-industrial` | sheet — new kind | Corrugated sheet on riveted steel, soot brick bases | Concrete +0.3 | High strip windows 2.0 × 0.6, sill 3.0; sawtooth glazing | Roller doors 3.6 × 4.0 | 0.4 / 0.3 | Riveted frames, pipe racks, ladders, container stacking | Sawtooth, barrel-vault, low gable, lean-to |

Until a kind exists in the kit table, a nation must not fall back to another nation's tradition:
Kwind-09 rendered with jettied timber frames would read as the medieval village the brief forbids.

## 4. Materials

Blueprint material keys are `<nation-prefix>-<name>`. Korvenia, Solforiz and Aethelgard keys have
definitions in `materials/library.ts`; Kwind-09 keys need theirs (the keyword fallback maps
`kw-glass-grid` and `kw-brick-soot` to stone).

| Key | Look | Base colour (sRGB) | Roughness / metalness |
| --- | --- | --- | --- |
| `kv-basalt-ashlar` | Dark basalt blocks, fine joints, lichen at the base | `#46434b` | 0.82 / 0 |
| `kv-basalt-rubble` | Coursed rubble, pale mortar | `#4a474c` | 0.9 / 0 |
| `kv-oak-frame-plaster` | Black oak frame, warm lime plaster | `#a69d8e` | 0.88 / 0 |
| `kv-slate`, `kv-lead`, `kv-shingle`, `kv-thatch-dark`, `kv-timber-raw` | Roofs and raw timber | `#363a43`, `#6c7178`, `#54453a`, `#4a3d2c`, `#6a5038` | 0.7, 0.45 (metal 0.55), 0.86, 0.97, 0.82 |
| `kv-black-marble` | Polished black marble with grey and gold veins (porch, dial) | `#19181b` | 0.22 / 0 |
| `sf-sandstone-ashlar`, `sf-sandstone-rubble`, `sf-mudbrick-plaster`, `sf-lime-plaster` | Warm sandstone and earth plasters | `#b38a5a`, `#a07a52`, `#a87f57`, `#d8c8a8` | 0.85–0.93 / 0 |
| `sf-glazed-tile`, `sf-palm-timber`, `sf-iron-sheet` | Green-glazed dome tile, palm timber, iron sheet | `#3d6b78`, `#7a5a3a`, `#5a4a40` | 0.35, 0.85, 0.6 (metal 0.6) |
| `ag-oak-stave`, `ag-oak-plank`, `ag-oak-frame`, `ag-oak-palisade` | Tarred black oak; new work pale (`#b08a5a`) | `#4a3828` | 0.85 / 0 |
| `ag-sod-turf`, `ag-reed-thatch`, `ag-wattle-daub`, `ag-fieldstone`, `ag-oak-shingle` | Turf, reed, daub, fieldstone, shingle | `#4a5232`, `#7a6844`, `#8e8270`, `#5a5650`, `#54453a` | 0.86–0.98 / 0 |
| `kw-concrete` | Board-marked concrete, rain streaks | `#77787a` | 0.9 / 0 |
| `kw-brick-soot` | Soot-darkened brick, pale lime joints | `#4a3832` | 0.88 / 0 |
| `kw-steel-panel` | Painted steel panels, chipped edges | `#8f99a3` | 0.5 / 0.6 |
| `kw-corrugated-sheet` | Galvanised corrugated sheet | `#7d8288` | 0.55 / 0.7 |
| `kw-rusted-steel` | Rusted plate, containers, tanks | `#7a4a30` | 0.7 / 0.4 |
| `kw-glass-grid` | Wired glazing in a steel grid (dark by day, lit galleries at night) | `#1b1d24` | 0.18 / 0 (glass shading) |
| `kw-ceramic-tile` | Dark glazed roof tile | `#2f3a44` | 0.4 / 0 |
| `kw-copper-verdigris` | Green copper roofs | `#4f8a7c` | 0.5 / 0.6 |
| `kw-asphalt-felt` | Flat-roof felt | `#2a2c30` | 0.95 / 0 |
| `kw-timber-lattice` | Lattice screens and pergolas | `#5a4030` | 0.8 / 0 |

## 5. Palettes

Two dominant values and one accent family per nation; heraldry supplies saturated colour. The
blueprint `atmosphere.palette` carries each nation's swatches, including `crownField` and
`crownBorder` for the national standard (crown heraldry) at the Herald's Station.

| Nation | Dominant | Secondary | Accent | Crown standard |
| --- | --- | --- | --- | --- |
| Korvenia | Basalt `#2e2c31`, slate `#3a3d45` | Plaster `#b9b0a0`, limestone repairs `#a59f92` | Restrained gilt `#c9a23a`, purpure `#5e3a78`, corona `#e8e0f0` | `#4b3462` / `#b7954a` |
| Solforiz | Sandstone `#c8a678`, lime plaster `#d9c7a6` | Mudbrick `#b98c62`, shadow `#5a3e2c` | Sulfur `#d6c25a`, glazed tile `#2f6f6a` | `#8c5a2b` / `#c9a050` |
| Aethelgard | Black oak `#2f2620`, turf `#5d6b3c` | Fieldstone `#77746c`, reed `#a08d5f` | Red moss `#7a3b2a`, ember `#d97a3a`, new oak `#b08a5a` | `#7a2420` / `#8f8a7c` |
| Kwind-09 | Concrete `#6f7276`, soot brick `#4a3832` | Steel `#97a1ab`, wet asphalt `#1f2328` | Sign cyan `#3fd2e2`, sodium `#ffb05c`, verdigris `#4f8a7c` | `#1b232e` / `#3fd2e2` |

## 6. Signage of age, class and repair

**Quality** sets detail and material allowance:

| Quality | Allowed |
| --- | --- |
| noble | One per holding (the hall). Full tradition detail, the costliest material in the holding, ornament, best glazing; shows its age but not neglect |
| fine | Dressed material, regular openings, trims and frames, cared-for repairs |
| common | Plain tradition detail, mixed repairs, cheaper roof materials appearing in patches |
| poor | Smallest openings or none, salvaged and mismatched materials, tarpaulins, props, sag |

**Condition** sets weathering: `new` clean edges and pale timber; `sound` light grime at the base;
`worn` rounded arrises, dulled roofs, moss in joints; `weathered` streaks, lichen, missing roof
units, faded paint; `damaged` broken openings, sag, visible holes; `ruinous` roofless or partly
fallen, weeds inside; `under-construction` bare frames, scaffold, stacked material.

**Repairs** are specific marks, placed on the mass the repair names:

| Repair | Mark |
| --- | --- |
| rebuilt-courses | A horizontal band of paler or newer material with a clean seam (the repaired watchtower's crown) |
| patched-roof | A rectangle of fresher roof material in an older slope |
| boarded-opening | Planks or sheet across a window or door |
| new-timber, spliced-post | Pale unweathered members among dark ones; a visible scarf joint |
| iron-strapping | Dark iron bands around quoins, posts or a tank |
| welded-plate | Unpainted bright plate with weld seams over rusted steel |
| tarpaulin | Oiled cloth or hide weighted with stones or rope |
| lime-wash, fresh-render | One face brighter than the others |
| re-thatched, re-shingled | A fresher band of roof covering; the rest moss-dark |
| buttress | Raking timber shores or steel props against a leaning face |
| salvaged-stone | Mismatched dressed blocks in a rubble wall |
| replaced-gate, new-lintel | New leaves or lintel in raw material, not yet weathered or carved |

## 7. Heraldry and standards

The banner's heraldry appears only at `bannerMounts` whose `heraldry` is `player` and whose
`minHallTier` the state has reached: the gate shield, the hall emblem, the founding standard, the
muster standards, later tapestries, shields and pennants. `crown` mounts show the nation's
standard in the crown colours (veiled in Korvenia, a corporate signal flag in Kwind-09); `veiled`
mounts are always veiled. The allied Great House flies its heraldry at its distant seat; the rival
house's colours appear only at the frontier toward the rival's nation and on the captive marker.
Before a banner exists, cloth is undyed — never placeholder heraldry.

## 8. Dressing and vegetation

Dressing clusters (`dressing[]`) are authored, each with a reason (a woodpile by a kitchen door,
laundry across a court, a cart waiting at a gate). Kits may expand a cluster into a few props but
never scatter props without a cluster. Vegetation zones (`vegetation[]`) carry species and seeded
density; scatter avoids buildings, routes and water and thins near landmarks. Lone trees are
single authored instances (the yew in Korvenia's Honour Court, Aethelgard's old ash, Kwind-09's
ginkgo).

## 9. Never

Generic cube buildings; identical repeated houses (the validator rejects repeated residential
massing); random scatter; featureless terrain; stock primitives at hero framings; excessive bloom;
neon clutter; Kwind-09 as a neon medieval village; any nation rendered in another nation's
tradition or materials; copied architecture, assets or layouts from existing games — inspiration
only (the painterly scale of *Expedition 33*, FromSoftware's architectural storytelling and major
fantasy RPG settlements, as the brief names them).
