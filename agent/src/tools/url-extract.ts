import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry, isCircuitOpen } from '../lib/retry.js';
import { getSupabase, withTimeout } from '../lib/supabase.js';
import { generateTaskId, getAttemptNumber, emitLedgerEvent } from '../lib/ledger.js';

export const urlExtractFallbackTool = tool(
  'url_extract_fallback',
  'Tier 2 fallback: Extract structured content from a URL via Nimble Extract API. Use when no PDP WSA template exists, or to extract product data from an arbitrary page. Returns page content as markdown or structured data.',
  {
    url: z.string().describe('URL to extract content from'),
    output_format: z
      .enum(['html', 'markdown', 'simplified_html'])
      .optional()
      .default('markdown'),
    render: z.boolean().optional().default(false).describe('Render JavaScript before extraction'),
    run_id: z.string().optional(),
    retailer_id: z.string().optional(),
  },
  async (args) => {
    const nimble = getNimbleClient();
    const db = getSupabase();
    const startTime = Date.now();

    // ── Ledger: started event + circuit breaker ──
    const taskId = generateTaskId(args.run_id ?? '', args.retailer_id ?? '', 'url_extract_fallback', args.url);
    const attempt = await getAttemptNumber(taskId);

    const cbKey = `${args.retailer_id}:url_extract_fallback`;
    if (isCircuitOpen(cbKey)) {
      void emitLedgerEvent({
        run_id: args.run_id ?? '',
        event_type: 'task',
        agent_name: 'webops',
        step_name: 'collection',
        task_id: taskId,
        attempt,
        status: 'skipped',
        tool_name: 'url_extract_fallback',
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
      tool_name: 'url_extract_fallback',
      provenance: { url: args.url, collection_tier: 'search_extract' },
    });

    let requestId: string | undefined;
    if (args.run_id) {
      try {
        const { data } = await withTimeout(
          db
            .from('nimble_requests')
            .insert({
              run_id: args.run_id,
              retailer_id: args.retailer_id,
              collection_tier: 'search_extract',
              request_payload: {
                url: args.url,
                output_format: args.output_format,
                render: args.render,
              },
            })
            .select('id')
            .single(),
          10_000,
          'url_extract: nimble_requests insert'
        );
        requestId = data?.id;
      } catch (e) {
        console.warn('[url_extract] nimble_requests insert failed:', e instanceof Error ? e.message : e);
      }
    }

    const result = await withRetry(
      () =>
        nimble.urlExtract({
          url: args.url,
          output_format: args.output_format,
          render: args.render,
        }),
      { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000 }
    );

    const latencyMs = Date.now() - startTime;

    if (requestId) {
      try {
        const payload = result.success ? JSON.stringify(result.data) : '';
        await withTimeout(
          db.from('nimble_responses').insert({
            nimble_request_id: requestId,
            raw_payload: result.success
              ? { title: result.data?.title, url: result.data?.url }
              : null,
            payload_size_bytes: payload.length,
            http_status: result.success ? 200 : 0,
            latency_ms: latencyMs,
          }),
          10_000,
          'url_extract: nimble_responses insert'
        );
      } catch (e) {
        console.warn('[url_extract] nimble_responses insert failed:', e instanceof Error ? e.message : e);
      }
    }

    if (!result.success) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `URL extraction failed after ${result.attempts} attempts`,
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
            title: result.data?.title,
            url: result.data?.url,
            content: result.data?.content,
          }),
        },
      ],
    };
  }
);
