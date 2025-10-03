const express = require("express");
const { query, validationResult } = require("express-validator");
const getPrismaClient = require("../lib/prisma");

const router = express.Router();
const prisma = getPrismaClient();

// GET /api/public/products - Get all active products (public access)
router.get(
  "/products",
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
    query("category").optional().trim(),
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
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const search = req.query.search;
      const category = req.query.category;

      // Build where clause - only show active products
      const where = {
        isActive: true,
      };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ];
      }

      if (category) {
        where.categoryId = category;
      }

      // Get products with pagination
      const [products, totalCount] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            quantity: true,
            weight: true,
            imageUrl: true,
            bannerText: true,
            bannerColor: true,
            bannerType: true,
            originalPrice: true,
            isOnSale: true,
            hasOptions: true,
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            optionGroups: {
              select: {
                id: true,
                name: true,
                description: true,
                selectionType: true,
                isRequired: true,
                sortOrder: true,
                options: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    priceType: true,
                    priceValue: true,
                    isDefault: true,
                    isAvailable: true,
                    stock: true,
                    sortOrder: true,
                  },
                  orderBy: {
                    sortOrder: "asc",
                  },
                },
              },
              orderBy: {
                sortOrder: "asc",
              },
            },
          },
        }),
        prisma.product.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        products,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get public products error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/public/products/:id - Get single active product (public access)
router.get("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: {
        id,
        isActive: true, // Only show active products
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        quantity: true,
        weight: true,
        imageUrl: true,
        bannerText: true,
        bannerColor: true,
        bannerType: true,
        originalPrice: true,
        isOnSale: true,
        hasOptions: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        optionGroups: {
          select: {
            id: true,
            name: true,
            description: true,
            selectionType: true,
            isRequired: true,
            sortOrder: true,
            options: {
              select: {
                id: true,
                name: true,
                description: true,
                priceType: true,
                priceValue: true,
                isDefault: true,
                isAvailable: true,
                stock: true,
                sortOrder: true,
              },
              orderBy: {
                sortOrder: "asc",
              },
            },
          },
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ product });
  } catch (error) {
    console.error("Get public product error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/public/categories - Get all active categories (public access)
router.get("/categories", async (req, res) => {
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
    console.error("Get public categories error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
