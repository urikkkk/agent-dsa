import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';

export const readConfigTool = tool(
  'read_config',
  'Read configuration data from Supabase: locations, retailers, keywords, products, question templates, or a specific run. Use this to understand what data is available before planning a workflow.',
  {
    table: z
      .enum([
        'locations',
        'retailers',
        'products',
        'keyword_sets',
        'keyword_set_items',
        'question_templates',
        'nimble_agents',
        'runs',
        'product_matches',
      ])
      .describe('Which table to read from'),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Column filters (e.g., {"is_active": true, "domain": "walmart.com"})'),
    select: z
      .string()
      .optional()
      .default('*')
      .describe('Columns to select (Supabase select syntax)'),
    limit: z.number().optional().default(50),
    id: z.string().optional().describe('Fetch a single record by ID'),
  },
  async (args) => {
    const db = getSupabase();

    // Build and execute query directly to avoid TypeScript reassignment issues
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let error: any;

    if (args.id) {
      const result = await db
        .from(args.table)
        .select(args.select)
        .eq('id', args.id)
        .single();
      data = result.data;
      error = result.error;
    } else {
      let q = db.from(args.table).select(args.select);
      if (args.filters) {
        for (const [col, val] of Object.entries(args.filters)) {
          if (typeof val === 'boolean' || typeof val === 'string' || typeof val === 'number') {
            q = q.eq(col, val);
          }
        }
      }
      const result = await q.limit(args.limit);
      data = result.data;
      error = result.error;
    }

    if (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            table: args.table,
            count: Array.isArray(data) ? data.length : 1,
            data,
          }),
        },
      ],
    };
  }
);
