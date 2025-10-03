// Database configuration optimized for Railway deployment
const getDatabaseConfig = () => {
  const baseConfig = {
    // Connection optimization for serverless/Railway
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    errorFormat: 'minimal',
  };

  // Production optimizations for Railway
  if (process.env.NODE_ENV === 'production') {
    return {
      ...baseConfig,
      log: ['error', 'warn'],
      __internal: {
        engine: {
          connectTimeout: 6000,    // 6 seconds - Railway optimized
          queryTimeout: 10000,     // 10 seconds - prevent timeouts
          pool: {
            connectionLimit: 20,   // Railway connection limit
            acquireTimeoutMillis: 5000,
            createTimeoutMillis: 5000,
            destroyTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
          },
        },
      },
    };
  }

  // Development optimizations
  return {
    ...baseConfig,
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'info' },
    ],
    __internal: {
      engine: {
        connectTimeout: 8000,
        queryTimeout: 15000,
        pool: {
          connectionLimit: 10,
          acquireTimeoutMillis: 3000,
          createTimeoutMillis: 3000,
          destroyTimeoutMillis: 3000,
          idleTimeoutMillis: 15000,
          reapIntervalMillis: 1000,
        },
      },
    },
  };
};

module.exports = {
  getDatabaseConfig,
};