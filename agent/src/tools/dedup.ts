import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { normalizeUrl, extractRetailerProductId } from '../lib/normalize.js';

export const dedupTool = tool(
  'dedup_candidates',
  'Deduplicate SERP candidates by URL or retailer product ID. Use this after serp_search to remove duplicate listings before fetching PDPs. Returns unique candidates sorted by rank.',
  {
    candidates: z.array(
      z.object({
        rank: z.number(),
        title: z.string(),
        url: z.string(),
        price: z.number().optional(),
        is_sponsored: z.boolean().optional(),
        retailer_product_id: z.string().optional(),
      })
    ),
    retailer_domain: z.string().describe('Retailer domain for ID extraction'),
  },
  async (args) => {
    const seen = new Set<string>();
    const unique: typeof args.candidates = [];

    for (const candidate of args.candidates) {
      // Try retailer product ID first
      const rpid =
        candidate.retailer_product_id ||
        extractRetailerProductId(candidate.url, args.retailer_domain);
      const normalizedUrl = normalizeUrl(candidate.url);
      const key = rpid || normalizedUrl;

      if (!seen.has(key)) {
        seen.add(key);
        unique.push({
          ...candidate,
          retailer_product_id: rpid || candidate.retailer_product_id,
        });
      }
    }

    // Sort by rank (organic before sponsored at same rank)
    unique.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.is_sponsored && !b.is_sponsored) return 1;
      if (!a.is_sponsored && b.is_sponsored) return -1;
      return 0;
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            original_count: args.candidates.length,
            unique_count: unique.length,
            removed: args.candidates.length - unique.length,
            candidates: unique,
          }),
        },
      ],
    };
  }
);
