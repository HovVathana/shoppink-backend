const getPrismaClient = require("../lib/prisma");
const prisma = getPrismaClient();

class StockManagementService {
  /**
   * Deduct stock when order is assigned to driver
   */
  async deductStockForOrder(orderId) {
    try {
      console.log(`[STOCK] Deducting stock for order: ${orderId}`);

      // Get order with items
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!order) {
        throw new Error("Order not found");
      }

      // Process each order item
      for (const item of order.orderItems) {
        await this.deductStockForItem(item);
      }

      console.log(`[STOCK] Successfully deducted stock for order: ${orderId}`);
      return { success: true, orderId };
    } catch (error) {
      console.error("Deduct stock for order error:", error);
      throw error;
    }
  }

  /**
   * Restore stock when order status changes from DELIVERING or order is deleted
   */
  async restoreStockForOrder(orderId) {
    try {
      console.log(`[STOCK] Restoring stock for order: ${orderId}`);

      // Get order with items
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!order) {
        throw new Error("Order not found");
      }

      // Process each order item
      for (const item of order.orderItems) {
        await this.restoreStockForItem(item);
      }

      console.log(`[STOCK] Successfully restored stock for order: ${orderId}`);
      return { success: true, orderId };
    } catch (error) {
      console.error("Restore stock for order error:", error);
      throw error;
    }
  }

  /**
   * Deduct stock for a single order item
   */
  async deductStockForItem(orderItem) {
    try {
      const { productId, quantity, optionDetails } = orderItem;

      // Resolve variantId from optionDetails if available
      let variantId = optionDetails?.variantId;
      if (!variantId && optionDetails) {
        // Legacy payload support: optionDetails might be an array of groups
        const selections = Array.isArray(optionDetails)
          ? optionDetails
          : optionDetails.selections;
        if (selections && selections.length > 0) {
          const selectedOptionIds = selections
            .flatMap((g) => (g.selectedOptions || []).map((o) => o.id))
            .filter(Boolean);
          variantId = await this.resolveVariantId(productId, selectedOptionIds);
        }
      }

      if (variantId) {
        await this.deductVariantStock(variantId, quantity);
        console.log(`[STOCK] Deducted ${quantity} from variant ${variantId}`);
      } else {
        await this.deductProductStock(productId, quantity);
        console.log(`[STOCK] Deducted ${quantity} from product ${productId}`);
      }
    } catch (error) {
      console.error("Deduct stock for item error:", error);
      throw error;
    }
  }

  /**
   * Restore stock for a single order item
   */
  async restoreStockForItem(orderItem) {
    try {
      const { productId, quantity, optionDetails } = orderItem;

      // Resolve variantId from optionDetails if available
      let variantId = optionDetails?.variantId;
      if (!variantId && optionDetails) {
        const selections = Array.isArray(optionDetails)
          ? optionDetails
          : optionDetails.selections;
        if (selections && selections.length > 0) {
          const selectedOptionIds = selections
            .flatMap((g) => (g.selectedOptions || []).map((o) => o.id))
            .filter(Boolean);
          variantId = await this.resolveVariantId(productId, selectedOptionIds);
        }
      }

      if (variantId) {
        await this.restoreVariantStock(variantId, quantity);
        console.log(`[STOCK] Restored ${quantity} to variant ${variantId}`);
      } else {
        await this.restoreProductStock(productId, quantity);
        console.log(`[STOCK] Restored ${quantity} to product ${productId}`);
      }
    } catch (error) {
      console.error("Restore stock for item error:", error);
      throw error;
    }
  }

  /**
   * Deduct stock from product variant
   */
  async deductVariantStock(variantId, quantity) {
    try {
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
      });

      if (!variant) {
        throw new Error(`Variant not found: ${variantId}`);
      }

      if (variant.stock < quantity) {
        throw new Error(
          `Insufficient stock for variant ${variantId}. Available: ${variant.stock}, Requested: ${quantity}`
        );
      }

      await prisma.productVariant.update({
        where: { id: variantId },
        data: {
          stock: {
            decrement: quantity,
          },
        },
      });
    } catch (error) {
      console.error("Deduct variant stock error:", error);
      throw error;
    }
  }

  /**
   * Restore stock to product variant
   */
  async restoreVariantStock(variantId, quantity) {
    try {
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant) {
        throw new Error(`Variant not found: ${variantId}`);
      }
      await prisma.productVariant.update({
        where: { id: variantId },
        data: {
          stock: {
            increment: quantity,
          },
        },
      });
    } catch (error) {
      console.error("Restore variant stock error:", error);
      throw error;
    }
  }

  /**
   * Deduct stock from simple product
   */
  async deductProductStock(productId, quantity) {
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }

      if (product.quantity < quantity) {
        throw new Error(
          `Insufficient stock for product ${productId}. Available: ${product.quantity}, Requested: ${quantity}`
        );
      }

      await prisma.product.update({
        where: { id: productId },
        data: {
          quantity: {
            decrement: quantity,
          },
        },
      });
    } catch (error) {
      console.error("Deduct product stock error:", error);
      throw error;
    }
  }

  /**
   * Restore stock to simple product
   */
  async restoreProductStock(productId, quantity) {
    try {
      await prisma.product.update({
        where: { id: productId },
        data: {
          quantity: {
            increment: quantity,
          },
        },
      });
    } catch (error) {
      console.error("Restore product stock error:", error);
      throw error;
    }
  }

  /**
   * Resolve a variantId from a product and list of selected option IDs
   */
  async resolveVariantId(productId, optionIds) {
    if (!optionIds || optionIds.length === 0) return null;
    const variants = await prisma.productVariant.findMany({
      where: { productId },
      include: { variantOptions: true },
    });
    if (!variants || variants.length === 0) return null;
    const desired = new Set(optionIds);

    // Prefer exact match
    for (const v of variants) {
      const voSet = new Set(v.variantOptions.map((vo) => vo.optionId));
      if (voSet.size === desired.size) {
        let exact = true;
        for (const id of desired) {
          if (!voSet.has(id)) {
            exact = false;
            break;
          }
        }
        if (exact) return v.id;
      }
    }

    // Fallback to subset match (variant options ⊆ selected options), choose largest
    let best = null;
    let bestSize = -1;
    for (const v of variants) {
      const voSet = new Set(v.variantOptions.map((vo) => vo.optionId));
      let subset = true;
      for (const id of voSet) {
        if (!desired.has(id)) {
          subset = false;
          break;
        }
      }
      if (subset && voSet.size > bestSize) {
        best = v.id;
        bestSize = voSet.size;
      }
    }
    return best;
  }

  /**
   * Validate stock availability before assignment
   */
  async validateStockForOrder(orderId) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!order) {
        throw new Error("Order not found");
      }

      const validationResults = [];

      for (const item of order.orderItems) {
        const { productId, quantity, optionDetails } = item;

        // Try to resolve variantId from optionDetails
        let variantId = optionDetails?.variantId;
        if (!variantId && optionDetails) {
          const selections = Array.isArray(optionDetails)
            ? optionDetails
            : optionDetails.selections;
          if (selections && selections.length > 0) {
            const selectedOptionIds = selections
              .flatMap((g) => (g.selectedOptions || []).map((o) => o.id))
              .filter(Boolean);
            variantId = await this.resolveVariantId(
              productId,
              selectedOptionIds
            );
          }
        }

        if (variantId) {
          // Check variant stock
          const variant = await prisma.productVariant.findUnique({
            where: { id: variantId },
          });

          validationResults.push({
            productId,
            variantId,
            requestedQuantity: quantity,
            availableStock: variant?.stock || 0,
            isValid: (variant?.stock || 0) >= quantity,
            productName: item.product.name,
          });
        } else {
          // Check product stock
          validationResults.push({
            productId,
            variantId: null,
            requestedQuantity: quantity,
            availableStock: item.product.quantity || 0,
            isValid: (item.product.quantity || 0) >= quantity,
            productName: item.product.name,
          });
        }
      }

      return {
        isValid: validationResults.every((r) => r.isValid),
        results: validationResults,
      };
    } catch (error) {
      console.error("Validate stock for order error:", error);
      throw error;
    }
  }
}

module.exports = new StockManagementService();
