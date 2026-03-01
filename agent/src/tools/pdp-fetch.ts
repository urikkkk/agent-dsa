import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry } from '../lib/retry.js';
import { parsePdpResult, pdpToProduct } from '../lib/parsers.js';
import { getSupabase } from '../lib/supabase.js';

export const pdpFetchTool = tool(
  'pdp_fetch',
  'Fetch a product detail page (PDP) using a Nimble WSA template. Returns detailed product info: price, size, availability, rating. Use this after getting URLs from SERP search.',
  {
    template_id: z.number().describe('Nimble WSA template ID for the retailer PDP agent'),
    url: z.string().describe('Product URL to fetch'),
    zip_code: z.string().optional().describe('ZIP code for location-specific pricing'),
    run_id: z.string().optional().describe('Run ID for logging'),
    retailer_id: z.string().optional().describe('Retailer UUID for logging'),
  },
  async (args) => {
    const nimble = getNimbleClient();
    const db = getSupabase();
    const startTime = Date.now();

    // Log request
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
            url: args.url,
            zip_code: args.zip_code,
          },
        })
        .select('id')
        .single();
      requestId = data?.id;
    }

    const result = await withRetry(
      () =>
        nimble.runPdpAgent({
          template_id: args.template_id,
          url: args.url,
          zip_code: args.zip_code,
        }),
      { maxAttempts: 3 }
    );

    const latencyMs = Date.now() - startTime;

    if (!result.success) {
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
              error: `PDP fetch failed after ${result.attempts} attempts`,
              errors: result.errors,
            }),
          },
        ],
      };
    }

    const rawData = (result.data as unknown as Record<string, unknown>)?.data ?? result.data;
    const pdp = parsePdpResult(rawData);

    // Log response
    if (requestId) {
      const payload = JSON.stringify(result.data);
      await db.from('nimble_responses').insert({
        nimble_request_id: requestId,
        raw_payload: result.data as unknown as Record<string, unknown>,
        payload_size_bytes: payload.length,
        parsing_summary: {
          has_price: pdp?.price != null && pdp.price > 0,
          has_size: !!pdp?.size_raw,
          in_stock: pdp?.in_stock,
        },
        http_status: 200,
        latency_ms: latencyMs,
      });
    }

    if (!pdp) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: 'Failed to parse PDP data',
              raw: rawData,
            }),
          },
        ],
      };
    }

    const product = pdpToProduct(pdp, args.url);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            product,
            raw_pdp: pdp,
          }),
        },
      ],
    };
  }
);
