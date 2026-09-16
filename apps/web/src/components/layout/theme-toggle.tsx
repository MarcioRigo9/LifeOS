"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

const ORDER = ["light", "dark", "system"] as const;
const ICONS = { light: Sun, dark: Moon, system: MonitorSmartphone };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const current = (theme as (typeof ORDER)[number]) ?? "system";
  const Icon = ICONS[current];

  function cycle() {
    const idx = ORDER.indexOf(current);
    setTheme(ORDER[(idx + 1) % ORDER.length]);
  }

  if (!mounted) return <div className="size-11" />;

  return (
    <Button variant="ghost" size="icon" onClick={cycle} aria-label={`Tema: ${current}`}>
      <Icon />
    </Button>
  );
}
