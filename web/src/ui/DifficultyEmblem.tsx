import type { CampaignDifficulty } from "../campaign/types";

export function DifficultyEmblem({ difficulty }: { difficulty: CampaignDifficulty }) {
  return (
    <svg className="cf-difficulty-emblem" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="20" />
      {difficulty === "story" ? (
        <>
          <path d="M16 16.5c4.4 0 7 1.4 8 3.7 1-2.3 3.6-3.7 8-3.7v16c-4.4 0-7 1.1-8 3.2-1-2.1-3.6-3.2-8-3.2z" />
          <path d="M24 20.2v15.5M20 13.2h8" />
        </>
      ) : difficulty === "tactician" ? (
        <>
          <path d="m16 33 16-18M14 15l18 18M13.5 14.5l5.5 1.2-4.3 4.1zM34.5 33.5 29 32.3l4.3-4.1z" />
          <path d="M24 20.5 29 24l-1.9 6h-6.2L19 24z" />
        </>
      ) : difficulty === "grandmaster" ? (
        <>
          <path d="M17 34h14M19 30h10l-1-7 4-4-5.5-1L24 13l-2.5 5-5.5 1 4 4z" />
          <path d="M24 13v17M17.2 19.2 30.8 27" />
        </>
      ) : (
        <>
          <path d="m14 20 5.2 4 4.8-10 4.8 10 5.2-4-2 14H16zM16 34h16" />
          <path d="m24 14-2 7 4 3-3 5" />
        </>
      )}
    </svg>
  );
}
