import { useMemo, useState } from "react";
import { LEGACY_COPY, LEGACY_TEXT, PIECE_NAMES, sentenceCase } from "../../../../shared/legacy/content/copy";
import { getAlliedHouse, getRivalHouse, CROWN_TITLES } from "../../../../shared/legacy/content/houses";
import { FILES, musterClaimFor } from "../../../../shared/legacy/content/muster";
import { NATIONS } from "../../../../shared/legacy/content/nations";
import { TINCTURE_SRGB } from "../../../../shared/legacy/environment-contract";
import type { LegacySceneState } from "../../../../shared/legacy/environment-contract";
import { createMusterFormation, standardPieceAt } from "../../../../shared/legacy/domain/formation";
import { nominationRefusal } from "../../../../shared/legacy/domain/nomination";
import { representativeCondition } from "../../../../shared/legacy/domain/presentation";
import { findMember } from "../../../../shared/legacy/domain/state";
import type { FileLetter, LegacyEvent, LegacyState } from "../../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "../desktop-copy";
import { legacyTimestamp } from "../storage";
import { LedgerRow, PanelSection } from "./InspectionPanel";

const INSPECTOR = LEGACY_COPY.inspector;
/** Standard algebraic piece letters (N for the knight). */
const PIECE_LETTERS = { p: "P", n: "N", b: "B", r: "R", q: "Q", k: "K" } as const;

interface MusterGroundsPanelProps {
  state: LegacyState;
  scene: LegacySceneState;
  closeUp: boolean;
  dispatch(event: LegacyEvent): string | null;
  onInspect(): void;
  onFeedback(message: string): void;
}

type FormationGroup = "player" | "ally" | "royal" | "crown";

interface FormationCell {
  square: string;
  piece: string;
  group: FormationGroup;
  label: string;
}

function firstAvailableMember(state: LegacyState): string | null {
  for (const member of state.members) if (member.status === "available") return member.id;
  return state.members[0]?.id ?? null;
}

