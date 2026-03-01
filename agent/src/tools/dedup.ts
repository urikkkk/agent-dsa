import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { normalizeUrl, extractRetailerProductId } from '../lib/normalize.js';
import { getSupabase } from '../lib/supabase.js';

// --- Pure dedup logic (reusable) ---

interface DedupCandidate {
  rank: number;
  title: string;
  url: string;
  price?: number;
  is_sponsored?: boolean;
  retailer_product_id?: string;
  badge?: string;
  snippet_price?: number;
  raw_payload?: Record<string, unknown>;
  [key: string]: unknown;
}

function deduplicateCandidates(
  candidates: DedupCandidate[],
  retailerDomain: string
): DedupCandidate[] {
  const seen = new Set<string>();
  const unique: DedupCandidate[] = [];

  for (const candidate of candidates) {
    const rpid =
      candidate.retailer_product_id ||
      extractRetailerProductId(candidate.url, retailerDomain);
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

  unique.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.is_sponsored && !b.is_sponsored) return 1;
    if (!a.is_sponsored && b.is_sponsored) return -1;
    return 0;
  });

  return unique;
}

// --- Original dedup tool (kept as fallback) ---

export const dedupTool = tool(
  'dedup_candidates',
  'Deduplicate SERP candidates by URL or retailer product ID. Returns unique candidates sorted by rank. Prefer dedup_and_write_serp_candidates which also persists results.',
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
    const unique = deduplicateCandidates(args.candidates, args.retailer_domain);

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

// --- Combined dedup + write tool (saves a turn) ---

export const dedupAndWriteSerpCandidatesTool = tool(
  'dedup_and_write_serp_candidates',
  'Deduplicate SERP candidates and write them to Supabase in one call. Combines dedup_candidates + write_serp_candidates. Returns unique candidates and DB insert count.',
  {
    run_id: z.string(),
    retailer_id: z.string(),
    retailer_domain: z.string().describe('Retailer domain for dedup ID extraction'),
    candidates: z.array(
      z.object({
        rank: z.number(),
        title: z.string(),
        url: z.string(),
        price: z.number().optional(),
        is_sponsored: z.boolean().optional(),
        retailer_product_id: z.string().optional(),
        badge: z.string().optional(),
        snippet_price: z.number().optional(),
        raw_payload: z.record(z.string(), z.unknown()).optional(),
      })
    ),
  },
  async (args) => {
    const unique = deduplicateCandidates(args.candidates, args.retailer_domain);

    const db = getSupabase();
    const rows = unique.map((c) => ({
      run_id: args.run_id,
      retailer_id: args.retailer_id,
      rank: c.rank,
      title: c.title,
      is_sponsored: c.is_sponsored || false,
      snippet_price: c.snippet_price ?? c.price,
      badge: c.badge,
      pdp_url: c.url,
      retailer_product_id: c.retailer_product_id,
      raw_payload: c.raw_payload,
    }));

    const { data, error } = await db
      .from('serp_candidates')
      .insert(rows)
      .select('id');

    if (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: error.message,
              original_count: args.candidates.length,
              unique_count: unique.length,
              candidates: unique,
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
            original_count: args.candidates.length,
            unique_count: unique.length,
            removed: args.candidates.length - unique.length,
            inserted_count: data.length,
            candidates: unique,
          }),
        },
      ],
    };
  }
);
