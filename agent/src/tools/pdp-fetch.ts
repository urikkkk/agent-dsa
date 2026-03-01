import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry, isCircuitOpen } from '../lib/retry.js';
import { parsePdpResult, pdpToProduct } from '../lib/parsers.js';
import { getSupabase } from '../lib/supabase.js';
import { generateTaskId, getAttemptNumber, emitLedgerEvent } from '../lib/ledger.js';

export const pdpFetchTool = tool(
  'pdp_fetch',
  'Fetch a product detail page (PDP) using a Nimble WSA agent. Returns detailed product info: price, size, availability, rating. Use after getting product IDs from SERP search. The agent_name should match the retailer (e.g., "amazon_pdp", "walmart_pdp").',
  {
    agent_name: z.string().describe('Nimble WSA agent name for the retailer PDP (e.g., "amazon_pdp", "walmart_pdp")'),
    product_id: z.string().describe('Product identifier (ASIN for Amazon, product_id for Walmart, SKU for others)'),
    zip_code: z.string().optional().describe('ZIP code for location-specific pricing'),
    run_id: z.string().optional().describe('Run ID for logging'),
    retailer_id: z.string().optional().describe('Retailer UUID for logging'),
  },
  async (args) => {
    const nimble = getNimbleClient();
    const db = getSupabase();
    const startTime = Date.now();

    // ── Ledger: started event + circuit breaker ──
    const taskId = generateTaskId(args.run_id ?? '', args.retailer_id ?? '', 'pdp_fetch', args.product_id, args.zip_code);
    const attempt = await getAttemptNumber(taskId);

    const cbKey = `${args.retailer_id}:pdp_fetch`;
    if (isCircuitOpen(cbKey)) {
      void emitLedgerEvent({
        run_id: args.run_id ?? '',
        event_type: 'task',
        agent_name: 'webops',
        step_name: 'collection',
        task_id: taskId,
        attempt,
        status: 'skipped',
        tool_name: 'pdp_fetch',
        error: { code: 'CIRCUIT_OPEN', message: `Circuit open for ${cbKey}` },
        next_action_hint: 'skip',
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'circuit_open' }) }] };
    }

    emitLedgerEvent({
      run_id: args.run_id ?? '',
      event_type: 'task',
      agent_name: 'webops',
      step_name: 'collection',
      task_id: taskId,
      attempt,
      status: 'started',
      tool_name: 'pdp_fetch',
      provenance: { product_id: args.product_id, zip_code: args.zip_code },
    });

    // Log request
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
            product_id: args.product_id,
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
          agent_name: args.agent_name,
          product_id: args.product_id,
          zip_code: args.zip_code,
        }),
      { maxAttempts: 2, baseDelayMs: 3000, maxDelayMs: 15000 }
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

    // WSA response has data with parsed fields
    const responseData = result.data as unknown as Record<string, unknown>;
    const rawData = responseData?.data as Record<string, unknown>;
    // PDP agents return parsed_items as an array with one item
    const parsedItems = (rawData?.parsed_items as unknown[]) || [];
    const pdpData = parsedItems.length > 0 ? parsedItems[0] : rawData;

    const pdp = parsePdpResult(pdpData);

    // Log response
    if (requestId) {
      await db.from('nimble_responses').insert({
        nimble_request_id: requestId,
        raw_payload: { task_id: responseData?.task_id, url: responseData?.url },
        payload_size_bytes: JSON.stringify(responseData).length,
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
              raw: pdpData,
            }),
          },
        ],
      };
    }

    const product = pdpToProduct(pdp, String(responseData?.url || ''), args.product_id);

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
