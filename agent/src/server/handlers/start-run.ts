import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import type { StartRunRequest, StartRunResponse } from '@agent-dsa/shared';
import { readBody } from '../router.js';
import { getSupabase } from '../../lib/supabase.js';
import { executeAndEnrich } from '../enriched-result.js';

export async function handleStartRun(
  req: IncomingMessage,
  res: ServerResponse,
  _params: RouteParams,
): Promise<void> {
  const raw = await readBody(req);
  let body: StartRunRequest;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  if (!body.question_text || typeof body.question_text !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'question_text is required' }));
    return;
  }

  const db = getSupabase();

  const { data: run, error: insertErr } = await db
    .from('runs')
    .insert({
      question_text: body.question_text,
      location_id: body.location_id ?? null,
      retailer_ids: body.retailer_ids ?? [],
      parameters: { ...body.parameters, source: 'http' },
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr || !run) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Failed to create run: ${insertErr?.message}` }));
    return;
  }

  // Fire-and-forget — the stream endpoint delivers progress
  void executeAndEnrich(run.id).catch((err) => {
    console.error(`[start-run] executeAndEnrich failed for ${run.id}:`, err);
  });

  const response: StartRunResponse = {
    run_id: run.id,
    stream_url: `/runs/${run.id}/stream`,
  };

  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}
