#!/usr/bin/env tsx
/**
 * CLI tool to verify Supermemory connectivity and search results.
 *
 * Usage:
 *   npx tsx agent/src/cli-memory-debug.ts [--runId ...] [--retailerId ...] [--userId ...] [--query ...]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import {
  isMemoryEnabled,
  healthCheck,
  debugMemory,
  buildMemoryTags,
} from './lib/supermemory.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[++i];
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  console.log('=== Supermemory Debug ===\n');
  console.log(`Enabled: ${isMemoryEnabled()}`);
  console.log(`API key present: ${!!process.env.SUPERMEMORY_API_KEY}`);
  console.log(`Tag prefix: ${process.env.SUPERMEMORY_TAG_PREFIX || 'nimble_agents'}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'dev'}`);

  if (!isMemoryEnabled()) {
    console.log('\nSupermemory is disabled. Set SUPERMEMORY_ENABLED=true to test.');
    process.exit(0);
  }

  // Show example tags that would be generated
  console.log('\n--- Example Tags ---');
  const exampleTags = buildMemoryTags({
    env: process.env.NODE_ENV || 'dev',
    userId: args.userId,
    retailerId: args.retailerId,
    agentName: 'dsa',
    stepName: 'analysis',
    runId: args.runId,
  });
  console.log('Tags:', JSON.stringify(exampleTags, null, 2));

  // Health check
  console.log('\n--- Health Check ---');
  const health = await healthCheck();
  console.log(`OK: ${health.ok}, Latency: ${health.latency_ms}ms`);
  if (health.error) console.log(`Error: ${health.error}`);

  // Debug search
  console.log('\n--- Memory Search ---');
  const result = await debugMemory({
    runId: args.runId,
    retailerId: args.retailerId,
    userId: args.userId,
    query: args.query,
  });

  console.log(`\nSearch A (user+retailer scoped):`);
  console.log(`  Tags: ${JSON.stringify(result.search_a.tags)}`);
  console.log(`  Results: ${result.search_a.count}`);
  if (result.search_a.snippets.length > 0) {
    console.log('  Snippets:');
    for (const s of result.search_a.snippets) {
      console.log(`    - ${s}`);
    }
  }

  if (result.search_b.tags.length > 0) {
    console.log(`\nSearch B (retailer-only fallback):`);
    console.log(`  Tags: ${JSON.stringify(result.search_b.tags)}`);
    console.log(`  Results: ${result.search_b.count}`);
    if (result.search_b.snippets.length > 0) {
      console.log('  Snippets:');
      for (const s of result.search_b.snippets) {
        console.log(`    - ${s}`);
      }
    }
  }

  console.log(`\nMerged total: ${result.merged_count}`);
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
