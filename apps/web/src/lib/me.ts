"use client";

/** Client-side current-user helper (roles drive nav visibility). */

export interface Me {
  userId: string;
  email: string;
  roles: string[];
}

let cache: Me | null | undefined;

export async function getMe(): Promise<Me | null> {
  if (cache !== undefined) return cache;
  try {
    const res = await fetch("/api/me");
    cache = res.ok ? ((await res.json()) as Me) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function resetMeCache(): void {
  cache = undefined;
}
