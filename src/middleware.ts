import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware(req) {
    if (req.nextUrl.pathname.startsWith("/admin") && req.nextauth.token?.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => Boolean(token),
    },
    pages: {
      signIn: "/sign-in",
    },
  },
);

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/portfolio/:path*", "/history/:path*", "/leaderboard/:path*", "/account/:path*", "/markets/:path*", "/activity/:path*", "/invite/:path*", "/u/:path*", "/leagues/:path*", "/l/:path*", "/store/:path*", "/join/:path*"],
};
