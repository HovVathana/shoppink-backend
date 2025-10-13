const express = require("express");
const { body, validationResult, query } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const {
  authenticateUser,
  requireViewProducts,
  requireCreateProducts,
  requireEditProducts,
  requireDeleteProducts,
  requireProductsForOrders,
} = require("../middleware/permissions");

const router = express.Router();
const prisma = getPrismaClient();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Upload image to Cloudinary
const uploadToCloudinary = (buffer, originalname) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "products",
        public_id: `product-${Date.now()}-${originalname.split(".")[0]}`,
        transformation: [
          { width: 800, height: 800, crop: "limit" },
          { quality: "auto" },
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result.secure_url);
        }
      }
    );
    uploadStream.end(buffer);
  });
};

// All routes require authentication
router.use(authenticateUser);

// Validation rules
const productValidation = [
  body("name")
    .trim()
    .isLength({ min: 1 })
    .withMessage("Product name is required"),
  body("price")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),
  body("quantity")
    .isInt({ min: 0 })
    .withMessage("Quantity must be a non-negative integer"),
  body("weight")
    .isFloat({ min: 0 })
    .withMessage("Weight must be a positive number"),
  body("delivery_price_for_pp")
    .isFloat({ min: 0 })
    .withMessage("PP delivery price must be a positive number"),
  body("delivery_price_for_province")
    .isFloat({ min: 0 })
    .withMessage("Province delivery price must be a positive number"),
  body("description").optional().trim(),
  body("categoryId")
    .optional()
    .isString()
    .withMessage("Category ID must be a string"),
  body("isActive").optional().isBoolean(),
  body("bannerText").optional().trim(),
  body("bannerColor")
    .optional()
    .isIn(["blue", "green", "red", "yellow", "purple", "pink", "gray"])
    .withMessage("Invalid banner color"),
  body("bannerType")
    .optional()
    .isIn([
      // New simplified types
      "circle", "square", "rectangle", "tilted",
      // Legacy types for backward compatibility
      "info", "success", "warning", "error", "discount", "new", "sale", "hot"
    ])
    .withMessage("Invalid banner type"),
  body("originalPrice")
    .optional({ nullable: true })
    .custom((value, { req }) => {
      // If originalPrice is null or undefined, it's valid
      if (value === null || value === undefined) {
        return true;
      }
      // If originalPrice is provided, it must be a positive number
      if (isNaN(value) || value < 0) {
        throw new Error("Original price must be a positive number");
      }
      return true;
    }),
  body("isOnSale").optional().isBoolean(),
];

