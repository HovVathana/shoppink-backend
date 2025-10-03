const express = require("express");
const { body, validationResult, query } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const {
  authenticateUser,
  requireViewCategories,
  requireCreateCategories,
  requireEditCategories,
  requireDeleteCategories,
} = require("../middleware/permissions");

const router = express.Router();
const prisma = getPrismaClient();

// All routes require authentication
router.use(authenticateUser);

// Validation rules
const categoryValidation = [
  body("name")
    .trim()
    .isLength({ min: 1 })
    .withMessage("Category name is required"),
  body("description").optional().trim(),
  body("isActive").optional().isBoolean(),
];

// GET /api/categories - Get all categories with pagination and filtering
router.get(
  "/",
  requireViewCategories,
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("search").optional().trim(),
    query("isActive").optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const search = req.query.search;
      const isActive = req.query.isActive;

      // Build where clause
      const where = {};

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ];
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      // Get categories with pagination
      const [categories, totalCount] = await Promise.all([
        prisma.category.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            _count: {
              select: { products: true },
            },
          },
        }),
        prisma.category.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        categories,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get categories error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/categories/all - Get all active categories (for dropdowns)
router.get("/all", requireViewCategories, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });

    res.json({ categories });
  } catch (error) {
    console.error("Get all categories error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/categories/:id - Get single category
router.get("/:id", requireViewCategories, async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true,
            isActive: true,
          },
        },
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ category });
  } catch (error) {
    console.error("Get category error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/categories - Create new category
router.post(
  "/",
  requireCreateCategories,
  categoryValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { name, description, isActive = true } = req.body;

      // Check if category already exists
      const existingCategory = await prisma.category.findUnique({
        where: { name },
      });

      if (existingCategory) {
        return res
          .status(409)
          .json({ message: "Category with this name already exists" });
      }

      const category = await prisma.category.create({
        data: {
          name,
          description,
          isActive,
        },
      });

      res.status(201).json({
        message: "Category created successfully",
        category,
      });
    } catch (error) {
      console.error("Create category error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/categories/:id - Update category
router.put(
  "/:id",
  requireEditCategories,
  categoryValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const { name, description, isActive } = req.body;

      // Check if category exists
      const existingCategory = await prisma.category.findUnique({
        where: { id },
      });

      if (!existingCategory) {
        return res.status(404).json({ message: "Category not found" });
      }

      // Check if name already exists (if different from current)
      if (name && name !== existingCategory.name) {
        const nameExists = await prisma.category.findUnique({
          where: { name },
        });
        if (nameExists) {
          return res
            .status(409)
            .json({ message: "Category with this name already exists" });
        }
      }

      const category = await prisma.category.update({
        where: { id },
        data: {
          name,
          description,
          isActive,
        },
      });

      res.json({
        message: "Category updated successfully",
        category,
      });
    } catch (error) {
      console.error("Update category error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// DELETE /api/categories/:id - Delete category
router.delete("/:id", requireDeleteCategories, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category exists
    const existingCategory = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!existingCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Check if category has products
    if (existingCategory._count.products > 0) {
      return res.status(400).json({
        message:
          "Cannot delete category that has products. Please move or delete the products first.",
      });
    }

    await prisma.category.delete({
      where: { id },
    });

    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Delete category error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
