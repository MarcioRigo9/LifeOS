/**
 * Everything here is UNTRUSTED DATA (SECURITY_MODEL.md §7) — free text from an external source,
 * never executed, never concatenated into an AI prompt. `priceText` and `packageText` are
 * structurally separate from `productTitle` specifically so a malicious/malformed title can
 * never influence the parsed price or package size (see sanitize.ts).
 */
export interface RawMarketQuote {
  productTitle: string;
  brand?: string;
  priceText: string; // e.g. "R$ 19,90" — parsed by parseCurrencyToCents
  packageText?: string; // e.g. "1kg" — parsed by parsePackageSize; falls back to productTitle if absent
  promo?: boolean;
  sourceUrl?: string;
}

export class MarketPriceProviderError extends Error {
  constructor(public providerName: string, public reason: "network" | "timeout" | "format", message: string) {
    super(`[${providerName}] ${reason}: ${message}`);
  }
}

/** Adapter interface every price source implements — swappable, so priceSyncService.ts never
 * depends on a specific market/scraper. */
export interface MarketPriceProvider {
  name: string;
  searchPrices(query: string): Promise<RawMarketQuote[]>;
}
