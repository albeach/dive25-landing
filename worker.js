/**
 * DIVE25 Status Worker
 * Checks health of all instances and returns real-time status
 * Deploy with: wrangler deploy worker.js --name dive25-status
 */

const INSTANCES = [
  { id: 'usa', name: 'United States', url: 'https://usa-api.dive25.com/health' },
  { id: 'fra', name: 'France', url: 'https://fra-api.dive25.com/health' },
  { id: 'gbr', name: 'United Kingdom', url: 'https://gbr-api.dive25.com/health' },
  { id: 'deu', name: 'Germany', url: 'https://deu-api.prosecurity.biz/health' },
];

// Cache status for 30 seconds
const CACHE_TTL = 30;

async function checkInstance(instance) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(instance.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'DIVE25-Status-Checker/1.0' }
    });

    clearTimeout(timeout);
    const latency = Date.now() - start;

    if (response.ok) {
      return {
        id: instance.id,
        name: instance.name,
        status: 'online',
        latency,
        statusCode: response.status
      };
    } else {
      return {
        id: instance.id,
        name: instance.name,
        status: 'degraded',
        latency,
        statusCode: response.status
      };
    }
  } catch (error) {
    return {
      id: instance.id,
      name: instance.name,
      status: 'offline',
      latency: null,
      error: error.message
    };
  }
}

async function getStatus() {
  const results = await Promise.all(INSTANCES.map(checkInstance));
  
  const allOnline = results.every(r => r.status === 'online');
  const anyOffline = results.some(r => r.status === 'offline');
  
  return {
    timestamp: new Date().toISOString(),
    overall: anyOffline ? 'degraded' : (allOnline ? 'operational' : 'degraded'),
    instances: results
  };
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Check cache first
    const cache = caches.default;
    const cacheKey = new Request(new URL('/status', request.url).toString());
    
    let response = await cache.match(cacheKey);
    
    if (!response) {
      // Fetch fresh status
      const status = await getStatus();
      
      response = new Response(JSON.stringify(status, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
        }
      });

      // Store in cache
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  }
};

