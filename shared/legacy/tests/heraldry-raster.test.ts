import assert from "node:assert/strict";
import test from "node:test";
import { CHARGES, DIVISIONS, ORDINARIES, HERALDRY_PRESETS, describeHeraldry } from "../content/heraldry";
import { TINCTURE_SRGB } from "../environment-contract";
import { chargeRings } from "../heraldry/charges";
import { circlePoints, radialUnionPoints, signedArea } from "../heraldry/geometry";
import type { Ring } from "../heraldry/geometry";
import { HeraldryRasterizer, rasterizeHeraldry } from "../heraldry/raster";
import { HERALDRY_ASPECT_HEIGHT, heraldryPixelHeight, heraldryShapes } from "../heraldry/shapes";
import type { HeraldryAspect } from "../heraldry/shapes";
import { heraldryPathData, heraldrySvgPaths, svgHeraldry } from "../heraldry/svg";
import type { Heraldry, Tincture } from "../types";

const ASPECTS: readonly HeraldryAspect[] = ["banner", "shield", "pennant"];

function plain(field: Tincture, extra: Partial<Heraldry> = {}): Heraldry {
  return { division: "plain", field: [field, field], ordinary: "none", ordinaryTincture: "or", charge: "none", chargeTincture: "or", ...extra };
}

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function pixel(raster: { width: number; data: Uint8ClampedArray }, x: number, y: number): [number, number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [raster.data[i], raster.data[i + 1], raster.data[i + 2], raster.data[i + 3]];
}

test("shapes cover every division, ordinary and charge on every aspect, inside the unit box", () => {
  for (const aspect of ASPECTS) {
    const height = HERALDRY_ASPECT_HEIGHT[aspect];
    for (const charge of CHARGES) {
      for (const [index, division] of DIVISIONS.entries()) {
        const ordinary = ORDINARIES[index % ORDINARIES.length];
        const heraldry: Heraldry = { division, field: ["azure", "or"], ordinary, ordinaryTincture: "argent", charge, chargeTincture: "gules" };
        const shapes = heraldryShapes(heraldry, aspect, { swallowtail: index % 2 === 0 });
        assert.equal(shapes.width, 1);
        assert.equal(shapes.height, height);
        assert.ok(signedArea(shapes.outline[0]) > 0, "outline is an outer ring");
        assert.equal(shapes.layers[0].role, "field");
        assert.equal(shapes.layers[shapes.layers.length - 1].role, "border");
        assert.equal(shapes.layers.some((layer) => layer.role === "charge"), charge !== "none", `${aspect}/${charge}`);
        assert.equal(shapes.layers.some((layer) => layer.role === "ordinary"), ordinary !== "none", `${aspect}/${ordinary}`);
        for (const layer of shapes.layers) {
          assert.ok(layer.rings.length > 0, `${aspect}/${layer.role} has rings`);
          if (layer.tincture) assert.equal(layer.color, TINCTURE_SRGB[layer.tincture]);
          for (const ring of layer.rings) {
            for (let i = 0; i < ring.length; i += 2) {
              assert.ok(ring[i] >= -1e-5 && ring[i] <= 1 + 1e-5 && ring[i + 1] >= -1e-5 && ring[i + 1] <= height + 1e-5, `${aspect}/${layer.role} within bounds`);
            }
          }
        }
      }
    }
  }
});

test("rasters have the requested dimensions and are byte-identical across runs", () => {
  for (const aspect of ASPECTS) {
    for (const width of [64, 512]) {
      const height = heraldryPixelHeight(aspect, width);
      const heraldry = HERALDRY_PRESETS.korvenia[3].heraldry;
      const a = rasterizeHeraldry(heraldry, { width, height, aspect, swallowtail: true });
      const b = rasterizeHeraldry(heraldry, { width, height, aspect, swallowtail: true });
      assert.equal(a.width, width);
      assert.equal(a.height, height);
      assert.equal(a.data.length, width * height * 4);
      assert.deepEqual(a.data, b.data);
    }
  }
  assert.throws(() => rasterizeHeraldry(plain("or"), { width: 0, height: 10, aspect: "shield" }), RangeError);
  assert.throws(() => rasterizeHeraldry(plain("or"), { width: 5000, height: 10, aspect: "shield" }), RangeError);
});

