import { config } from 'dotenv';
config({ path: '.env.local' });

// Prevent Claude SDK from attaching to a Claude Code session
delete process.env.CLAUDECODE;

import { buildServer } from './server/index.js';
import { logMemoryStatus } from './lib/supermemory.js';

const PORT = parseInt(process.env.HTTP_PORT ?? '3001', 10);

const server = buildServer();

server.listen(PORT, () => {
  logMemoryStatus();
  console.log(`[serve] agent-dsa HTTP server listening on http://localhost:${PORT}`);
  console.log(`[serve] Health: GET /health`);
  console.log(`[serve] Start run: POST /runs`);
  console.log(`[serve] Stream: GET /runs/:runId/stream`);
  console.log(`[serve] Action: POST /runs/:runId/action`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('\n[serve] Shutting down...');
  server.close(() => {
    console.log('[serve] Server closed');
    process.exit(0);
  });

  // Force exit after 30s
  setTimeout(() => {
    console.error('[serve] Forced shutdown after 30s timeout');
    process.exit(1);
  }, 30_000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
