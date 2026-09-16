import type { MarketPriceProvider, RawMarketQuote } from "./types";

/**
 * A structured, deterministic provider backed by realistic fixture data — the explicit
 * "API simulada com fixtures reais" option this phase's spec allows. Live scraping against real
 * supermarket sites from this codebase would be fragile (layout changes), unverifiable in CI,
 * and ToS-risky without an explicit partnership/API — this fixture set is what every automated
 * test in this phase exercises against, and is a safe, honest default until a real provider
 * (see httpJsonProvider.ts) is configured with a real endpoint.
 */
const FIXTURE_QUOTES: Record<string, RawMarketQuote[]> = {
  "peito de frango": [
    { productTitle: "Peito de Frango Sadia 1kg Bandeja", brand: "Sadia", priceText: "R$ 19,90", packageText: "1kg" },
    { productTitle: "Filé de Peito de Frango Perdigão 1kg", brand: "Perdigão", priceText: "R$ 18,49", packageText: "1kg" },
  ],
  "arroz branco": [
    { productTitle: "Arroz Branco Tio João Tipo 1 5kg", brand: "Tio João", priceText: "R$ 24,90", packageText: "5kg" },
    { productTitle: "Arroz Branco Camil 1kg", brand: "Camil", priceText: "R$ 5,49", packageText: "1kg" },
  ],
  "aveia em flocos": [
    { productTitle: "Aveia em Flocos Finos Quaker 500g", brand: "Quaker", priceText: "R$ 8,99", packageText: "500g" },
  ],
  banana: [{ productTitle: "Banana Prata kg", priceText: "R$ 6,49", packageText: "1kg" }],
  ovo: [{ productTitle: "Ovos Brancos Grandes Bandeja com 30 unidades", priceText: "R$ 22,90" }],
};

export class FixtureMarketPriceProvider implements MarketPriceProvider {
  name = "fixture-supermercado";

  async searchPrices(query: string): Promise<RawMarketQuote[]> {
    const normalized = query.trim().toLowerCase();
    const key = Object.keys(FIXTURE_QUOTES).find((k) => normalized.includes(k) || k.includes(normalized));
    return key ? FIXTURE_QUOTES[key] : [];
  }
}
