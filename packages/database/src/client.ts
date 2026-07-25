import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Prisma 7's "prisma-client" generator is engine-less: a driver adapter is
// mandatory (there's no more implicit connection via a schema-level
// datasource url — see prisma.config.ts for where DATABASE_URL now lives for
// CLI/migrate purposes).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

/** Singleton so hot-reloaded dev processes (tsx watch) don't exhaust the Postgres connection pool. */
export const prisma = globalThis.__prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export * from "../generated/prisma/client.js";