test("field, division and charge pixels carry the exact contract tinctures", () => {
  for (const tincture of Object.keys(TINCTURE_SRGB) as Tincture[]) {
    const raster = rasterizeHeraldry(plain(tincture), { width: 64, height: 96, aspect: "banner", border: false });
    assert.deepEqual(pixel(raster, 32, 48), [...rgb(TINCTURE_SRGB[tincture]), 255], tincture);
  }
  const halves = rasterizeHeraldry({ ...plain("gules"), division: "per-pale", field: ["gules", "argent"] }, { width: 64, height: 96, aspect: "banner" });
  assert.deepEqual(pixel(halves, 12, 48), [...rgb(TINCTURE_SRGB.gules), 255]);
  assert.deepEqual(pixel(halves, 52, 48), [...rgb(TINCTURE_SRGB.argent), 255]);
  const star = rasterizeHeraldry(plain("azure", { charge: "mullet", chargeTincture: "or" }), { width: 128, height: 192, aspect: "banner" });
  // The banner's charge centre sits at (0.5, 0.68) in unit space; the mullet is solid there.
  assert.deepEqual(pixel(star, 64, Math.round(0.68 * 128)), [...rgb(TINCTURE_SRGB.or), 255]);
  const chief = rasterizeHeraldry(plain("vert", { ordinary: "chief", ordinaryTincture: "argent" }), { width: 100, height: 120, aspect: "shield" });
  assert.deepEqual(pixel(chief, 50, 10), [...rgb(TINCTURE_SRGB.argent), 255]);
  assert.deepEqual(pixel(chief, 50, 80), [...rgb(TINCTURE_SRGB.vert), 255]);
});

test("silhouettes are anti-aliased, transparent outside and fringe-free", () => {
  const banner = rasterizeHeraldry(plain("sable"), { width: 64, height: 96, aspect: "banner", swallowtail: true, border: false });
  const notch = pixel(banner, 32, 93);
  assert.equal(notch[3], 0, "the swallowtail notch is transparent");
  assert.deepEqual(notch.slice(0, 3), rgb(TINCTURE_SRGB.sable), "transparent pixels keep the field colour, so filtering never darkens edges");
  let partial = 0;
  let coverage = 0;
  for (let i = 3; i < banner.data.length; i += 4) {
    if (banner.data[i] > 0 && banner.data[i] < 255) partial++;
    coverage += banner.data[i] / 255;
  }
  assert.ok(partial > 20, "edges along the notch are anti-aliased");
  // Exact-area coverage: the swallowtail banner covers (1.5 - 0.12) / 1.5 of the canvas.
  const expected = 64 * 96 * ((1.5 - 0.12) / 1.5);
  assert.ok(Math.abs(coverage - expected) / expected < 0.003, `coverage ${coverage.toFixed(1)} ≈ ${expected.toFixed(1)}`);
  const shield = rasterizeHeraldry(plain("or"), { width: 100, height: 120, aspect: "shield" });
  assert.equal(pixel(shield, 1, 118)[3], 0, "the shield's lower corner is transparent");
  assert.equal(pixel(shield, 50, 60)[3], 255);
  const square = rasterizeHeraldry(plain("or"), { width: 120, height: 120, aspect: "pennant" });
  assert.equal(pixel(square, 60, 5)[3], 0, "mismatched proportions letterbox with transparency");
});

test("fimbriation outlines only charges that break the rule of tincture", () => {
  const compliant = heraldryShapes(plain("azure", { charge: "key", chargeTincture: "or" }), "banner");
  assert.equal(compliant.fimbriation, null);
  const metalOnMetal = heraldryShapes(plain("argent", { charge: "key", chargeTincture: "or" }), "banner");
  assert.equal(metalOnMetal.fimbriation?.color, TINCTURE_SRGB.sable);
  const colourOnColour = heraldryShapes(plain("gules", { charge: "key", chargeTincture: "azure" }), "banner");
  assert.equal(colourOnColour.fimbriation?.color, TINCTURE_SRGB.argent);
  const outlined = rasterizeHeraldry(plain("argent", { charge: "mullet", chargeTincture: "or" }), { width: 128, height: 192, aspect: "banner" });
  const bare = rasterizeHeraldry(plain("argent", { charge: "mullet", chargeTincture: "or" }), { width: 128, height: 192, aspect: "banner", fimbriation: false });
  assert.notDeepEqual(outlined.data, bare.data);
});

