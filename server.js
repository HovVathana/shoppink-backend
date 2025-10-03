const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

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

// Enhanced CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://172.20.10.2:3000",
      "http://localhost:8000",
      "http://192.168.100.138:3000",
      ...(process.env.NODE_ENV === "production"
        ? ["https://your-frontend-domain.com"]
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

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
});
