const express = require("express");
const getPrismaClient = require("../lib/prisma");
const {
  authenticateUser,
  requireDashboardAccess,
} = require("../middleware/permissions");
const { cacheMiddleware } = require("../middleware/cache");

const router = express.Router();
const prisma = getPrismaClient();

// All routes require authentication
router.use(authenticateUser);

// GET /api/dashboard/stats - Get dashboard statistics
router.get("/stats", cacheMiddleware(120), requireDashboardAccess, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Get current month stats
    const [
      totalProducts,
      activeProducts,
      lowStockProducts,
      totalOrders,
      monthlyOrders,
      lastMonthOrders,
      monthlyRevenue,
      lastMonthRevenue,
      recentOrders,
      topProducts,
    ] = await Promise.all([
      // Product stats
      prisma.product.count(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({
        where: { quantity: { lte: 10 }, isActive: true },
      }),

      // Order stats
      prisma.order.count(),
      prisma.order.count({
        where: {
          createdAt: { gte: startOfMonth },
          state: { not: "CANCELLED" },
        },
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
          state: { not: "CANCELLED" },
        },
      }),

      // Revenue stats
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfMonth },
          status: { not: "CANCELLED" },
        },
        _sum: { totalAmount: true },
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
          status: { not: "CANCELLED" },
        },
        _sum: { totalAmount: true },
      }),

      // Recent orders
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: { name: true, email: true },
          },
        },
      }),

      // Top selling products (based on order items)
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        _count: { productId: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
    ]);

    // Get product details for top products - optimized to avoid N+1 query
    const topProductIds = topProducts.map(item => item.productId);
    const productDetails = topProductIds.length > 0 ? await prisma.product.findMany({
      where: { id: { in: topProductIds } },
      select: { id: true, name: true, price: true, imageUrl: true },
    }) : [];
    
    // Create lookup map for performance
    const productMap = new Map(productDetails.map(p => [p.id, p]));
    
    const topProductsWithDetails = topProducts.map((item) => {
      const product = productMap.get(item.productId);
      return {
        ...product,
        totalSold: item._sum.quantity,
        orderCount: item._count.productId,
      };
    });

    // Calculate growth percentages
    const orderGrowth =
      lastMonthOrders > 0
        ? (((monthlyOrders - lastMonthOrders) / lastMonthOrders) * 100).toFixed(
            1
          )
        : monthlyOrders > 0
        ? 100
        : 0;

    const revenueGrowth =
      (lastMonthRevenue._sum.totalAmount || 0) > 0
        ? (
            (((monthlyRevenue._sum.totalAmount || 0) -
              (lastMonthRevenue._sum.totalAmount || 0)) /
              (lastMonthRevenue._sum.totalAmount || 0)) *
            100
          ).toFixed(1)
        : (monthlyRevenue._sum.totalAmount || 0) > 0
        ? 100
        : 0;

    res.json({
      overview: {
        totalProducts,
        activeProducts,
        lowStockProducts,
        totalOrders,
        monthlyRevenue: monthlyRevenue._sum.totalAmount || 0,
        monthlyOrders,
        orderGrowth: parseFloat(orderGrowth),
        revenueGrowth: parseFloat(revenueGrowth),
      },
      recentOrders,
      topProducts: topProductsWithDetails,
      alerts: {
        lowStockCount: lowStockProducts,
        pendingOrdersCount: await prisma.order.count({
          where: { status: "PENDING" },
        }),
      },
    });
  } catch (error) {
    console.error("Get dashboard stats error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/dashboard/charts/revenue - Get revenue chart data
router.get("/charts/revenue", cacheMiddleware(300), requireDashboardAccess, async (req, res) => {
  try {
    const now = new Date();
    const last12Months = [];

    // Generate last 12 months data
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const revenue = await prisma.order.aggregate({
        where: {
          createdAt: { gte: date, lt: nextMonth },
          status: { not: "CANCELLED" },
        },
        _sum: { totalAmount: true },
      });

      last12Months.push({
        month: date.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        revenue: revenue._sum.totalAmount || 0,
      });
    }

    res.json({ revenueData: last12Months });
  } catch (error) {
    console.error("Get revenue chart error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/dashboard/charts/orders - Get orders chart data
router.get("/charts/orders", cacheMiddleware(180), requireDashboardAccess, async (req, res) => {
  try {
    const orderStatusCounts = await prisma.order.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    const chartData = orderStatusCounts.map((item) => ({
      status: item.status,
      count: item._count.status,
    }));

    res.json({ orderStatusData: chartData });
  } catch (error) {
    console.error("Get orders chart error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
