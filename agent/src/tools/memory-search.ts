import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { isMemoryEnabled, memorySearch } from '../lib/supermemory.js';

export const memorySearchTool = tool(
  'memory_search',
  'Search long-term memory for prior insights from previous runs. Returns relevant past analyses, answers, and observations.',
  {
    query: z.string().describe('Natural-language search query'),
    run_id: z.string().describe('Current run ID (used for ledger tracking)'),
    retailer_ids: z
      .array(z.string())
      .optional()
      .describe('Optional retailer UUIDs to scope the search'),
    limit: z
      .number()
      .optional()
      .default(5)
      .describe('Max results to return (default 5)'),
  },
  async (args) => {
    if (!isMemoryEnabled()) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, skipped: true, reason: 'memory_disabled' }),
          },
        ],
      };
    }

    const results = await memorySearch({
      runId: args.run_id,
      query: args.query,
      retailerIds: args.retailer_ids,
      limit: args.limit,
      agentName: 'dsa',
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ success: true, results }),
        },
      ],
    };
  }
);
