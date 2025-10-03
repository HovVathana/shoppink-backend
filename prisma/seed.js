const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Create a default admin user
  const hashedPassword = await bcrypt.hash("admin123", 12);

  const admin = await prisma.admin.upsert({
    where: { email: "admin@shoppink.com" },
    update: {},
    create: {
      email: "admin@shoppink.com",
      password: hashedPassword,
      name: "Admin User",
    },
  });

  console.log("✅ Created admin user:", admin.email);

  // Create sample categories
  const categories = [
    {
      name: "Electronics",
      description: "Electronic devices and accessories",
    },
    {
      name: "Clothing",
      description: "Fashion and apparel items",
    },
    {
      name: "Beauty",
      description: "Cosmetics and beauty products",
    },
    {
      name: "Jewelry",
      description: "Jewelry and accessories",
    },
    {
      name: "Accessories",
      description: "Various accessories and gadgets",
    },
  ];

  const createdCategories = {};
  for (const categoryData of categories) {
    const category = await prisma.category.upsert({
      where: { name: categoryData.name },
      update: {},
      create: categoryData,
    });
    createdCategories[categoryData.name] = category;
  }

  console.log("✅ Created sample categories");

  // Create sample drivers
  const drivers = [
    {
      name: "Sokha Delivery",
      phone: "+855123456789",
    },
    {
      name: "Pisach Transport",
      phone: "+855987654321",
    },
    {
      name: "Vanna Express",
      phone: "+855555666777",
    },
  ];

  const createdDrivers = [];
  for (const driverData of drivers) {
    const driver = await prisma.driver.create({
      data: driverData,
    });
    createdDrivers.push(driver);
  }

  console.log("✅ Created sample drivers");

  // Create sample customers
  const customer1 = await prisma.customer.upsert({
    where: { email: "john@example.com" },
    update: {},
    create: {
      email: "john@example.com",
      name: "John Doe",
      phone: "+1234567890",
      address: "123 Main St",
      city: "Phnom Penh",
      province: "Phnom Penh",
      postalCode: "12000",
    },
  });

  const customer2 = await prisma.customer.upsert({
    where: { email: "jane@example.com" },
    update: {},
    create: {
      email: "jane@example.com",
      name: "Jane Smith",
      phone: "+1234567891",
      address: "456 Oak Ave",
      city: "Siem Reap",
      province: "Siem Reap",
      postalCode: "17000",
    },
  });

  console.log("✅ Created sample customers");

  // Create sample products
  const products = [
    {
      name: "Pink Smartphone Case",
      description: "Stylish pink protective case for smartphones",
      price: 25.99,
      quantity: 100,
      weight: 0.2,
      delivery_price_for_pp: 2.5,
      delivery_price_for_province: 5.0,
      categoryId: createdCategories["Accessories"].id,
      sku: "PSC001",
      imageUrl:
        "https://via.placeholder.com/300x300/ff69b4/ffffff?text=Pink+Case",
    },
    {
      name: "Rose Gold Watch",
      description: "Elegant rose gold watch with pink accents",
      price: 199.99,
      quantity: 50,
      weight: 0.5,
      delivery_price_for_pp: 3.0,
      delivery_price_for_province: 6.0,
      categoryId: createdCategories["Jewelry"].id,
      sku: "RGW001",
      imageUrl:
        "https://via.placeholder.com/300x300/ffc0cb/ffffff?text=Rose+Watch",
    },
    {
      name: "Pink Wireless Headphones",
      description: "High-quality wireless headphones in pink",
      price: 89.99,
      quantity: 75,
      weight: 0.8,
      delivery_price_for_pp: 3.5,
      delivery_price_for_province: 7.0,
      categoryId: createdCategories["Electronics"].id,
      sku: "PWH001",
      imageUrl:
        "https://via.placeholder.com/300x300/ff1493/ffffff?text=Pink+Headphones",
    },
    {
      name: "Floral Pink Dress",
      description: "Beautiful floral dress in pink tones",
      price: 79.99,
      quantity: 30,
      weight: 0.6,
      delivery_price_for_pp: 4.0,
      delivery_price_for_province: 8.0,
      categoryId: createdCategories["Clothing"].id,
      sku: "FPD001",
      imageUrl:
        "https://via.placeholder.com/300x300/ffb6c1/ffffff?text=Pink+Dress",
    },
    {
      name: "Pink Makeup Kit",
      description: "Complete makeup kit with pink-themed cosmetics",
      price: 149.99,
      quantity: 25,
      weight: 1.2,
      delivery_price_for_pp: 4.5,
      delivery_price_for_province: 9.0,
      categoryId: createdCategories["Beauty"].id,
      sku: "PMK001",
      imageUrl:
        "https://via.placeholder.com/300x300/ff69b4/ffffff?text=Makeup+Kit",
    },
  ];

  for (const productData of products) {
    await prisma.product.upsert({
      where: { sku: productData.sku },
      update: {},
      create: productData,
    });
  }

  console.log("✅ Created sample products");

  // Create sample orders with enhanced structure
  const createdProducts = await prisma.product.findMany();

  const order1 = await prisma.order.create({
    data: {
      orderNumber: "ORD-000001",
      customerName: customer1.name,
      customerPhone: customer1.phone,
      customerLocation: customer1.address,
      province: customer1.province,
      remark: "Please deliver in the morning",
      state: "COMPLETED",
      subtotalPrice: 110.98,
      companyDeliveryPrice: 2.0,
      deliveryPrice: 3.0,
      totalPrice: 115.98,
      driverId: createdDrivers[0].id,
      createdBy: admin.id,
      assignedAt: new Date(),
      completedAt: new Date(),
      orderItems: {
        create: [
          {
            productId: createdProducts[0].id,
            quantity: 2,
            price: createdProducts[0].price,
            weight: createdProducts[0].weight,
          },
          {
            productId: createdProducts[2].id,
            quantity: 1,
            price: createdProducts[2].price,
            weight: createdProducts[2].weight,
          },
        ],
      },
    },
  });

  const order2 = await prisma.order.create({
    data: {
      orderNumber: "ORD-000002",
      customerName: customer2.name,
      customerPhone: customer2.phone,
      customerLocation: customer2.address,
      province: customer2.province,
      remark: "Handle with care",
      state: "PLACED",
      subtotalPrice: 279.98,
      companyDeliveryPrice: 3.0,
      deliveryPrice: 5.0,
      totalPrice: 287.98,
      driverId: null,
      createdBy: admin.id,
      assignedAt: null,
      completedAt: null,
      orderItems: {
        create: [
          {
            productId: createdProducts[1].id,
            quantity: 1,
            price: createdProducts[1].price,
            weight: createdProducts[1].weight,
          },
          {
            productId: createdProducts[3].id,
            quantity: 1,
            price: createdProducts[3].price,
            weight: createdProducts[3].weight,
          },
        ],
      },
    },
  });

  console.log("✅ Created sample orders");
  console.log("🎉 Database seeding completed!");
  console.log("\n📋 Sample Data Created:");
  console.log(`👤 Admin: ${admin.email} (password: admin123)`);
  console.log(`📂 Categories: ${categories.length} categories`);
  console.log(`🛍️ Products: ${products.length} items`);
  console.log(`🚚 Drivers: ${drivers.length} drivers`);
  console.log(`👥 Customers: 2 customers`);
  console.log(`📦 Orders: 2 orders`);
}

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
