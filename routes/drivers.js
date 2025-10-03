const express = require("express");
const { body, validationResult, query } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const {
  authenticateUser,
  requireViewDrivers,
  requireCreateDrivers,
  requireEditDrivers,
  requireDeleteDrivers,
  requireDriversForOrders,
} = require("../middleware/permissions");
const { cacheMiddleware } = require("../middleware/cache");

const router = express.Router();
const prisma = getPrismaClient();

// All routes require authentication
router.use(authenticateUser);

// Validation rules
const driverValidation = [
  body("name")
    .trim()
    .isLength({ min: 1 })
    .withMessage("Driver name is required"),
  body("phone")
    .trim()
    .isLength({ min: 1 })
    .withMessage("Phone number is required"),
  body("isActive").optional().isBoolean(),
];

// GET /api/drivers - Get all drivers with pagination and filtering
router.get(
  "/",
  cacheMiddleware(300), // 5 minutes cache
  requireDriversForOrders,
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
          { phone: { contains: search, mode: "insensitive" } },
        ];
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      // Get drivers with pagination
      const [drivers, totalCount] = await Promise.all([
        prisma.driver.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            _count: {
              select: { orders: true },
            },
          },
        }),
        prisma.driver.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        drivers,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get drivers error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /api/drivers/all - Get all active drivers (for dropdowns)
router.get("/all", cacheMiddleware(600), requireDriversForOrders, async (req, res) => {
  try {
    const drivers = await prisma.driver.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
      },
    });

    res.json({ drivers });
  } catch (error) {
    console.error("Get all drivers error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/drivers/:id - Get single driver
router.get("/:id", requireDriversForOrders, async (req, res) => {
  try {
    const { id } = req.params;

    const driver = await prisma.driver.findUnique({
      where: { id },
      include: {
        orders: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            state: true,
            totalPrice: true,
            orderAt: true,
          },
          orderBy: { orderAt: "desc" },
          take: 10,
        },
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json({ driver });
  } catch (error) {
    console.error("Get driver error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/drivers - Create new driver
router.post("/", requireCreateDrivers, driverValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { name, phone, isActive = true } = req.body;

    const driver = await prisma.driver.create({
      data: {
        name,
        phone,
        isActive,
      },
    });

    res.status(201).json({
      message: "Driver created successfully",
      driver,
    });
  } catch (error) {
    console.error("Create driver error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /api/drivers/:id - Update driver
router.put("/:id", requireEditDrivers, driverValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { id } = req.params;
    const { name, phone, isActive } = req.body;

    // Check if driver exists
    const existingDriver = await prisma.driver.findUnique({
      where: { id },
    });

    if (!existingDriver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const driver = await prisma.driver.update({
      where: { id },
      data: {
        name,
        phone,
        isActive,
      },
    });

    res.json({
      message: "Driver updated successfully",
      driver,
    });
  } catch (error) {
    console.error("Update driver error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/drivers/:id - Delete driver
router.delete("/:id", requireDeleteDrivers, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if driver exists
    const existingDriver = await prisma.driver.findUnique({
      where: { id },
      include: {
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!existingDriver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    // Check if driver has orders
    if (existingDriver._count.orders > 0) {
      return res.status(400).json({
        message:
          "Cannot delete driver that has assigned orders. Please reassign the orders first.",
      });
    }

    await prisma.driver.delete({
      where: { id },
    });

    res.json({ message: "Driver deleted successfully" });
  } catch (error) {
    console.error("Delete driver error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
