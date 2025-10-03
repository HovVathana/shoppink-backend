const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const sampleOrders = [
  {
    orderNumber: "ORD-001",
    customerName: "Sok Dara",
    customerPhone: "012345678",
    customerLocation: "Street 271, Phnom Penh",
    province: "Phnom Penh",
    state: "PLACED",
    totalPrice: 25.5,
    orderAt: new Date("2025-08-30T08:00:00Z"),
    items: [{ productName: "T-Shirt", quantity: 2, price: 12.75 }],
  },
  {
    orderNumber: "ORD-002",
    customerName: "Chan Sophea",
    customerPhone: "012345679",
    customerLocation: "Street 63, Phnom Penh",
    province: "Phnom Penh",
    state: "DELIVERING",
    totalPrice: 45.0,
    orderAt: new Date("2025-08-30T09:15:00Z"),
    assignedAt: new Date("2025-08-30T10:00:00Z"),
    items: [{ productName: "Jeans", quantity: 1, price: 45.0 }],
  },
  {
    orderNumber: "ORD-003",
    customerName: "Pich Ratana",
    customerPhone: "012345680",
    customerLocation: "Siem Reap City",
    province: "Siem Reap",
    state: "COMPLETED",
    totalPrice: 32.25,
    orderAt: new Date("2025-08-30T07:30:00Z"),
    assignedAt: new Date("2025-08-30T08:15:00Z"),
    completedAt: new Date("2025-08-30T14:30:00Z"),
    items: [{ productName: "Dress", quantity: 1, price: 32.25 }],
  },
  {
    orderNumber: "ORD-004",
    customerName: "Lim Bopha",
    customerPhone: "012345681",
    customerLocation: "Street 240, Phnom Penh",
    province: "Phnom Penh",
    state: "RETURNED",
    totalPrice: 18.75,
    orderAt: new Date("2025-08-30T10:45:00Z"),
    assignedAt: new Date("2025-08-30T11:00:00Z"),
    items: [{ productName: "Shoes", quantity: 1, price: 18.75 }],
  },
  {
    orderNumber: "ORD-005",
    customerName: "Mao Pisach",
    customerPhone: "012345682",
    customerLocation: "Battambang City",
    province: "Battambang",
    state: "DELIVERING",
    totalPrice: 67.5,
    orderAt: new Date("2025-08-30T11:20:00Z"),
    assignedAt: new Date("2025-08-30T12:00:00Z"),
    items: [{ productName: "Jacket", quantity: 1, price: 67.5 }],
  },
];

// Generate more orders for pagination testing
const generateMoreOrders = () => {
  const orders = [];
  const names = [
    "Sok",
    "Chan",
    "Pich",
    "Lim",
    "Mao",
    "Chea",
    "Heng",
    "Vann",
    "Keo",
    "Srey",
  ];
  const surnames = [
    "Dara",
    "Sophea",
    "Ratana",
    "Bopha",
    "Pisach",
    "Mony",
    "Sovan",
    "Pisey",
    "Chanthy",
    "Sreypov",
  ];
  const provinces = [
    "Phnom Penh",
    "Siem Reap",
    "Battambang",
    "Kampong Cham",
    "Kandal",
  ];
  const states = ["PLACED", "DELIVERING", "COMPLETED", "RETURNED"];
  const products = [
    "T-Shirt",
    "Jeans",
    "Dress",
    "Shoes",
    "Jacket",
    "Hat",
    "Bag",
    "Watch",
    "Sunglasses",
    "Belt",
  ];

  for (let i = 6; i <= 100; i++) {
    const name = names[Math.floor(Math.random() * names.length)];
    const surname = surnames[Math.floor(Math.random() * surnames.length)];
    const province = provinces[Math.floor(Math.random() * provinces.length)];
    const state = states[Math.floor(Math.random() * states.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    const quantity = Math.floor(Math.random() * 3) + 1;
    const price = Math.round((Math.random() * 50 + 10) * 100) / 100;

    // Create orders for different dates to test date filtering
    const baseDate = new Date("2025-08-30");
    const daysOffset = Math.floor(Math.random() * 7) - 3; // -3 to +3 days from today
    const orderDate = new Date(baseDate);
    orderDate.setDate(orderDate.getDate() + daysOffset);
    orderDate.setHours(Math.floor(Math.random() * 24));
    orderDate.setMinutes(Math.floor(Math.random() * 60));

    const order = {
      orderNumber: `ORD-${i.toString().padStart(3, "0")}`,
      customerName: `${name} ${surname}`,
      customerPhone: `01234567${i.toString().padStart(2, "0")}`,
      customerLocation:
        province === "Phnom Penh"
          ? `Street ${Math.floor(Math.random() * 500) + 1}, Phnom Penh`
          : `${province} City`,
      province: province,
      state: state,
      totalPrice: price * quantity,
      orderAt: orderDate,
      items: [{ productName: product, quantity: quantity, price: price }],
    };

    // Add assignedAt for DELIVERING, COMPLETED, and RETURNED orders
    if (
      state === "DELIVERING" ||
      state === "COMPLETED" ||
      state === "RETURNED"
    ) {
      const assignedDate = new Date(orderDate);
      assignedDate.setHours(assignedDate.getHours() + 1);
      order.assignedAt = assignedDate;
    }

    // Add completedAt for COMPLETED orders
    if (state === "COMPLETED") {
      const completedDate = new Date(order.assignedAt);
      completedDate.setHours(
        completedDate.getHours() + Math.floor(Math.random() * 6) + 2
      );
      order.completedAt = completedDate;
    }

    orders.push(order);
  }

  return orders;
};

async function seedOrders() {
  try {
    console.log("🌱 Starting to seed orders...");

    // Get or create a default admin for the orders
    let defaultAdmin = await prisma.admin.findFirst();
    if (!defaultAdmin) {
      defaultAdmin = await prisma.admin.create({
        data: {
          username: "admin",
          email: "admin@shoppink.com",
          password: "$2b$10$example", // This should be properly hashed in real usage
          name: "Default Admin",
          role: "ADMIN",
        },
      });
      console.log("👤 Created default admin for orders");
    }

    // Delete existing orders
    await prisma.order.deleteMany({});
    console.log("🗑️  Cleared existing orders");

    // Add sample orders
    const allOrders = [...sampleOrders, ...generateMoreOrders()];

    for (const orderData of allOrders) {
      // Calculate required price fields
      const subtotalPrice = orderData.totalPrice * 0.9; // 90% of total
      const deliveryPrice = orderData.totalPrice * 0.05; // 5% delivery
      const companyDeliveryPrice = orderData.totalPrice * 0.05; // 5% company delivery

      await prisma.order.create({
        data: {
          ...orderData,
          subtotalPrice,
          deliveryPrice,
          companyDeliveryPrice,
          createdBy: defaultAdmin.id,
          // Remove items as they should be created separately
          items: undefined,
        },
      });
    }

    console.log(
      `✅ Successfully seeded ${allOrders.length} orders (spanning multiple dates for testing)`
    );
    console.log("📊 Order distribution:");

    const states = await prisma.order.groupBy({
      by: ["state"],
      _count: {
        state: true,
      },
    });

    states.forEach((state) => {
      console.log(`   ${state.state}: ${state._count.state} orders`);
    });
  } catch (error) {
    console.error("❌ Error seeding orders:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seedOrders();
