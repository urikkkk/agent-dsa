import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry } from '../lib/retry.js';
import { isCircuitOpen } from '../lib/retry.js';
import { extractSerpItems, parseSerpResults } from '../lib/parsers.js';
import { getSupabase, withTimeout } from '../lib/supabase.js';
import { generateTaskId, getAttemptNumber, emitLedgerEvent } from '../lib/ledger.js';

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

    // ── Ledger: started event + circuit breaker ──
    const taskId = generateTaskId(args.run_id ?? '', args.retailer_id ?? '', 'serp_search', args.keyword, args.zip_code);
    const attempt = await getAttemptNumber(taskId);

    const cbKey = `${args.retailer_id}:serp_search`;
    if (isCircuitOpen(cbKey)) {
      void emitLedgerEvent({
        run_id: args.run_id ?? '',
        event_type: 'task',
        agent_name: 'webops',
        step_name: 'collection',
        task_id: taskId,
        attempt,
        status: 'skipped',
        tool_name: 'serp_search',
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
      tool_name: 'serp_search',
      provenance: { keyword: args.keyword, zip_code: args.zip_code },
    });

    // Log the request
    let requestId: string | undefined;
    if (args.run_id) {
      try {
        const { data } = await withTimeout(
          db
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
            .single(),
          10_000,
          'serp_search: nimble_requests insert'
        );
        requestId = data?.id;
      } catch (e) {
        console.warn('[serp_search] nimble_requests insert failed:', e instanceof Error ? e.message : e);
      }
    }

    console.log(`[serp_search] calling Nimble: agent=${args.agent_name} keyword="${args.keyword}" zip=${args.zip_code}`);
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
    console.log(`[serp_search] Nimble result: success=${result.success} attempts=${result.attempts} latency=${latencyMs}ms`);

    if (!result.success) {
      // Log failure
      if (requestId) {
        try {
          await withTimeout(
            db.from('nimble_responses').insert({
              nimble_request_id: requestId,
              http_status: 0,
              latency_ms: latencyMs,
              parsing_summary: { error: result.errors },
            }),
            10_000,
            'serp_search: nimble_responses failure insert'
          );
        } catch (e) {
          console.warn('[serp_search] nimble_responses failure insert failed:', e instanceof Error ? e.message : e);
        }
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

    // Extract items from WSA response using shared utility
    // WSA response shape: { url, task_id, status, data: { parsing: [...] } }
    const responseData = result.data as unknown as Record<string, unknown>;
    const rawItems = extractSerpItems(responseData);
    const parsed = parseSerpResults(rawItems);

    // Log response
    if (requestId) {
      try {
        await withTimeout(
          db.from('nimble_responses').insert({
            nimble_request_id: requestId,
            raw_payload: { task_id: responseData?.task_id, url: responseData?.url, result_count: parsed.length },
            payload_size_bytes: JSON.stringify(responseData).length,
            parsing_summary: { result_count: parsed.length },
            http_status: 200,
            latency_ms: latencyMs,
          }),
          10_000,
          'serp_search: nimble_responses success insert'
        );
      } catch (e) {
        console.warn('[serp_search] nimble_responses success insert failed:', e instanceof Error ? e.message : e);
      }
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
