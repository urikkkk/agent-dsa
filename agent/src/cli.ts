import { config } from 'dotenv';
config({ path: '.env.local' });

// Allow running inside an existing Claude Code session
delete process.env.CLAUDECODE;

import { getSupabase } from './lib/supabase.js';
import { executeQuestion } from './execute-question.js';
import { RunEventBus, formatRunEvent } from './lib/run-events.js';

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(' ');

  if (!question) {
    console.error(
      'Usage: npx tsx agent/src/cli.ts "Best price for Cheerios across Amazon and Walmart in Chicago"'
    );
    process.exit(1);
  }

  console.log(`\nAgent DSA - CLI Runner`);
  console.log(`Question: ${question}\n`);

  const db = getSupabase();

  // Parse location from question (simple heuristic)
  let locationId: string | undefined;
  const locationMatch = question.match(/\bin\s+(\w[\w\s]*?)(?:\s*$|\s+(?:at|on|from|across))/i);
  if (locationMatch) {
    const cityName = locationMatch[1].trim();
    const { data: loc } = await db
      .from('locations')
      .select('id, city')
      .ilike('city', `%${cityName}%`)
      .limit(1)
      .single();
    if (loc) {
      locationId = loc.id;
      console.log(`Matched location: ${loc.city}`);
    }
  }

  // Parse retailers from question
  const retailerNames = ['walmart', 'amazon', 'target', 'kroger'];
  const mentionedRetailers = retailerNames.filter((name) =>
    question.toLowerCase().includes(name)
  );

  let retailerIds: string[] = [];
  if (mentionedRetailers.length > 0) {
    const { data: retailers } = await db
      .from('retailers')
      .select('id, name')
      .in(
        'domain',
        mentionedRetailers.map((n) => `${n}.com`)
      );
    if (retailers) {
      retailerIds = retailers.map((r) => r.id);
      console.log(
        `Matched retailers: ${retailers.map((r) => r.name).join(', ')}`
      );
    }
  }

  // Create the run
  const { data: run, error } = await db
    .from('runs')
    .insert({
      question_text: question,
      location_id: locationId,
      retailer_ids: retailerIds,
      status: 'pending',
      parameters: { source: 'cli' },
    })
    .select('id')
    .single();

  if (error || !run) {
    console.error('Failed to create run:', error?.message);
    process.exit(1);
  }

  console.log(`Created run: ${run.id}`);
  console.log(`Executing (two-phase: collecting → analyzing)...\n`);

  const eventBus = new RunEventBus(run.id);
  eventBus.on('run_event', (e) => console.log(formatRunEvent(e)));
  eventBus.startHeartbeat(10_000);

  const result = await executeQuestion(run.id, eventBus);

  if (result.success) {
    console.log(`\n--- Run completed ---`);
    console.log(`Answer ID: ${result.answerId}`);
    console.log(`Cost: $${result.totalCostUsd?.toFixed(4)}`);
    console.log(`Turns: ${result.numTurns}`);

    // Fetch and display the answer
    const { data: answer } = await db
      .from('answers')
      .select('answer_text, answer_data, confidence')
      .eq('id', result.answerId!)
      .single();

    if (answer) {
      console.log(`\n--- Answer ---`);
      console.log(answer.answer_text);
      if (answer.confidence != null) {
        console.log(`\nConfidence: ${(answer.confidence * 100).toFixed(0)}%`);
      }
    }
  } else {
    console.error(`\nRun failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
