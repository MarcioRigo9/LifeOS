"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";
import { useSession } from "@/components/providers/session-provider";

/** The "seletor de perfil rápido" required at the top of the dashboard — switches which
 * profile (Márcio/Brenda) subsequent measurement/habit/workout actions apply to. This is a
 * pure UI concern: both people share one login (DATA_MODEL_REVIEW.md §2.1), so there is no
 * separate auth step, just which profile_id gets attached to the next write. */
export function ProfileSwitcher() {
  const { profiles, activeProfileId, setActiveProfileId, loading } = useSession();

  if (loading) {
    return <div className="flex gap-2">{[0, 1].map((i) => <div key={i} className="size-10 animate-pulse rounded-full bg-muted" />)}</div>;
  }
  if (profiles.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {profiles.map((p) => {
        const active = p.id === activeProfileId;
        return (
          <button
            key={p.id}
            onClick={() => setActiveProfileId(p.id)}
            className="group flex flex-col items-center gap-1"
            aria-pressed={active}
            aria-label={`Trocar para ${p.displayName}`}
          >
            <Avatar
              className={cn(
                "ring-2 ring-offset-2 ring-offset-background transition-all",
                active ? "ring-primary scale-105" : "ring-transparent opacity-60 group-hover:opacity-100"
              )}
            >
              <AvatarFallback className={active ? "bg-primary text-primary-foreground" : undefined}>
                {initials(p.displayName)}
              </AvatarFallback>
            </Avatar>
          </button>
        );
      })}
    </div>
  );
}
