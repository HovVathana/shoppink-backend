const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class HierarchicalStockService {
  /**
   * Get hierarchical stock tree for a product
   * This builds the tree structure showing stock at each level
   */
  async getHierarchicalStock(productId) {
    try {
      // Get product with all option groups, options, and variants
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          optionGroups: {
            include: {
              options: {
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
          },
          variants: {
            include: {
              variantOptions: {
                include: {
                  option: {
                    include: {
                      optionGroup: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!product) {
        throw new Error("Product not found");
      }

      // Build hierarchical structure
      const tree = this.buildHierarchicalTree(product);

      return {
        product: {
          id: product.id,
          name: product.name,
          totalStock: this.calculateHierarchicalTotalStock(tree),
        },
        tree,
        variants: product.variants,
      };
    } catch (error) {
      console.error("Get hierarchical stock error:", error);
      throw error;
    }
  }

  /**
   * Build hierarchical tree structure from variants with actual stock data
   */
  buildHierarchicalTree(product) {
    const { optionGroups, variants } = product;

    if (!variants || variants.length === 0) {
      // Fallback: build tree directly from option groups so UI shows structure
      return this.buildTreeFromOptionGroups(optionGroups);
    }

    // Build tree structure from variants
    const tree = this.buildTreeFromVariants(variants, optionGroups);
    return tree;
  }

  /**
   * Build tree structure from option groups and options when no variants exist
   * Aggregates stock using option.stock values and sums to parent groups
   */
  buildTreeFromOptionGroups(optionGroups) {
    if (!optionGroups || optionGroups.length === 0) return [];

    const buildNode = (group) => {
      // Find direct child groups
      const childGroups = optionGroups.filter(
        (g) => g.parentGroupId === group.id
      );

      // Build child group nodes recursively
      const childGroupNodes = childGroups.map((cg) => buildNode(cg));

      // Build option nodes as leaves
      const optionNodes = (group.options || []).map((opt) => ({
        id: opt.id,
        name: opt.name,
        type: "option",
        level: (group.level || 1) + 1,
        stock: opt.stock || 0,
        children: [],
        groupId: group.id,
        groupName: group.name,
        variantId: null,
      }));

      const children = [...childGroupNodes, ...optionNodes];
      const stock = children.reduce((sum, n) => sum + (n.stock || 0), 0);

      return {
        id: group.id,
        name: group.name,
        type: "option-group",
        level: group.level || 1,
        stock,
        children,
      };
    };

    const rootGroups = optionGroups.filter(
      (g) => (g.level || 1) === 1 || !g.parentGroupId
    );
    return rootGroups.map((g) => buildNode(g));
  }

  /**
   * Build tree structure directly from product variants
   */
  buildTreeFromVariants(variants, optionGroups) {
    // Create a map of option groups by level for easy lookup
    const groupsByLevel = {};
    optionGroups.forEach((group) => {
      if (!groupsByLevel[group.level]) {
        groupsByLevel[group.level] = [];
      }
      groupsByLevel[group.level].push(group);
    });

    // Get the maximum level to understand the hierarchy depth
    const maxLevel = Math.max(...optionGroups.map((g) => g.level));

    // Build tree recursively starting from level 1
    return this.buildLevelNodes(variants, optionGroups, 1, maxLevel, []);
  }

  /**
   * Build a node for a group with its children and stock calculations
   */
  buildGroupNode(group, allGroups, variantMap) {
    const childGroups = allGroups.filter((g) => g.parentGroupId === group.id);

    // If this group has options AND child groups, create nested structure
    if (group.options.length > 0 && childGroups.length > 0) {
      const children = [];

      // Create a node for each option in this group
      group.options.forEach((option) => {
        const optionNode = {
          id: option.id,
          name: option.name,
          type: "option-group", // This option acts as a group
          level: group.level + 1,
          stock: 0,
          children: [],
        };

        // Add child groups under this option
        childGroups.forEach((childGroup) => {
          const childNode = this.buildChildGroupNodeRecursive(
            childGroup,
            option,
            allGroups,
            variantMap,
            [option] // Track the path of parent options
          );
          optionNode.children.push(childNode);
          optionNode.stock += childNode.stock;
        });

        children.push(optionNode);
      });

      return {
        id: group.id,
        name: group.name,
        type: "option-group",
        level: group.level,
        stock: children.reduce((sum, child) => sum + child.stock, 0),
        children,
      };
    }

    // If this group has child groups but no options, just add child groups
    if (childGroups.length > 0) {
      const children = childGroups.map((childGroup) =>
        this.buildGroupNode(childGroup, allGroups, variantMap)
      );

      return {
        id: group.id,
        name: group.name,
        type: "option-group",
        level: group.level,
        stock: children.reduce((sum, child) => sum + child.stock, 0),
        children,
      };
    }

    // Regular group with just options
    const children = group.options.map((option) => ({
      id: option.id,
      name: option.name,
      type: "option",
      level: group.level + 1,
      stock: option.stock,
      children: [],
    }));

    return {
      id: group.id,
      name: group.name,
      type: "option-group",
      level: group.level,
      stock: children.reduce((sum, child) => sum + child.stock, 0),
      children,
    };
  }

  /**
   * Build nodes for a specific level in the hierarchy
   */
  buildLevelNodes(variants, optionGroups, currentLevel, maxLevel, parentPath) {
    // Get groups at current level
    const currentLevelGroups = optionGroups.filter(
      (g) => g.level === currentLevel
    );

    if (currentLevelGroups.length === 0) {
      return [];
    }

    const groupNodes = [];

    currentLevelGroups.forEach((group) => {
      const optionNodes = [];
      let groupStock = 0;

      // Build option nodes for this group
      group.options.forEach((option) => {
        const currentPath = [...parentPath, option.id];

        // Calculate stock for this option at this level
        let stock = 0;
        const children = [];

        let variantId = null;

        if (currentLevel < maxLevel) {
          // This is not the leaf level, build children

          const childNodes = this.buildLevelNodes(
            variants,
            optionGroups,
            currentLevel + 1,
            maxLevel,
            currentPath
          );
          children.push(...childNodes);
          stock = children.reduce((sum, child) => sum + child.stock, 0);
        } else {
          // This is the leaf level, get stock and variant ID from variants

          const stockData = this.getStockAndVariantForPath(
            variants,
            currentPath
          );

          stock = stockData.stock;
          variantId = stockData.variantId;
        }

        optionNodes.push({
          id: option.id,
          name: option.name,
          type: "option", // Options are always type "option", regardless of whether they have children
          level: currentLevel + 1, // Options are one level deeper than their group
          stock: stock,
          children: children,
          groupName: group.name,
          groupId: group.id,
          variantId: variantId, // Include variant ID for leaf nodes
        });

        groupStock += stock;
      });

      // Create group node that contains all its options
      groupNodes.push({
        id: group.id,
        name: group.name,
        type: "option-group",
        level: currentLevel,
        stock: groupStock,
        children: optionNodes,
        groupName: group.name,
        groupId: group.id,
      });
    });

    return groupNodes;
  }

  /**
   * Get stock for a specific option path from variants
   */
  getStockForPath(variants, optionPath) {
    const matchingVariants = variants.filter((variant) => {
      const variantOptionIds = variant.variantOptions
        .map((vo) => vo.option.id)
        .sort();
      const pathSorted = [...optionPath].sort();

      // Check if this variant contains all options in the path
      return pathSorted.every((optionId) =>
        variantOptionIds.includes(optionId)
      );
    });

    return matchingVariants.reduce(
      (total, variant) => total + variant.stock,
      0
    );
  }

  /**
   * Get stock and variant ID for a specific option path from variants
   * For leaf nodes, this should return exactly one variant
   */
  getStockAndVariantForPath(variants, optionPath) {
    const matchingVariants = variants.filter((variant) => {
      const variantOptionIds = variant.variantOptions
        .map((vo) => vo.option.id)
        .sort();
      const pathSorted = [...optionPath].sort();

      // For leaf nodes, the variant should contain exactly the same options as the path
      return (
        variantOptionIds.length === pathSorted.length &&
        pathSorted.every((optionId) => variantOptionIds.includes(optionId))
      );
    });

    if (matchingVariants.length === 1) {
      // Perfect match - one variant for this exact combination
      return {
        stock: matchingVariants[0].stock,
        variantId: matchingVariants[0].id,
      };
    } else if (matchingVariants.length > 1) {
      // Multiple variants match - sum the stock but no single variant ID
      return {
        stock: matchingVariants.reduce(
          (total, variant) => total + variant.stock,
          0
        ),
        variantId: null,
      };
    } else {
      // No matching variants
      return {
        stock: 0,
        variantId: null,
      };
    }
  }

  /**
   * Build child group node under a specific parent option
   */
  buildChildGroupNode(childGroup, parentOption, allGroups, variantMap) {
    const children = [];

    // Create option nodes for this child group
    childGroup.options.forEach((childOption) => {
      // Find the variant that matches this combination
      const optionIds = [parentOption.id, childOption.id].sort();
      const variantKey = optionIds.join("-");
      const variant = variantMap.get(variantKey);

      children.push({
        id: `${parentOption.id}_${childOption.id}`, // Create unique ID for each combination
        name: childOption.name,
        type: "option",
        level: childGroup.level + 1,
        stock: variant ? variant.stock : 0,
        variantId: variant ? variant.id : null,
        children: [],
      });
    });

    return {
      id: `${parentOption.id}_${childGroup.id}`,
      name: childGroup.name,
      type: "option-group",
      level: childGroup.level,
      stock: children.reduce((sum, child) => sum + child.stock, 0),
      children,
    };
  }

  /**
   * Build child group node recursively to handle unlimited nesting levels
   */
  buildChildGroupNodeRecursive(
    childGroup,
    parentOption,
    allGroups,
    variantMap,
    optionPath
  ) {
    const children = [];
    const grandChildGroups = allGroups.filter(
      (g) => g.parentGroupId === childGroup.id
    );

    // If this child group has options AND grandchild groups, create nested structure
    if (childGroup.options.length > 0 && grandChildGroups.length > 0) {
      // Create a node for each option in this child group
      childGroup.options.forEach((childOption) => {
        const optionNode = {
          id: `${optionPath.map((o) => o.id).join("_")}_${childOption.id}`,
          name: childOption.name,
          type: "option-group",
          level: childGroup.level + 1,
          stock: 0,
          children: [],
        };

        // Recursively add grandchild groups under this option
        grandChildGroups.forEach((grandChildGroup) => {
          const grandChildNode = this.buildChildGroupNodeRecursive(
            grandChildGroup,
            childOption,
            allGroups,
            variantMap,
            [...optionPath, childOption] // Extend the option path
          );
          optionNode.children.push(grandChildNode);
          optionNode.stock += grandChildNode.stock;
        });

        children.push(optionNode);
      });
    } else {
      // This is a leaf group - create final option nodes with variants
      childGroup.options.forEach((childOption) => {
        // Find the variant that matches this complete combination
        const allOptionIds = [
          ...optionPath.map((o) => o.id),
          childOption.id,
        ].sort();
        const variantKey = allOptionIds.join("-");
        const variant = variantMap.get(variantKey);

        children.push({
          id: `${optionPath.map((o) => o.id).join("_")}_${childOption.id}`,
          name: childOption.name,
          type: "option",
          level: childGroup.level + 1,
          stock: variant ? variant.stock : 0,
          variantId: variant ? variant.id : null,
          children: [],
        });
      });
    }

    return {
      id: `${optionPath.map((o) => o.id).join("_")}_${childGroup.id}`,
      name: childGroup.name,
      type: "option-group",
      level: childGroup.level,
      stock: children.reduce((sum, child) => sum + child.stock, 0),
      children,
    };
  }

  /**
   * Calculate total stock from variants
   */
  calculateTotalStock(variants) {
    return variants.reduce((total, variant) => total + variant.stock, 0);
  }

  /**
   * Calculate hierarchical total stock - sum only the outer 2 levels
   * This prevents double counting in multi-level hierarchies
   */
  calculateHierarchicalTotalStock(tree) {
    if (!tree || tree.length === 0) return 0;

    // Find the root level (level 1) groups
    const rootGroups = tree.filter((node) => node.level === 1);

    if (rootGroups.length > 0) {
      // Sum the stock of level 1 groups (which already contain aggregated stock from children)
      return rootGroups.reduce((total, group) => total + group.stock, 0);
    }

    // Fallback: if no level 1 groups, sum all root nodes
    return tree.reduce((total, node) => total + node.stock, 0);
  }

  /**
   * Update stock for a specific variant
   */
  async updateVariantStock(variantId, newStock) {
    try {
      const variant = await prisma.productVariant.update({
        where: { id: variantId },
        data: { stock: parseInt(newStock) },
        include: {
          variantOptions: {
            include: {
              option: {
                include: {
                  optionGroup: true,
                },
              },
            },
          },
        },
      });

      return variant;
    } catch (error) {
      console.error("Update variant stock error:", error);
      throw error;
    }
  }

  /**
   * Enhanced auto-generate variants for products with unlimited hierarchical levels
   * Supports intelligent updating - only creates new variants, preserves existing ones
   */
  async generateVariantsForProduct(productId) {
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          optionGroups: {
            where: { isActive: true },
            include: {
              options: {
                where: { isAvailable: true },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
          },
          variants: {
            include: {
              variantOptions: {
                include: {
                  option: true,
                },
              },
            },
          },
        },
      });

      if (!product) {
        throw new Error("Product not found");
      }

      // Generate all possible combinations using recursive algorithm
      const allCombinations = this.generateAllOptionCombinations(
        product.optionGroups
      );

      if (allCombinations.length === 0) {
        return {
          created: [],
          updated: [],
          message: "No valid option combinations found",
        };
      }

      const results = {
        created: [],
        updated: [],
        skipped: [],
        errors: [],
      };

      // Process each combination
      for (const combination of allCombinations) {
        try {
          const result = await this.createOrUpdateVariant(product, combination);
          if (result.action === "created") {
            results.created.push(result.variant);
          } else if (result.action === "updated") {
            results.updated.push(result.variant);
          } else {
            results.skipped.push(result.variant);
          }
        } catch (error) {
          console.error(
            `Error processing combination ${combination.name}:`,
            error
          );
          results.errors.push({
            combination: combination.name,
            error: error.message,
          });
        }
      }

      // Update option group paths for better organization
      await this.updateOptionGroupPaths(productId);

      return results;
    } catch (error) {
      console.error("Generate variants error:", error);
      throw error;
    }
  }

  /**
   * Generate all possible option combinations recursively
   * Supports unlimited nesting levels
   */
  generateAllOptionCombinations(optionGroups) {
    if (!optionGroups || optionGroups.length === 0) {
      return [];
    }

    // Group by hierarchy level and parent relationships
    const groupsByLevel = this.groupOptionsByLevel(optionGroups);
    const maxLevel = Math.max(...Object.keys(groupsByLevel).map(Number));

    const combinations = [];

    // Start recursive generation from level 1
    this.generateCombinationsRecursive(
      groupsByLevel,
      1,
      maxLevel,
      [],
      null,
      combinations
    );

    return combinations;
  }

  /**
   * Group option groups by level for easier processing
   */
  groupOptionsByLevel(optionGroups) {
    const grouped = {};

    optionGroups.forEach((group) => {
      if (!grouped[group.level]) {
        grouped[group.level] = [];
      }
      grouped[group.level].push(group);
    });

    return grouped;
  }

  /**
   * Recursive function to generate all combinations
   */
  generateCombinationsRecursive(
    groupsByLevel,
    currentLevel,
    maxLevel,
    currentPath,
    parentGroupId,
    results
  ) {
    if (currentLevel > maxLevel) {
      // We've reached the end, add this combination if it has options
      if (currentPath.length > 0) {
        const combination = this.createCombinationObject(currentPath);
        results.push(combination);
      }
      return;
    }

    const currentLevelGroups = (groupsByLevel[currentLevel] || []).filter(
      (group) =>
        currentLevel === 1
          ? group.parentGroupId === null
          : group.parentGroupId === parentGroupId
    );

    for (const group of currentLevelGroups) {
      if (!group.options || group.options.length === 0) continue;

      for (const option of group.options) {
        const newPath = [...currentPath, { group, option }];

        // Check if there are child groups for this option's group
        const hasChildGroups = (groupsByLevel[currentLevel + 1] || []).some(
          (childGroup) => childGroup.parentGroupId === group.id
        );

        if (hasChildGroups) {
          // Continue to next level
          this.generateCombinationsRecursive(
            groupsByLevel,
            currentLevel + 1,
            maxLevel,
            newPath,
            group.id,
            results
          );
        } else {
          // This is a leaf path, add the combination
          const combination = this.createCombinationObject(newPath);
          results.push(combination);
        }
      }
    }
  }

  /**
   * Create a combination object from a path of group-option pairs
   */
  createCombinationObject(path) {
    const options = path.map((item) => item.option);
    const groups = path.map((item) => item.group);

    // Create name by joining option names
    const name = options.map((opt) => opt.name).join(" ");

    // Create option path for tracking
    const optionPath = path
      .map((item) => `${item.group.name}:${item.option.name}`)
      .join("/");

    // Create hash for uniqueness checking
    const optionIds = options.map((opt) => opt.id).sort();
    const optionHash = this.createOptionHash(optionIds);

    // Calculate total price adjustment
    const totalPriceAdjustment = options.reduce(
      (sum, opt) => sum + (opt.priceValue || 0),
      0
    );

    return {
      name,
      options,
      groups,
      optionPath,
      optionHash,
      priceAdjustment: totalPriceAdjustment,
      sortOrder: this.calculateSortOrder(path),
    };
  }

  /**
   * Get stock summary for dashboard/reporting
   */
  async getStockSummary(productId) {
    try {
      const variants = await prisma.productVariant.findMany({
        where: { productId },
        include: {
          variantOptions: {
            include: {
              option: {
                include: {
                  optionGroup: true,
                },
              },
            },
          },
        },
      });

      const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
      const lowStockVariants = variants.filter((v) => v.stock <= 10);
      const outOfStockVariants = variants.filter((v) => v.stock === 0);

      return {
        totalVariants: variants.length,
        totalStock,
        lowStockCount: lowStockVariants.length,
        outOfStockCount: outOfStockVariants.length,
        lowStockVariants: lowStockVariants.map((v) => ({
          id: v.id,
          name: v.name,
          stock: v.stock,
        })),
        outOfStockVariants: outOfStockVariants.map((v) => ({
          id: v.id,
          name: v.name,
          stock: v.stock,
        })),
      };
    } catch (error) {
      console.error("Get stock summary error:", error);
      throw error;
    }
  }

  /**
   * Create or update a variant based on combination
   */
  async createOrUpdateVariant(product, combination) {
    try {
      // Check if variant already exists by hash
      const existingVariant = await prisma.productVariant.findUnique({
        where: {
          productId_optionHash: {
            productId: product.id,
            optionHash: combination.optionHash,
          },
        },
        include: {
          variantOptions: {
            include: {
              option: true,
            },
          },
        },
      });

      if (existingVariant) {
        // Update existing variant if needed
        const needsUpdate =
          existingVariant.name !== combination.name ||
          existingVariant.optionPath !== combination.optionPath ||
          Math.abs(
            existingVariant.priceAdjustment - combination.priceAdjustment
          ) > 0.01;

        if (needsUpdate) {
          const updatedVariant = await prisma.productVariant.update({
            where: { id: existingVariant.id },
            data: {
              name: combination.name,
              optionPath: combination.optionPath,
              priceAdjustment: combination.priceAdjustment,
              sortOrder: combination.sortOrder,
            },
          });
          return { action: "updated", variant: updatedVariant };
        }

        return { action: "skipped", variant: existingVariant };
      }

      // Create new variant
      const newVariant = await prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({
          data: {
            productId: product.id,
            name: combination.name,
            stock: 0,
            priceAdjustment: combination.priceAdjustment,
            optionPath: combination.optionPath,
            optionHash: combination.optionHash,
            sortOrder: combination.sortOrder,
          },
        });

        // Create variant-option relationships
        await Promise.all(
          combination.options.map((option) =>
            tx.productVariantOption.create({
              data: {
                variantId: variant.id,
                optionId: option.id,
              },
            })
          )
        );

        return variant;
      });

      return { action: "created", variant: newVariant };
    } catch (error) {
      console.error("Create/update variant error:", error);
      throw error;
    }
  }

  /**
   * Create a hash from option IDs for uniqueness checking
   */
  createOptionHash(optionIds) {
    const crypto = require("crypto");
    const sortedIds = optionIds.sort().join("-");
    return crypto.createHash("md5").update(sortedIds).digest("hex");
  }

  /**
   * Calculate sort order based on option path
   */
  calculateSortOrder(path) {
    // Simple sort order based on option sort orders
    return path.reduce((sum, item, index) => {
      return (
        sum +
        (item.option.sortOrder || 0) * Math.pow(100, path.length - index - 1)
      );
    }, 0);
  }

  /**
   * Update option group paths for better organization
   */
  async updateOptionGroupPaths(productId) {
    try {
      const optionGroups = await prisma.productOptionGroup.findMany({
        where: { productId },
        include: {
          parentGroup: true,
        },
        orderBy: { level: "asc" },
      });

      for (const group of optionGroups) {
        const path = this.buildGroupPath(group, optionGroups);
        if (group.path !== path) {
          await prisma.productOptionGroup.update({
            where: { id: group.id },
            data: { path },
          });
        }
      }
    } catch (error) {
      console.error("Update option group paths error:", error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Build hierarchical path for an option group
   */
  buildGroupPath(group, allGroups) {
    const path = [group.name];
    let currentGroup = group;

    while (currentGroup.parentGroupId) {
      const parentGroup = allGroups.find(
        (g) => g.id === currentGroup.parentGroupId
      );
      if (parentGroup) {
        path.unshift(parentGroup.name);
        currentGroup = parentGroup;
      } else {
        break;
      }
    }

    return path.join("/");
  }
}

module.exports = new HierarchicalStockService();
