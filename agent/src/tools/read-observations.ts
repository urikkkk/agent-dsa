import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';

export const readObservationsTool = tool(
  'read_observations',
  'Read observations written by the collection phase for this run. Returns price, availability, validation status, and quality scores. Optionally filter by retailer.',
  {
    run_id: z.string().describe('Run ID to read observations for'),
    retailer_id: z.string().optional().describe('Optional retailer UUID to filter by'),
  },
  async (args) => {
    const db = getSupabase();

    let q = db
      .from('observations')
      .select('*')
      .eq('run_id', args.run_id)
      .order('created_at', { ascending: true });

    if (args.retailer_id) {
      q = q.eq('retailer_id', args.retailer_id);
    }

    const { data, error } = await q;

    if (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: error.message }),
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
            count: data?.length ?? 0,
            observations: data ?? [],
          }),
        },
      ],
    };
  }
);
