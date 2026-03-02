/**
 * Competitive Cereal Category Sweep
 *
 * Runs 20 keywords across 4 retailers (Walmart, Amazon, Target, Kroger)
 * to map the full cereal aisle in Dallas, TX. Deduplicates results per
 * retailer and writes serp_candidates + observations to Supabase.
 *
 * Usage: npx tsx agent/src/category-sweep.ts
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.local') });
import { getNimbleClient } from './lib/nimble-client.js';
import { extractSerpItems, parseSerpResults } from './lib/parsers.js';
import type { NimbleSerpResult } from '@agent-dsa/shared';
import { deduplicateCandidates, type DedupCandidate } from './tools/dedup.js';
import { withRetry } from './lib/retry.js';
import { getSupabase, withTimeout } from './lib/supabase.js';
import { runValidationChecks } from './tools/validate.js';

// ── Helpers ──────────────────────────────────────────────────────

/** Extract + parse SERP items from a WSA response using the shared utility. */
function extractAndParseSerpItems(response: { data: unknown }): NimbleSerpResult[] {
  const rawItems = extractSerpItems(response);
  return parseSerpResults(rawItems);
}

// ── Keywords ────────────────────────────────────────────────────

const KEYWORDS = [
  // Core Cereal (GM brands)
  'Cheerios cereal',
  'Honey Nut Cheerios',
  'Cheerios Oat Crunch',
  'Multi Grain Cheerios',
  'Chex cereal',
  'Rice Chex',
  // Kid Cereal (GM brands)
  'Lucky Charms cereal',
  'Cinnamon Toast Crunch',
  'Cocoa Puffs cereal',
  'Trix cereal',
  "Reese's Puffs cereal",
  // Competitors
  'Frosted Flakes cereal',
  'Froot Loops cereal',
  'Raisin Bran cereal',
  'Fruity Pebbles cereal',
  "Cap'n Crunch cereal",
  'Special K cereal',
  // Broad category sweeps
  'cereal',
  'breakfast cereal family size',
  'kids cereal',
] as const;

const ZIP_CODE = '75201';

