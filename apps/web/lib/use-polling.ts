"use client";

import { useEffect, useState } from "react";

export function usePolling<T>(url: string, intervalMs: number): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url, intervalMs]);

  return { data, error };
}
