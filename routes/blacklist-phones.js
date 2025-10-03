const express = require("express");
const { body, validationResult, query, param } = require("express-validator");
const getPrismaClient = require("../lib/prisma");
const {
  authenticateUser,
  requireViewOrders,
  requireEditOrders,
} = require("../middleware/permissions");

const router = express.Router();
const prisma = getPrismaClient();

// All routes require authentication
router.use(authenticateUser);

const normalizePhone = (p) => (p || "").replace(/[^0-9]/g, "");

// GET /api/blacklist-phones - list entries
router.get("/", requireViewOrders, async (req, res) => {
  try {
    const entries = await prisma.blacklistedPhone.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: { entries } });
  } catch (error) {
    console.error("Get blacklist phones error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/blacklist-phones - add entry
router.post(
  "/",
  requireEditOrders,
  [
    body("phone").isString().trim().isLength({ min: 3 }).withMessage("Phone is required"),
    body("reason").optional().isString().trim().isLength({ max: 300 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }

      const { phone, reason } = req.body;
      const normalized = normalizePhone(phone);
      if (!normalized) {
        return res.status(400).json({ message: "Invalid phone" });
      }

      // Upsert by normalized phone to avoid duplicates
      const entry = await prisma.blacklistedPhone.upsert({
        where: { phone: normalized },
        create: {
          phone: normalized,
          rawPhone: phone,
          reason: reason || null,
          createdBy: req.user?.id || null,
        },
        update: {
          rawPhone: phone,
          reason: reason || null,
        },
      });

      res.status(201).json({ message: "Phone blacklisted", data: { entry } });
    } catch (error) {
      console.error("Create blacklist phone error:", error);
      if (error.code === "P2002") {
        return res.status(409).json({ message: "Phone already blacklisted" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// DELETE /api/blacklist-phones/:id - delete entry
router.delete(
  "/:id",
  requireEditOrders,
  [param("id").isString().withMessage("ID is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }
      const { id } = req.params;

      const existing = await prisma.blacklistedPhone.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: "Entry not found" });
      }

      await prisma.blacklistedPhone.delete({ where: { id } });
      res.json({ message: "Entry deleted" });
    } catch (error) {
      console.error("Delete blacklist phone error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Optional check endpoint: GET /api/blacklist-phones/check?phone=...
router.get(
  "/check",
  requireViewOrders,
  [query("phone").isString().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }
      const normalized = normalizePhone(req.query.phone);
      if (!normalized) return res.json({ data: { blacklisted: false } });
      const entry = await prisma.blacklistedPhone.findUnique({ where: { phone: normalized } });
      res.json({ data: { blacklisted: !!entry, entry } });
    } catch (error) {
      console.error("Check blacklist phone error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

module.exports = router;

