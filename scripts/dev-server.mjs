/**
 * Local development API server.
 *
 * In production, the handlers in /api run as Vercel serverless functions:
 * Vercel parses the JSON request body into `req.body` for us and gives us
 * `res.status(...).json(...)`. This tiny node:http server reproduces just
 * enough of that surface to run the *same* handler files locally, so what
 * you test in development is what gets deployed.
 *
 * It also loads a project-root `.env` file (if present) before importing
 * the handlers, mirroring how Vercel injects environment variables.
 *
 * Usage:  node scripts/dev-server.mjs   (or `npm run dev:api`)
 * Port:   API_PORT env var, default 8787. Vite proxies /api here.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- minimal .env loader (only sets variables that aren't already set) ---
const envPath = join(projectRoot, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const ROUTES = {
  '/api/extract': 'api/extract.js',
  '/api/summarise': 'api/summarise.js',
  '/api/ask': 'api/ask.js',
  '/api/health': 'api/health.js',
};

const handlerCache = new Map();
async function loadHandler(routePath) {
  if (!handlerCache.has(routePath)) {
    const moduleUrl = pathToFileURL(join(projectRoot, ROUTES[routePath])).href;
    const mod = await import(moduleUrl);
    handlerCache.set(routePath, mod.default);
  }
  return handlerCache.get(routePath);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const routePath = pathname.replace(/\/$/, '');

  if (!ROUTES[routePath]) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No API route for ${pathname}` } }));
    return;
  }

  // --- Vercel-compatible request/response surface -------------------------
  const rawBody = await readBody(req);
  req.body = {};
  if (rawBody) {
    try {
      req.body = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'BAD_JSON', message: 'Request body must be valid JSON.' } }));
      return;
    }
  }
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return res;
  };
  // -------------------------------------------------------------------------

  try {
    const handler = await loadHandler(routePath);
    await handler(req, res);
  } catch (err) {
    console.error('[dev-server] handler crashed:', err);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Dev server error.' } }));
    }
  }
});

const port = Number(process.env.API_PORT || 8787);
server.listen(port, () => {
  console.log(`[dev-server] API listening on http://localhost:${port}`);
});
