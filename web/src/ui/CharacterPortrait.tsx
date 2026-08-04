import type { CharacterStatus } from "../campaign/types";
import type { PieceKind } from "../core/types";

interface CharacterPortraitProps {
  characterId: string;
  name: string;
  title: string;
  kind: PieceKind;
  status?: CharacterStatus;
  compact?: boolean;
  label?: boolean;
}

const PIECE_GLYPH: Record<PieceKind, string> = {
  p: "♙",
  n: "♘",
  b: "♗",
  r: "♖",
  q: "♕",
  k: "♔",
};

export function CharacterPortrait({
  characterId,
  name,
  title,
  kind,
  status = "active",
  compact = false,
  label = false,
}: CharacterPortraitProps) {
  const hasPortrait = characterId === "cael";
  return (
    <figure
      className="cf-character-portrait"
      data-character={characterId}
      data-compact={compact}
      data-status={status}
    >
      <div className="cf-character-portrait-image" aria-hidden="true">
        {hasPortrait ? (
          <img
            src="/assets/portraits/cael.webp"
            alt=""
            width={1086}
            height={1448}
            decoding="async"
            draggable={false}
          />
        ) : <span>{PIECE_GLYPH[kind]}</span>}
      </div>
      {label ? (
        <figcaption>
          <strong>{name}</strong>
          <span>{title}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
