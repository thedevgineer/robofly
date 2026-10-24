import { pumpCoinUrl, pumpMintSet } from "./pump";

export { pumpCoinUrl, pumpMintSet };

function envUrl(key: "VITE_GITHUB_URL" | "VITE_ARXIV_URL"): string | null {
  const value = (import.meta.env[key] as string | undefined)?.trim();
  return value || null;
}

export function githubUrl(): string | null {
  return envUrl("VITE_GITHUB_URL");
}

export function arxivUrl(): string | null {
  return envUrl("VITE_ARXIV_URL");
}
