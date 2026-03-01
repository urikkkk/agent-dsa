import { config } from 'dotenv';
config({ path: '.env.local' });

// Allow running inside an existing Claude Code session
delete process.env.CLAUDECODE;

import { getSupabase } from './lib/supabase.js';
import { executeQuestion } from './execute-question.js';

const POLL_INTERVAL_MS = parseInt(
  process.env.AGENT_POLL_INTERVAL_MS || '5000',
  10
);

async function pollForPendingRuns(): Promise<void> {
  const db = getSupabase();

  // Find the oldest pending run
  const { data: runs, error } = await db
    .from('runs')
    .select('id, question_text')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error polling for runs:', error.message);
    return;
  }

  if (!runs || runs.length === 0) {
    return;
  }

  const run = runs[0];
  console.log(`\n--- Picking up run ${run.id} ---`);
  console.log(`Question: ${run.question_text || '(no question)'}`);

  const result = await executeQuestion(run.id);

  if (result.success) {
    console.log(`Run ${run.id} completed successfully`);
    console.log(`  Answer ID: ${result.answerId}`);
    console.log(`  Cost: $${result.totalCostUsd?.toFixed(4)}`);
    console.log(`  Turns: ${result.numTurns}`);
  } else {
    console.error(`Run ${run.id} failed: ${result.error}`);
  }
}

async function main(): Promise<void> {
  console.log('Agent DSA - Run Executor');
  console.log(`Polling every ${POLL_INTERVAL_MS}ms for pending runs...`);
  console.log('Press Ctrl+C to stop.\n');

  // Initial poll
  await pollForPendingRuns();

  // Continue polling
  const interval = setInterval(async () => {
    try {
      await pollForPendingRuns();
    } catch (err) {
      console.error(
        'Poll error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }, POLL_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    clearInterval(interval);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
