// Small presentation helpers for the Legacy screen.

import { NATIONS } from "../../../shared/legacy/content/nations";
import type { NationId } from "../../../shared/legacy/types";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Formats a caller-supplied ISO timestamp; unparseable values are shown as stored. */
export function formatLegacyTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? dateFormat.format(time) : iso;
}

/** Date only, for compact rows such as honours. */
export function formatLegacyDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? dayFormat.format(time) : iso;
}

export function nationName(nationId: NationId): string {
  return NATIONS[nationId].name;
}
