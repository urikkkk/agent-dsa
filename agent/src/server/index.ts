import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { Router } from './router.js';
import { handleStartRun } from './handlers/start-run.js';
import { handleStreamRun } from './handlers/stream-run.js';
import { handleRunAction } from './handlers/run-action.js';
import { handleMemoryDebug } from './handlers/memory-debug.js';

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function buildServer(): Server {
  const router = new Router();

  // Health check
  router.add('GET', '/health', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  // API routes
  router.add('POST', '/runs', handleStartRun);
  router.add('GET', '/runs/:runId/stream', handleStreamRun);
  router.add('POST', '/runs/:runId/action', handleRunAction);
  router.add('GET', '/memory/debug', handleMemoryDebug);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    setCors(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    router.handle(req, res).catch((err) => {
      console.error('[server] Unhandled error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  return server;
}
