const PUMP_HOME = "https://pump.fun";

/** Coin page when `VITE_PUMP_MINT` is set; otherwise the pump.fun home. */
export function pumpCoinUrl(): string {
  const mint = (import.meta.env.VITE_PUMP_MINT as string | undefined)?.trim();
  if (!mint) return PUMP_HOME;
  return `${PUMP_HOME}/coin/${encodeURIComponent(mint)}`;
}

export function pumpMintSet(): boolean {
  return Boolean((import.meta.env.VITE_PUMP_MINT as string | undefined)?.trim());
}
