import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase, withTimeout } from '../lib/supabase.js';
import { runValidationChecks } from './validate.js';

export const writeObservationTool = tool(
  'write_observation',
  'Write an observation (price/availability/product data) to Supabase. Auto-validates before saving — no need to call validate_observation first. Uses upsert to avoid duplicates on (run_id, retailer_id, product_id, location_id).',
  {
    run_id: z.string().describe('Run ID'),
    retailer_id: z.string().describe('Retailer UUID'),
    location_id: z.string().optional().describe('Location UUID (omit for national/online pricing)'),
    product_id: z.string().optional().describe('Matched product UUID'),
    product_match_id: z.string().optional(),
    shelf_price: z.number().optional(),
    promo_price: z.number().optional(),
    unit_price: z.number().optional(),
    size_oz: z.number().optional(),
    size_raw: z.string().optional(),
    pack_count: z.number().optional().default(1),
    in_stock: z.boolean().optional(),
    rating: z.number().min(0).max(5).optional(),
    review_count: z.number().optional(),
    serp_rank: z.number().optional(),
    confidence: z.number().min(0).max(1).optional(),
    source_url: z.string().optional(),
    collection_method: z.enum(['website_search_agent', 'nimble_web_tools']).optional(),
    collection_tier: z.enum(['wsa', 'search_extract', 'generic_llm']).optional(),
    zip_used: z.string().optional(),
    ai_parsed_fields: z.record(z.string(), z.unknown()).optional().describe('AI-extracted structured fields'),
    ai_confidence: z.number().min(0).max(1).optional().describe('AI extraction confidence 0-1'),
    raw_payload: z.record(z.string(), z.unknown()).optional(),
  },
  async (args) => {
    const db = getSupabase();

    // Look up retailer domain for URL validation
    let retailerDomain: string | undefined;
    if (args.retailer_id) {
      const { data: retailer } = await withTimeout(
        db
          .from('retailers')
          .select('domain')
          .eq('id', args.retailer_id)
          .single(),
        15_000,
        'write_observation: retailers lookup'
      );
      retailerDomain = retailer?.domain as string | undefined;
    }

    // Auto-validate (now includes URL domain matching)
    const validation = runValidationChecks({
      shelf_price: args.shelf_price,
      promo_price: args.promo_price,
      unit_price: args.unit_price,
      size_oz: args.size_oz,
      size_raw: args.size_raw,
      in_stock: args.in_stock,
      source_url: args.source_url,
      retailer_domain: retailerDomain,
      rating: args.rating,
      confidence: args.confidence,
    });

    // product_id must be a valid UUID (the column references products.id).
    // The agent often passes retailer-specific IDs (e.g., Amazon ASINs like "B0D248DSKM").
    // Store non-UUID values in ai_parsed_fields and set product_id to null.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let resolvedProductId: string | undefined = args.product_id;
    let retailerProductId: string | undefined;
    if (args.product_id && !UUID_RE.test(args.product_id)) {
      retailerProductId = args.product_id;
      resolvedProductId = undefined;
    }

    const aiParsedFields = {
      ...(args.ai_parsed_fields ?? {}),
      ...(retailerProductId ? { retailer_product_id: retailerProductId } : {}),
    };

    const row = {
      run_id: args.run_id,
      retailer_id: args.retailer_id,
      location_id: args.location_id,
      product_id: resolvedProductId,
      product_match_id: args.product_match_id,
      shelf_price: args.shelf_price,
      promo_price: args.promo_price,
      unit_price: args.unit_price,
      size_oz: args.size_oz,
      size_raw: args.size_raw,
      pack_count: args.pack_count,
      in_stock: args.in_stock,
      rating: args.rating,
      review_count: args.review_count,
      serp_rank: args.serp_rank,
      confidence: args.confidence,
      source_url: args.source_url,
      collection_method: args.collection_method,
      collection_tier: args.collection_tier,
      zip_used: args.zip_used,
      validation_status: validation.validation_status,
      validation_reasons: validation.reasons,
      quality_score: validation.quality_score,
      ai_parsed_fields: Object.keys(aiParsedFields).length > 0 ? aiParsedFields : undefined,
      ai_confidence: args.ai_confidence,
      raw_payload: args.raw_payload,
    };

    // Plain insert — the partial unique index (WHERE product_id IS NOT NULL) doesn't
    // work with Supabase's upsert, so we use insert and handle duplicates gracefully.
    const { data, error } = await withTimeout(
      db
        .from('observations')
        .insert(row)
        .select('id')
        .single(),
      15_000,
      'write_observation: observations insert'
    );

    if (error) {
      console.error(`[write_observation] insert failed: ${error.message} (${error.code}) | run_id=${args.run_id} retailer_id=${args.retailer_id} product_id=${resolvedProductId ?? 'null'} retailer_pid=${retailerProductId ?? 'none'}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: error.message }),
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
            observation_id: data.id,
            validation: validation,
            ...(retailerProductId ? { note: `Retailer product ID "${retailerProductId}" stored in ai_parsed_fields (not a UUID)` } : {}),
          }),
        },
      ],
    };
  }
);

export const writeSerpCandidatesTool = tool(
  'write_serp_candidates',
  'Write SERP search result candidates to Supabase. Call this after serp_search to persist the ranked results for later analysis.',
  {
    run_id: z.string(),
    retailer_id: z.string(),
    candidates: z.array(
      z.object({
        rank: z.number().optional(),
        title: z.string().optional(),
        is_sponsored: z.boolean().optional().default(false),
        snippet_price: z.number().optional(),
        badge: z.string().optional(),
        pdp_url: z.string().optional(),
        retailer_product_id: z.string().optional(),
        raw_payload: z.record(z.string(), z.unknown()).optional(),
      })
    ),
  },
  async (args) => {
    const db = getSupabase();

    const rows = args.candidates.map((c) => ({
      run_id: args.run_id,
      retailer_id: args.retailer_id,
      rank: c.rank,
      title: c.title,
      is_sponsored: c.is_sponsored,
      snippet_price: c.snippet_price,
      badge: c.badge,
      pdp_url: c.pdp_url,
      retailer_product_id: c.retailer_product_id,
      raw_payload: c.raw_payload,
    }));

    const { data, error } = await withTimeout(
      db
        .from('serp_candidates')
        .insert(rows)
        .select('id'),
      15_000,
      'write_serp_candidates: serp_candidates insert'
    );

    if (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: error.message }),
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
            inserted_count: data.length,
          }),
        },
      ],
    };
  }
);

export const writeAnswerTool = tool(
  'write_answer',
  'Write the final computed answer for a run. This is the end result visible to the user. Include a clear answer_text summarizing findings and structured answer_data with all details.',
  {
    run_id: z.string(),
    question_template_id: z.string().optional(),
    question_text: z.string().describe('The original question asked'),
    answer_text: z
      .string()
      .describe('Human-readable answer summary'),
    answer_data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Structured answer data (prices, comparisons, etc.)'),
    confidence: z.number().optional().describe('Answer confidence 0-1'),
    sources_count: z.number().optional().default(0),
  },
  async (args) => {
    const db = getSupabase();

    const { data, error } = await withTimeout(
      db
        .from('answers')
        .insert({
          run_id: args.run_id,
          question_template_id: args.question_template_id,
          question_text: args.question_text,
          answer_text: args.answer_text,
          answer_data: args.answer_data,
          status: 'ready',
          confidence: args.confidence,
          sources_count: args.sources_count,
        })
        .select('id')
        .single(),
      15_000,
      'write_answer: answers insert'
    );

    if (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: error.message }),
          },
        ],
      };
    }

    // NOTE: Do NOT set run status here — the orchestrator in execute-question.ts
    // handles status transitions after checkCompletionCriteria, step summaries,
    // memory writes, and cost tracking are all finished.

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            answer_id: data.id,
            status: 'ready',
          }),
        },
      ],
    };
  }
);
