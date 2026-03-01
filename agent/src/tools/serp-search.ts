import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry } from '../lib/retry.js';
import { parseSerpResults } from '../lib/parsers.js';
import { getSupabase } from '../lib/supabase.js';

export const serpSearchTool = tool(
  'serp_search',
  'Search a retailer SERP using a Nimble WSA template. Returns ranked product results with prices, titles, and URLs. Use this as the primary way to find products at a specific retailer.',
  {
    template_id: z.number().describe('Nimble WSA template ID for the retailer SERP agent'),
    query: z.string().describe('Search query (e.g., "Cheerios cereal")'),
    zip_code: z.string().optional().describe('ZIP code for location-specific results'),
    num_results: z.number().optional().default(30).describe('Number of results to fetch'),
    run_id: z.string().optional().describe('Run ID for logging'),
    retailer_id: z.string().optional().describe('Retailer UUID for logging'),
  },
  async (args) => {
    const nimble = getNimbleClient();
    const db = getSupabase();
    const startTime = Date.now();

    // Log the request
    let requestId: string | undefined;
    if (args.run_id) {
      const { data } = await db
        .from('nimble_requests')
        .insert({
          run_id: args.run_id,
          retailer_id: args.retailer_id,
          agent_template_id: args.template_id,
          collection_tier: 'wsa',
          request_payload: {
            template_id: args.template_id,
            query: args.query,
            zip_code: args.zip_code,
            num_results: args.num_results,
          },
          keyword: args.query,
          location_context: args.zip_code ? { zip_code: args.zip_code } : null,
        })
        .select('id')
        .single();
      requestId = data?.id;
    }

    const result = await withRetry(
      () =>
        nimble.runSearchAgent({
          template_id: args.template_id,
          query: args.query,
          zip_code: args.zip_code,
          num_results: args.num_results,
        }),
      { maxAttempts: 3 }
    );

    const latencyMs = Date.now() - startTime;

    if (!result.success) {
      // Log failure
      if (requestId) {
        await db.from('nimble_responses').insert({
          nimble_request_id: requestId,
          http_status: 0,
          latency_ms: latencyMs,
          parsing_summary: { error: result.errors },
        });
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `SERP search failed after ${result.attempts} attempts`,
              errors: result.errors,
            }),
          },
        ],
      };
    }

    const parsed = parseSerpResults(
      (result.data as unknown as Record<string, unknown>)?.data ?? result.data
    );

    // Log response
    if (requestId) {
      const payload = JSON.stringify(result.data);
      await db.from('nimble_responses').insert({
        nimble_request_id: requestId,
        raw_payload: result.data as unknown as Record<string, unknown>,
        payload_size_bytes: payload.length,
        parsing_summary: { result_count: parsed.length },
        http_status: 200,
        latency_ms: latencyMs,
      });
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            result_count: parsed.length,
            results: parsed,
            query: args.query,
            template_id: args.template_id,
          }),
        },
      ],
    };
  }
);
