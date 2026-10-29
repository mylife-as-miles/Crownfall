// Directional focus movement for the Legacy screen's free-form layouts (3D
// landmark labels, the founding card, inspection panels and dialogs). Only
// elements marked with data-nav take part, so footers and decorative buttons
// keep native Tab order without stealing arrow-key or D-pad movement.

import type { Direction } from "../settings-types";

const NAV_SELECTOR = "[data-nav]";

function isNavigable(element: HTMLElement): boolean {
  if (element.hasAttribute("disabled") || element.closest("[inert]")) return false;
  if (element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

export function navigableElements(scope: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const element of scope.querySelectorAll<HTMLElement>(NAV_SELECTOR)) if (isNavigable(element)) out.push(element);
  return out;
}

function focusElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
}

/** The focused navigable element inside `scope`, if any. */
export function currentNavigable(scope: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !scope.contains(active)) return null;
  return active.closest<HTMLElement>(NAV_SELECTOR);
}

/**
 * Moves focus to the nearest navigable element in `direction`. Candidates that
 * share the current row (or column) win over closer diagonal ones, which keeps
 * movement predictable in grids and option rows. Returns false at an edge.
 */
export function moveFocus(scope: HTMLElement, direction: Direction): boolean {
  const candidates = navigableElements(scope);
  if (candidates.length === 0) return false;
  const current = currentNavigable(scope);
  if (!current || candidates.indexOf(current) === -1) {
    focusElement(candidates[0]);
    return true;
  }
  const from = current.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = (horizontal ? x - fromX : y - fromY) * sign;
    if (primary <= 2) continue;
    // Edge distance along the movement axis, so wide neighbours are not penalised for their centre.
    const gap = horizontal
      ? Math.max(0, sign > 0 ? rect.left - from.right : from.left - rect.right)
      : Math.max(0, sign > 0 ? rect.top - from.bottom : from.top - rect.bottom);
    const overlap = horizontal
      ? Math.min(rect.bottom, from.bottom) - Math.max(rect.top, from.top)
      : Math.min(rect.right, from.right) - Math.max(rect.left, from.left);
    const offAxis = horizontal ? Math.abs(y - fromY) : Math.abs(x - fromX);
    const score = gap + (overlap > 0 ? offAxis * 0.25 : offAxis * 2 + 400);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (!best) return false;
  focusElement(best);
  return true;
}

export function focusEdge(scope: HTMLElement, last: boolean): boolean {
  const candidates = navigableElements(scope);
  const target = last ? candidates[candidates.length - 1] : candidates[0];
  if (!target) return false;
  focusElement(target);
  return true;
}

/** Focuses the first navigable element, preferring one marked data-nav-default. */
export function focusDefault(scope: HTMLElement): boolean {
  const candidates = navigableElements(scope);
  const preferred = candidates.find((element) => element.hasAttribute("data-nav-default")) ?? candidates[0];
  if (!preferred) return false;
  focusElement(preferred);
  return true;
}
