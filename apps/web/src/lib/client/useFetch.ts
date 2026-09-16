"use client";

import * as React from "react";
import { apiGet, ApiError } from "./api";

/** Small, dependency-free data-fetching hook (no SWR/react-query needed at this app's size) —
 * re-fetches whenever `url` changes (pass null to skip), exposes a `refresh` for after a
 * mutation. */
export function useFetch<T>(url: string | null) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(!!url);
  const [error, setError] = React.useState<ApiError | null>(null);

  const refresh = React.useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<T>(url);
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setLoading(false);
    }
  }, [url]);

  React.useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { data, loading, error, refresh, setData };
}
