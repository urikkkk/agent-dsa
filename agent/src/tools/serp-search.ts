import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry } from '../lib/retry.js';
import { parseSerpResults } from '../lib/parsers.js';
import { getSupabase } from '../lib/supabase.js';

export const serpSearchTool = tool(
  'serp_search',
  'Search a retailer SERP using a Nimble WSA agent. Returns ranked product results with prices, titles, and URLs. Use this as the primary way to find products at a specific retailer. The agent_name should match the retailer (e.g., "amazon_serp", "walmart_serp", "target_serp", "kroger_serp").',
  {
    agent_name: z.string().describe('Nimble WSA agent name for the retailer SERP (e.g., "amazon_serp", "walmart_serp")'),
    keyword: z.string().describe('Search keyword (e.g., "Cheerios cereal")'),
    zip_code: z.string().optional().describe('ZIP code for location-specific results'),
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
          collection_tier: 'wsa',
          request_payload: {
            agent_name: args.agent_name,
            keyword: args.keyword,
            zip_code: args.zip_code,
          },
          keyword: args.keyword,
          location_context: args.zip_code ? { zip_code: args.zip_code } : null,
        })
        .select('id')
        .single();
      requestId = data?.id;
    }

    const result = await withRetry(
      () =>
        nimble.runSearchAgent({
          agent_name: args.agent_name,
          keyword: args.keyword,
          zip_code: args.zip_code,
        }),
      { maxAttempts: 2, baseDelayMs: 3000, maxDelayMs: 15000 }
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

    // The WSA response has data.parsed_items (array of structured items)
    const responseData = result.data as unknown as Record<string, unknown>;
    const rawData = responseData?.data as Record<string, unknown>;
    const parsedItems = (rawData?.parsed_items as unknown[]) || [];

    const parsed = parseSerpResults(parsedItems);

    // Log response
    if (requestId) {
      await db.from('nimble_responses').insert({
        nimble_request_id: requestId,
        raw_payload: { task_id: responseData?.task_id, url: responseData?.url, result_count: parsed.length },
        payload_size_bytes: JSON.stringify(responseData).length,
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
            keyword: args.keyword,
            agent_name: args.agent_name,
            source_url: responseData?.url,
          }),
        },
      ],
    };
  }
);
