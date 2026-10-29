import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { LEGACY_COPY, LEGACY_TEXT, PIECE_NAMES, sentenceCase } from "../../../../shared/legacy/content/copy";
import { getAlliedHouse, getExternalHouse, getRivalHouse, CROWN_TITLES } from "../../../../shared/legacy/content/houses";
import { FILES, musterClaimFor } from "../../../../shared/legacy/content/muster";
import { NATIONS } from "../../../../shared/legacy/content/nations";
import { TINCTURE_SRGB } from "../../../../shared/legacy/environment-contract";
import type { LegacySceneState } from "../../../../shared/legacy/environment-contract";
import { createMusterFormation, standardPieceAt } from "../../../../shared/legacy/domain/formation";
import { PLAYER_HOUSE_ID } from "../../../../shared/legacy/domain/identity";
import { nominationRefusal } from "../../../../shared/legacy/domain/nomination";
import { representativeCondition } from "../../../../shared/legacy/domain/presentation";
import { findMember } from "../../../../shared/legacy/domain/state";
import type { FileLetter, Heraldry, HouseMember, LegacyEvent, LegacyState, PieceKind } from "../../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "../desktop-copy";
import { HeraldryEmblem } from "../HeraldryEmblem";
import { NextStepAction } from "../LegacyTerms";
import type { NextStep } from "../next-step";
import { legacyTimestamp } from "../storage";
import { LedgerRow, PanelSection } from "./InspectionPanel";

const INSPECTOR = LEGACY_COPY.inspector;
/** Standard algebraic piece letters (N for the knight). */
const PIECE_LETTERS: Readonly<Record<PieceKind, string>> = { p: "P", n: "N", b: "B", r: "R", q: "Q", k: "K" };

interface MusterGroundsPanelProps {
  state: LegacyState;
  scene: LegacySceneState;
  closeUp: boolean;
  nextStep: NextStep | null;
  dispatch(event: LegacyEvent): string | null;
  onInspect(): void;
  onFeedback(message: string): void;
  onNextStep(step: NextStep): void;
}

type FormationGroup = "player" | "ally" | "crown" | "royal";

interface FormationCell {
  square: string;
  file: FileLetter;
  piece: string;
  group: FormationGroup;
  label: string;
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** Mixes two #rrggbb colours; t = 0 keeps `a`. */
function mix(a: string, b: string, t: number): string {
  let out = "#";
  for (let index = 0; index < 3; index++) out += Math.round(channel(a, index) + (channel(b, index) - channel(a, index)) * t).toString(16).padStart(2, "0");
  return out;
}

/** Dark ink on light tinctures (argent, or), light ink on the rest. */
function inkFor(hex: string): string {
  const luminance = (0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)) / 255;
  return luminance > 0.52 ? "#1a140c" : "#f3ead6";
}

function distance(a: string, b: string): number {
  let sum = 0;
  for (let index = 0; index < 3; index++) sum += Math.abs(channel(a, index) - channel(b, index));
  return sum;
}

/** The ally's colour: its first tincture that stays distinguishable from your banner's and the crown's. */
function allyFill(heraldry: Heraldry, player: string, crown: string): string {
  const candidates = [heraldry.field[0], heraldry.field[1], heraldry.chargeTincture, heraldry.ordinaryTincture];
  for (const tincture of candidates) {
    const fill = TINCTURE_SRGB[tincture];
    if (distance(fill, player) > 90 && distance(fill, crown) > 90) return fill;
  }
  return TINCTURE_SRGB[heraldry.field[0]];
}

function cellStyle(fill: string): CSSProperties {
  return { ["--cell-fill" as string]: fill, ["--cell-ink" as string]: inkFor(fill) };
}

function firstAvailableMember(state: LegacyState): string | null {
  for (const member of state.members) if (member.status === "available") return member.id;
  return state.members[0]?.id ?? null;
}

