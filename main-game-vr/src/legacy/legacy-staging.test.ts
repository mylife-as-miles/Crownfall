import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_PANEL_METRES, LEGACY_STAGING_RULES, fallbackLegacyStaging, placeLegacyPanels, standInStaging, trayTouchActive } from './legacy-staging';
import type { LegacyStagingComfort } from './legacy-staging';

const degrees = (y: number, horizontal: number): number => Math.atan2(y, horizontal) * 180 / Math.PI;
const COMFORT: LegacyStagingComfort = { posture: 'seated', textScale: 100, panelDistance: 1.5, panelHeight: 0 };

/** The reading panel's centre, top and bottom elevations in degrees, and its distance from the eye. */
function panelAngles(comfort: LegacyStagingComfort) {
  const placement = placeLegacyPanels(standInStaging(comfort.posture), comfort);
  const [x, y, z] = placement.panel.position;
  const horizontal = Math.hypot(x, z);
  const half = LEGACY_PANEL_METRES.panel[1] * comfort.textScale / 200;
  return {
    centre: degrees(y, horizontal), top: degrees(y + half, horizontal), bottom: degrees(y - half, horizontal),
    distance: Math.hypot(x, y, z), floor: placement.panelFloorDegrees, placement,
  };
}

test('the reading panel sits a little below eye level by default, like the Home menu', () => {
  const panel = panelAngles(COMFORT);
  assert.ok(panel.centre < -2 && panel.centre > -6, `centre ${panel.centre.toFixed(1)} degrees`);
  assert.ok(panel.top < 13, `top ${panel.top.toFixed(1)} degrees`);
  assert.ok(panel.bottom > panel.floor, 'the panel clears the holding below it');
});

test('larger text grows the panel about its centre, rising only to clear the holding and never above the ceiling', () => {
  for (const posture of ['seated', 'standing'] as const) {
    for (const textScale of [100, 125, 150]) {
      for (const panelDistance of [1.2, 1.5, 1.8]) {
        const panel = panelAngles({ posture, textScale, panelDistance, panelHeight: 0 });
        const label = `${posture} ${textScale}% at ${panelDistance} m`;
        assert.ok(panel.bottom >= panel.floor - 0.01, `${label}: bottom ${panel.bottom.toFixed(1)} clears the holding at ${panel.floor.toFixed(1)}`);
        assert.ok(panel.top <= LEGACY_STAGING_RULES.panelCeilingDegrees + 0.01, `${label}: top ${panel.top.toFixed(1)} stays under the ceiling`);
      }
    }
  }
  const standard = panelAngles(COMFORT);
  const large = panelAngles({ ...COMFORT, textScale: 150 });
  assert.ok(large.top - standard.top < (large.top - large.bottom) / 2, 'the panel does not simply grow upward from its bottom edge');
  assert.ok(large.top < 24, `150% text keeps the top at ${large.top.toFixed(1)} degrees (it was 30.8 when the panel grew upward)`);
});

test('Menu Distance moves the panel along its line of sight, and Menu Height raises or lowers it', () => {
  const standard = panelAngles(COMFORT);
  const far = panelAngles({ ...COMFORT, panelDistance: 1.8 });
  assert.ok(Math.abs(far.distance / standard.distance - 1.2) < 0.01, 'Menu Distance 1.8 m places the panel 1.2 times farther');
  assert.ok(Math.abs(far.centre - standard.centre) < 0.01, 'in the same direction');
  const higher = placeLegacyPanels(standInStaging('seated'), { ...COMFORT, panelHeight: 0.08 }).panel.position;
  assert.ok(Math.abs(higher[1] - standard.placement.panel.position[1] - 0.08) < 1e-9, 'Menu Height raises the panel by its offset');
});

