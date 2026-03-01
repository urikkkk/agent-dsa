import { config } from 'dotenv';
config({ path: '.env.local' });

// Allow running inside an existing Claude Code session
delete process.env.CLAUDECODE;

import { getSupabase } from './lib/supabase.js';
import { executeQuestion } from './execute-question.js';
import { RunEventBus, formatRunEvent } from './lib/run-events.js';
import { logMemoryStatus } from './lib/supermemory.js';

const POLL_INTERVAL_MS = parseInt(
  process.env.AGENT_POLL_INTERVAL_MS || '5000',
  10
);

let isBusy = false;

async function pollForPendingRuns(): Promise<void> {
  if (isBusy) return;
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

  isBusy = true;
  try {
    const eventBus = new RunEventBus(run.id);
    eventBus.on('run_event', (e) => console.log(formatRunEvent(e)));
    eventBus.startHeartbeat(10_000);

    const result = await executeQuestion(run.id, eventBus);

    if (result.success) {
      console.log(`Run ${run.id} completed successfully`);
      console.log(`  Answer ID: ${result.answerId}`);
      console.log(`  Cost: $${result.totalCostUsd?.toFixed(4)}`);
      console.log(`  Turns: ${result.numTurns}`);
    } else {
      console.error(`Run ${run.id} failed: ${result.error}`);
    }
  } finally {
    isBusy = false;
  }
}

async function main(): Promise<void> {
  console.log('Agent DSA - Run Executor');
  console.log(`Polling every ${POLL_INTERVAL_MS}ms for pending runs...`);
  logMemoryStatus();
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

  // Graceful shutdown: wait for in-flight run to finish (up to 5 min)
  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down gracefully...');
    clearInterval(interval);

    if (isBusy) {
      console.log('Waiting for in-flight run to finish (up to 5 min)...');
      const deadline = Date.now() + 5 * 60 * 1000;
      while (isBusy && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (isBusy) {
        console.error('Timed out waiting for run — exiting anyway.');
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void gracefulShutdown());
  process.on('SIGTERM', () => void gracefulShutdown());
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
