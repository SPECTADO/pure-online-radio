import bcrypt from "bcryptjs";
import { prisma } from "../src/client.js";

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me";

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { username },
    // Keeps the admin credential in sync with SEED_ADMIN_PASSWORD on every
    // reseed (e.g. after rotating .env secrets) rather than silently keeping
    // whatever was hashed the very first time this ran.
    update: { passwordHash, role: "ADMIN" },
    create: {
      username,
      passwordHash,
      role: "ADMIN",
    },
  });

  await prisma.category.upsert({
    where: { name: "ALL" },
    update: {},
    create: { name: "ALL" },
  });

  await prisma.separationRule.upsert({
    where: { id: "global" },
    update: {},
    create: {
      id: "global",
      scope: "GLOBAL",
      artistSeparationMinutes: 60,
      albumSeparationMinutes: 90,
      songSeparationMinutes: 120,
    },
  });

  // The one required fallback wheel -- fills any time no other active wheel's slot
  // matches. Can be edited (steps only, see clockWheels.routes.ts) but never deleted,
  // so it's seeded once here rather than created through the API.
  await prisma.clockWheel.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      name: "Default",
      isActive: true,
      isDefault: true,
    },
  });

  console.log(`Seeded admin user "${username}", "ALL" category, global separation rule, and default clock wheel.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
