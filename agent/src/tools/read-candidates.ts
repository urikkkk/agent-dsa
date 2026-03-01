import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';

export const readCandidatesTool = tool(
  'read_candidates',
  'Read SERP candidates written by the collection phase for this run. Returns ranked candidates with titles, prices, sponsored flags, and PDP URLs. Optionally filter by retailer.',
  {
    run_id: z.string().describe('Run ID to read candidates for'),
    retailer_id: z.string().optional().describe('Optional retailer UUID to filter by'),
  },
  async (args) => {
    const db = getSupabase();

    let q = db
      .from('serp_candidates')
      .select('*')
      .eq('run_id', args.run_id)
      .order('rank', { ascending: true });

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
            candidates: data ?? [],
          }),
        },
      ],
    };
  }
);
