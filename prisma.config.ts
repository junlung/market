import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    // Prisma Config drives the CLI only. Migrate/db must use the DIRECT
    // endpoint: pointing the CLI at the pooled DATABASE_URL runs
    // `migrate deploy` through PgBouncer transaction pooling, where session
    // advisory locks strand — after which every deploy fails with P1002
    // ("timed out acquiring advisory lock"). The app keeps using the pooled
    // url from schema.prisma at runtime.
    url: env("DATABASE_URL_UNPOOLED"),
  },
});
