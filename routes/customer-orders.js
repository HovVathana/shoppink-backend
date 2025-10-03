const express = require("express");
const { body, validationResult, query } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");

const router = express.Router();
const prisma = getPrismaClient();

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

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload image to Cloudinary
const uploadToCloudinary = (buffer, originalname) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "payment-proofs",
        public_id: `payment-${Date.now()}-${originalname.split(".")[0]}`,
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

// Validation rules for customer orders
const customerOrderValidation = [
  body("customerName")
    .trim()
    .isLength({ min: 1 })
    .withMessage("Customer name is required"),
  body("customerPhone")
    .trim()
    .isLength({ min: 1 })
    .withMessage("Customer phone is required"),
  body("customerLocation")
    .trim()
    .isLength({ min: 1 })
    .withMessage("Customer location is required"),
  body("province")
    .trim()
    .isIn(["Phnom Penh", "Province"])
    .withMessage("Province must be either 'Phnom Penh' or 'Province'"),
  body("remark").optional().trim(),
  body("subtotalPrice")
    .isFloat({ min: 0 })
    .withMessage("Subtotal price must be positive"),
  body("deliveryPrice")
    .isFloat({ min: 0 })
    .withMessage("Delivery price must be positive"),
  body("totalPrice")
    .isFloat({ min: 0 })
    .withMessage("Total price must be positive"),
  body("items")
    .isArray({ min: 1 })
    .withMessage("At least one item is required"),
  body("items.*.productId").isString().withMessage("Product ID is required"),
  body("items.*.quantity")
    .isInt({ min: 1 })
    .withMessage("Quantity must be at least 1"),
  body("items.*.price")
    .isFloat({ min: 0 })
    .withMessage("Price must be positive"),
  body("items.*.weight")
    .isFloat({ min: 0 })
    .withMessage("Weight must be positive"),
];

// Middleware to parse items before validation
const parseItemsMiddleware = (req, res, next) => {
  if (req.body.items && typeof req.body.items === "string") {
    try {
      req.body.items = JSON.parse(req.body.items);
    } catch (error) {
      return res.status(400).json({
        message: "Invalid items format",
      });
    }
  }
  next();
};