test("SVG output is deterministic, labelled with the blazon and uses contract colours", () => {
  const heraldry = HERALDRY_PRESETS.solforiz[2].heraldry;
  const svg = svgHeraldry(heraldry, { aspect: "shield", idPrefix: "ember well!", width: 64 });
  assert.equal(svg, svgHeraldry(heraldry, { aspect: "shield", idPrefix: "ember well!", width: 64 }));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1 1\.2" width="64" height="76\.8"/);
  assert.match(svg, /clipPath id="emberwell-clip"/);
  assert.ok(svg.indexOf(`aria-label="${describeHeraldry(heraldry)}"`) !== -1);
  for (const tincture of ["azure", "or", "gules"] as const) assert.ok(svg.indexOf(`fill="${TINCTURE_SRGB[tincture]}"`) !== -1, tincture);
  const paths = heraldrySvgPaths(heraldry, "banner", { swallowtail: true });
  assert.equal(paths.viewBox, "0 0 1 1.5");
  assert.match(paths.outline, /^M0 0L1 0L1 1\.5L0\.5 1\.26L0 1\.5Z$/);
  assert.deepEqual(paths.layers.map((layer) => layer.role), ["field", "ordinary", "charge", "border"]);
  assert.equal(heraldryPathData([Float32Array.from([0, 0, 1, 0, 1, 1])]), "M0 0L1 0L1 1Z");
  assert.ok(svgHeraldry(plain("or"), { aspect: "pennant", title: "A & B <c>" }).indexOf('aria-label="A &amp; B &lt;c&gt;"') !== -1);
});

/** Nonzero winding number of a point against oriented rings (y-down, positive area = outer). */
function winding(rings: readonly Ring[], x: number, y: number): number {
  let total = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (ay <= y && by > y && cross > 0) total += 1;
      else if (ay > y && by <= y && cross < 0) total -= 1;
    }
  }
  return total;
}

test("every charge stays in its box and every hole stays open under the nonzero rule", () => {
  for (const charge of CHARGES) {
    if (charge === "none") continue;
    const rings = chargeRings(charge);
    assert.ok(rings.length > 0, charge);
    assert.ok(rings.some((ring) => signedArea(ring) > 0), `${charge} has an outer silhouette`);
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) assert.ok(Math.abs(ring[i]) <= 1.0001 && Math.abs(ring[i + 1]) <= 1.0001, `${charge} stays in [-1, 1]`);
      if (signedArea(ring) >= 0) continue;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < ring.length; i += 2) {
        cx += ring[i];
        cy += ring[i + 1];
      }
      cx /= ring.length / 2;
      cy /= ring.length / 2;
      // Probe just inside the hole's own edge: nested silhouettes (the sun's disc, the flame's core) sit further in.
      const outers = rings.filter((candidate) => signedArea(candidate) > 0);
      for (let i = 0; i < ring.length; i += 6) {
        const x = ring[i] + (cx - ring[i]) * 0.03;
        const y = ring[i + 1] + (cy - ring[i + 1]) * 0.03;
        assert.equal(winding(outers, x, y), 1, `${charge}: a hole lies inside exactly one outer ring`);
        assert.equal(winding(rings, x, y), 0, `${charge}: the hole is open`);
      }
    }
  }
  assert.equal(chargeRings("eclipse"), chargeRings("eclipse"), "charges are built once and shared");
});

test("every charge is readable at 64 px: neither a speck nor a blob", () => {
  for (const charge of CHARGES) {
    if (charge === "none") continue;
    const raster = rasterizeHeraldry(plain("azure", { charge, chargeTincture: "or" }), { width: 64, height: 96, aspect: "banner", border: false });
    const gold = rgb(TINCTURE_SRGB.or);
    const blue = rgb(TINCTURE_SRGB.azure);
    let coverage = 0;
    for (let i = 0; i < raster.data.length; i += 4) {
      // Fraction of the way from the field colour to the charge colour, per pixel.
      coverage += (raster.data[i] - blue[0]) / (gold[0] - blue[0]);
    }
    const fraction = coverage / (64 * 96);
    assert.ok(fraction > 0.03 && fraction < 0.3, `${charge} covers ${(fraction * 100).toFixed(1)}% of a 64 px banner`);
  }
});

