const express = require("express");
const { body, validationResult, query } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const { authenticateUser } = require("../middleware/permissions");

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
  body("driverId").optional().isString(),
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
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("state")
      .optional()
      .isIn(["PLACED", "DELIVERING", "RETURNED", "COMPLETED"]),
    query("search").optional().trim(),
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

      // Build where clause - only show admin orders
      const where = {
        orderSource: "ADMIN", // Only admin created orders
      };

      if (state) {
        where.state = state;
      }

      if (search) {
        where.AND = [
          {
            OR: [
              { orderNumber: { contains: search, mode: "insensitive" } },
              { customerName: { contains: search, mode: "insensitive" } },
              { customerPhone: { contains: search, mode: "insensitive" } },
              { customerLocation: { contains: search, mode: "insensitive" } },
              { province: { contains: search, mode: "insensitive" } },
            ],
          },
        ];
      }

      // Get orders with pagination
      const [orders, totalCount] = await Promise.all([
        prisma.order.findMany({
          where,
          skip,
          take: limit,
          orderBy: { orderAt: "desc" },
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
              include: {
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
      console.error("Get orders error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/orders/:id - Get single order
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: {
        id,
        orderSource: "ADMIN", // Only admin orders
      },
      include: {
        customer: true,
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

// PUT /api/orders/:id/status - Update order status
router.put(
  "/:id/status",
  [
    body("status")
      .isIn([
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
      ])
      .withMessage("Invalid status"),
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
      const { status } = req.body;

      // Check if order exists and is admin order
      const existingOrder = await prisma.order.findFirst({
        where: {
          id,
          orderSource: "ADMIN", // Only admin orders
        },
      });

      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      const order = await prisma.order.update({
        where: { id },
        data: { status },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
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
        },
      });

      res.json({
        message: "Order status updated successfully",
        order,
      });
    } catch (error) {
      console.error("Update order status error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/orders/stats/summary - Get order statistics
router.get("/stats/summary", async (req, res) => {
  try {
    const [
      totalOrders,
      pendingOrders,
      confirmedOrders,
      processingOrders,
      shippedOrders,
      deliveredOrders,
      cancelledOrders,
      totalRevenue,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.count({ where: { status: "CONFIRMED" } }),
      prisma.order.count({ where: { status: "PROCESSING" } }),
      prisma.order.count({ where: { status: "SHIPPED" } }),
      prisma.order.count({ where: { status: "DELIVERED" } }),
      prisma.order.count({ where: { status: "CANCELLED" } }),
      prisma.order.aggregate({
        where: { status: { not: "CANCELLED" } },
        _sum: { totalAmount: true },
      }),
    ]);

    res.json({
      totalOrders,
      ordersByStatus: {
        pending: pendingOrders,
        confirmed: confirmedOrders,
        processing: processingOrders,
        shipped: shippedOrders,
        delivered: deliveredOrders,
        cancelled: cancelledOrders,
      },
      totalRevenue: totalRevenue._sum.totalAmount || 0,
    });
  } catch (error) {
    console.error("Get order stats error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/orders/:id - Delete order
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check if order exists and is admin order
    const existingOrder = await prisma.order.findFirst({
      where: {
        id,
        orderSource: "ADMIN", // Only admin orders
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Delete order items first (due to foreign key constraints)
    await prisma.orderItem.deleteMany({
      where: { orderId: id },
    });

    // Delete the order
    await prisma.order.delete({
      where: { id },
    });

    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Delete order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
