import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { isMemoryEnabled, memoryAdd } from '../lib/supermemory.js';

export const memoryAddTool = tool(
  'memory_add',
  'Store an insight or finding in long-term memory for future runs. Use this to remember important patterns, price trends, or analysis conclusions.',
  {
    content: z.string().describe('The insight or finding to store'),
    run_id: z.string().describe('Current run ID'),
    agent_name: z
      .enum(['webops', 'dsa'])
      .describe('Which agent is storing the memory'),
    step_name: z.string().describe('Pipeline step name (e.g. "analysis", "collection")'),
    retailer_ids: z
      .array(z.string())
      .optional()
      .describe('Optional retailer UUIDs to tag the memory with'),
    custom_id: z
      .string()
      .optional()
      .describe('Optional custom document ID for deduplication'),
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

    memoryAdd({
      runId: args.run_id,
      agentName: args.agent_name,
      stepName: args.step_name,
      content: args.content,
      retailerIds: args.retailer_ids,
      customId: args.custom_id,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ success: true }),
        },
      ],
    };
  },
  { annotations: { readOnlyHint: false } }
);
