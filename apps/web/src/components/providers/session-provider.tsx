"use client";

import * as React from "react";

export interface HouseholdProfile {
  id: string;
  displayName: string;
  isCurrentUser: boolean;
}

interface SessionState {
  userId: string | null;
  householdId: string | null;
  profiles: HouseholdProfile[];
  activeProfileId: string | null;
  setActiveProfileId: (id: string) => void;
  loading: boolean;
  authenticated: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = React.createContext<SessionState | null>(null);

const ACTIVE_PROFILE_KEY = "lifeos:active-profile";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = React.useState<string | null>(null);
  const [householdId, setHouseholdId] = React.useState<string | null>(null);
  const [profiles, setProfiles] = React.useState<HouseholdProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [authenticated, setAuthenticated] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) {
        setAuthenticated(false);
        setUserId(null);
        setHouseholdId(null);
        setProfiles([]);
        return;
      }
      const data = await res.json();
      setAuthenticated(true);
      setUserId(data.userId);
      setHouseholdId(data.householdId);
      setProfiles(data.profiles);

      const stored = typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PROFILE_KEY) : null;
      const validStored = stored && data.profiles.some((p: HouseholdProfile) => p.id === stored) ? stored : null;
      const currentUserProfile = data.profiles.find((p: HouseholdProfile) => p.isCurrentUser);
      setActiveProfileIdState(validStored ?? currentUserProfile?.id ?? data.profiles[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const setActiveProfileId = React.useCallback((id: string) => {
    setActiveProfileIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  }, []);

  const value = React.useMemo(
    () => ({ userId, householdId, profiles, activeProfileId, setActiveProfileId, loading, authenticated, refresh: load }),
    [userId, householdId, profiles, activeProfileId, setActiveProfileId, loading, authenticated, load]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

/** The active profile's full record, not just its id. */
export function useActiveProfile(): HouseholdProfile | null {
  const { profiles, activeProfileId } = useSession();
  return profiles.find((p) => p.id === activeProfileId) ?? null;
}
