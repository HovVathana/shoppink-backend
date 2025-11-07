const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

// Performance optimization imports (simplified to avoid header conflicts)
const {
  setupCompression,
  performanceLogger,
  requestTimeout,
} = require("./middleware/simple-performance");
const { cacheMiddleware, getCacheStats } = require("./middleware/cache");

const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const productOptionRoutes = require("./routes/productOptions");
const orderRoutes = require("./routes/orders-enhanced");
const dashboardRoutes = require("./routes/dashboard");
const categoryRoutes = require("./routes/categories");
const driverRoutes = require("./routes/drivers");
const publicRoutes = require("./routes/public");
const staffRoutes = require("./routes/staff");
const customerOrderRoutes = require("./routes/customer-orders");
const blacklistPhoneRoutes = require("./routes/blacklist-phones");

const app = express();
const PORT = process.env.PORT || 5000;

// Performance middleware (safe versions to avoid header conflicts)
app.use(setupCompression());
app.use(performanceLogger()); // Logging-only performance monitoring
app.use(requestTimeout(25000)); // 25 seconds for Vercel compatibility

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Increased limit for development
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", limiter);

// More lenient rate limiting for orders endpoint during development
const ordersLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute for orders
  message: "Too many order requests, please wait a moment.",
});
app.use("/api/orders", ordersLimiter);

// Note: Selective caching applied directly in route handlers to avoid middleware conflicts

// Enhanced CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://172.20.10.2:3000",
      "http://localhost:8000",
      "http://192.168.100.138:3000",
      ...(process.env.NODE_ENV === "production"
        ? [
            "https://shoppink-store.vercel.app",
            process.env.FRONTEND_URL, // Add your actual frontend URL
          ].filter(Boolean)
        : []),
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 86400, // Cache preflight requests for 24 hours
  })
);

// Handle preflight requests
app.options("*", cors());

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/product-options", productOptionRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/blacklist-phones", blacklistPhoneRoutes);

app.use("/api/staff", staffRoutes);
app.use("/api/customer-orders", customerOrderRoutes);

// Cache statistics endpoint for monitoring
app.get("/api/health/cache", (req, res) => {
  try {
    const stats = getCacheStats();
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      cache: stats,
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      message: "Failed to get cache stats",
      error: error.message,
    });
  }
});

// Fast health check endpoint (no database connection)
app.get("/api/health", (req, res) => {
  const startTime = Date.now();
  const responseTime = Date.now() - startTime;

  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    serverless: !!process.env.VERCEL,
    responseTime: `${responseTime}ms`,
    message: "Service is running",
  });
});

// Database health check endpoint (separate for when needed)
app.get("/api/health/database", async (req, res) => {
  const startTime = Date.now();

  try {
    // Test database connection
    const getPrismaClient = require("./lib/prisma");
    const prisma = getPrismaClient();

    // Simple database query to test connection with timeout
    const queryPromise = prisma.$queryRaw`SELECT 1`;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Database query timeout")), 5000)
    );

    await Promise.race([queryPromise, timeoutPromise]);

    const responseTime = Date.now() - startTime;

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      database: "connected",
      responseTime: `${responseTime}ms`,
      serverless: !!process.env.VERCEL,
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;

    res.status(503).json({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      database: "disconnected",
      error: error.message,
      responseTime: `${responseTime}ms`,
      serverless: !!process.env.VERCEL,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Something went wrong!",
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Only start server if not in serverless environment
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  });
}

// Export the app for serverless deployment
module.exports = app;