function MemberLine({ member }: { member: HouseMember }) {
  return <>
    <span className="legacy-member-name">{member.name}<span className="legacy-member-epithet"> {member.epithet}</span></span>
    <span className={`legacy-status legacy-status--${member.status}`}>{LEGACY_COPY.status[member.status].label}</span>
    <span className="legacy-member-origin">{member.origin}</span>
  </>;
}

/**
 * The Muster Grounds centre on the house's side of the formation: sixteen
 * pieces in the colours of the houses that field them, with your one piece in
 * your banner's colours. The pawn row doubles as the file choice (claimed
 * files carry the holding house's mark), so choosing a member and pressing
 * Nominate stays above the fold.
 */
export function MusterGroundsPanel({ state, scene, closeUp, nextStep, dispatch, onInspect, onFeedback, onNextStep }: MusterGroundsPanelProps) {
  const banner = state.banner;
  // A nominee who cannot take the field (captive or injured) is not offered again: the choice starts on someone who can.
  const [pendingMember, setPendingMember] = useState<string | null>(() => {
    const current = findMember(state, state.nomination.memberId);
    return current && current.status === "available" ? current.id : firstAvailableMember(state);
  });
  const [pendingFile, setPendingFile] = useState<FileLetter | null>(() => state.nomination.file ?? scene.eligibleFiles[0] ?? null);
  const [describedFile, setDescribedFile] = useState<FileLetter | null>(null);
  const representative = scene.representative;
  const nominee = findMember(state, state.nomination.memberId);
  const actionsRef = useRef<HTMLDivElement>(null);
  const handOff = useRef(false);
  const unchanged = pendingMember === state.nomination.memberId && pendingFile === state.nomination.file;
  const nominated = nominee !== null && state.nomination.file !== null;
  // Once the nomination stands, the panel's primary action moves on to the next step toward the match.
  const showNext = nominated && unchanged && nextStep !== null && nextStep.landmark !== "muster-grounds";

  // After a nomination, focus follows the primary action to the next step, scrolled into view.
  useEffect(() => {
    if (!handOff.current || !showNext) return;
    handOff.current = false;
    const target = actionsRef.current?.querySelector<HTMLElement>("[data-next-step]");
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [showNext]);

  const formation = useMemo((): FormationCell[] => {
    if (!banner) return [];
    const preview: LegacyState = pendingMember && pendingFile ? { ...state, nomination: { memberId: pendingMember, file: pendingFile } } : state;
    const { formation: squares, allegiance } = createMusterFormation(preview, { playerSide: "w", opponentNationId: getRivalHouse(banner.nationId).nationId });
    const cells: FormationCell[] = [];
    for (const rank of ["2", "1"]) {
      for (const file of FILES) {
        const square = `${file}${rank}`;
        const id = squares[square];
        const owner = allegiance[id];
        const kind = standardPieceAt(square)?.kind ?? "p";
        const group: FormationGroup = owner.houseId === PLAYER_HOUSE_ID ? "player" : owner.houseId.indexOf("crown:") === 0 ? (id.indexOf("crown:") === 0 ? "royal" : "crown") : "ally";
        cells.push({ square, file, piece: PIECE_LETTERS[kind], group, label: `${square} · ${PIECE_NAMES[kind]} · ${sentenceCase(owner.label)}` });
      }
    }
    return cells;
  }, [banner, state, pendingMember, pendingFile]);

  if (!banner) return <p className="legacy-empty">{LEGACY_COPY.empty.unfounded}</p>;
  const ally = getAlliedHouse(banner.nationId);
  const nation = NATIONS[banner.nationId];
  const crownTitle = sentenceCase(CROWN_TITLES[banner.nationId]);
  const playerFill = TINCTURE_SRGB[banner.heraldry.field[0]];
  const crownFill = mix(nation.palette.secondary, "#15120e", 0.55);
  const fills: Readonly<Record<FormationGroup, string>> = {
    player: playerFill,
    ally: allyFill(ally.heraldry, playerFill, crownFill),
    crown: crownFill,
    royal: mix(nation.palette.secondary, "#15120e", 0.3),
  };
  const counts = { player: 0, ally: 0, crown: 0 };
  for (const cell of formation) {
    if (cell.group === "player") counts.player++;
    else if (cell.group === "ally") counts.ally++;
    else counts.crown++;
  }
  const refusal = pendingMember && pendingFile ? nominationRefusal(state, pendingMember, pendingFile) : INSPECTOR.chooseMember;
  const fileDescription = (file: FileLetter): string => {
    const claim = musterClaimFor(banner.nationId, file);
    return claim ? `${INSPECTOR.fileName(file)} · ${INSPECTOR.claimedBy(claim.label)}` : `${INSPECTOR.fileName(file)} · ${INSPECTOR.openFile}`;
  };
  const nominate = () => {
    if (!pendingMember || !pendingFile || unchanged) return;
    const member = findMember(state, pendingMember);
    const error = dispatch({ type: "nominate", memberId: pendingMember, file: pendingFile, at: legacyTimestamp() });
    if (!error) handOff.current = true;
    onFeedback(error ?? (member ? LEGACY_TEXT.nomination(member.name, pendingFile).title : ""));
  };
  const condition = representative ? representativeCondition(representative) : null;

  return <>
    <PanelSection title={INSPECTOR.formationHeading} className="legacy-formation-section">
      <div className="legacy-formation" role="radiogroup" aria-label={INSPECTOR.chooseFile} aria-describedby="legacy-formation-principle" onMouseLeave={() => setDescribedFile(null)}>
        {formation.slice(0, FILES.length).map((cell) => {
          const claim = musterClaimFor(banner.nationId, cell.file);
          const holder = claim ? getExternalHouse(claim.houseId) : null;
          const selected = pendingFile === cell.file;
          return <button
            key={cell.square}
            type="button"
            role="radio"
            className={`legacy-formation-cell legacy-file is-${cell.group}${claim ? " is-claimed" : ""}${selected ? " is-selected" : ""}`}
            style={cellStyle(fills[cell.group])}
            aria-checked={selected}
            aria-disabled={claim ? true : undefined}
            aria-label={`${fileDescription(cell.file)}. ${cell.label}`}
            title={cell.label}
            data-nav
            data-file={cell.file}
            onFocus={() => setDescribedFile(cell.file)}
            onMouseEnter={() => setDescribedFile(cell.file)}
            onClick={() => { if (claim) onFeedback(INSPECTOR.claimedBy(claim.label)); else setPendingFile(cell.file); }}
          >
            <span className="legacy-formation-piece">{cell.piece}</span>
            {claim && (holder
              ? <HeraldryEmblem className="legacy-formation-mark" heraldry={holder.heraldry} aspect="shield" label="" />
              : <span className="legacy-formation-mark legacy-formation-mark--crown" aria-hidden="true" />)}
          </button>;
        })}
        {formation.slice(FILES.length).map((cell) => <span key={cell.square} className={`legacy-formation-cell is-${cell.group}`} style={cellStyle(fills[cell.group])} title={cell.label} aria-hidden="true">
          <span className="legacy-formation-piece">{cell.piece}</span>
        </span>)}
        {FILES.map((file) => <span key={file} className="legacy-formation-axis" aria-hidden="true">{file}</span>)}
      </div>
      <p className="legacy-file-caption" aria-hidden="true">{fileDescription(describedFile ?? pendingFile ?? scene.eligibleFiles[0])}</p>
      <ul className="legacy-formation-legend">
        <li><span className="legacy-legend-dot is-player" style={cellStyle(fills.player)} aria-hidden="true" />{INSPECTOR.yourBanner} · {counts.player}</li>
        <li><span className="legacy-legend-dot" style={cellStyle(fills.ally)} aria-hidden="true" />{ally.name} · {counts.ally}</li>
        <li><span className="legacy-legend-dot" style={cellStyle(fills.crown)} aria-hidden="true" />{crownTitle} · {counts.crown}</li>
      </ul>
      <p className="legacy-principle" id="legacy-formation-principle">{LEGACY_COPY.principle}</p>
      {representative && condition && <p className={`legacy-seat legacy-seat--${condition}`} data-seat={condition}>
        <span className="legacy-seat-name">{representative.name}</span>
        <span className="legacy-muted"> {representative.epithet} · {representative.file ? INSPECTOR.fileName(representative.file) : "—"} · </span>
        <span className={`legacy-status legacy-status--${condition}`}>{LEGACY_COPY.status[condition].label}</span>
        {representative.captorName && <span className="legacy-muted"> · {INSPECTOR.heldBy} {sentenceCase(representative.captorName)}</span>}
      </p>}
    </PanelSection>

    <PanelSection title={UI.nomination}>
      <div className="legacy-members" role="radiogroup" aria-label={INSPECTOR.chooseMember}>
        {state.members.map((member) => {
          const unfit = member.status !== "available";
          return <button
            key={member.id}
            type="button"
            role="radio"
            className={`legacy-member${pendingMember === member.id ? " is-selected" : ""}`}
            aria-checked={pendingMember === member.id}
            aria-disabled={unfit || undefined}
            data-nav
            data-member={member.id}
            onClick={() => { if (!unfit) setPendingMember(member.id); else onFeedback(nominationRefusal(state, member.id, pendingFile ?? scene.eligibleFiles[0]) ?? ""); }}
          ><MemberLine member={member} /></button>;
        })}
      </div>
      <div ref={actionsRef} className="legacy-nominate-row">
        {/* One primary action at a time: Nominate while the choice differs from the standing nomination, then the next step. */}
        {showNext && nextStep
          ? <NextStepAction step={nextStep} onGo={onNextStep} variant="panel" defaultFocus />
          : <button type="button" className="legacy-button legacy-button--primary" data-nav data-nav-default data-nominate aria-disabled={unchanged || refusal !== null ? true : undefined} onClick={() => { if (refusal) onFeedback(refusal); else nominate(); }}>{INSPECTOR.nominate}</button>}
      </div>
    </PanelSection>

    {representative && nominee && condition && <PanelSection title={UI.representative} className="legacy-representative">
      <p className="legacy-rep-name">{representative.name}</p>
      <p className="legacy-rep-epithet">{representative.epithet}</p>
      <p className="legacy-rep-origin">{nominee.origin}</p>
      <dl className="legacy-ledger">
        <LedgerRow label={INSPECTOR.allegiance}>{banner.name}</LedgerRow>
        <LedgerRow label={INSPECTOR.appointment}>{INSPECTOR.pawnAppointment}</LedgerRow>
        <LedgerRow label={INSPECTOR.file}>{representative.file ? INSPECTOR.fileName(representative.file) : "—"}</LedgerRow>
        <LedgerRow label={INSPECTOR.condition}><span className={`legacy-status legacy-status--${condition}`}>{LEGACY_COPY.status[condition].label}</span></LedgerRow>
        {representative.captorName && <LedgerRow label={INSPECTOR.heldBy}>{sentenceCase(representative.captorName)}</LedgerRow>}
        {representative.promotedTo && <LedgerRow label={INSPECTOR.promotions}>{INSPECTOR.promotedTo(PIECE_NAMES[representative.promotedTo])}</LedgerRow>}
        <LedgerRow label={INSPECTOR.musters}>{nominee.musters}</LedgerRow>
        <LedgerRow label={INSPECTOR.captures}>{nominee.captures}</LedgerRow>
        <LedgerRow label={INSPECTOR.timesCaptured}>{nominee.timesCaptured}</LedgerRow>
      </dl>
      <p className="legacy-rep-condition">{representative.status === "captive" && representative.captorName
        ? INSPECTOR.emptyPlace(sentenceCase(representative.captorName))
        : LEGACY_COPY.status[condition].description}</p>
      <button type="button" className="legacy-button" data-nav onClick={onInspect}>{closeUp ? UI.showGrounds : `${UI.inspect} ${representative.name}`}</button>
    </PanelSection>}
    <div className="legacy-formation-notes">
      <p className="legacy-fineprint">{INSPECTOR.formationNote}</p>
      <p className="legacy-fineprint">{INSPECTOR.futureAppointments}</p>
    </div>
  </>;
}
