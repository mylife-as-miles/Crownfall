# Korvenia — design sheet: the holding on the scarp

*The Grand Duchy of Korvenia — occult Grand Duchy beneath an eclipse.* Reversible production
default (`status: "production-default"`); not a canonical or launch choice. Data:
`shared/legacy/environment/blueprint/nations/korvenia.ts`. Maps: `maps/korvenia-*.png`, generated
schedule `maps/korvenia-schedule.md`. All names are working placeholders.

## Terrain logic — vertical

The south flank of a basalt scarp. The land falls 8.5 % to the south and 3 % to the east into a
13 m ravine. A rock spur carries the **Banner Court at +9 m** and the **Record shelf at +6.5 m**
beneath crag ribs that climb to a wooded crest about 28 m up, 125 m north — low enough that the
hall and keep break the skyline from the valley. The **Muster Terrace** is cut and filled level at
0 m below the court's 9 m retaining wall. The lower town steps from −1 m to −5 m toward the ravine.
A valley brook runs about 14 m below the datum, crossed by the national road's stone bridge beside
the holding's mill. Every level change is a built edge: retaining walls, the Muster Stair, the
Record Steps, parapets.

## Organisation — narrow, stepped, enclosed

- **A Banner Court (+9 m).** The Banner Hall (13 × 26 m, eaves 11 m, ridge 22 m, lead roof) with
  a black marble porch on its south gable, a six-storey keep with a lead spire (34 m above the
  floor), a stair turret and a flèche; the Lodging (three storeys, slate) where the household
  actually lives, its oriel over the court; the kitchen range; the unfinished West Range (walls to
  4 m, scaffold, idle treadwheel crane); the Court Gate at the head of the Muster Stair; the Honour
  Court with eight empty candle niches, a black marble eclipse dial and an old yew.
- **B Muster Terrace (0 m).** A packed-earth yard under the court's retaining wall: the dais with
  its two standards, eight file posts a–h and the nominated Pawn's marked stone on axis, the
  armoury, the timber levy hall, drill square, pells and butts. The levy is watched from above.
- **C Lower Town.** Lantern Street (3.6 m) with continuous jettied gables to the street, Rock Lane
  with lean-to houses against the rock, Wall Lane with the poorest thatched cottages by the south
  wall, the Well Square and Lantern Shrine. Twenty-one dwellings of every class: the reeve's ashlar house,
  three-storey retainers' houses, a four-storey weavers' tenement propped with shores, a roofless
  burnt house, labourers' lean-tos.
- **D Forge and Granary Yards.** Smithy (forge glow visible from the West Gate), cooper and
  carpenter's workshop, tithe granary on staddles, tithe barn, builder's yard.
- **E West Gate and Herald's Station.** A two-towered gatehouse on the town wall where the road
  arrives; the herald tower with its raven loft, post room and notice board; the post stable.
- **F Record Shelf (+6.5 m).** The War Record: a tall gabled archive with a tracery window and an
  iron-banded record tower, joined to the Lodging by a gallery bridge; the Record Steps fall to
  Rock Lane.
- **G Outer Territory.** The valley meadow, the brook and mill, strip fields with a hedge and a
  disputed boundary stone, an orchard, the scarp forest and beacon, the road's toll tower.

## Dominant shapes and skyline

Vertical, pointed and dark against a luminous horizon: the keep spire and hall gable on the rock,
the flèche, conical turrets, a sawtooth of steep slate gables stepping down the street, the
pale-crowned repaired watchtower at the south-east corner over the ravine, the burnt north tower
as a broken shell. Beyond: the allied Great House's many-spired cloister-estate on the next ridge
above pale quarry scars (bearing 8°, 3.6 km), the abbey (285°, 2.2 km), the market town (300°,
7 km), the capital's forest of black spires at the end of the valley road (312°, 20 km, always
"the capital"), snow-streaked northern peaks.

## Construction traditions

`kv-ashlar-gothic` for lordly, civic and sacred buildings; `kv-rubble-jettied` for the common
house; `kv-cottage` for labourers' cottages and lean-tos (parameters in `STYLE_GUIDE.md` §3).
Black marble is the one luxury and appears only on the hall's porch and the honour dial.

## Landmark translations

| Landmark | Korvenia |
| --- | --- |
| Banner Hall | Lead-roofed Gothic hall and keep on the rock, black marble porch, emblem over the door, veiled standard on the keep, two shuttered gallery lancets (too large for the new house) |
| Muster Grounds | Earth yard and stone dais under the 9 m retaining wall; the Muster Stair climbs the wall to the Court Gate |
| War Record | Gabled archive and record tower on its own shelf, previous house's records below, the banner's shelf mostly empty, the war table's markers |
| Herald's Station | Herald tower with raven loft and post room by the West Gate; the Grand Duchy's riders and notices arrive here first |
| Main gate and road | West Gate → the national road over the brook bridge, up the valley to the capital |
| Unfinished structure | West Range, completes at hall tier 1 |
| Ceremonial place | Honour Court: eight candle niches, black marble dial, yew |

## Life

Sentries on the south wall and the north curtain, gate guards, the smith at bellows, anvil and
quench, a Grand Duchy messenger riding in from the valley to the Herald's Station, the levy drilling
before the dais, the herald at the notice board, the War Record's scribe crossing to the hall, a
mason at the West Range, a water carrier at the Well Square, the dyer's daughter carrying cloth,
a washer on the ravine path, a carter between granary and post stable, children on Lantern Street,
farmers in the strips, a merchant's cart on the road.

## Atmosphere

Eclipse noon: the sun held behind the black disc, a corona low in the west-south-west (bearing
245°, elevation 20°), a dusk band all round the horizon. Violet-grey sky, long violet shadows,
ambient never black; braziers, ritual candles, lanterns and the forge as small warm accents. Wind
toward 70° moves banners and smoke. No global bloom.

## Views

Establishing from above the valley meadow south-south-east (the way a messenger first sees it):
lower town and watchtower in the lower third, the hall gable and keep on the rock above the Muster
Stair at the centre, the West Gate and the road toward the capital at the left, the allied spires
top right. VR: the viewer looks toward bearing 352° (north, toward the scarp); the scarp rises
beyond the far edge as a backdrop.