test("the eclipse shows a dark disc inside its corona and the sun a solid disc", () => {
  const size = 320;
  const height = heraldryPixelHeight("shield", size);
  const eclipse = rasterizeHeraldry(plain("sable", { charge: "eclipse", chargeTincture: "or" }), { width: size, height, aspect: "shield" });
  // Shield charges centre on (0.5, 0.5) in unit space with a 0.58-wide charge box.
  const cx = Math.round(0.5 * size);
  const cy = Math.round(0.5 * size);
  assert.deepEqual(pixel(eclipse, cx, cy).slice(0, 3), rgb(TINCTURE_SRGB.sable), "the eclipsed disc shows the field");
  const scale = (0.58 / 2) * size;
  // The corona is thickest opposite the disc's offset (towards the lower left).
  assert.deepEqual(pixel(eclipse, Math.round(cx - 0.4 * scale), Math.round(cy + 0.4 * scale)).slice(0, 3), rgb(TINCTURE_SRGB.or));
  const sun = rasterizeHeraldry(plain("sable", { charge: "sun", chargeTincture: "or" }), { width: size, height, aspect: "shield" });
  assert.deepEqual(pixel(sun, cx, cy).slice(0, 3), rgb(TINCTURE_SRGB.or), "the sun's disc is solid");
});

test("radial unions trace the outer boundary of lobed silhouettes", () => {
  const single = radialUnionPoints([[0, 0, 0.5]], 0, 0, 64);
  const circle = circlePoints(0, 0, 0.5, 64);
  for (let i = 0; i < single.length; i++) assert.ok(Math.abs(single[i] - circle[i]) < 1e-9);
  const lobed = radialUnionPoints([[0, 0, 0.3], [0.4, 0, 0.2]], 0, 0, 360);
  assert.ok(Math.abs(lobed[0] - 0.6) < 1e-9, "reaches the far side of the lobe");
  assert.ok(Math.abs(lobed[180 * 2] + 0.3) < 1e-9, "keeps the main disc opposite the lobe");
  assert.ok(signedArea(lobed) > Math.PI * 0.09, "the union is larger than the main disc");
});

test("a reused rasterizer matches fresh rasters, writes into caller targets and can release its buffers", () => {
  const rasterizer = new HeraldryRasterizer();
  const jobs: [Heraldry, HeraldryAspect, number][] = [
    [HERALDRY_PRESETS.korvenia[3].heraldry, "banner", 256],
    [HERALDRY_PRESETS.solforiz[0].heraldry, "shield", 64],
    [HERALDRY_PRESETS["kwind-09"][2].heraldry, "pennant", 300],
    [HERALDRY_PRESETS.aethelgard[0].heraldry, "banner", 128],
  ];
  for (const [heraldry, aspect, width] of jobs) {
    const height = heraldryPixelHeight(aspect, width);
    const fresh = rasterizeHeraldry(heraldry, { width, height, aspect, swallowtail: true });
    const reused = rasterizer.rasterize(heraldry, { width, height, aspect, swallowtail: true });
    assert.deepEqual(reused.data, fresh.data, `${aspect} ${width}px matches after earlier, larger jobs`);
  }
  const target = new Uint8ClampedArray(64 * 96 * 4).fill(7);
  const intoTarget = rasterizer.rasterize(plain("vert", { charge: "tree", chargeTincture: "or" }), { width: 64, height: 96, aspect: "banner" }, target);
  assert.equal(intoTarget.data, target, "the caller's buffer is filled in place");
  assert.deepEqual(target, rasterizeHeraldry(plain("vert", { charge: "tree", chargeTincture: "or" }), { width: 64, height: 96, aspect: "banner" }).data);
  assert.throws(() => rasterizer.rasterize(plain("or"), { width: 64, height: 96, aspect: "banner" }, new Uint8ClampedArray(10)), RangeError);
  rasterizer.release();
  assert.deepEqual(rasterizer.rasterize(plain("or"), { width: 8, height: 12, aspect: "banner" }).data, rasterizeHeraldry(plain("or"), { width: 8, height: 12, aspect: "banner" }).data);
});
