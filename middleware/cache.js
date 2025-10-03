const cache = new Map();
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Periodically clean up expired cache entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > value.ttl * 1000) {
      cache.delete(key);
    }
  }
}, CACHE_CLEANUP_INTERVAL);

/**
 * Simple in-memory cache middleware
 * @param {number} duration - Cache duration in seconds (default: 300 = 5 minutes)
 * @param {function} keyGenerator - Optional custom key generator function
 */
const cacheMiddleware = (duration = 300, keyGenerator = null) => {
  return (req, res, next) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const key = keyGenerator 
      ? keyGenerator(req) 
      : `${req.method}:${req.originalUrl}:${JSON.stringify(req.query)}`;
    
    // Check if we have a valid cached response
    const cachedResponse = cache.get(key);
    if (cachedResponse && Date.now() - cachedResponse.timestamp < duration * 1000) {
      console.log(`Cache HIT: ${key}`);
      res.setHeader('X-Cache', 'HIT');
      return res.json(cachedResponse.data);
    }

    // Cache miss - intercept the response to cache it
    console.log(`Cache MISS: ${key}`);
    res.setHeader('X-Cache', 'MISS');
    
    const originalJson = res.json;
    res.json = function(data) {
      // Only cache successful responses (status 2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, { 
          data, 
          timestamp: Date.now(),
          ttl: duration 
        });
        console.log(`Cached response: ${key} (TTL: ${duration}s)`);
      }
      return originalJson.call(this, data);
    };
    
    next();
  };
};

/**
 * Clear cache for specific pattern or all cache
 * @param {string} pattern - Optional pattern to match keys (uses includes())
 */
const clearCache = (pattern = null) => {
  if (!pattern) {
    cache.clear();
    console.log('All cache cleared');
    return;
  }
  
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
  console.log(`Cache cleared for pattern: ${pattern}`);
};

/**
 * Get cache statistics
 */
const getCacheStats = () => {
  const now = Date.now();
  const stats = {
    totalEntries: cache.size,
    activeEntries: 0,
    expiredEntries: 0,
    entries: []
  };
  
  for (const [key, value] of cache.entries()) {
    const isExpired = now - value.timestamp > value.ttl * 1000;
    if (isExpired) {
      stats.expiredEntries++;
    } else {
      stats.activeEntries++;
    }
    
    stats.entries.push({
      key,
      age: Math.round((now - value.timestamp) / 1000),
      ttl: value.ttl,
      expired: isExpired
    });
  }
  
  return stats;
};

module.exports = {
  cacheMiddleware,
  clearCache,
  getCacheStats
};