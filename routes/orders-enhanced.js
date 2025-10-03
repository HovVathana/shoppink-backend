const express = require("express");
const { body, validationResult, query } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const {
  authenticateUser,
  requireViewOrders,
  requireCreateOrders,
  requireEditOrders,
  requireDeleteOrders,
} = require("../middleware/permissions");
const stockManagementService = require("../services/stockManagementService");
const { cacheMiddleware } = require("../middleware/cache");

const router = express.Router();
const prisma = getPrismaClient();

// All routes require authentication
router.use(authenticateUser);

// Validation rules for enhanced orders
const orderValidation = [
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
    .isLength({ min: 1 })
    .withMessage("Province is required"),
  body("remark").optional().trim(),
  body("state")
    .optional()
    .isIn(["PLACED", "DELIVERING", "RETURNED", "COMPLETED"]),
  body("subtotalPrice")
    .isFloat({ min: 0 })
    .withMessage("Subtotal price must be positive"),
  body("companyDeliveryPrice")
    .isFloat({ min: 0 })
    .withMessage("Company delivery price must be positive"),
  body("deliveryPrice")
    .isFloat({ min: 0 })
    .withMessage("Delivery price must be positive"),
  body("totalPrice")
    .isFloat({ min: 0 })
    .withMessage("Total price must be positive"),
  body("isPaid").optional().isBoolean(),
  body("driverId").optional({ nullable: true }).isString(),
  body("products")
    .isArray({ min: 1 })
    .withMessage("At least one product is required"),
  body("products.*.productId").isString().withMessage("Product ID is required"),
  body("products.*.quantity")
    .isInt({ min: 1 })
    .withMessage("Quantity must be positive"),
  body("products.*.price")
    .isFloat({ min: 0 })
    .withMessage("Price must be positive"),
];