// ── Helpers ─────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RetailerConfig {
  id: string;
  name: string;
  domain: string;
  serpAgentName: string;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const db = getSupabase();
  const nimble = getNimbleClient();

  // 1. Look up Dallas location
  const { data: location, error: locErr } = await withTimeout(
    db
      .from('locations')
      .select('id')
      .eq('city', 'Dallas')
      .eq('state', 'TX')
      .single(),
    15_000,
    'lookup Dallas location',
  );
  if (locErr || !location) {
    console.error('Dallas location not found. Seed it first.', locErr);
    process.exit(1);
  }
  const locationId: string = location.id;
  console.log(`Location: Dallas, TX (${locationId})`);

  // 2. Load retailers with their SERP agent names
  const { data: retailers, error: retErr } = await withTimeout(
    db
      .from('retailers')
      .select('id, name, domain, serp_agent_id')
      .eq('is_active', true),
    15_000,
    'load retailers',
  );
  if (retErr || !retailers?.length) {
    console.error('No active retailers found.', retErr);
    process.exit(1);
  }

  // Resolve SERP agent names
  const agentIds = retailers.map((r: { serp_agent_id: string }) => r.serp_agent_id);
  const { data: agents } = await withTimeout(
    db
      .from('nimble_agents')
      .select('id, name')
      .in('id', agentIds),
    15_000,
    'load agents',
  );
  const agentNameMap = new Map<string, string>();
  for (const a of agents ?? []) {
    agentNameMap.set(a.id, a.name);
  }

  const retailerConfigs: RetailerConfig[] = retailers.map(
    (r: { id: string; name: string; domain: string; serp_agent_id: string }) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      serpAgentName: agentNameMap.get(r.serp_agent_id) ?? '',
    }),
  );
  console.log(
    `Retailers: ${retailerConfigs.map((r) => r.name).join(', ')}`,
  );

  // 3. Create a run record
  const { data: run, error: runErr } = await withTimeout(
    db
      .from('runs')
      .insert({
        location_id: locationId,
        retailer_ids: retailerConfigs.map((r) => r.id),
        categories: ['cereal'],
        parameters: {
          type: 'category_sweep',
          keywords: KEYWORDS,
          zip_code: ZIP_CODE,
        },
        question_text:
          'Competitive cereal category mapping & pricing analysis for Dallas, TX',
        status: 'collecting',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single(),
    15_000,
    'create run',
  );
  if (runErr || !run) {
    console.error('Failed to create run.', runErr);
    process.exit(1);
  }
  const runId: string = run.id;
  console.log(`\nRun ID: ${runId}`);
  console.log(`Total SERP calls: ${KEYWORDS.length * retailerConfigs.length}`);
  console.log('---');

  // 4. Sweep all retailers
  const stats = {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    totalRawItems: 0,
    totalUniqueItems: 0,
    observationsWritten: 0,
  };

  for (const retailer of retailerConfigs) {
    console.log(`\n[${retailer.name}] Starting sweep (agent: ${retailer.serpAgentName})`);
    const allResults: DedupCandidate[] = [];
    let retailerSuccess = 0;
    let retailerFail = 0;

    for (const keyword of KEYWORDS) {
      stats.totalCalls++;
      const cbKey = `${retailer.id}:serp_search`;

      const result = await withRetry(
        async () => {
          const response = await nimble.runSearchAgent({
            agent_name: retailer.serpAgentName,
            keyword,
            zip_code: ZIP_CODE,
          });

          return extractAndParseSerpItems(response);
        },
        {
          maxAttempts: 2,
          baseDelayMs: 3000,
          maxDelayMs: 15000,
          circuitBreakerKey: cbKey,
        },
      );

      if (result.success && result.data) {
        const items = result.data;
        retailerSuccess++;
        stats.successCalls++;
        stats.totalRawItems += items.length;

        // Map parsed SERP results to DedupCandidate shape
        for (const item of items) {
          allResults.push({
            rank: item.rank,
            title: item.title,
            url: item.url,
            price: item.price,
            is_sponsored: item.is_sponsored,
            retailer_product_id: item.retailer_product_id,
            badge: item.badge,
            snippet_price: item.price,
            raw_payload: { keyword, rating: item.rating, review_count: item.review_count },
          });
        }

        console.log(
          `  [${retailer.name}] "${keyword}" -> ${items.length} items`,
        );
      } else {
        retailerFail++;
        stats.failedCalls++;
        const lastErr =
          result.errors[result.errors.length - 1]?.error ?? 'unknown';
        console.warn(
          `  [${retailer.name}] "${keyword}" FAILED (${result.attempts} attempts): ${lastErr}`,
        );

        // Log error to run_errors
        await db
          .from('run_errors')
          .insert({
            run_id: runId,
            retailer_id: retailer.id,
            step: 'serp',
            keyword,
            error_message: lastErr,
            attempt_count: result.attempts,
            retry_count: result.attempts - 1,
          })
          .then(() => {});
      }

      // Rate limiting between calls
      await sleep(1000);
    }

    // 5. Deduplicate and write serp_candidates
    const unique = deduplicateCandidates(allResults, retailer.domain);
    stats.totalUniqueItems += unique.length;

    console.log(
      `  [${retailer.name}] Dedup: ${allResults.length} raw -> ${unique.length} unique (${retailerSuccess} ok, ${retailerFail} fail)`,
    );

    if (unique.length > 0) {
      // Write serp_candidates in batches of 50
      for (let i = 0; i < unique.length; i += 50) {
        const batch = unique.slice(i, i + 50);
        const rows = batch.map((c) => ({
          run_id: runId,
          retailer_id: retailer.id,
          rank: c.rank,
          title: c.title,
          is_sponsored: c.is_sponsored || false,
          snippet_price: c.snippet_price ?? c.price,
          badge: c.badge,
          pdp_url: c.url,
          retailer_product_id: c.retailer_product_id,
          raw_payload: c.raw_payload,
        }));

        const { error: scErr } = await withTimeout(
          db.from('serp_candidates').insert(rows),
          15_000,
          `write serp_candidates batch ${i}`,
        );
        if (scErr) {
          console.error(
            `  [${retailer.name}] serp_candidates insert error:`,
            scErr.message,
          );
        }
      }

      // 6. Write observations for items with prices
      const priced = unique.filter((c) => c.price != null && c.price > 0);
      for (const item of priced) {
        const validation = runValidationChecks({
          shelf_price: item.price,
          source_url: item.url,
          retailer_domain: retailer.domain,
          category: 'cereal',
          collection_tier: 'wsa',
        });

        const { error: obsErr } = await db.from('observations').insert({
          run_id: runId,
          retailer_id: retailer.id,
          location_id: locationId,
          shelf_price: item.price,
          serp_rank: item.rank,
          confidence: 0.6, // SERP-level confidence (no PDP verification)
          source_url: item.url,
          collection_method: 'website_search_agent',
          collection_tier: 'wsa',
          zip_used: ZIP_CODE,
          validation_status: validation.validation_status,
          validation_reasons: validation.reasons,
          quality_score: validation.quality_score,
          ai_parsed_fields: {
            title: item.title,
            retailer_product_id: item.retailer_product_id,
            is_sponsored: item.is_sponsored,
            badge: item.badge,
            keyword: (item.raw_payload as Record<string, unknown>)?.keyword,
            rating: (item.raw_payload as Record<string, unknown>)?.rating,
            review_count: (item.raw_payload as Record<string, unknown>)?.review_count,
          },
        });

        if (!obsErr) {
          stats.observationsWritten++;
        }
      }

      console.log(
        `  [${retailer.name}] Wrote ${priced.length} observations`,
      );
    }
  }

  // 7. Update run status
  await db
    .from('runs')
    .update({
      status: stats.failedCalls > stats.successCalls ? 'completed_with_errors' : 'completed',
      finished_at: new Date().toISOString(),
      summary: `Category sweep: ${stats.successCalls}/${stats.totalCalls} SERP calls, ${stats.totalUniqueItems} unique items, ${stats.observationsWritten} observations`,
    })
    .eq('id', runId);

  // 8. Print summary
  console.log('\n========================================');
  console.log('Category Sweep Complete');
  console.log('========================================');
  console.log(`Run ID: ${runId}`);
  console.log(`SERP calls: ${stats.successCalls}/${stats.totalCalls} successful`);
  console.log(
    `Items: ${stats.totalRawItems} raw -> ${stats.totalUniqueItems} unique after dedup`,
  );
  console.log(`Observations written: ${stats.observationsWritten}`);
  console.log('========================================');
  console.log(`\nNext: npx tsx agent/src/export-excel.ts ${runId}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
