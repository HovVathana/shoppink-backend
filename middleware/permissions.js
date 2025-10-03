const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Check if user is authenticated
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res
        .status(401)
        .json({ message: "Access denied. No token provided." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if it's a user
    if (decoded.userId) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });
      if (!user || !user.isActive) {
        return res
          .status(401)
          .json({ message: "Invalid token or account deactivated." });
      }
      req.user = user;
      return next();
    }

    return res.status(401).json({ message: "Invalid token." });
  } catch (error) {
    res.status(401).json({ message: "Invalid token." });
  }
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ message: "Access denied. Admin privileges required." });
  }
  next();
};

// Check if user has specific permission
const requirePermission = (permission) => {
  return (req, res, next) => {
    // Admin has all permissions
    if (req.user.role === "ADMIN") {
      return next();
    }

    // Check if user has the required permission
    if (req.user.permissions.includes(permission)) {
      return next();
    }

    return res.status(403).json({
      message: `Access denied. Required permission: ${permission}`,
    });
  };
};

// Check if user has any of the specified permissions
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    // Admin has all permissions
    if (req.user.role === "ADMIN") {
      return next();
    }

    // Check if user has any of the required permissions
    const hasPermission = permissions.some((permission) =>
      req.user.permissions.includes(permission)
    );

    if (hasPermission) {
      return next();
    }

    return res.status(403).json({
      message: `Access denied. Required permissions: ${permissions.join(
        " or "
      )}`,
    });
  };
};

// Dashboard permissions
const requireViewDashboard = requirePermission("view_dashboard");
const requireDashboardAccess = requireViewDashboard; // Alias for backward compatibility

// Product permissions
const requireViewProducts = requirePermission("view_products");
const requireCreateProducts = requirePermission("create_products");
const requireEditProducts = requirePermission("edit_products");
const requireDeleteProducts = requirePermission("delete_products");
const requireProductAccess = requireAnyPermission([
  "view_products",
  "create_products",
  "edit_products",
  "delete_products",
]);

// Order permissions
const requireViewOrders = requirePermission("view_orders");
const requireCreateOrders = requirePermission("create_orders");
const requireEditOrders = requirePermission("edit_orders");
const requireDeleteOrders = requirePermission("delete_orders");
const requireOrderAccess = requireAnyPermission([
  "view_orders",
  "create_orders",
  "edit_orders",
  "delete_orders",
]);

// Category permissions
const requireViewCategories = requirePermission("view_categories");
const requireCreateCategories = requirePermission("create_categories");
const requireEditCategories = requirePermission("edit_categories");
const requireDeleteCategories = requirePermission("delete_categories");
const requireCategoryAccess = requireAnyPermission([
  "view_categories",
  "create_categories",
  "edit_categories",
  "delete_categories",
]);

// Driver permissions
const requireViewDrivers = requirePermission("view_drivers");
const requireCreateDrivers = requirePermission("create_drivers");
const requireEditDrivers = requirePermission("edit_drivers");
const requireDeleteDrivers = requirePermission("delete_drivers");
const requireDriverAccess = requireAnyPermission([
  "view_drivers",
  "create_drivers",
  "edit_drivers",
  "delete_drivers",
]);

// Staff permissions
const requireViewStaff = requirePermission("view_staff");
const requireCreateStaff = requirePermission("create_staff");
const requireEditStaff = requirePermission("edit_staff");
const requireDeleteStaff = requirePermission("delete_staff");
const requireStaffAccess = requireAnyPermission([
  "view_staff",
  "create_staff",
  "edit_staff",
  "delete_staff",
]);

// Special permissions for order creation/editing - allows access to products and drivers
const requireProductsForOrders = requireAnyPermission([
  "view_products",
  "create_orders",
  "edit_orders",
]);
const requireDriversForOrders = requireAnyPermission([
  "view_drivers",
  "create_orders",
  "edit_orders",
]);

module.exports = {
  authenticateUser,
  requireAdmin,
  requirePermission,
  requireAnyPermission,
  // Dashboard
  requireViewDashboard,
  requireDashboardAccess,
  // Products
  requireViewProducts,
  requireCreateProducts,
  requireEditProducts,
  requireDeleteProducts,
  requireProductAccess,
  // Orders
  requireViewOrders,
  requireCreateOrders,
  requireEditOrders,
  requireDeleteOrders,
  requireOrderAccess,
  // Categories
  requireViewCategories,
  requireCreateCategories,
  requireEditCategories,
  requireDeleteCategories,
  requireCategoryAccess,
  // Drivers
  requireViewDrivers,
  requireCreateDrivers,
  requireEditDrivers,
  requireDeleteDrivers,
  requireDriverAccess,
  // Staff
  requireViewStaff,
  requireCreateStaff,
  requireEditStaff,
  requireDeleteStaff,
  requireStaffAccess,
  // Special permissions for orders
  requireProductsForOrders,
  requireDriversForOrders,
};