export function MusterGroundsPanel({ state, scene, closeUp, dispatch, onInspect, onFeedback }: MusterGroundsPanelProps) {
  const banner = state.banner;
  const [pendingMember, setPendingMember] = useState<string | null>(() => state.nomination.memberId ?? firstAvailableMember(state));
  const [pendingFile, setPendingFile] = useState<FileLetter | null>(() => state.nomination.file ?? scene.eligibleFiles[0] ?? null);
  const [describedFile, setDescribedFile] = useState<FileLetter | null>(null);
  const representative = scene.representative;
  const nominee = findMember(state, state.nomination.memberId);

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
        const group: FormationGroup = owner.houseId === "player" ? "player" : owner.houseId.indexOf("crown:") === 0 ? (id.indexOf("crown:") === 0 ? "royal" : "crown") : "ally";
        cells.push({ square, piece: PIECE_LETTERS[kind], group, label: `${square} · ${PIECE_NAMES[kind]} · ${sentenceCase(owner.label)}` });
      }
    }
    return cells;
  }, [banner, state, pendingMember, pendingFile]);

  if (!banner) return <p className="legacy-empty">{LEGACY_COPY.empty.unfounded}</p>;
  const ally = getAlliedHouse(banner.nationId);
  const crownTitle = sentenceCase(CROWN_TITLES[banner.nationId]);
  const counts = { player: 0, ally: 0, crown: 0 };
  for (const cell of formation) {
    if (cell.group === "player") counts.player++;
    else if (cell.group === "ally") counts.ally++;
    else counts.crown++;
  }
  const bannerColour = TINCTURE_SRGB[banner.heraldry.field[0]];
  const allyColour = TINCTURE_SRGB[ally.heraldry.field[0]];
  const metal = NATIONS[banner.nationId].palette.metal;
  const unchanged = pendingMember === state.nomination.memberId && pendingFile === state.nomination.file;
  const refusal = pendingMember && pendingFile ? nominationRefusal(state, pendingMember, pendingFile) : INSPECTOR.chooseMember;
  const fileDescription = (file: FileLetter): string => {
    const claim = musterClaimFor(banner.nationId, file);
    return claim ? `${INSPECTOR.fileName(file)} · ${INSPECTOR.claimedBy(claim.label)}` : `${INSPECTOR.fileName(file)} · ${UI.openFile}`;
  };
  const nominate = () => {
    if (!pendingMember || !pendingFile || unchanged) return;
    const member = findMember(state, pendingMember);
    const error = dispatch({ type: "nominate", memberId: pendingMember, file: pendingFile, at: legacyTimestamp() });
    onFeedback(error ?? (member ? LEGACY_TEXT.nomination(member.name, pendingFile).title : ""));
  };

  return <>
    {/* The founding principle of the Muster leads the panel, before any choice is made. */}
    <p className="legacy-principle legacy-principle--lead">{UI.principle}</p>
    <PanelSection title={UI.representative} className="legacy-representative">
      {representative && nominee ? <>
        <p className="legacy-rep-name">{representative.name}</p>
        <p className="legacy-rep-epithet">{representative.epithet}</p>
        <dl className="legacy-ledger">
          <LedgerRow label={INSPECTOR.allegiance}>{banner.name}</LedgerRow>
          <LedgerRow label={INSPECTOR.appointment}>{INSPECTOR.pawnAppointment}</LedgerRow>
          <LedgerRow label={INSPECTOR.file}>{representative.file ? INSPECTOR.fileName(representative.file) : "—"}</LedgerRow>
          <LedgerRow label={INSPECTOR.condition}>
            <span className={`legacy-status legacy-status--${representativeCondition(representative)}`}>{LEGACY_COPY.status[representativeCondition(representative)].label}</span>
          </LedgerRow>
          {representative.captorName && <LedgerRow label={INSPECTOR.heldBy}>{sentenceCase(representative.captorName)}</LedgerRow>}
          {representative.promotedTo && <LedgerRow label={INSPECTOR.promotions}>{INSPECTOR.promotedTo(PIECE_NAMES[representative.promotedTo])}</LedgerRow>}
          <LedgerRow label={INSPECTOR.musters}>{nominee.musters}</LedgerRow>
          <LedgerRow label={INSPECTOR.captures}>{nominee.captures}</LedgerRow>
          <LedgerRow label={INSPECTOR.timesCaptured}>{nominee.timesCaptured}</LedgerRow>
        </dl>
        <p className="legacy-rep-condition">{representative.status === "captive" && representative.captorName
          ? INSPECTOR.emptyPlace(sentenceCase(representative.captorName))
          : LEGACY_COPY.status[representativeCondition(representative)].description}</p>
        <button type="button" className="legacy-button" data-nav onClick={onInspect}>{closeUp ? UI.showGrounds : `${UI.inspect} ${representative.name}`}</button>
      </> : <p className="legacy-empty">{LEGACY_COPY.empty.representative}</p>}
    </PanelSection>

    <PanelSection title={UI.nomination}>
      <p className="legacy-field-label">{INSPECTOR.chooseMember}</p>
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
          >
            <span className="legacy-member-name">{member.name}</span>
            <span className="legacy-member-epithet">{member.epithet}</span>
            <span className={`legacy-status legacy-status--${member.status}`}>{LEGACY_COPY.status[member.status].label}</span>
          </button>;
        })}
      </div>
      <p className="legacy-field-label">{INSPECTOR.chooseFile}</p>
      <div className="legacy-files" role="radiogroup" aria-label={INSPECTOR.chooseFile} onMouseLeave={() => setDescribedFile(null)}>
        {FILES.map((file) => {
          const claim = musterClaimFor(banner.nationId, file);
          return <button
            key={file}
            type="button"
            role="radio"
            className={`legacy-file${claim ? " is-claimed" : ""}${pendingFile === file ? " is-selected" : ""}`}
            aria-checked={pendingFile === file}
            aria-disabled={claim ? true : undefined}
            aria-label={fileDescription(file)}
            data-nav
            data-file={file}
            onFocus={() => setDescribedFile(file)}
            onMouseEnter={() => setDescribedFile(file)}
            onClick={() => { if (claim) onFeedback(INSPECTOR.claimedBy(claim.label)); else setPendingFile(file); }}
          >{file}</button>;
        })}
      </div>
      <p className="legacy-file-caption" aria-hidden="true">{fileDescription(describedFile ?? pendingFile ?? scene.eligibleFiles[0])}</p>
      <ul className="legacy-claims">
        {scene.claimedFiles.map((claim) => <li key={claim.file}><span className="legacy-claim-file">{claim.file}</span>{sentenceCase(claim.label)}</li>)}
      </ul>
      <button type="button" className="legacy-button legacy-button--primary" data-nav aria-disabled={unchanged || refusal !== null ? true : undefined} onClick={() => { if (refusal) onFeedback(refusal); else nominate(); }}>{INSPECTOR.nominate}</button>
    </PanelSection>

    <PanelSection title={UI.formation} className="legacy-formation-section">
      <div className="legacy-formation" role="img" aria-label={`${UI.yourBanner} ${counts.player}, ${ally.name} ${counts.ally}, ${crownTitle} ${counts.crown}`}>
        {formation.map((cell) => <span key={cell.square} className={`legacy-formation-cell is-${cell.group}`} title={cell.label} style={cell.group === "player" ? { background: bannerColour } : cell.group === "ally" ? { background: allyColour } : cell.group === "royal" ? { borderColor: metal } : undefined}>{cell.piece}</span>)}
      </div>
      <ul className="legacy-formation-legend">
        <li><span className="legacy-legend-dot" style={{ background: bannerColour }} aria-hidden="true" />{UI.yourBanner} · {counts.player}</li>
        <li><span className="legacy-legend-dot" style={{ background: allyColour }} aria-hidden="true" />{ally.name} · {counts.ally}</li>
        <li><span className="legacy-legend-dot is-crown" aria-hidden="true" />{crownTitle} · {counts.crown}</li>
      </ul>
      <p className="legacy-fineprint">{INSPECTOR.formationNote}</p>
      <p className="legacy-fineprint">{INSPECTOR.futureAppointments}</p>
    </PanelSection>
  </>;
}
