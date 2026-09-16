import { z } from "zod";
import { MarketPriceProviderError, type MarketPriceProvider, type RawMarketQuote } from "./types";

const quoteSchema = z.object({
  title: z.string().min(1),
  brand: z.string().optional(),
  price: z.string().min(1),
  package: z.string().optional(),
  promo: z.boolean().optional(),
  url: z.string().optional(),
});
const responseSchema = z.object({ results: z.array(quoteSchema) });

/**
 * A REAL network provider extension point — calls a configurable JSON search endpoint
 * (`GET {baseUrl}?q=<query>`), never fabricates a result. Its response is UNTRUSTED DATA
 * (SECURITY_MODEL.md §7): validated with Zod before anything downstream touches it, and this
 * class never passes the raw HTTP body anywhere except through that schema. Disabled by default
 * (no `NEXT_PUBLIC_`/server env var wires it up yet) until a real, contracted price API exists —
 * unlike FixtureMarketPriceProvider, this one genuinely fails over the network, which is exactly
 * what exercises the resilience requirement (timeouts, malformed JSON, HTTP errors) in tests.
 */
export class HttpJsonMarketPriceProvider implements MarketPriceProvider {
  name: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(params: { name: string; baseUrl: string; timeoutMs?: number }) {
    this.name = params.name;
    this.baseUrl = params.baseUrl;
    this.timeoutMs = params.timeoutMs ?? 8000;
  }

  async searchPrices(query: string): Promise<RawMarketQuote[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}?q=${encodeURIComponent(query)}`, { signal: controller.signal });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      throw new MarketPriceProviderError(
        this.name,
        isTimeout ? "timeout" : "network",
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new MarketPriceProviderError(this.name, "network", `HTTP ${res.status}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new MarketPriceProviderError(this.name, "format", `invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
      throw new MarketPriceProviderError(this.name, "format", `unexpected response shape: ${parsed.error.message}`);
    }

    return parsed.data.results.map((r) => ({
      productTitle: r.title,
      brand: r.brand,
      priceText: r.price,
      packageText: r.package,
      promo: r.promo,
      sourceUrl: r.url,
    }));
  }
}
