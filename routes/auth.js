const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const prisma = getPrismaClient();

// Validation rules
const signupValidation = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Valid email is required"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("name")
    .trim()
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters"),
];

const loginValidation = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Valid email is required"),
  body("password").notEmpty().withMessage("Password is required"),
];

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "24h" });
};

// POST /api/auth/signup
// router.post("/signup", signupValidation, async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         message: "Validation failed",
//         errors: errors.array(),
//       });
//     }

//     const { email, password, name } = req.body;

//     // Check if user already exists
//     const existingUser = await prisma.user.findUnique({
//       where: { email },
//     });

//     if (existingUser) {
//       return res
//         .status(409)
//         .json({ message: "User with this email already exists" });
//     }

//     // Hash password
//     const saltRounds = 12;
//     const hashedPassword = await bcrypt.hash(password, saltRounds);

//     // Create user with ADMIN role (for signup)
//     const user = await prisma.user.create({
//       data: {
//         email,
//         password: hashedPassword,
//         name,
//         role: "ADMIN",
//         permissions: [
//           "view_dashboard",
//           "view_products",
//           "create_products",
//           "edit_products",
//           "delete_products",
//           "view_orders",
//           "create_orders",
//           "edit_orders",
//           "delete_orders",
//         ],
//       },
//       select: {
//         id: true,
//         email: true,
//         name: true,
//         profilePicture: true,
//         role: true,
//         permissions: true,
//         createdAt: true,
//       },
//     });

//     // Generate token
//     const token = generateToken(user.id);

//     res.status(201).json({
//       message: "User created successfully",
//       user,
//       token,
//     });
//   } catch (error) {
//     console.error("Signup error:", error);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// POST /api/auth/login
router.post("/login", loginValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Generate token
    const token = generateToken(user.id);

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
        role: user.role,
        permissions: user.permissions,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/auth/me - Get current user info
router.get("/me", authenticateToken, async (req, res) => {
  try {
    res.json({
      user: req.user,
    });
  } catch (error) {
    console.error("Get user info error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /api/auth/profile - Update user profile
router.put(
  "/profile",
  authenticateToken,
  [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage("Name must be at least 2 characters"),
    body("profilePicture")
      .optional()
      .custom((value) => {
        // Allow empty string for removing profile picture
        if (value === "") return true;
        // Require valid URL for non-empty values
        if (value && typeof value === "string" && value.trim() !== "") {
          const urlPattern = /^https?:\/\/.+/;
          if (!urlPattern.test(value)) {
            throw new Error("Profile picture must be a valid URL");
          }
        }
        return true;
      }),
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

      const { name, profilePicture } = req.body;
      const userId = req.user.id;

      // Build update data object
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (profilePicture !== undefined)
        updateData.profilePicture = profilePicture;

      // Update user
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          profilePicture: true,
          role: true,
          permissions: true,
          createdAt: true,
        },
      });

      res.json({
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /api/auth/change-password - Change user password
router.put(
  "/change-password",
  authenticateToken,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
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

      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;

      // Get user with password
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          password: true,
        },
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(
        currentPassword,
        user.password
      );

      if (!isCurrentPasswordValid) {
        return res
          .status(400)
          .json({ message: "Current password is incorrect" });
      }

      // Check if new password is different from current
      const isSamePassword = await bcrypt.compare(newPassword, user.password);
      if (isSamePassword) {
        return res.status(400).json({
          message: "New password must be different from current password",
        });
      }

      // Hash new password
      const saltRounds = 12;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user password
      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedNewPassword,
          updatedAt: new Date(),
        },
      });

      res.json({
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

module.exports = router;
