import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getNimbleClient } from '../lib/nimble-client.js';
import { withRetry } from '../lib/retry.js';
import { getSupabase } from '../lib/supabase.js';

export const urlExtractFallbackTool = tool(
  'url_extract_fallback',
  'Tier 2 fallback: Extract structured content from a URL via Nimble. Use when no PDP WSA template exists, or to extract product data from an arbitrary page. Returns page content as markdown or structured data.',
  {
    url: z.string().describe('URL to extract content from'),
    render: z.boolean().optional().default(false).describe('Render JavaScript before extraction'),
    content_type: z
      .enum(['html', 'markdown', 'text'])
      .optional()
      .default('markdown'),
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
            url: args.url,
            render: args.render,
            content_type: args.content_type,
          },
        })
        .select('id')
        .single();
      requestId = data?.id;
    }

    const result = await withRetry(
      () =>
        nimble.urlExtract({
          url: args.url,
          render: args.render,
          content_type: args.content_type,
        }),
      { maxAttempts: 2 }
    );

    const latencyMs = Date.now() - startTime;

    if (requestId) {
      const payload = result.success ? JSON.stringify(result.data) : '';
      await db.from('nimble_responses').insert({
        nimble_request_id: requestId,
        raw_payload: result.success
          ? (result.data as unknown as Record<string, unknown>)
          : null,
        payload_size_bytes: payload.length,
        http_status: result.success ? 200 : 0,
        latency_ms: latencyMs,
      });
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
            data: result.data,
          }),
        },
      ],
    };
  }
);
