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
      // Enhanced logging and performance monitoring
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'error', 'warn'] 
        : ['error'],
      errorFormat: 'minimal',
      // Railway optimizations
      __internal: {
        engine: {
          connectTimeout: 10000, // 10 seconds
          queryTimeout: 15000,   // 15 seconds
        },
      },
    });

    // Add query performance monitoring in development
    if (process.env.NODE_ENV === 'development') {
      prisma.$use(async (params, next) => {
        const before = Date.now();
        const result = await next(params);
        const after = Date.now();
        
        if (after - before > 1000) { // Log slow queries (>1s)
          console.log(`Slow Query (${after - before}ms):`, {
            model: params.model,
            action: params.action,
          });
        }
        
        return result;
      });
    }

    // Connect explicitly for better cold start performance
    prisma.$connect().catch(console.error);
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