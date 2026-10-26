export type CreatureLoadState = {
  status: "loading" | "ready" | "fallback" | "error";
  phase: "download" | "decode" | "render" | "illustration";
  loadedBytes?: number;
  totalBytes?: number;
  error?: string;
};
