import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: "ADMIN" | "MEMBER";
    username: string;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: "ADMIN" | "MEMBER";
      username: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "ADMIN" | "MEMBER";
    username?: string;
  }
}
