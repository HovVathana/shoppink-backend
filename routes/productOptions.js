const express = require("express");
const { body, validationResult, param } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const { authenticateToken } = require("../middleware/auth");
const {
  requireCreateProducts,
  requireEditProducts,
  requireDeleteProducts,
} = require("../middleware/permissions");

const hierarchicalStockService = require("../services/hierarchicalStockService");

const router = express.Router();
const prisma = getPrismaClient();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/product-options/:productId/groups - Get all option groups for a product
router.get("/:productId/groups", async (req, res) => {
  try {
    const { productId } = req.params;

    const optionGroups = await prisma.productOptionGroup.findMany({
      where: { productId },
      include: {
        options: {
          orderBy: { sortOrder: "asc" },
        },
        parentGroup: true,
        childGroups: true,
      },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
    });

    res.json(optionGroups);
  } catch (error) {
    console.error("Get option groups error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Validation rules for option groups
const optionGroupValidation = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Group name must be between 1 and 100 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must not exceed 500 characters"),
  body("selectionType")
    .isIn(["SINGLE", "MULTIPLE"])
    .withMessage("Selection type must be SINGLE or MULTIPLE"),
  body("isRequired")
    .optional()
    .isBoolean()
    .withMessage("isRequired must be a boolean"),
  body("sortOrder")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Sort order must be a non-negative integer"),
  body("parentGroupId")
    .optional()
    .isString()
    .withMessage("Parent group ID must be a string"),
  body("isParent")
    .optional()
    .isBoolean()
    .withMessage("isParent must be a boolean"),
  body("level")
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage("Level must be between 1 and 5"),
];

// Validation rules for options
const optionValidation = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Option name must be between 1 and 100 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must not exceed 500 characters"),
  body("priceType")
    .isIn(["FREE", "BASE", "FIXED", "PERCENTAGE"])
    .withMessage("Price type must be FREE, BASE, FIXED, or PERCENTAGE"),
  body("priceValue")
    .optional({ nullable: true })
    .custom((value, { req }) => {
      const priceType = req.body.priceType;
      // Validate priceValue for BASE, FIXED and PERCENTAGE types
      if (
        priceType === "BASE" ||
        priceType === "FIXED" ||
        priceType === "PERCENTAGE"
      ) {
        if (value === null || value === undefined || value === "") {
          throw new Error(
            "Price value is required for BASE, FIXED and PERCENTAGE price types"
          );
        }
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < 0) {
          throw new Error("Price value must be a non-negative number");
        }
      }
      return true;
    }),
  body("isDefault")
    .optional()
    .isBoolean()
    .withMessage("isDefault must be a boolean"),
  body("isAvailable")
    .optional()
    .isBoolean()
    .withMessage("isAvailable must be a boolean"),
  body("stock")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Stock must be a non-negative integer"),
  body("sortOrder")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Sort order must be a non-negative integer"),
];

// POST /api/product-options/:productId/groups - Create option group
router.post(
  "/:productId/groups",
  requireCreateProducts,
  [
    param("productId").isString().withMessage("Product ID is required"),
    ...optionGroupValidation,
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

      const { productId } = req.params;
      const {
        name,
        description,
        selectionType,
        isRequired,
        sortOrder,
        parentGroupId,
        isParent,
        level,
      } = req.body;

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Convert string values to proper types
      const isRequiredBool = isRequired === "true" || isRequired === true;
      const isParentBool = isParent === "true" || isParent === true;
      const sortOrderNum = parseInt(sortOrder) || 0;
      const levelNum = parseInt(level) || (isParentBool ? 1 : 2);

      // Validate parent group if specified
      if (parentGroupId) {
        const parentGroup = await prisma.productOptionGroup.findUnique({
          where: { id: parentGroupId },
        });

        if (!parentGroup) {
          return res.status(400).json({ message: "Parent group not found" });
        }

        if (!parentGroup.isParent) {
          return res.status(400).json({
            message: "Selected parent group is not marked as a parent group",
          });
        }
      }

      // Create option group
      const optionGroup = await prisma.productOptionGroup.create({
        data: {
          productId,
          name,
          description,
          selectionType,
          isRequired: isRequiredBool,
          sortOrder: sortOrderNum,
          parentGroupId: parentGroupId || null,
          isParent: isParentBool,
          level: levelNum,
        },
        include: {
          options: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      // Update product to indicate it has options
      await prisma.product.update({
        where: { id: productId },
        data: { hasOptions: true },
      });

      res.status(201).json({ optionGroup });
    } catch (error) {
      console.error("Create option group error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// POST /api/product-options/groups/:groupId/options - Create option
router.post(
  "/groups/:groupId/options",
  requireCreateProducts,
  [
    param("groupId").isString().withMessage("Option group ID is required"),
    ...optionValidation,
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

      const { groupId } = req.params;
      const {
        name,
        description,
        priceType,
        priceValue,
        isDefault,
        isAvailable,
        stock,
        sortOrder,
      } = req.body;

      // Check if option group exists
      const optionGroup = await prisma.productOptionGroup.findUnique({
        where: { id: groupId },
      });

      if (!optionGroup) {
        return res.status(404).json({ message: "Option group not found" });
      }

      // Convert string values to proper types
      const isDefaultBool = isDefault === "true" || isDefault === true;
      const isAvailableBool = isAvailable !== "false" && isAvailable !== false; // Default to true
      const stockNum = parseInt(stock) || 0;
      const sortOrderNum = parseInt(sortOrder) || 0;
      const priceValueNum = priceValue ? parseFloat(priceValue) : null;

      // Create option
      const option = await prisma.productOption.create({
        data: {
          optionGroupId: groupId,
          name,
          description,
          priceType,
          priceValue: priceValueNum,
          isDefault: isDefaultBool,
          isAvailable: isAvailableBool,
          stock: stockNum,
          sortOrder: sortOrderNum,
        },
      });

      res.status(201).json({ option });
    } catch (error) {
      console.error("Create option error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/product-options/groups/:groupId - Update option group
router.put(
  "/groups/:groupId",
  requireEditProducts,
  [
    param("groupId").isString().withMessage("Option group ID is required"),
    ...optionGroupValidation,
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

      const { groupId } = req.params;
      const {
        name,
        description,
        selectionType,
        isRequired,
        sortOrder,
        parentGroupId,
        isParent,
        level,
      } = req.body;

      // Check if option group exists
      const existingGroup = await prisma.productOptionGroup.findUnique({
        where: { id: groupId },
      });

      if (!existingGroup) {
        return res.status(404).json({ message: "Option group not found" });
      }

      // Convert string values to proper types
      const isRequiredBool = isRequired === "true" || isRequired === true;
      const isParentBool = isParent === "true" || isParent === true;
      const sortOrderNum = parseInt(sortOrder) || 0;
      const levelNum = parseInt(level) || (isParentBool ? 1 : 2);

      // Validate parent group if specified
      if (parentGroupId && parentGroupId !== existingGroup.parentGroupId) {
        const parentGroup = await prisma.productOptionGroup.findUnique({
          where: { id: parentGroupId },
        });

        if (!parentGroup) {
          return res.status(400).json({ message: "Parent group not found" });
        }

        if (!parentGroup.isParent) {
          return res.status(400).json({
            message: "Selected parent group is not marked as a parent group",
          });
        }

        // Prevent circular references
        if (parentGroupId === groupId) {
          return res
            .status(400)
            .json({ message: "A group cannot be its own parent" });
        }
      }

      // Update option group
      const optionGroup = await prisma.productOptionGroup.update({
        where: { id: groupId },
        data: {
          name,
          description,
          selectionType,
          isRequired: isRequiredBool,
          sortOrder: sortOrderNum,
          parentGroupId: parentGroupId || null,
          isParent: isParentBool,
          level: levelNum,
        },
        include: {
          options: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      res.json({ optionGroup });
    } catch (error) {
      console.error("Update option group error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/products/options/:optionId - Update option
router.put(
  "/options/:optionId",
  requireEditProducts,
  [
    param("optionId").isString().withMessage("Option ID is required"),
    ...optionValidation,
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

      const { optionId } = req.params;
      const {
        name,
        description,
        priceType,
        priceValue,
        isDefault,
        isAvailable,
        stock,
        sortOrder,
      } = req.body;

      // Check if option exists
      const existingOption = await prisma.productOption.findUnique({
        where: { id: optionId },
      });

      if (!existingOption) {
        return res.status(404).json({ message: "Option not found" });
      }

      // Convert string values to proper types
      const isDefaultBool = isDefault === "true" || isDefault === true;
      const isAvailableBool = isAvailable !== "false" && isAvailable !== false;
      const stockNum = parseInt(stock) || 0;
      const sortOrderNum = parseInt(sortOrder) || 0;
      const priceValueNum = priceValue ? parseFloat(priceValue) : null;

      // Update option
      const option = await prisma.productOption.update({
        where: { id: optionId },
        data: {
          name,
          description,
          priceType,
          priceValue: priceValueNum,
          isDefault: isDefaultBool,
          isAvailable: isAvailableBool,
          stock: stockNum,
          sortOrder: sortOrderNum,
        },
      });

      res.json({ option });
    } catch (error) {
      console.error("Update option error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// DELETE /api/product-options/groups/:groupId - Delete option group (safe cascade within product domain)
router.delete(
  "/groups/:groupId",
  requireDeleteProducts,
  [param("groupId").isString().withMessage("Option group ID is required")],
  async (req, res) => {
    try {
      const { groupId } = req.params;

      // 1) Load target group and product
      const optionGroup = await prisma.productOptionGroup.findUnique({
        where: { id: groupId },
        include: { product: true },
      });
      if (!optionGroup) {
        return res.status(404).json({ message: "Option group not found" });
      }

      // 2) Find all descendant groups (same product) to delete together
      const allGroups = await prisma.productOptionGroup.findMany({
        where: { productId: optionGroup.productId },
        select: { id: true, parentGroupId: true, level: true },
      });

      const toDelete = new Set([groupId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const g of allGroups) {
          if (
            g.parentGroupId &&
            toDelete.has(g.parentGroupId) &&
            !toDelete.has(g.id)
          ) {
            toDelete.add(g.id);
            changed = true;
          }
        }
      }

      const groupsToDelete = allGroups.filter((g) => toDelete.has(g.id));
      const groupIds = groupsToDelete.map((g) => g.id);

      // 3) Collect all options under these groups
      const options = await prisma.productOption.findMany({
        where: { optionGroupId: { in: groupIds } },
        select: { id: true },
      });
      const optionIds = options.map((o) => o.id);

      // 4) Find variants that use any of these options
      const variants = optionIds.length
        ? await prisma.productVariant.findMany({
            where: {
              productId: optionGroup.productId,
              variantOptions: { some: { optionId: { in: optionIds } } },
            },
            select: { id: true },
          })
        : [];
      const variantIds = variants.map((v) => v.id);

      // 5) Block deletion if any impacted variants are referenced by orders
      if (variantIds.length) {
        const referenced = await prisma.orderItem.findFirst({
          where: { productVariantId: { in: variantIds } },
          select: { id: true },
        });
        if (referenced) {
          return res.status(400).json({
            message:
              "Cannot delete option group because some variants are referenced in orders. Please update or remove related orders first.",
          });
        }
      }

      // 6) Perform deletion in a transaction: remove variants, then groups (deepest first)
      await prisma.$transaction(async (tx) => {
        if (variantIds.length) {
          await tx.productVariant.deleteMany({
            where: { id: { in: variantIds } },
          });
        }
        // Delete groups from deepest level to root to satisfy FK on parentGroupId
        const sortedByLevelDesc = groupsToDelete.sort(
          (a, b) => (b.level || 0) - (a.level || 0)
        );
        for (const g of sortedByLevelDesc) {
          await tx.productOptionGroup.delete({ where: { id: g.id } });
        }
      });

      // 7) Update product hasOptions if no groups remain
      const remainingGroups = await prisma.productOptionGroup.count({
        where: { productId: optionGroup.productId },
      });
      if (remainingGroups === 0) {
        await prisma.product.update({
          where: { id: optionGroup.productId },
          data: { hasOptions: false },
        });
      }

      return res.json({
        message: "Option group and related data deleted successfully",
        deleted: {
          groups: groupIds.length,
          options: optionIds.length,
          variants: variantIds.length,
        },
      });
    } catch (error) {
      console.error("Delete option group error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// DELETE /api/product-options/options/:optionId - Delete option (safe cascade within product domain)
router.delete(
  "/options/:optionId",
  requireDeleteProducts,
  [param("optionId").isString().withMessage("Option ID is required")],
  async (req, res) => {
    try {
      const { optionId } = req.params;

      // 1) Load option with its group to get productId
      const option = await prisma.productOption.findUnique({
        where: { id: optionId },
        include: { optionGroup: true },
      });
      if (!option) {
        return res.status(404).json({ message: "Option not found" });
      }

      const productId = option.optionGroup.productId;

      // 2) Find variants using this option
      const variants = await prisma.productVariant.findMany({
        where: {
          productId,
          variantOptions: { some: { optionId } },
        },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);

      // 3) Block deletion if any impacted variants are referenced by orders
      if (variantIds.length) {
        const referenced = await prisma.orderItem.findFirst({
          where: { productVariantId: { in: variantIds } },
          select: { id: true },
        });
        if (referenced) {
          return res.status(400).json({
            message:
              "Cannot delete option because related variants are referenced in orders. Please update or remove related orders first.",
          });
        }
      }

      // 4) Delete in a transaction: variants first, then the option
      await prisma.$transaction(async (tx) => {
        if (variantIds.length) {
          await tx.productVariant.deleteMany({
            where: { id: { in: variantIds } },
          });
        }
        await tx.productOption.delete({ where: { id: optionId } });
      });

      return res.json({
        message: "Option and related variants deleted successfully",
        deleted: { variants: variantIds.length },
      });
    } catch (error) {
      console.error("Delete option error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/products/:productId/hierarchical-stock - Get hierarchical stock tree
router.get("/:productId/hierarchical-stock", async (req, res) => {
  try {
    const { productId } = req.params;

    const stockData = await hierarchicalStockService.getHierarchicalStock(
      productId
    );
    res.json(stockData);
  } catch (error) {
    console.error("Get hierarchical stock error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/products/:productId/generate-variants - Auto-generate variants
router.post(
  "/:productId/generate-variants",
  requireCreateProducts,
  async (req, res) => {
    try {
      const { productId } = req.params;

      const variants =
        await hierarchicalStockService.generateVariantsForProduct(productId);
      res.json({
        message: `Generated ${variants.length} variants successfully`,
        variants,
      });
    } catch (error) {
      console.error("Generate variants error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/products/variants/:variantId/stock - Update variant stock
router.put(
  "/variants/:variantId/stock",
  requireEditProducts,
  [
    param("variantId").isString().withMessage("Variant ID is required"),
    body("stock")
      .isInt({ min: 0 })
      .withMessage("Stock must be a non-negative integer"),
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

      const { variantId } = req.params;
      const { stock } = req.body;

      const variant = await hierarchicalStockService.updateVariantStock(
        variantId,
        stock
      );
      res.json({ variant });
    } catch (error) {
      console.error("Update variant stock error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/products/:productId/stock-summary - Get stock summary
router.get("/:productId/stock-summary", async (req, res) => {
  try {
    const { productId } = req.params;

    const summary = await hierarchicalStockService.getStockSummary(productId);
    res.json(summary);
  } catch (error) {
    console.error("Get stock summary error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
