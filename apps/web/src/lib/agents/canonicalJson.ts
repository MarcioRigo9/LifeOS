/**
 * Deterministic canonical JSON serialization, equivalent to JCS (RFC 8785):
 * object keys sorted alphabetically at every level, no whitespace, arrays keep order,
 * `undefined` keys omitted, explicit `null` preserved (AGENT_CONTRACTS.md §8.3).
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === undefined) {
    // Callers must not pass a bare `undefined` at the top level; inside objects it's
    // filtered out before we get here (see serializeObject).
    throw new Error("canonicalStringify: cannot serialize undefined at top level");
  }
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalStringify: non-finite numbers are not allowed (money must be integer cents)");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v === undefined ? null : v)).join(",")}]`;
  }
  if (typeof value === "object") {
    return serializeObject(value as Record<string, unknown>);
  }
  throw new Error(`canonicalStringify: unsupported value type ${typeof value}`);
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`);
  return `{${parts.join(",")}}`;
}
