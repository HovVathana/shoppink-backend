const compression = require('compression');

// Response size optimization middleware
const optimizeResponse = (options = {}) => {
  const {
    maxItems = 1000,
    compressThreshold = 1024, // 1KB
    removeNullFields = true,
  } = options;

  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = (data) => {
      if (data && typeof data === 'object') {
        let optimizedData = data;
        
        // Limit array sizes for performance
        if (Array.isArray(data)) {
          if (data.length > maxItems) {
            console.warn(`Response array truncated from ${data.length} to ${maxItems} items`);
            optimizedData = data.slice(0, maxItems);
          }
        } else if (data.orders && Array.isArray(data.orders)) {
          if (data.orders.length > maxItems) {
            console.warn(`Orders array truncated from ${data.orders.length} to ${maxItems} items`);
            optimizedData = {
              ...data,
              orders: data.orders.slice(0, maxItems),
            };
          }
        }
        
        // Remove null/undefined fields to reduce payload size
        if (removeNullFields) {
          optimizedData = removeNullValues(optimizedData);
        }
        
        // Add performance headers safely
        const dataSize = JSON.stringify(optimizedData).length;
        
        if (!res.headersSent) {
          try {
            res.setHeader('X-Response-Size', dataSize);
            
            if (dataSize > compressThreshold) {
              res.setHeader('X-Should-Compress', 'true');
            }
          } catch (error) {
            // Silently ignore header setting errors
            console.debug('Could not set response headers:', error.message);
          }
        }
      }
      
      return originalJson(optimizedData || data);
    };
    
    next();
  };
};

// Recursively remove null/undefined values from objects
const removeNullValues = (obj) => {
  if (obj === null || obj === undefined) return undefined;
  
  if (Array.isArray(obj)) {
    return obj.map(removeNullValues).filter(item => item !== undefined);
  }
  
  if (typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeNullValues(value);
      if (cleanedValue !== undefined && cleanedValue !== null) {
        cleaned[key] = cleanedValue;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
  
  return obj;
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

// Simple performance monitoring middleware (logging only)
const performanceMonitor = () => {
  return (req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      // Log slow requests
      if (duration > 2000) { // 2 seconds
        console.warn(`[SLOW REQUEST] ${duration}ms - ${req.method} ${req.path}`, {
          query: req.query,
          params: req.params,
          userAgent: req.get('User-Agent'),
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
  optimizeResponse,
  requestTimeout,
  performanceMonitor,
  setupCompression,
  removeNullValues,
};