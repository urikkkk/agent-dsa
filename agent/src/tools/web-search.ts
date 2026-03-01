import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry } from '../lib/retry.js';
import { getSupabase } from '../lib/supabase.js';

export const webSearchFallbackTool = tool(
  'web_search_fallback',
  'Tier 2 fallback: Search the web via Nimble Search API. Use when no WSA template exists for a retailer, or when WSA SERP search fails. Supports focus modes: general, shopping, news. Returns structured search results with product data.',
  {
    query: z.string().describe('Search query (e.g., "Cheerios price walmart.com")'),
    focus: z
      .enum(['general', 'shopping', 'news'])
      .optional()
      .default('shopping')
      .describe('Search focus mode. "shopping" uses WSA-based AI-powered extraction.'),
    max_results: z.number().optional().default(10),
    include_domains: z
      .array(z.string())
      .optional()
      .describe('Restrict results to these domains'),
    deep_search: z
      .boolean()
      .optional()
      .default(false)
      .describe('Enable deep content extraction (slower but more detailed)'),
    run_id: z.string().optional(),
    retailer_id: z.string().optional(),
  },
  async (args) => {
    const nimble = getNimbleClient();
    const db = getSupabase();
    const startTime = Date.now();

    let requestId: string | undefined;
    if (args.run_id) {
      const { data } = await db
        .from('nimble_requests')
        .insert({
          run_id: args.run_id,
          retailer_id: args.retailer_id,
          collection_tier: 'search_extract',
          request_payload: {
            query: args.query,
            focus: args.focus,
            max_results: args.max_results,
            include_domains: args.include_domains,
          },
          keyword: args.query,
        })
        .select('id')
        .single();
      requestId = data?.id;
    }

    // Log fallback event
    if (args.run_id) {
      await db.from('fallback_events').insert({
        run_id: args.run_id,
        retailer_id: args.retailer_id,
        keyword: args.query,
        from_tier: 'wsa',
        to_tier: 'search_extract',
        trigger_reason: 'no_wsa_template_or_wsa_failure',
      });
    }

    const result = await withRetry(
      () =>
        nimble.webSearch({
          query: args.query,
          focus: args.focus,
          max_results: args.max_results,
          include_domains: args.include_domains,
          deep_search: args.deep_search,
        }),
      { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000 }
    );

    const latencyMs = Date.now() - startTime;

    if (requestId) {
      await db.from('nimble_responses').insert({
        nimble_request_id: requestId,
        raw_payload: result.success
          ? { total_results: result.data?.total_results, request_id: result.data?.request_id }
          : null,
        http_status: result.success ? 200 : 0,
        latency_ms: latencyMs,
        parsing_summary: result.success
          ? { source: 'web_search', result_count: result.data?.total_results }
          : { error: result.errors },
      });
    }

    if (!result.success) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Web search failed after ${result.attempts} attempts`,
              errors: result.errors,
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
            total_results: result.data?.total_results,
            results: result.data?.results,
          }),
        },
      ],
    };
  }
);