// POST /api/customer-orders - Create a new customer order
router.post(
  "/",
  upload.single("paymentProof"),
  parseItemsMiddleware,
  customerOrderValidation,
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const {
        customerName,
        customerPhone,
        customerLocation,
        province,
        remark,
        subtotalPrice,
        deliveryPrice,
        totalPrice,
        items,
      } = req.body;

      // Items are already parsed by middleware
      const parsedItems = items;

      // Upload payment proof to Cloudinary
      let paymentProofUrl = null;
      if (req.file) {
        try {
          paymentProofUrl = await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname
          );
        } catch (uploadError) {
          console.error("Failed to upload payment proof:", uploadError);
          return res.status(500).json({
            message: "Failed to upload payment proof",
          });
        }
      }

      // Validate products exist and have sufficient stock
      const uniqueProductIds = [
        ...new Set(parsedItems.map((item) => item.productId)),
      ];
      const products = await prisma.product.findMany({
        where: {
          id: { in: uniqueProductIds },
          isActive: true,
        },
      });

      if (products.length !== uniqueProductIds.length) {
        return res.status(400).json({
          message: "One or more products not found or inactive",
        });
      }

      // Note: Stock validation is not performed here since stock will be checked when driver is assigned

      // Calculate company delivery price (internal cost)
      const companyDeliveryPrice = province === "Phnom Penh" ? 1.5 : 2.0;

      // Generate custom order ID with timestamp + random: SP + DDMMYY + HHMM + 5 random chars
      const generateCustomOrderId = () => {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, "0");
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const year = String(now.getFullYear()).slice(-2);
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");

        // Generate 5 random alphanumeric characters (uppercase)
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let randomSuffix = "";
        for (let i = 0; i < 5; i++) {
          randomSuffix += chars.charAt(
            Math.floor(Math.random() * chars.length)
          );
        }

        return `SP${day}${month}${year}${hours}${minutes}${randomSuffix}`;
      };

      // Create order with retry mechanism to handle potential ID collisions
      const createOrderWithRetry = async (maxRetries = 3) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const customOrderId = generateCustomOrderId();

            // Create order with transaction
            return await prisma.$transaction(async (tx) => {
              // Create the order with custom ID
              const newOrder = await tx.order.create({
                data: {
                  id: customOrderId,
                  customerName,
                  customerPhone,
                  customerLocation,
                  province,
                  remark: remark || null,
                  state: "PLACED",
                  subtotalPrice: 0,
                  companyDeliveryPrice,
                  deliveryPrice: parseFloat(deliveryPrice),
                  totalPrice: 0,
                  isPaid: !!paymentProofUrl,
                  orderSource: "CUSTOMER",
                  paymentProofUrl,
                  createdBy: null, // No admin user for customer orders
                },
              });

              // Helper to resolve variant by selected option IDs
              const resolveVariantId = async (productId, optionIds) => {
                if (!optionIds || optionIds.length === 0) return null;
                const variants = await tx.productVariant.findMany({
                  where: { productId },
                  include: { variantOptions: true },
                });
                if (!variants || variants.length === 0) return null;
                const desired = new Set(optionIds);

                // Prefer exact match first
                for (const v of variants) {
                  const voSet = new Set(
                    v.variantOptions.map((vo) => vo.optionId)
                  );
                  if (voSet.size === desired.size) {
                    let exact = true;
                    for (const id of desired) {
                      if (!voSet.has(id)) {
                        exact = false;
                        break;
                      }
                    }
                    if (exact) return v.id;
                  }
                }

                // Fallback: subset match (all variant options contained in selected)
                let best = null;
                let bestSize = -1;
                for (const v of variants) {
                  const voSet = new Set(
                    v.variantOptions.map((vo) => vo.optionId)
                  );
                  let subset = true;
                  for (const id of voSet) {
                    if (!desired.has(id)) {
                      subset = false;
                      break;
                    }
                  }
                  if (subset && voSet.size > bestSize) {
                    best = v.id;
                    bestSize = voSet.size;
                  }
                }
                return best;
              };

              // Create order items and update product quantities
              let serverSubtotal = 0;
              for (const item of parsedItems) {
                // Flatten selected option IDs (customer payload may include optionDetails grouped similarly)
                const selectedOptionIds = (item.optionDetails || [])
                  .flatMap((group) =>
                    (group.selectedOptions || []).map((opt) => opt.id)
                  )
                  .filter(Boolean);

                const variantId = await resolveVariantId(
                  item.productId,
                  selectedOptionIds
                );

                // Compute safe server-side price from product base + variant adjustment
                const variant = variantId
                  ? await tx.productVariant.findUnique({
                      where: { id: variantId },
                      select: { priceAdjustment: true },
                    })
                  : null;
                const baseProduct = await tx.product.findUnique({
                  where: { id: item.productId },
                  select: { price: true },
                });
                const computedPrice =
                  (baseProduct?.price || 0) + (variant?.priceAdjustment || 0);

                await tx.orderItem.create({
                  data: {
                    orderId: newOrder.id,
                    productId: item.productId,
                    quantity: parseInt(item.quantity),
                    price: computedPrice,
                    weight: parseFloat(item.weight),
                    optionDetails:
                      item.optionDetails && item.optionDetails.length > 0
                        ? {
                            variantId: variantId,
                            selections: item.optionDetails,
                          }
                        : null,
                  },
                });

                serverSubtotal += computedPrice * parseInt(item.quantity);

                // Note: Stock is NOT deducted here - it will be deducted when driver is assigned
              }

              // Update order totals based on computed item prices
              const computedSubtotal = serverSubtotal;
              const computedTotal =
                computedSubtotal + parseFloat(deliveryPrice);
              await tx.order.update({
                where: { id: newOrder.id },
                data: {
                  subtotalPrice: computedSubtotal,
                  totalPrice: computedTotal,
                },
              });

              return newOrder;
            });
          } catch (error) {
            if (error.code === "P2002" && attempt < maxRetries) {
              // Unique constraint violation, retry with new ID
              console.log(
                `Order ID collision, retrying... (attempt ${attempt})`
              );
              continue;
            }
            throw error;
          }
        }
        throw new Error("Failed to create order after maximum retries");
      };

      const order = await createOrderWithRetry();

      // Fetch the complete order with items and products
      const completeOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      res.status(201).json({
        message: "Order created successfully",
        data: {
          order: completeOrder,
        },
      });
    } catch (error) {
      console.error("Failed to create customer order:", error);
      res.status(500).json({
        message: "Failed to create order",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// GET /api/customer-orders - Get all customer orders (admin only)
router.get(
  "/",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 5000 })
      .withMessage("Limit must be between 1 and 5000"),
    query("state")
      .optional()
      .isIn(["PLACED", "DELIVERING", "RETURNED", "COMPLETED"]),
    query("search").optional().trim(),
    query("sortBy")
      .optional()
      .isIn([
        "id",
        "orderAt",
        "customerName",
        "province",
        "subtotalPrice",
        "totalPrice",
        "state",
      ]),
    query("sortOrder").optional().isIn(["asc", "desc"]),
    query("dateFrom")
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/),
    query("dateTo")
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/),
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
      const state = req.query.state;
      const search = req.query.search;
      const sortBy = req.query.sortBy || "orderAt";
      const sortOrder = req.query.sortOrder || "desc";
      const dateFrom = req.query.dateFrom;
      const dateTo = req.query.dateTo;

      // Prevent large queries without date filtering
      if (limit > 500 && !dateFrom && !dateTo) {
        return res.status(400).json({
          message:
            "Large limit requests require date filtering for performance",
        });
      }

      // Build where clause for customer orders only
      const where = {
        orderSource: "CUSTOMER", // Only customer orders
      };

      if (state) {
        where.state = state;
      }

      if (search) {
        where.OR = [
          { id: { contains: search, mode: "insensitive" } },
          { customerName: { contains: search, mode: "insensitive" } },
          { customerPhone: { contains: search, mode: "insensitive" } },
          { customerLocation: { contains: search, mode: "insensitive" } },
          { province: { contains: search, mode: "insensitive" } },
        ];
      }

      // Date filtering
      if (dateFrom || dateTo) {
        const dateField = "orderAt";
        where[dateField] = {};

        if (dateFrom) {
          // Validate and parse dateFrom
          const fromDate = new Date(dateFrom);
          if (isNaN(fromDate.getTime())) {
            return res.status(400).json({
              message: "Invalid dateFrom format. Use YYYY-MM-DD",
            });
          }
          // Set to start of day in UTC
          fromDate.setUTCHours(0, 0, 0, 0);
          where[dateField].gte = fromDate;
        }
        if (dateTo) {
          // Validate and parse dateTo
          const toDate = new Date(dateTo);
          if (isNaN(toDate.getTime())) {
            return res.status(400).json({
              message: "Invalid dateTo format. Use YYYY-MM-DD",
            });
          }
          // Set to end of day in UTC
          toDate.setUTCHours(23, 59, 59, 999);
          where[dateField].lte = toDate;
        }
      }

      // Build orderBy object
      const orderBy = {};

      // Map frontend sort fields to database fields
      const sortFieldMap = {
        id: "id",
        orderAt: "orderAt",
        customerName: "customerName",
        province: "province",
        subtotalPrice: "subtotalPrice",
        totalPrice: "totalPrice",
        state: "state",
      };

      const dbSortField = sortFieldMap[sortBy] || "orderAt";
      orderBy[dbSortField] = sortOrder.toLowerCase() === "asc" ? "asc" : "desc";

      // Get orders with pagination
      const [orders, totalCount] = await Promise.all([
        prisma.order.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            driver: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
            orderItems: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                  },
                },
              },
            },
            creator: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
          },
        }),
        prisma.order.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        orders,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Failed to fetch customer orders:", error);
      res.status(500).json({
        message: "Failed to fetch customer orders",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// GET /api/customer-orders/:id - Get order by ID (for customer tracking)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: {
        id,
        orderSource: "CUSTOMER", // Only allow access to customer orders
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
              },
            },
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    res.json({
      data: { order },
    });
  } catch (error) {
    console.error("Failed to fetch order:", error);
    res.status(500).json({
      message: "Failed to fetch order",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// PUT /api/customer-orders/:id - Update customer order
router.put(
  "/:id",
  upload.single("paymentProof"),
  parseItemsMiddleware,
  customerOrderValidation,
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
        customerName,
        customerPhone,
        customerLocation,
        province,
        remark,
        subtotalPrice,
        deliveryPrice,
        totalPrice,
        items,
        isPaid: isPaidRaw,
      } = req.body;

      // Items are already parsed by middleware
      const parsedItems = items;

      // Check if order exists and is customer order
      const existingOrder = await prisma.order.findFirst({
        where: {
          id,
          orderSource: "CUSTOMER", // Only customer orders
        },
        include: { orderItems: true },
      });

      if (!existingOrder) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      // Upload payment proof to Cloudinary if new file provided
      let paymentProofUrl = existingOrder.paymentProofUrl;
      if (req.file) {
        try {
          paymentProofUrl = await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname
          );
        } catch (uploadError) {
          console.error("Failed to upload payment proof:", uploadError);
          return res.status(500).json({
            message: "Failed to upload payment proof",
          });
        }
      }

      // Determine final isPaid value: prefer explicit body, else keep existing or set true if proof exists
      const isPaidFromBody =
        isPaidRaw === true ||
        isPaidRaw === "true" ||
        isPaidRaw === 1 ||
        isPaidRaw === "1";
      const finalIsPaid =
        typeof isPaidRaw !== "undefined"
          ? isPaidFromBody
          : existingOrder.isPaid || !!paymentProofUrl;

      // Update order and items in transaction
      const updatedOrder = await prisma.$transaction(async (tx) => {
        // Delete existing order items
        await tx.orderItem.deleteMany({
          where: { orderId: id },
        });

        // Restore product quantities from old items
        for (const oldItem of existingOrder.orderItems) {
          await tx.product.update({
            where: { id: oldItem.productId },
            data: {
              quantity: {
                increment: oldItem.quantity,
              },
            },
          });
        }

        // Update the order
        const order = await tx.order.update({
          where: { id },
          data: {
            customerName,
            customerPhone,
            customerLocation,
            province,
            remark,
            subtotalPrice: parseFloat(subtotalPrice),
            deliveryPrice: parseFloat(deliveryPrice),
            totalPrice: parseFloat(totalPrice),
            paymentProofUrl,
            isPaid: finalIsPaid,
          },
        });

        // Create new order items and update product quantities
        for (const item of parsedItems) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              quantity: parseInt(item.quantity),
              price: parseFloat(item.price),
              weight: parseFloat(item.weight),
              optionDetails: item.optionDetails || null,
            },
          });

          // Update product quantity
          await tx.product.update({
            where: { id: item.productId },
            data: {
              quantity: {
                decrement: parseInt(item.quantity),
              },
            },
          });
        }

        return order;
      });

      res.json({
        message: "Customer order updated successfully",
        data: { order: updatedOrder },
      });
    } catch (error) {
      console.error("Failed to update customer order:", error);
      res.status(500).json({
        message: "Failed to update customer order",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// DELETE /api/customer-orders/:id - Delete customer order
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check if order exists and is customer order
    const existingOrder = await prisma.order.findFirst({
      where: {
        id,
        orderSource: "CUSTOMER", // Only customer orders
      },
      include: { orderItems: true },
    });

    if (!existingOrder) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    // Delete order and restore product quantities in transaction
    await prisma.$transaction(async (tx) => {
      // Restore product quantities
      for (const item of existingOrder.orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            quantity: {
              increment: item.quantity,
            },
          },
        });
      }

      // Delete order items first (due to foreign key constraint)
      await tx.orderItem.deleteMany({
        where: { orderId: id },
      });

      // Delete the order
      await tx.order.delete({
        where: { id },
      });
    });

    res.json({
      message: "Customer order deleted successfully",
    });
  } catch (error) {
    console.error("Failed to delete customer order:", error);
    res.status(500).json({
      message: "Failed to delete customer order",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

module.exports = router;
