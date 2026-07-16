import type { Route } from "next";
import { Activity, Crown, Home, Trophy, User, Wallet } from "lucide-react";

// The desktop top nav and the mobile tab bar must stay mirrors: same
// destinations, no orphans. The nav is kept to four shared destinations to
// stay approachable; the rest live per-surface — Portfolio and Store are
// avatar-menu items on desktop (Portfolio is also a mobile tab; Store on
// mobile is reachable via the balance menu's Gems row and the account page),
// and Account is a mobile tab that lives in the avatar menu on desktop.
// "Ranks" is "Leaderboard" shortened for tab-bar width.

export const NAV_LINKS: Array<{ href: Route; label: string }> = [
  { href: "/dashboard", label: "Markets" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/leagues", label: "Leagues" },
  { href: "/activity", label: "Activity" },
];

export const MOBILE_TABS: Array<{ href: Route; label: string; icon: typeof Home }> = [
  { href: "/dashboard", label: "Markets", icon: Home },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/leagues", label: "Leagues", icon: Crown },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/account", label: "Account", icon: User },
];
