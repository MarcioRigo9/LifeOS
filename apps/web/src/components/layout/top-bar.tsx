"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileSwitcher } from "./profile-switcher";
import { ThemeToggle } from "./theme-toggle";

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="safe-top sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:px-8 md:py-5">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground md:text-sm">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ProfileSwitcher />
        <Button variant="ghost" size="icon" asChild aria-label="Editar perfil">
          <Link href="/profile">
            <Settings />
          </Link>
        </Button>
        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair" className="hidden sm:inline-flex">
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