// GET /api/orders - Get all orders with pagination and filtering
router.get(
  "/",
  requireViewOrders,
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
    query("assignedOnly").optional().isBoolean(),
    query("allSources").optional().isBoolean(),
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
      const assignedOnly = req.query.assignedOnly === "true";
      const allSources = req.query.allSources === "true";

      // Prevent large queries without date filtering
      if (limit > 500 && !dateFrom && !dateTo) {
        return res.status(400).json({
          message:
            "Large limit requests require date filtering for performance",
        });
      }

      // Build where clause
      const where = {};

      // Only filter by orderSource if not fetching assigned orders or all sources
      // When assignedOnly is true, we want all orders (ADMIN + CUSTOMER) that have assignedAt
      // When allSources is true, we want all orders regardless of source (for dashboard)
      if (!assignedOnly && !allSources) {
        where.orderSource = "ADMIN"; // Only admin created orders for regular orders page
      }

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
        const dateField = assignedOnly ? "assignedAt" : "orderAt";
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

      // Filter for assigned orders only
      if (assignedOnly) {
        where.assignedAt = {
          ...where.assignedAt,
          not: null,
        };
      }

      // Build orderBy object
      const orderBy = {};

      // Map frontend sort fields to database fields
      const sortFieldMap = {
        id: "id",
        orderAt: "orderAt",
        assignedAt: "assignedAt",
        customerName: "customerName",
        province: "province",
        subtotalPrice: "subtotalPrice",
        totalPrice: "totalPrice",
        state: "state",
      };

      const dbSortField = sortFieldMap[sortBy] || "orderAt";
      orderBy[dbSortField] = sortOrder.toLowerCase() === "asc" ? "asc" : "desc";

      // Get orders with pagination - optimized includes and parallel execution
      const queries = [
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
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
            orderItems: {
              take: 50, // Increased limit for better UX while still optimal
              select: {
                id: true,
                productId: true,
                quantity: true,
                price: true,
                weight: true,
                optionDetails: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                    weight: true,
                  },
                },
              },
            },
          },
        })
      ];
      
      // Only count for smaller queries or when pagination info is needed
      const shouldCount = limit <= 200 || page === 1;
      if (shouldCount) {
        queries.push(prisma.order.count({ where }));
      }
      
      const results = await Promise.all(queries);
      const orders = results[0];
      const totalCount = results[1] || null;

      const totalPages = totalCount ? Math.ceil(totalCount / limit) : null;

      res.json({
        orders,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNext: totalCount ? page < totalPages : orders.length === limit,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get orders error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/orders/:id - Get single order
router.get("/:id", requireViewOrders, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        driver: true,
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ order });
  } catch (error) {
    console.error("Get order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/orders - Create new order
router.post("/", requireCreateOrders, orderValidation, async (req, res) => {
  try {
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
      state = "PLACED",
      subtotalPrice: subtotalPriceStr,
      companyDeliveryPrice: companyDeliveryPriceStr,
      deliveryPrice: deliveryPriceStr,
      totalPrice: totalPriceStr,
      isPaid: isPaidRaw,
      driverId,
      products,
    } = req.body;

    // Convert string values to correct types
    const subtotalPrice = parseFloat(subtotalPriceStr);
    const companyDeliveryPrice = parseFloat(companyDeliveryPriceStr);
    const deliveryPrice = parseFloat(deliveryPriceStr);
    const totalPrice = parseFloat(totalPriceStr);
    const isPaid = isPaidRaw === true || isPaidRaw === "true";

    // Validate converted values
    if (isNaN(subtotalPrice) || subtotalPrice < 0) {
      return res.status(400).json({ message: "Invalid subtotal price value" });
    }
    if (isNaN(companyDeliveryPrice) || companyDeliveryPrice < 0) {
      return res
        .status(400)
        .json({ message: "Invalid company delivery price value" });
    }
    if (isNaN(deliveryPrice) || deliveryPrice < 0) {
      return res.status(400).json({ message: "Invalid delivery price value" });
    }
    if (isNaN(totalPrice) || totalPrice < 0) {
      return res.status(400).json({ message: "Invalid total price value" });
    }

    // Convert product prices and quantities
    const convertedProducts = products.map((product) => ({
      ...product,
      quantity: parseInt(product.quantity),
      price: parseFloat(product.price),
      weight: parseFloat(product.weight) || 0,
      optionDetails: product.optionDetails || null,
    }));

    // Validate converted product values
    for (const product of convertedProducts) {
      if (isNaN(product.quantity) || product.quantity < 1) {
        return res.status(400).json({
          message: `Invalid quantity for product ${product.productId}`,
        });
      }
      if (isNaN(product.price) || product.price < 0) {
        return res
          .status(400)
          .json({ message: `Invalid price for product ${product.productId}` });
      }
    }

    // Batch validate driver and products to reduce database queries
    const productIds = [...new Set(convertedProducts.map(p => p.productId))];
    const queries = [];
    
    // Add driver validation query if needed
    if (driverId) {
      queries.push(prisma.driver.findUnique({ 
        where: { id: driverId },
        select: { id: true, name: true, isActive: true }
      }));
    } else {
      queries.push(Promise.resolve(null));
    }
    
    // Optimized product fetch with selective includes
    queries.push(prisma.product.findMany({
      where: { 
        id: { in: productIds },
        isActive: true
      },
      select: {
        id: true,
        name: true,
        price: true,
        quantity: true,
        hasOptions: true,
        isActive: true,
        optionGroups: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            options: {
              where: { isAvailable: true },
              select: {
                id: true,
                name: true,
                priceType: true,
                priceValue: true,
              },
            },
          },
        },
      },
    }));
    
    const [driver, productsData] = await Promise.all(queries);

    // Validate driver
    if (driverId && !driver) {
      return res.status(400).json({ message: "Invalid driver ID" });
    }

    // Create product lookup map for O(1) access
    const productMap = new Map(productsData.map(p => [p.id, p]));

    // Validate all products exist
    for (const product of convertedProducts) {
      const productExists = productMap.get(product.productId);
      if (!productExists) {
        return res
          .status(400)
          .json({ message: `Product with ID ${product.productId} not found` });
      }

      // Store product for stock validation later
      product._productData = productExists;
    }

    // Optimized batch fetch of variants with selective loading
    const productsWithOptions = convertedProducts.filter(p => 
      p._productData.hasOptions && p.optionDetails && p.optionDetails.length > 0
    );
    
    const variantsByProduct = new Map();
    if (productsWithOptions.length > 0) {
      const variantProductIds = [...new Set(productsWithOptions.map(p => p.productId))];
      
      // Fetch variants with optimized select and joins
      const allVariants = await prisma.productVariant.findMany({
        where: { 
          productId: { in: variantProductIds },
          isActive: true
        },
        select: {
          id: true,
          productId: true,
          stock: true,
          priceAdjustment: true,
          variantOptions: {
            select: {
              optionId: true,
            },
          },
        },
      });
      
      // Group variants by product ID efficiently
      for (const variant of allVariants) {
        if (!variantsByProduct.has(variant.productId)) {
          variantsByProduct.set(variant.productId, []);
        }
        variantsByProduct.get(variant.productId).push(variant);
      }
    }

    // Now validate stock for all products
    for (const product of convertedProducts) {
      const productExists = product._productData;
      
      // Check stock based on whether product has options
      if (
        productExists.hasOptions &&
        product.optionDetails &&
        product.optionDetails.length > 0
      ) {
        // For products with options, validate against the matched variant stock
        // 1) Collect selected option IDs
        const selectedOptionIds = (product.optionDetails || [])
          .flatMap((group) =>
            (group.selectedOptions || []).map((opt) => opt.id)
          )
          .filter(Boolean);

        // 2) Get variants from cache
        const variants = variantsByProduct.get(product.productId) || [];

        if (!variants || variants.length === 0) {
          // If no variants exist, skip strict validation (legacy); stock is enforced on assignment
          // Alternatively, you can return an error. We choose to allow creation to keep UX consistent.
        } else {
          const desired = new Set(selectedOptionIds);
          let matchedVariant = null;

          // Prefer exact match
          for (const v of variants) {
            const voSet = new Set(v.variantOptions.map((vo) => vo.optionId));
            if (voSet.size === desired.size) {
              let exact = true;
              for (const id of desired) {
                if (!voSet.has(id)) {
                  exact = false;
                  break;
                }
              }
              if (exact) {
                matchedVariant = v;
                break;
              }
            }
          }

          // Fallback: largest subset match (variant options ⊆ selected options)
          if (!matchedVariant) {
            let bestSize = -1;
            for (const v of variants) {
              const voSet = new Set(v.variantOptions.map((vo) => vo.optionId));
              let subset = true;
              for (const id of voSet) {
                if (!desired.has(id)) {
                  subset = false;
                  break;
                }
              }
              if (subset && voSet.size > bestSize) {
                matchedVariant = v;
                bestSize = voSet.size;
              }
            }
          }

          if (
            matchedVariant &&
            (matchedVariant.stock || 0) < product.quantity
          ) {
            return res.status(400).json({
              message: `Insufficient stock for ${
                productExists.name
              }. Available: ${matchedVariant.stock || 0}, Requested: ${
                product.quantity
              }`,
            });
          }
        }
      } else {
        // For products without options, check main product stock
        if (productExists.quantity < product.quantity) {
          return res.status(400).json({
            message: `Insufficient stock for product ${productExists.name}. Available: ${productExists.quantity}, Requested: ${product.quantity}`,
          });
        }
      }
      
      // Clean up temporary data
      delete product._productData;
    }

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
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
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
                remark,
                state,
                subtotalPrice,
                companyDeliveryPrice,
                deliveryPrice,
                totalPrice,
                isPaid,
                driverId,
                createdBy: req.user.id,
                assignedAt: driverId ? new Date() : null,
              },
            });

            // Helper to resolve variant by selected option IDs using pre-fetched data
            const resolveVariantId = (productId, optionIds) => {
              if (!optionIds || optionIds.length === 0) return null;
              const variants = variantsByProduct.get(productId) || [];
              if (!variants || variants.length === 0) return null;
              const desired = new Set(optionIds);

              // 1) Prefer exact match (variant option set equals selected options)
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

              // 2) Fallback: accept variant if all its options are contained in selected options (subset)
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
              return best; // may be null if no match
            };

            // Pre-compute all order items data to avoid queries inside transaction
            const orderItemsData = [];
            
            // Process all products in batch for better performance
            for (const product of convertedProducts) {
              // Flatten selected option IDs from optionDetails
              const selectedOptionIds = (product.optionDetails || [])
                .flatMap((group) =>
                  (group.selectedOptions || []).map((opt) => opt.id)
                )
                .filter(Boolean);

              const variantId = resolveVariantId(
                product.productId,
                selectedOptionIds
              );

              // Use pre-fetched product data to compute price efficiently
              const productData = productMap.get(product.productId);
              const variants = variantsByProduct.get(product.productId) || [];
              const variant = variantId ? variants.find(v => v.id === variantId) : null;
              
              const computedPrice =
                (productData?.price || 0) + (variant?.priceAdjustment || 0);

              orderItemsData.push({
                orderId: newOrder.id,
                productId: product.productId,
                quantity: product.quantity,
                price: computedPrice,
                weight: product.weight || 0,
                optionDetails:
                  product.optionDetails && product.optionDetails.length > 0
                    ? {
                        variantId: variantId,
                        selections: product.optionDetails,
                      }
                    : null,
              });
            }

            // Bulk create all order items in a single query
            await tx.orderItem.createMany({
              data: orderItemsData,
            });

            // Note: Stock is NOT deducted here - it will be deducted when driver is assigned

            // Fetch the complete order with relations in the same transaction
            const completeOrder = await tx.order.findUnique({
              where: { id: newOrder.id },
              include: {
                driver: true,
                creator: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                  },
                },
                orderItems: {
                  include: {
                    product: true,
                  },
                },
              },
            });
            
            return completeOrder;
          });
        } catch (error) {
          if (error.code === "P2002" && attempt < maxRetries) {
            // Unique constraint violation, retry with new ID
            console.log(`Order ID collision, retrying... (attempt ${attempt})`);
            continue;
          }
          throw error;
        }
      }
      throw new Error("Failed to create order after maximum retries");
    };

    const completeOrder = await createOrderWithRetry();

    res.status(201).json({
      message: "Order created successfully",
      order: completeOrder,
    });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /api/orders/:id/state - Update order state
