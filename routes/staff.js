const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const {
  authenticateUser,
  requireAdmin,
  requireViewStaff,
  requireCreateStaff,
  requireEditStaff,
  requireDeleteStaff,
} = require("../middleware/permissions");

const prisma = new PrismaClient();

// Role-based default permissions
const getRolePermissions = (role) => {
  const rolePermissions = {
    ADMIN: [
      "view_dashboard",
      "view_products",
      "create_products",
      "edit_products",
      "delete_products",
      "view_orders",
      "create_orders",
      "edit_orders",
      "delete_orders",
    ],
    MANAGER: [
      "view_dashboard",
      "view_products",
      "create_products",
      "edit_products",
      "view_orders",
      "create_orders",
      "edit_orders",
    ],
    STAFF: ["view_products", "view_orders"],
  };

  return rolePermissions[role] || [];
};

// Get all staff members - excludes current admin
router.get("/", authenticateUser, requireViewStaff, async (req, res) => {
  try {
    const { search, role, isActive } = req.query;

    let where = {
      id: { not: req.user.id }, // Exclude current user
    };

    // Search by name or email
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    // Filter by role
    if (role) {
      where.role = role;
    }

    // Filter by active status
    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Remove password from response
    const usersWithoutPassword = users.map(
      ({ password, ...userData }) => userData
    );

    res.json(usersWithoutPassword);
  } catch (error) {
    console.error("Error fetching staff:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get single staff member
router.get("/:id", authenticateUser, requireViewStaff, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    // Remove password from response
    const { password, ...userData } = user;
    res.json(userData);
  } catch (error) {
    console.error("Error fetching staff member:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create new staff member (Admin only)
router.post("/", authenticateUser, requireCreateStaff, async (req, res) => {
  try {
    const { name, email, password, role, permissions, isActive } = req.body;

    // Validate required fields
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "Name, email, password, and role are required",
      });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Get default permissions for role if not provided
    const userPermissions = permissions || getRolePermissions(role);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
        permissions: userPermissions,
        isActive: isActive !== undefined ? isActive : true,
        createdBy: req.user.id,
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Remove password from response
    const { password: _, ...userData } = user;

    res.status(201).json({
      message: "Staff member created successfully",
      staff: userData,
    });
  } catch (error) {
    console.error("Error creating staff member:", error);

    if (error.code === "P2002") {
      return res.status(400).json({ message: "Email already exists" });
    }

    res.status(500).json({ message: "Server error" });
  }
});

// Update staff member (Admin only)
router.put("/:id", authenticateUser, requireEditStaff, async (req, res) => {
  try {
    const { name, email, password, role, permissions, isActive } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!existingUser) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    // Prevent admin from editing themselves through this endpoint
    if (existingUser.id === req.user.id) {
      return res.status(400).json({
        message: "Cannot edit your own account through this endpoint",
      });
    }

    // Check if email is being changed and if it already exists
    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email },
      });
      if (emailExists) {
        return res.status(400).json({ message: "Email already exists" });
      }
    }

    // Prepare update data
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role) {
      updateData.role = role;
      // Update permissions based on new role if permissions not explicitly provided
      if (!permissions) {
        updateData.permissions = getRolePermissions(role);
      }
    }
    if (permissions) updateData.permissions = permissions;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Update password if provided
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Remove password from response
    const { password: _, ...userData } = user;

    res.json({
      message: "Staff member updated successfully",
      staff: userData,
    });
  } catch (error) {
    console.error("Error updating staff member:", error);

    if (error.code === "P2002") {
      return res.status(400).json({ message: "Email already exists" });
    }

    res.status(500).json({ message: "Server error" });
  }
});

// Delete staff member (Admin only)
router.delete(
  "/:id",
  authenticateUser,
  requireDeleteStaff,
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
      });

      if (!user) {
        return res.status(404).json({ message: "Staff member not found" });
      }

      // Prevent admin from deleting themselves
      if (user.id === req.user.id) {
        return res
          .status(400)
          .json({ message: "Cannot delete your own account" });
      }

      await prisma.user.delete({
        where: { id: req.params.id },
      });

      res.json({ message: "Staff member deleted successfully" });
    } catch (error) {
      console.error("Error deleting staff member:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Toggle staff status (Admin only)
router.patch(
  "/:id/toggle-status",
  authenticateUser,
  requireAdmin,
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
      });

      if (!user) {
        return res.status(404).json({ message: "Staff member not found" });
      }

      // Prevent admin from deactivating themselves
      if (user.id === req.user.id) {
        return res
          .status(400)
          .json({ message: "Cannot deactivate your own account" });
      }

      const updatedUser = await prisma.user.update({
        where: { id: req.params.id },
        data: { isActive: !user.isActive },
        include: {
          creator: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      // Remove password from response
      const { password, ...userData } = updatedUser;

      res.json({
        message: `Staff member ${
          updatedUser.isActive ? "activated" : "deactivated"
        } successfully`,
        staff: userData,
      });
    } catch (error) {
      console.error("Error toggling staff status:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get available permissions
router.get("/permissions/list", authenticateUser, requireAdmin, (req, res) => {
  const permissions = [
    {
      id: "view_dashboard",
      name: "View Dashboard",
      description: "Access to dashboard overview and analytics",
    },
    {
      id: "view_products",
      name: "View Products",
      description: "View product listings and details",
    },
    {
      id: "create_products",
      name: "Create Products",
      description: "Add new products to the system",
    },
    {
      id: "edit_products",
      name: "Edit Products",
      description: "Modify existing product information",
    },
    {
      id: "delete_products",
      name: "Delete Products",
      description: "Remove products from the system",
    },
    {
      id: "view_orders",
      name: "View Orders",
      description: "View order listings and details",
    },
    {
      id: "create_orders",
      name: "Create Orders",
      description: "Create new orders",
    },
    {
      id: "edit_orders",
      name: "Edit Orders",
      description: "Modify existing orders",
    },
    {
      id: "delete_orders",
      name: "Delete Orders",
      description: "Cancel or remove orders",
    },
  ];

  res.json(permissions);
});

// Get role-based default permissions
router.get(
  "/roles/:role/permissions",
  authenticateUser,
  requireAdmin,
  (req, res) => {
    const { role } = req.params;
    const permissions = getRolePermissions(role);
    res.json({ role, permissions });
  }
);

module.exports = router;
