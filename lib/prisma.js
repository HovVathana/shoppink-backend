const { PrismaClient } = require('@prisma/client');

// Global variable to store the Prisma client instance
let prisma;

// Create or reuse Prisma client for serverless environments
const getPrismaClient = () => {
  if (!prisma) {
    // Optimize database URL for connection performance
    const { optimizeDatabaseUrl } = require('./database-url-optimizer');
    const databaseUrl = optimizeDatabaseUrl(process.env.DATABASE_URL);
    const isVercel = !!process.env.VERCEL;
    
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      // Optimized logging for production
      log: process.env.NODE_ENV === 'development' 
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'error' },
            { emit: 'stdout', level: 'warn' }
          ]
        : ['error'],
      errorFormat: 'minimal',
      // Vercel-specific optimizations
      __internal: {
        engine: {
          // Aggressive timeouts for serverless
          connectTimeout: isVercel ? 3000 : 8000,   // 3s for Vercel, 8s for others
          queryTimeout: isVercel ? 8000 : 12000,    // 8s for Vercel, 12s for others
          // Connection pooling for serverless
          ...(isVercel && {
            pool: {
              acquireTimeoutMillis: 2000,
              createTimeoutMillis: 2000,
              destroyTimeoutMillis: 1000,
              idleTimeoutMillis: 10000, // Close idle connections faster
              reapIntervalMillis: 5000,
              createRetryIntervalMillis: 100,
            },
          }),
        },
      },
    });

    // Enhanced query performance monitoring in development
    if (process.env.NODE_ENV === 'development') {
      // Event-based query logging for better performance analysis
      prisma.$on('query', (e) => {
        if (e.duration > 500) { // Log queries slower than 500ms
          console.log(`[SLOW QUERY] ${e.duration}ms - ${e.query.substring(0, 100)}...`);
        }
      });
      
      // Middleware for request tracking
      prisma.$use(async (params, next) => {
        const before = Date.now();
        const result = await next(params);
        const after = Date.now();
        
        // Log very slow queries (>2s) in production as well for monitoring
        if (after - before > 2000) {
          console.log(`[CRITICAL SLOW QUERY] ${after - before}ms:`, {
            model: params.model,
            action: params.action,
            args: JSON.stringify(params.args).substring(0, 200),
          });
        }
        
        return result;
      });
    } else {
      // Production monitoring for critical slow queries only
      prisma.$use(async (params, next) => {
        const before = Date.now();
        const result = await next(params);
        const after = Date.now();
        
        if (after - before > 5000) { // Log extremely slow queries (>5s) in production
          console.error(`[PRODUCTION SLOW QUERY] ${after - before}ms:`, {
            model: params.model,
            action: params.action,
          });
        }
        
        return result;
      });
    }

    // Serverless-optimized connection handling
    if (isVercel) {
      // For Vercel, don't connect immediately - connect on first use
      console.log('Vercel environment detected - using lazy connection');
    } else {
      // For non-serverless environments, connect immediately
      prisma.$connect()
        .then(() => {
          console.log('Database connected successfully');
        })
        .catch((error) => {
          console.error('Database connection failed:', error);
        });
    }
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