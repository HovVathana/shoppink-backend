const express = require("express");
const getPrismaClient = require("../lib/prisma");
const { authenticateToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/permissions");

const router = express.Router();
const prisma = getPrismaClient();

// Get all comments across all orders (admin only) - MUST come before /:orderId
router.get(
  "/",
  authenticateToken,
  requirePermission("manage_orders"),
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

      const { status, page = 1, limit = 20 } = req.query;

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 5));

      const where = {};
      if (status && ["PENDING", "CONFIRMED", "DENIED"].includes(status)) {
        where.status = status;
      }

      const skip = (pageNum - 1) * limitNum;

      const [comments, total] = await Promise.all([
        prisma.orderComment.findMany({
          where,
          include: {
            order: {
              select: {
                id: true,
                customerName: true,
                customerPhone: true,
                customerLocation: true,
                totalPrice: true,
                orderAt: true,
                state: true,
                orderItems: {
                  select: {
                    id: true,
                    quantity: true,
                    price: true,
                    product: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            approver: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
        }),
        prisma.orderComment.count({ where }),
      ]);

      res.json({
        comments,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching all comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  },
);

// Create a comment on an order (customer can comment on their own orders)
router.post("/:orderId", authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { content } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Comment content is required" });
    }

    // Verify order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Create comment
    const comment = await prisma.orderComment.create({
      data: {
        orderId,
        userId: req.user.id,
        content: content.trim(),
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// Get all comments for an order
router.get(
  "/:orderId",
  authenticateToken,
  requirePermission("view_orders"),
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

      const { orderId } = req.params;
      const { page = 1, limit = 5 } = req.query;

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 5));

      // Verify order exists
      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const skip = (pageNum - 1) * limitNum;

      const [comments, total] = await Promise.all([
        prisma.orderComment.findMany({
          where: { orderId },
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            approver: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
        }),
        prisma.orderComment.count({
          where: { orderId },
        }),
      ]);

      res.json({
        comments,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  },
);

// Update comment status (admin only)
router.patch(
  "/:commentId/status",
  authenticateToken,
  requirePermission("manage_orders"),
  async (req, res) => {
    try {
      const { commentId } = req.params;
      const { status } = req.body;

      if (!["CONFIRMED", "DENIED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const comment = await prisma.orderComment.update({
        where: { id: commentId },
        data: {
          status,
          approvedBy: req.user.id,
          updatedAt: new Date(),
        },
        include: {
          order: true,
          approver: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      res.json(comment);
    } catch (error) {
      console.error("Error updating comment status:", error);
      res.status(500).json({ error: "Failed to update comment status" });
    }
  },
);

// Delete a comment (admin only)
router.delete(
  "/:commentId",
  authenticateToken,
  requirePermission("manage_orders"),
  async (req, res) => {
    try {
      const { commentId } = req.params;

      await prisma.orderComment.delete({
        where: { id: commentId },
      });

      res.json({ message: "Comment deleted successfully" });
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  },
);

module.exports = router;
