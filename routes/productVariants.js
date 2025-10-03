const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { body, param, validationResult } = require("express-validator");
const {
  requireCreateProducts,
  requireEditProducts,
  requireDeleteProducts,
} = require("../middleware/permissions");

const router = express.Router();
const prisma = new PrismaClient();

// Validation rules
const variantValidation = [
  body("name").notEmpty().withMessage("Variant name is required"),
  body("stock").isInt({ min: 0 }).withMessage("Stock must be a non-negative integer"),
  body("priceAdjustment").optional().isFloat().withMessage("Price adjustment must be a number"),
  body("optionIds").isArray().withMessage("Option IDs must be an array"),
  body("optionIds.*").isString().withMessage("Each option ID must be a string"),
];

// GET /api/products/:productId/variants - Get all variants for a product
router.get("/:productId/variants", async (req, res) => {
  try {
    const { productId } = req.params;

    const variants = await prisma.productVariant.findMany({
      where: { productId },
      include: {
        variantOptions: {
          include: {
            option: {
              include: {
                optionGroup: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json({ variants });
  } catch (error) {
    console.error("Get variants error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/products/:productId/variants - Create variant
router.post(
  "/:productId/variants",
  requireCreateProducts,
  [
    param("productId").isString().withMessage("Product ID is required"),
    ...variantValidation,
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
      const { name, stock, priceAdjustment, optionIds, sku } = req.body;

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Verify all option IDs exist
      const options = await prisma.productOption.findMany({
        where: { id: { in: optionIds } },
        include: { optionGroup: true },
      });

      if (options.length !== optionIds.length) {
        return res.status(400).json({ message: "Some option IDs are invalid" });
      }

      // Create variant with transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create the variant
        const variant = await tx.productVariant.create({
          data: {
            productId,
            name,
            sku,
            stock: parseInt(stock) || 0,
            priceAdjustment: parseFloat(priceAdjustment) || 0,
          },
        });

        // Create variant-option relationships
        const variantOptions = await Promise.all(
          optionIds.map((optionId) =>
            tx.productVariantOption.create({
              data: {
                variantId: variant.id,
                optionId,
              },
            })
          )
        );

        return { variant, variantOptions };
      });

      // Fetch the complete variant with relations
      const completeVariant = await prisma.productVariant.findUnique({
        where: { id: result.variant.id },
        include: {
          variantOptions: {
            include: {
              option: {
                include: {
                  optionGroup: true,
                },
              },
            },
          },
        },
      });

      res.status(201).json({ variant: completeVariant });
    } catch (error) {
      console.error("Create variant error:", error);
      if (error.code === "P2002") {
        return res.status(400).json({ message: "Variant name already exists for this product" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/products/variants/:variantId - Update variant
router.put(
  "/variants/:variantId",
  requireEditProducts,
  [
    param("variantId").isString().withMessage("Variant ID is required"),
    body("stock").optional().isInt({ min: 0 }).withMessage("Stock must be a non-negative integer"),
    body("priceAdjustment").optional().isFloat().withMessage("Price adjustment must be a number"),
    body("isActive").optional().isBoolean().withMessage("isActive must be a boolean"),
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
      const { stock, priceAdjustment, isActive } = req.body;

      // Check if variant exists
      const existingVariant = await prisma.productVariant.findUnique({
        where: { id: variantId },
      });

      if (!existingVariant) {
        return res.status(404).json({ message: "Variant not found" });
      }

      // Update variant
      const variant = await prisma.productVariant.update({
        where: { id: variantId },
        data: {
          ...(stock !== undefined && { stock: parseInt(stock) }),
          ...(priceAdjustment !== undefined && { priceAdjustment: parseFloat(priceAdjustment) }),
          ...(isActive !== undefined && { isActive }),
        },
        include: {
          variantOptions: {
            include: {
              option: {
                include: {
                  optionGroup: true,
                },
              },
            },
          },
        },
      });

      res.json({ variant });
    } catch (error) {
      console.error("Update variant error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// DELETE /api/products/variants/:variantId - Delete variant
router.delete(
  "/variants/:variantId",
  requireDeleteProducts,
  [param("variantId").isString().withMessage("Variant ID is required")],
  async (req, res) => {
    try {
      const { variantId } = req.params;

      // Check if variant exists
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
      });

      if (!variant) {
        return res.status(404).json({ message: "Variant not found" });
      }

      // Delete variant (cascade will handle variant options)
      await prisma.productVariant.delete({
        where: { id: variantId },
      });

      res.json({ message: "Variant deleted successfully" });
    } catch (error) {
      console.error("Delete variant error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// POST /api/products/:productId/variants/generate - Auto-generate variants from option combinations
router.post(
  "/:productId/variants/generate",
  requireCreateProducts,
  [param("productId").isString().withMessage("Product ID is required")],
  async (req, res) => {
    try {
      const { productId } = req.params;

      // Get product with option groups and options
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          optionGroups: {
            include: {
              options: {
                where: { isAvailable: true },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { level: "asc" },
          },
        },
      });

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Generate all possible combinations
      const variants = await generateVariantCombinations(product);

      res.json({ 
        message: `Generated ${variants.length} variants successfully`,
        variants 
      });
    } catch (error) {
      console.error("Generate variants error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Helper function to generate variant combinations
async function generateVariantCombinations(product) {
  const { optionGroups } = product;
  
  // Find hierarchical structure (Size -> Color pattern)
  const parentGroups = optionGroups.filter(g => g.level === 1 && g.options.length > 0);
  const childGroups = optionGroups.filter(g => g.level === 2 && g.options.length > 0);
  
  const variants = [];
  
  for (const parentGroup of parentGroups) {
    for (const parentOption of parentGroup.options) {
      // Find child groups that belong to this parent
      const relevantChildGroups = childGroups.filter(cg => cg.parentGroupId === parentGroup.id);
      
      for (const childGroup of relevantChildGroups) {
        for (const childOption of childGroup.options) {
          const variantName = `${parentOption.name} ${childOption.name}`;
          const optionIds = [parentOption.id, childOption.id];
          
          // Check if variant already exists
          const existingVariant = await prisma.productVariant.findUnique({
            where: {
              productId_name: {
                productId: product.id,
                name: variantName,
              },
            },
          });
          
          if (!existingVariant) {
            // Create new variant
            const variant = await prisma.$transaction(async (tx) => {
              const newVariant = await tx.productVariant.create({
                data: {
                  productId: product.id,
                  name: variantName,
                  stock: 0,
                  priceAdjustment: (parentOption.priceValue || 0) + (childOption.priceValue || 0),
                },
              });
              
              // Create variant-option relationships
              await Promise.all(
                optionIds.map((optionId) =>
                  tx.productVariantOption.create({
                    data: {
                      variantId: newVariant.id,
                      optionId,
                    },
                  })
                )
              );
              
              return newVariant;
            });
            
            variants.push(variant);
          }
        }
      }
    }
  }
  
  return variants;
}

module.exports = router;
