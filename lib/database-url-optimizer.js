// Database URL optimization for Railway PostgreSQL and Vercel deployment

const optimizeDatabaseUrl = (originalUrl) => {
  if (!originalUrl) {
    throw new Error('DATABASE_URL is not defined');
  }

  // Check if we're in Vercel environment
  const isVercel = !!process.env.VERCEL;
  
  // Parse the URL to modify connection parameters
  const url = new URL(originalUrl);
  
  // Add connection pooling parameters for better performance
  const params = new URLSearchParams(url.search);
  
  if (isVercel) {
    // Vercel serverless optimizations
    params.set('connection_limit', '1');        // Single connection per function instance
    params.set('pool_timeout', '5');           // 5 seconds pool timeout
    params.set('connect_timeout', '3');        // 3 seconds connection timeout
    params.set('schema', 'public');            // Default schema
    params.set('sslmode', 'require');          // Force SSL for security
  } else {
    // Railway/local development optimizations
    params.set('connection_limit', '10');       // Multiple connections for local dev
    params.set('pool_timeout', '10');          // 10 seconds pool timeout
    params.set('connect_timeout', '5');        // 5 seconds connection timeout
    params.set('schema', 'public');            // Default schema
    
    // Only add SSL for production (Railway auto-detects)
    if (process.env.NODE_ENV === 'production') {
      params.set('sslmode', 'require');
    }
  }
  
  // Reconstruct the URL with optimized parameters
  url.search = params.toString();
  
  const optimizedUrl = url.toString();
  
  console.log(`Database URL optimized for ${isVercel ? 'Vercel' : 'Railway/Local'}:`);
  console.log(`- Connection limit: ${params.get('connection_limit')}`);
  console.log(`- Pool timeout: ${params.get('pool_timeout')}s`);
  console.log(`- Connect timeout: ${params.get('connect_timeout')}s`);
  
  return optimizedUrl;
};

// Test database connection performance
const testConnectionPerformance = async (prisma) => {
  const startTime = Date.now();
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    const duration = Date.now() - startTime;
    
    console.log(`✅ Database connection test: ${duration}ms`);
    
    if (duration > 1000) {
      console.warn(`⚠️  Slow database connection detected (${duration}ms). Consider optimizing your DATABASE_URL or Railway region.`);
    }
    
    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Database connection failed after ${duration}ms:`, error.message);
    return { success: false, duration, error: error.message };
  }
};

module.exports = {
  optimizeDatabaseUrl,
  testConnectionPerformance,
};