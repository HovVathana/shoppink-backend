const { PrismaClient } = require('@prisma/client');

// Global variable to store the Prisma client instance
let prisma;

// Create or reuse Prisma client for serverless environments
const getPrismaClient = () => {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Connection pool settings for better performance
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    // Connect explicitly (optional, but can help with cold starts)
    prisma.$connect();
  }

  return prisma;
};

// For serverless functions, ensure proper cleanup
if (process.env.NODE_ENV === 'production') {
  process.on('beforeExit', async () => {
    await prisma?.$disconnect();
  });
}

module.exports = getPrismaClient;