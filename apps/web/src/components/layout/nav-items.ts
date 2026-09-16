import { Home, MessageCircle, UtensilsCrossed, Dumbbell, HeartPulse, ClipboardCheck, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Hoje", icon: Home },
  { href: "/coordinator", label: "Chat", icon: MessageCircle },
  { href: "/nutrition", label: "Nutrição", icon: UtensilsCrossed },
  { href: "/fitness", label: "Treino", icon: Dumbbell },
  { href: "/health", label: "Saúde", icon: HeartPulse },
  { href: "/review", label: "Revisão", icon: ClipboardCheck },
];
