// National Muster file claims. The allied Great House and the crown hold some
// pawn files in every nation's formation; a minor banner nominates its
// representative from whatever remains (four or five files). Claims change
// identity and narrative stakes only: the formation itself is always the
// standard chess position. Labels are working placeholders.

import { NATION_HOUSES } from "./houses";
import type { FileLetter, NationId } from "../types";

export const FILES: readonly FileLetter[] = ["a", "b", "c", "d", "e", "f", "g", "h"];

export interface MusterFileClaim {
  file: FileLetter;
  /** The allied Great House id or "crown:<nation>". */
  houseId: string;
  label: string;
}

function crown(nationId: NationId): string {
  return `crown:${nationId}`;
}

export const MUSTER_FILE_CLAIMS: Readonly<Record<NationId, readonly MusterFileClaim[]>> = {
  korvenia: [
    { file: "d", houseId: NATION_HOUSES.korvenia.allied, label: "House Ombreval's household guard" },
    { file: "e", houseId: NATION_HOUSES.korvenia.allied, label: "House Ombreval's household guard" },
    { file: "f", houseId: crown("korvenia"), label: "the Grand Duchy's own guard" },
  ],
  solforiz: [
    { file: "c", houseId: NATION_HOUSES.solforiz.allied, label: "House Qarathun's gate levy" },
    { file: "d", houseId: NATION_HOUSES.solforiz.allied, label: "House Qarathun's gate levy" },
    { file: "e", houseId: crown("solforiz"), label: "the Caliphate's household levy" },
  ],
  aethelgard: [
    { file: "d", houseId: NATION_HOUSES.aethelgard.allied, label: "House Stanhyrst's spears" },
    { file: "e", houseId: NATION_HOUSES.aethelgard.allied, label: "House Stanhyrst's champion file" },
    { file: "f", houseId: crown("aethelgard"), label: "the Blood-Throne's oathsworn" },
    { file: "h", houseId: crown("aethelgard"), label: "an older banner sworn to the Blood-Throne" },
  ],
  "kwind-09": [
    { file: "c", houseId: crown("kwind-09"), label: "the Zaibatsu's security detail" },
    { file: "d", houseId: NATION_HOUSES["kwind-09"].allied, label: "House Kanemura-Lok's contract file" },
    { file: "e", houseId: NATION_HOUSES["kwind-09"].allied, label: "House Kanemura-Lok's contract file" },
  ],
};

export function musterClaimFor(nationId: NationId, file: FileLetter): MusterFileClaim | null {
  for (const claim of MUSTER_FILE_CLAIMS[nationId]) if (claim.file === file) return claim;
  return null;
}

/** Files a minor banner of this nation may nominate, in board order. */
export function eligibleMusterFiles(nationId: NationId): FileLetter[] {
  const out: FileLetter[] = [];
  for (const file of FILES) if (!musterClaimFor(nationId, file)) out.push(file);
  return out;
}

export function isFileLetter(value: unknown): value is FileLetter {
  return typeof value === "string" && (FILES as readonly string[]).indexOf(value) !== -1;
}
