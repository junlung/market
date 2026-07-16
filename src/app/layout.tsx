import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/layout/auth-provider";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  // absolute base for og:image/twitter:image URLs in link previews
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://prollymarket.vercel.app",
  ),
  title: {
    default: "ProllyMarket",
    template: "%s · ProllyMarket",
  },
  description: "The private prediction league for friends. Real odds. Fake money. Eternal glory.",
  openGraph: {
    title: "ProllyMarket",
    description: "The private prediction league for friends. Real odds. Fake money. Eternal glory.",
    siteName: "ProllyMarket",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ProllyMarket",
    description: "The private prediction league for friends. Real odds. Fake money. Eternal glory.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
