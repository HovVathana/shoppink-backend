const compression = require('compression');

// Simple performance monitoring middleware (logging only, no header modifications)
const performanceLogger = () => {
  return (req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      // Log slow requests
      if (duration > 2000) { // 2 seconds
        console.warn(`[SLOW REQUEST] ${duration}ms - ${req.method} ${req.path}`, {
          query: Object.keys(req.query).length > 0 ? req.query : undefined,
          params: Object.keys(req.params).length > 0 ? req.params : undefined,
        });
      }
      
      // Log performance for all requests in development
      if (process.env.NODE_ENV === 'development' && duration > 500) {
        console.log(`[PERFORMANCE] ${duration}ms - ${req.method} ${req.path}`);
      }
    });
    
    next();
  };
};

// Request timeout middleware
const requestTimeout = (timeoutMs = 30000) => {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.error(`Request timeout: ${req.method} ${req.path}`);
        res.status(408).json({
          message: 'Request timeout',
          timeout: timeoutMs,
        });
      }
    }, timeoutMs);
    
    res.on('finish', () => {
      clearTimeout(timeout);
    });
    
    next();
  };
};

// Compression middleware with custom configuration
const setupCompression = () => {
  return compression({
    filter: (req, res) => {
      // Don't compress if client doesn't support it
      if (req.headers['x-no-compression']) {
        return false;
      }
      
      // Always compress JSON responses
      return compression.filter(req, res);
    },
    threshold: 1024, // Only compress if response > 1KB
    level: 6, // Balanced compression level
    memLevel: 8,
  });
};

module.exports = {
  performanceLogger,
  requestTimeout,
  setupCompression,
};