import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function check() {
  const runId = '72262517-d317-4541-8c69-31e325a8a0a9';

  const { data: run } = await db
    .from('runs')
    .select('id, status, question_text, total_cost_usd, started_at, finished_at')
    .eq('id', runId)
    .single();
  console.log('Run:', JSON.stringify(run, null, 2));

  const { data: answer } = await db
    .from('answers')
    .select('id, answer_text, confidence, status')
    .eq('run_id', runId)
    .single();
  console.log('\nAnswer:', JSON.stringify(answer, null, 2));

  const { data: logs } = await db
    .from('agent_logs')
    .select('tool_name, created_at')
    .eq('run_id', runId)
    .order('created_at');
  console.log(`\nAgent Logs (${logs?.length || 0} entries):`);
  if (logs) {
    for (const l of logs) {
      console.log(`  - ${l.tool_name} @ ${l.created_at}`);
    }
  }

  const { data: reqs } = await db
    .from('nimble_requests')
    .select('collection_tier, keyword, status')
    .eq('run_id', runId);
  console.log(`\nNimble Requests (${reqs?.length || 0}):`);
  if (reqs) {
    for (const r of reqs) {
      console.log(`  - ${r.collection_tier} | ${r.keyword} | ${r.status}`);
    }
  }
}

check();
