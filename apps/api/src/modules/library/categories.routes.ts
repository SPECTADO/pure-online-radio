import { Router } from "express";
import { Prisma, prisma } from "@spectado/database";
import { ALL_CATEGORY_NAME, CategorySchema, CreateCategoryRequestSchema } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const categoriesRoutes = Router();

categoriesRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

categoriesRoutes.get("/", async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  res.json(categories.map((c) => CategorySchema.parse(c)));
});

categoriesRoutes.post("/", async (req, res) => {
  const parsed = CreateCategoryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const category = await prisma.category.create({ data: { name: parsed.data.name } });
    res.status(201).json(CategorySchema.parse(category));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: `category "${parsed.data.name}" already exists` });
      return;
    }
    throw err;
  }
});

categoriesRoutes.delete("/:id", async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category) {
    res.status(404).json({ error: "category not found" });
    return;
  }

  if (category.name === ALL_CATEGORY_NAME) {
    res.status(400).json({ error: `the "${ALL_CATEGORY_NAME}" category cannot be deleted` });
    return;
  }

  await prisma.category.delete({ where: { id: category.id } });
  res.status(204).send();
});
