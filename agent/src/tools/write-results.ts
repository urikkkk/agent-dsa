import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';

export const writeObservationTool = tool(
  'write_observation',
  'Write a validated observation (price/availability/product data) to Supabase. Call validate_observation first to get a quality score. This is the primary way to record data collected from retailers.',
  {
    run_id: z.string().describe('Run ID'),
    retailer_id: z.string().describe('Retailer UUID'),
    location_id: z.string().describe('Location UUID'),
    product_id: z.string().optional().describe('Matched product UUID'),
    product_match_id: z.string().optional(),
    shelf_price: z.number().optional(),
    promo_price: z.number().optional(),
    unit_price: z.number().optional(),
    size_oz: z.number().optional(),
    size_raw: z.string().optional(),
    pack_count: z.number().optional().default(1),
    in_stock: z.boolean().optional(),
    rating: z.number().optional(),
    review_count: z.number().optional(),
    serp_rank: z.number().optional(),
    confidence: z.number().optional(),
    source_url: z.string().optional(),
    collection_method: z.enum(['website_search_agent', 'nimble_web_tools']).optional(),
    collection_tier: z.enum(['wsa', 'search_extract', 'generic_llm']).optional(),
    zip_used: z.string().optional(),
    validation_status: z.enum(['pass', 'warn', 'fail']).optional(),
    validation_reasons: z.array(z.string()).optional().default([]),
    quality_score: z.number().optional(),
    raw_payload: z.record(z.string(), z.unknown()).optional(),
  },
  async (args) => {
    const db = getSupabase();

    const { data, error } = await db
      .from('observations')
      .insert({
        run_id: args.run_id,
        retailer_id: args.retailer_id,
        location_id: args.location_id,
        product_id: args.product_id,
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
        validation_status: args.validation_status,
        validation_reasons: args.validation_reasons,
        quality_score: args.quality_score,
        raw_payload: args.raw_payload,
      })
      .select('id')
      .single();

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
            observation_id: data.id,
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

    const { data, error } = await db
      .from('serp_candidates')
      .insert(rows)
      .select('id');

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

    const { data, error } = await db
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
      .single();

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

    // Update run status to completed
    await db
      .from('runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.run_id);

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