test('the touch tray is within arm\'s reach for either hand and never hides the holding', () => {
  for (const posture of ['seated', 'standing'] as const) {
    for (const textScale of [100, 125, 150]) {
      const staging = standInStaging(posture);
      const { tray } = placeLegacyPanels(staging, { ...COMFORT, posture, textScale });
      const [x, y, z] = tray.position;
      const distance = Math.hypot(x, y, z);
      assert.ok(distance <= 0.62, `${posture} ${textScale}%: the tray is ${distance.toFixed(2)} m from the eye`);
      // Shoulders sit about 0.2 m below and slightly behind the eye, 0.17 m to either side.
      for (const side of [-1, 1]) {
        const reach = Math.hypot(x - side * 0.17, y + 0.2, z - 0.05);
        assert.ok(reach <= 0.6, `${posture} ${textScale}%: ${side < 0 ? 'left' : 'right'} hand reaches it at ${reach.toFixed(2)} m`);
      }
      const half = degrees(LEGACY_PANEL_METRES.tray[1] * textScale / 200, distance);
      const [cx, cy, cz] = staging.surfaceCenter;
      const front = degrees(cy, Math.hypot(cx, cz + staging.footprint[1] / 2));
      const top = degrees(y, Math.hypot(x, z)) + half;
      assert.ok(top <= front - LEGACY_STAGING_RULES.clearanceDegrees + 0.01, `${posture} ${textScale}%: the tray's top (${top.toFixed(1)}) stays below the holding's front edge (${front.toFixed(1)})`);
    }
  }
});

test('the tray takes fingertip presses only while the head looks down past the reading panel towards it', () => {
  const comforts: LegacyStagingComfort[] = [];
  for (const posture of ['seated', 'standing'] as const) {
    for (const textScale of [100, 125, 150]) {
      for (const panelHeight of [-0.1, 0, 0.1]) {
        for (const panelDistance of [1.2, 1.5, 1.8]) comforts.push({ posture, textScale, panelHeight, panelDistance });
      }
    }
  }
  for (const comfort of comforts) {
    const label = `${comfort.posture} ${comfort.textScale}% height ${comfort.panelHeight} distance ${comfort.panelDistance}`;
    const placement = placeLegacyPanels(standInStaging(comfort.posture), comfort);
    const gate = placement.trayTouchGateDegrees;
    const [px, py, pz] = placement.panel.position;
    const bottom = degrees(py - LEGACY_PANEL_METRES.panel[1] * comfort.textScale / 200, Math.hypot(px, pz));
    const [tx, ty, tz] = placement.tray.position;
    const trayCentre = degrees(ty, Math.hypot(tx, tz));
    // Reading the panel's lowest row with the head level with it, or a little above, never enables the tray.
    assert.equal(trayTouchActive(bottom, false, gate), false, `${label}: reading the panel bottom (${bottom.toFixed(1)}) leaves the tray off`);
    assert.ok(gate <= bottom - 3, `${label}: the gate (${gate.toFixed(1)}) sits well below the panel's bottom edge`);
    // Looking at the tray with the eyes turned 15 degrees further down than the head still enables it.
    assert.equal(trayTouchActive(trayCentre + 15, false, gate), true, `${label}: a head pitched ${(trayCentre + 15).toFixed(1)} enables the tray at ${trayCentre.toFixed(1)}`);
  }
  // Hysteresis: once on, the tray stays on until the head rises past the gate by the hysteresis.
  const gate = -25;
  assert.equal(trayTouchActive(-24, false, gate), false);
  assert.equal(trayTouchActive(-25, false, gate), true);
  assert.equal(trayTouchActive(-22, true, gate), true);
  assert.equal(trayTouchActive(-25 + LEGACY_STAGING_RULES.trayTouchGate.hysteresisDegrees, true, gate), false);
});

test('before an environment reports its staging, the fallback still clears the surface', () => {
  const { panel, panelFloorDegrees } = placeLegacyPanels(fallbackLegacyStaging('seated'), COMFORT);
  const horizontal = Math.hypot(panel.position[0], panel.position[2]);
  assert.ok(degrees(panel.position[1] - LEGACY_PANEL_METRES.panel[1] / 2, horizontal) >= panelFloorDegrees - 0.01);
});
