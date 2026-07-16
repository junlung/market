import type { Route } from "next";
import { Activity, Crown, Home, Trophy, User, Wallet } from "lucide-react";

// The desktop top nav and the mobile tab bar must stay mirrors: same
// destinations, no orphans. The two deliberate differences: Store is
// desktop-only (on mobile it's reachable via the balance menu's Gems row and
// the account page), and Account is mobile-only (on desktop it lives in the
// avatar menu). "Ranks" is "Leaderboard" shortened for tab-bar width.

export const NAV_LINKS: Array<{ href: Route; label: string }> = [
  { href: "/dashboard", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/leagues", label: "Leagues" },
  { href: "/activity", label: "Activity" },
  { href: "/store", label: "Store" },
];

export const MOBILE_TABS: Array<{ href: Route; label: string; icon: typeof Home }> = [
  { href: "/dashboard", label: "Markets", icon: Home },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/leagues", label: "Leagues", icon: Crown },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/account", label: "Account", icon: User },
];
