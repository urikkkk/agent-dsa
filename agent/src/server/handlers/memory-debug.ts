import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import { debugMemory } from '../../lib/supermemory.js';

/**
 * GET /memory/debug?runId=...&retailerId=...&userId=...&query=...
 *
 * Returns structured debug output for Supermemory connectivity and search results.
 */
export async function handleMemoryDebug(
  req: IncomingMessage,
  res: ServerResponse,
  _params: RouteParams
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const runId = url.searchParams.get('runId') ?? undefined;
  const retailerId = url.searchParams.get('retailerId') ?? undefined;
  const userId = url.searchParams.get('userId') ?? undefined;
  const query = url.searchParams.get('query') ?? undefined;

  const result = await debugMemory({ runId, retailerId, userId, query });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result, null, 2));
}
