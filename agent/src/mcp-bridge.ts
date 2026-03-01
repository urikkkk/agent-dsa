import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.AGENT_DSA_URL ?? 'http://localhost:3001';

const server = new McpServer({
  name: 'agent-dsa',
  version: '0.1.0',
});

// ── start_run ──────────────────────────────────────────────────────────
server.tool(
  'start_run',
  'Start a new DSA research run. Returns a run_id that you can pass to get_run_result to wait for the answer.',
  {
    question_text: z.string().describe('The question to research'),
    location_id: z.string().optional().describe('Optional location ID for geo-specific queries'),
    retailer_ids: z.array(z.string()).optional().describe('Optional list of retailer IDs to scope the search'),
    parameters: z.record(z.string(), z.unknown()).optional().describe('Optional extra parameters for the run'),
  },
  async ({ question_text, location_id, retailer_ids, parameters }) => {
    const body: Record<string, unknown> = { question_text };
    if (location_id) body.location_id = location_id;
    if (retailer_ids) body.retailer_ids = retailer_ids;
    if (parameters) body.parameters = parameters;

    const res = await fetch(`${BASE_URL}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { content: [{ type: 'text' as const, text: `Error ${res.status}: ${text}` }], isError: true };
    }

    const data = await res.json();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    };
  },
);

// ── get_run_result ─────────────────────────────────────────────────────
server.tool(
  'get_run_result',
  'Wait for a run to complete and return the full result. Blocks until the run finishes (up to 10 minutes).',
  {
    run_id: z.string().describe('The run ID returned by start_run'),
  },
  async ({ run_id }) => {
    const TIMEOUT_MS = 10 * 60 * 1000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE_URL}/runs/${run_id}/stream`, {
        signal: ac.signal,
        headers: { Accept: 'text/event-stream' },
      });

      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: 'text' as const, text: `Error ${res.status}: ${text}` }], isError: true };
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.startsWith(': ')) continue; // heartbeat comment

          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data: ') && currentEvent === 'run_complete') {
            const payload = line.slice(6);
            reader.cancel();
            return {
              content: [{ type: 'text' as const, text: payload }],
            };
          }

          if (line === '') {
            // End of SSE message block — reset event for next message
            currentEvent = '';
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: 'Stream ended without a run_complete event' }],
        isError: true,
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { content: [{ type: 'text' as const, text: 'Timed out waiting for run to complete (10 min)' }], isError: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `SSE error: ${msg}` }], isError: true };
    } finally {
      clearTimeout(timer);
    }
  },
);

// ── run_action ─────────────────────────────────────────────────────────
server.tool(
  'run_action',
  'Execute a follow-up action on a completed run (show_debug, retry_failed, or rerun_with_location).',
  {
    run_id: z.string().describe('The run ID to act on'),
    action: z.enum(['show_debug', 'retry_failed', 'rerun_with_location']).describe('The action to perform'),
    payload: z.record(z.string(), z.unknown()).optional().describe('Optional action-specific payload (e.g. { location_id } for rerun_with_location)'),
  },
  async ({ run_id, action, payload }) => {
    const body: Record<string, unknown> = { action };
    if (payload) body.payload = payload;

    const res = await fetch(`${BASE_URL}/runs/${run_id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { content: [{ type: 'text' as const, text: `Error ${res.status}: ${text}` }], isError: true };
    }

    const data = await res.json();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    };
  },
);

// ── Start ──────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