// GET /api/products - Get all products with pagination and filtering
router.get(
  "/",
  requireProductsForOrders,
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
      const category = req.query.category;
      const isActive = req.query.isActive;

      // Build where clause
      const where = {};

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
        ];
      }

      if (category) {
        where.categoryId = category;
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      // Get products with pagination
      const [products, totalCount] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            optionGroups: {
              include: {
                options: {
                  orderBy: {
                    sortOrder: "asc",
                  },
                },
                parentGroup: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                childGroups: {
                  include: {
                    options: {
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
      console.error("Get products error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/products/:id - Get single product
router.get("/:id", requireProductsForOrders, async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        optionGroups: {
          include: {
            options: {
              orderBy: {
                sortOrder: "asc",
              },
            },
            parentGroup: {
              select: {
                id: true,
                name: true,
              },
            },
            childGroups: {
              include: {
                options: {
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
    console.error("Get product error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/products - Create new product
router.post(
  "/",
  upload.single("image"),
  requireCreateProducts,
  productValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const {
        name,
        description,
        price: priceStr,
        quantity: quantityStr,
        weight: weightStr,
        delivery_price_for_pp: deliveryPpStr,
        delivery_price_for_province: deliveryProvinceStr,
        categoryId,
        isActive = true,
        bannerText,
        bannerColor = "blue",
        bannerType = "info",
        originalPrice: originalPriceStr,
      } = req.body;

      // Handle image upload
      let imageUrl = null;
      if (req.file) {
        try {
          imageUrl = await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname
          );
        } catch (uploadError) {
          console.error("Failed to upload image:", uploadError);
          return res.status(500).json({
            message: "Failed to upload image",
          });
        }
      } else {
        return res.status(400).json({
          message: "Product image is required",
        });
      }

      // Convert string values to correct types
      const price = parseFloat(priceStr);
      const quantity = parseInt(quantityStr);
      const weight = parseFloat(weightStr);
      const delivery_price_for_pp = parseFloat(deliveryPpStr);
      const delivery_price_for_province = parseFloat(deliveryProvinceStr);
      const originalPrice = originalPriceStr
        ? parseFloat(originalPriceStr)
        : null;

      // Convert boolean strings to actual booleans
      const isActiveBool = isActive === "true" || isActive === true;

      // Validate converted values
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ message: "Invalid price value" });
      }
      if (isNaN(quantity) || quantity < 0) {
        return res.status(400).json({ message: "Invalid quantity value" });
      }
      if (isNaN(weight) || weight < 0) {
        return res.status(400).json({ message: "Invalid weight value" });
      }
      if (isNaN(delivery_price_for_pp) || delivery_price_for_pp < 0) {
        return res
          .status(400)
          .json({ message: "Invalid delivery price for PP value" });
      }
      if (
        isNaN(delivery_price_for_province) ||
        delivery_price_for_province < 0
      ) {
        return res
          .status(400)
          .json({ message: "Invalid delivery price for province value" });
      }
      // Only validate originalPrice if it's provided and not null/empty
      if (
        originalPrice !== null &&
        originalPrice !== undefined &&
        !isNaN(originalPrice) &&
        originalPrice < 0
      ) {
        return res
          .status(400)
          .json({ message: "Original price must be positive" });
      }

      // Check if product name already exists
      const existingProduct = await prisma.product.findFirst({
        where: { name },
      });
      if (existingProduct) {
        return res
          .status(409)
          .json({ message: "Product with this name already exists" });
      }

      // Validate category if provided
      if (categoryId) {
        const categoryExists = await prisma.category.findUnique({
          where: { id: categoryId },
        });
        if (!categoryExists) {
          return res.status(400).json({ message: "Invalid category ID" });
        }
      }

      // Generate unique SKU - use timestamp + random number to ensure uniqueness
      const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
      const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const uniqueSku = `SKU-${timestamp}-${randomNum}`;

      const product = await prisma.product.create({
        data: {
          name,
          description,
          price,
          quantity,
          weight,
          delivery_price_for_pp,
          delivery_price_for_province,
          categoryId,
          imageUrl,
          sku: uniqueSku, // Use unique timestamp-based SKU
          isActive: isActiveBool,
          bannerText,
          bannerColor,
          bannerType,
          originalPrice,
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          optionGroups: {
            include: {
              options: {
                orderBy: {
                  sortOrder: "asc",
                },
              },
              parentGroup: {
                select: {
                  id: true,
                  name: true,
                },
              },
              childGroups: {
                include: {
                  options: {
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
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      });

      res.status(201).json({
        message: "Product created successfully",
        product,
      });
    } catch (error) {
      console.error("Create product error:", error);
      
      // Handle unique constraint failures
      if (error.code === 'P2002') {
        if (error.meta && error.meta.target && error.meta.target.includes('sku')) {
          return res.status(409).json({ message: "SKU conflict occurred. Please try again." });
        }
      }
      
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/products/:id - Update product
router.put(
  "/:id",
  upload.single("image"),
  requireEditProducts,
  productValidation,
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
      const {
        name,
        description,
        price: priceStr,
        quantity: quantityStr,
        weight: weightStr,
        delivery_price_for_pp: deliveryPpStr,
        delivery_price_for_province: deliveryProvinceStr,
        categoryId,
        isActive,
        bannerText,
        bannerColor,
        bannerType,
        originalPrice: originalPriceStr,
      } = req.body;

      // Handle image upload (optional for updates)
      let imageUrl = undefined;
      if (req.file) {
        try {
          imageUrl = await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname
          );
        } catch (uploadError) {
          console.error("Failed to upload image:", uploadError);
          return res.status(500).json({
            message: "Failed to upload image",
          });
        }
      }

      // Convert string values to correct types (only if provided)
      const price = priceStr !== undefined ? parseFloat(priceStr) : undefined;
      const quantity =
        quantityStr !== undefined ? parseInt(quantityStr) : undefined;
      const weight =
        weightStr !== undefined ? parseFloat(weightStr) : undefined;
      const delivery_price_for_pp =
        deliveryPpStr !== undefined ? parseFloat(deliveryPpStr) : undefined;
      const delivery_price_for_province =
        deliveryProvinceStr !== undefined
          ? parseFloat(deliveryProvinceStr)
          : undefined;
      const originalPrice = isNaN(originalPriceStr)
        ? null
        : parseFloat(originalPriceStr);

      // Convert boolean strings to actual booleans
      const isActiveBool =
        isActive !== undefined ? isActive === "true" : undefined;

      // Validate converted values (only if provided)
      if (price !== undefined && (isNaN(price) || price < 0)) {
        return res.status(400).json({ message: "Invalid price value" });
      }
      if (quantity !== undefined && (isNaN(quantity) || quantity < 0)) {
        return res.status(400).json({ message: "Invalid quantity value" });
      }
      if (weight !== undefined && (isNaN(weight) || weight < 0)) {
        return res.status(400).json({ message: "Invalid weight value" });
      }
      if (
        delivery_price_for_pp !== undefined &&
        (isNaN(delivery_price_for_pp) || delivery_price_for_pp < 0)
      ) {
        return res
          .status(400)
          .json({ message: "Invalid delivery price for PP value" });
      }
      if (
        delivery_price_for_province !== undefined &&
        (isNaN(delivery_price_for_province) || delivery_price_for_province < 0)
      ) {
        return res
          .status(400)
          .json({ message: "Invalid delivery price for province value" });
      }
      // Only validate originalPrice if it's provided and not null/empty
      if (
        originalPrice !== null &&
        originalPrice !== undefined &&
        !isNaN(originalPrice) &&
        originalPrice < 0
      ) {
        return res
          .status(400)
          .json({ message: "Original price must be positive" });
      }

      // Check if product exists
      const existingProduct = await prisma.product.findUnique({
        where: { id },
      });

      if (!existingProduct) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Check if name already exists (if provided and different from current)
      if (name && name !== existingProduct.name) {
        const nameExists = await prisma.product.findFirst({
          where: { name },
        });
        if (nameExists) {
          return res
            .status(409)
            .json({ message: "Product with this name already exists" });
        }
      }

      // Validate category if provided
      if (categoryId) {
        const categoryExists = await prisma.category.findUnique({
          where: { id: categoryId },
        });
        if (!categoryExists) {
          return res.status(400).json({ message: "Invalid category ID" });
        }
      }

      const product = await prisma.product.update({
        where: { id },
        data: {
          name,
          description,
          price,
          quantity,
          weight,
          delivery_price_for_pp,
          delivery_price_for_province,
          categoryId,
          imageUrl,
          isActive: isActiveBool,
          bannerText,
          bannerColor,
          bannerType,
          originalPrice,
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          optionGroups: {
            include: {
              options: {
                orderBy: {
                  sortOrder: "asc",
                },
              },
              parentGroup: {
                select: {
                  id: true,
                  name: true,
                },
              },
              childGroups: {
                include: {
                  options: {
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
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      });

      res.json({
        message: "Product updated successfully",
        product,
      });
    } catch (error) {
      console.error("Update product error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// DELETE /api/products/:id - Delete product
router.delete("/:id", requireDeleteProducts, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product exists
    const existingProduct = await prisma.product.findUnique({
      where: { id },
    });

    if (!existingProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if product is used in any orders
    const orderItems = await prisma.orderItem.findFirst({
      where: { productId: id },
    });

    if (orderItems) {
      return res.status(400).json({
        message:
          "Cannot delete product that is referenced in orders. Consider deactivating it instead.",
      });
    }

    await prisma.product.delete({
      where: { id },
    });

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