router.put(
  "/:id/state",
  requireEditOrders,
  [
    body("state")
      .isIn(["PLACED", "DELIVERING", "RETURNED", "COMPLETED"])
      .withMessage("Invalid state"),
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

      const { id } = req.params;
      const { state } = req.body;

      // Check if order exists
      const existingOrder = await prisma.order.findUnique({
        where: { id },
      });

      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      const updateData = { state };

      // Set completion time if state is COMPLETED
      if (state === "COMPLETED") {
        updateData.completedAt = new Date();
      }

      const order = await prisma.order.update({
        where: { id },
        data: updateData,
        include: {
          driver: true,
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      // Apply stock changes strictly based on state transition
      if (state === "DELIVERING" && existingOrder.state !== "DELIVERING") {
        await stockManagementService.deductStockForOrder(id);
      } else if (state === "RETURNED" && existingOrder.state !== "RETURNED") {
        await stockManagementService.restoreStockForOrder(id);
      }

      res.json({
        message: "Order state updated successfully",
        order,
      });
    } catch (error) {
      console.error("Update order state error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/orders/:id/driver - Assign driver to order
router.put(
  "/:id/driver",
  requireEditOrders,
  [
    body("driverId")
      .optional({ nullable: true })
      .custom((value) => {
        if (value === null || typeof value === "string") {
          return true;
        }
        throw new Error("Driver ID must be a string or null");
      }),
    body("assignedAt")
      .optional()
      .isISO8601()
      .withMessage("Assigned date must be a valid ISO 8601 date"),
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

      const { id } = req.params;
      const { driverId, assignedAt } = req.body;

      // Check if order exists
      const existingOrder = await prisma.order.findUnique({
        where: { id },
      });

      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Validate driver if provided (not null)
      if (driverId !== null && driverId !== undefined) {
        const driver = await prisma.driver.findUnique({
          where: { id: driverId },
        });
        if (!driver) {
          return res.status(400).json({ message: "Invalid driver ID" });
        }
      }

      // Handle stock management based on state changes
      const willBeAssigned = driverId !== null && driverId !== undefined;
      const currentState = existingOrder.state;

      // Determine the assigned date
      let assignedAtDate = null;
      if (willBeAssigned) {
        if (assignedAt) {
          // Use custom date if provided
          assignedAtDate = new Date(assignedAt);
        } else {
          // Use current date if no custom date provided
          assignedAtDate = new Date();
        }
      }

      // Auto-set state based on driver assignment (driver assignment endpoint)
      const newState = willBeAssigned ? "DELIVERING" : "PLACED";

      // Validate stock only if state is changing TO "DELIVERING"
      const needsStockValidation =
        newState === "DELIVERING" && currentState !== "DELIVERING";

      // Validate stock if state will change to DELIVERING
      if (needsStockValidation) {
        const stockValidation =
          await stockManagementService.validateStockForOrder(id);
        if (!stockValidation.isValid) {
          const insufficientItems = stockValidation.results.filter(
            (r) => !r.isValid
          );
          const errorMessage = insufficientItems
            .map(
              (item) =>
                `${item.productName}: requested ${item.requestedQuantity}, available ${item.availableStock}`
            )
            .join("; ");
          return res.status(400).json({
            message: `Insufficient stock: ${errorMessage}`,
            stockValidation,
          });
        }
      }

      const order = await prisma.order.update({
        where: { id },
        data: {
          driverId: willBeAssigned ? driverId : null,
          assignedAt: willBeAssigned ? assignedAtDate : null,
          state: newState,
        },
        include: {
          driver: true,
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      // Handle stock based on state changes only
      console.log(
        `[DRIVER ASSIGNMENT DEBUG] Order ${id}: ${currentState} → ${newState}`
      );

      if (newState === "DELIVERING" && currentState !== "DELIVERING") {
        // State changed TO "DELIVERING" - deduct stock
        console.log(
          `[DRIVER ASSIGNMENT DEBUG] Deducting stock for state change: ${currentState} → ${newState}`
        );
        await stockManagementService.deductStockForOrder(id);
      } else if (newState === "RETURNED" && currentState !== "RETURNED") {
        // State changed TO "RETURNED" - restore stock
        console.log(
          `[DRIVER ASSIGNMENT DEBUG] Restoring stock for state change: ${currentState} → ${newState}`
        );
        await stockManagementService.restoreStockForOrder(id);
      } else {
        console.log(
          `[DRIVER ASSIGNMENT DEBUG] No stock change needed for: ${currentState} → ${newState}`
        );
      }
      // Do nothing for other state changes or no state change

      res.json({
        message: "Driver assignment updated successfully",
        order,
      });
    } catch (error) {
      console.error("Update driver assignment error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/orders/:id - Update order
router.put("/:id", requireEditOrders, orderValidation, async (req, res) => {
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
      state = "PLACED",
      subtotalPrice: subtotalPriceStr,
      companyDeliveryPrice: companyDeliveryPriceStr,
      deliveryPrice: deliveryPriceStr,
      totalPrice: totalPriceStr,
      isPaid: isPaidRaw,
      driverId,
      products,
    } = req.body;

    // Convert string values to correct types
    const subtotalPrice = parseFloat(subtotalPriceStr);
    const companyDeliveryPrice = parseFloat(companyDeliveryPriceStr);
    const deliveryPrice = parseFloat(deliveryPriceStr);
    const totalPrice = parseFloat(totalPriceStr);
    const isPaid = isPaidRaw === true || isPaidRaw === "true";

    // Validate converted values
    if (isNaN(subtotalPrice) || subtotalPrice < 0) {
      return res.status(400).json({ message: "Invalid subtotal price value" });
    }
    if (isNaN(companyDeliveryPrice) || companyDeliveryPrice < 0) {
      return res
        .status(400)
        .json({ message: "Invalid company delivery price value" });
    }
    if (isNaN(deliveryPrice) || deliveryPrice < 0) {
      return res.status(400).json({ message: "Invalid delivery price value" });
    }
    if (isNaN(totalPrice) || totalPrice < 0) {
      return res.status(400).json({ message: "Invalid total price value" });
    }

    // Convert product prices and quantities
    const convertedProducts = products.map((product) => ({
      ...product,
      quantity: parseInt(product.quantity),
      price: parseFloat(product.price),
      weight: parseFloat(product.weight) || 0,
      optionDetails: product.optionDetails || null,
    }));

    // Validate converted product values
    for (const product of convertedProducts) {
      if (isNaN(product.quantity) || product.quantity < 1) {
        return res.status(400).json({
          message: `Invalid quantity for product ${product.productId}`,
        });
      }
      if (isNaN(product.price) || product.price < 0) {
        return res
          .status(400)
          .json({ message: `Invalid price for product ${product.productId}` });
      }
    }

    // Check if order exists
    const existingOrder = await prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: true,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Validate driver if provided
    if (driverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      });
      if (!driver) {
        return res.status(400).json({ message: "Driver not found" });
      }
    }

    // Validate products
    for (const product of convertedProducts) {
      const productExists = await prisma.product.findUnique({
        where: { id: product.productId },
      });
      if (!productExists) {
        return res
          .status(400)
          .json({ message: `Product with ID ${product.productId} not found` });
      }
    }

    // Update order in transaction
    const result = await prisma.$transaction(async (prisma) => {
      // Delete existing order items
      await prisma.orderItem.deleteMany({
        where: { orderId: id },
      });

      // Update order
      const updatedOrder = await prisma.order.update({
        where: { id },
        data: {
          customerName,
          customerPhone,
          customerLocation,
          province,
          remark,
          state,
          subtotalPrice,
          companyDeliveryPrice,
          deliveryPrice,
          totalPrice,
          isPaid,
          driverId: driverId || null,
          updatedAt: new Date(),
          ...(state === "DELIVERING" &&
            !existingOrder.assignedAt && { assignedAt: new Date() }),
          ...(state === "COMPLETED" &&
            !existingOrder.completedAt && { completedAt: new Date() }),
        },
      });

      // Helper to resolve variant by selected option IDs
      const resolveVariantId = async (productId, optionIds) => {
        if (!optionIds || optionIds.length === 0) return null;
        const variants = await prisma.productVariant.findMany({
          where: { productId },
          include: { variantOptions: true },
        });
        const desired = new Set(optionIds);
        for (const v of variants) {
          if (v.variantOptions.length !== desired.size) continue;
          const voSet = new Set(v.variantOptions.map((vo) => vo.optionId));
          let match = true;
          for (const id of desired) {
            if (!voSet.has(id)) {
              match = false;
              break;
            }
          }
          if (match) return v.id;
        }
        return null;
      };

      // Create new order items
      for (const product of convertedProducts) {
        const selectedOptionIds = (product.optionDetails || [])
          .flatMap((group) =>
            (group.selectedOptions || []).map((opt) => opt.id)
          )
          .filter(Boolean);

        const variantId = await resolveVariantId(
          product.productId,
          selectedOptionIds
        );

        await prisma.orderItem.create({
          data: {
            orderId: updatedOrder.id,
            productId: product.productId,
            quantity: product.quantity,
            price: product.price,
            weight: product.weight,
            optionDetails:
              product.optionDetails && product.optionDetails.length > 0
                ? { variantId: variantId, selections: product.optionDetails }
                : null,
          },
        });
      }

      return updatedOrder;
    });

    // Handle stock management based on state changes
    const currentState = existingOrder.state;
    const newState = state;

    console.log(`[STOCK DEBUG] Order ${id}: ${currentState} → ${newState}`);

    if (newState === "DELIVERING" && currentState !== "DELIVERING") {
      // State changed TO "DELIVERING" - deduct stock
      console.log(
        `[STOCK DEBUG] Deducting stock for state change: ${currentState} → ${newState}`
      );
      await stockManagementService.deductStockForOrder(id);
    } else if (newState === "RETURNED" && currentState !== "RETURNED") {
      // State changed TO "RETURNED" - restore stock
      console.log(
        `[STOCK DEBUG] Restoring stock for state change: ${currentState} → ${newState}`
      );
      await stockManagementService.restoreStockForOrder(id);
    } else {
      console.log(
        `[STOCK DEBUG] No stock change needed for: ${currentState} → ${newState}`
      );
    }
    // Do nothing for other state changes (like COMPLETED, PLACED, etc.)

    // Fetch updated order with relations
    const order = await prisma.order.findUnique({
      where: { id: result.id },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                category: true,
              },
            },
          },
        },
        driver: true,
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    res.json({
      message: "Order updated successfully",
      order,
    });
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/orders/:id - Delete order
router.delete("/:id", requireDeleteOrders, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if order exists
    const existingOrder = await prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: true,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Restore stock if order was in DELIVERING state
    if (existingOrder.state === "DELIVERING") {
      await stockManagementService.restoreStockForOrder(id);
    }

    // Delete order in transaction
    await prisma.$transaction(async (prisma) => {
      // Delete order items first (due to foreign key constraints)
      await prisma.orderItem.deleteMany({
        where: { orderId: id },
      });

      // Delete the order
      await prisma.order.delete({
        where: { id },
      });
    });

    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Delete order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /api/orders/:id/mark-printed - Mark order as printed
router.put(
  "/:id/mark-printed",
  requireEditOrders,
  [
    body("isPrinted")
      .isBoolean()
      .withMessage("isPrinted must be a boolean"),
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

      const { id } = req.params;
      const { isPrinted } = req.body;

      // Check if order exists
      const existingOrder = await prisma.order.findUnique({
        where: { id },
      });

      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      const order = await prisma.order.update({
        where: { id },
        data: { isPrinted },
        include: {
          driver: true,
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      res.json({
        message: `Order ${isPrinted ? "marked as printed" : "print status reset"} successfully`,
        order,
      });
    } catch (error) {
      console.error("Mark order as printed error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/orders/:id/reset-print - Reset print status of order
router.put(
  "/:id/reset-print",
  requireEditOrders,
  [
    body("isPrinted")
      .isBoolean()
      .withMessage("isPrinted must be a boolean"),
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

      const { id } = req.params;
      const { isPrinted } = req.body;

      // Check if order exists
      const existingOrder = await prisma.order.findUnique({
        where: { id },
      });

      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      const order = await prisma.order.update({
        where: { id },
        data: { isPrinted },
        include: {
          driver: true,
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      res.json({
        message: `Print status ${isPrinted ? "set" : "reset"} successfully`,
        order,
      });
    } catch (error) {
      console.error("Reset print status error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/orders/duplicates/phone - Find duplicate phone numbers
router.get("/duplicates/phone", requireViewOrders, async (req, res) => {
  try {
    // Find all orders grouped by phone number
    const phoneGroups = await prisma.order.groupBy({
      by: ["customerPhone"],
      _count: {
        customerPhone: true,
      },
      having: {
        customerPhone: {
          _count: {
            gt: 1,
          },
        },
      },
    });

    // Get detailed information for each duplicate phone number
    const duplicates = await Promise.all(
      phoneGroups.map(async (group) => {
        const orders = await prisma.order.findMany({
          where: {
            customerPhone: group.customerPhone,
          },
          select: {
            id: true,
            customerName: true,
            customerPhone: true,
            customerLocation: true,
            province: true,
            state: true,
            totalPrice: true,
            orderAt: true,
            orderSource: true,
          },
          orderBy: {
            orderAt: "desc",
          },
        });

        return {
          phone: group.customerPhone,
          count: group._count.customerPhone,
          orders: orders,
        };
      })
    );

    res.json({
      data: {
        duplicates: duplicates.sort((a, b) => b.count - a.count),
        totalDuplicatePhones: duplicates.length,
        totalDuplicateOrders: duplicates.reduce(
          (sum, dup) => sum + dup.count,
          0
        ),
      },
    });
  } catch (error) {
    console.error("Get duplicate phones error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
