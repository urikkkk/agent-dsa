import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import type { RunActionRequest, RunStatus } from '@agent-dsa/shared';
import { readBody } from '../router.js';
import { getSupabase } from '../../lib/supabase.js';
import { getRunDebugData } from '../../lib/ledger.js';
import { executeAndEnrich } from '../enriched-result.js';

const TERMINAL_STATUSES: Set<RunStatus> = new Set([
  'completed',
  'completed_with_errors',
  'partial_success',
  'failed',
  'cancelled',
]);

export async function handleRunAction(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const runId = params.runId;
  const db = getSupabase();

  // Validate run exists
  const { data: run, error: runErr } = await db
    .from('runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Run not found' }));
    return;
  }

  const raw = await readBody(req);
  let body: RunActionRequest;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  if (!body.action) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'action is required' }));
    return;
  }

  switch (body.action) {
    case 'show_debug': {
      const debugData = await getRunDebugData(runId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(debugData));
      return;
    }

    case 'retry_failed': {
      if (!TERMINAL_STATUSES.has(run.status as RunStatus)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Run is not in a terminal state' }));
        return;
      }

      // Clone run with retry metadata
      const { data: newRun, error: insertErr } = await db
        .from('runs')
        .insert({
          question_text: run.question_text,
          location_id: run.location_id,
          retailer_ids: run.retailer_ids,
          parameters: {
            ...run.parameters,
            source: 'retry',
            original_run_id: runId,
            rerun_plan: body.payload?.rerun_plan ?? null,
          },
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertErr || !newRun) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to create retry run: ${insertErr?.message}` }));
        return;
      }

      void executeAndEnrich(newRun.id).catch((err) => {
        console.error(`[run-action] retry executeAndEnrich failed for ${newRun.id}:`, err);
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ run_id: newRun.id, stream_url: `/runs/${newRun.id}/stream` }));
      return;
    }

    case 'rerun_with_location': {
      const payload = body.payload ?? {};
      const locationId = payload.location_id as string | undefined;
      const zipCode = payload.zip_code as string | undefined;

      let resolvedLocationId = locationId;

      if (!resolvedLocationId && zipCode) {
        // Resolve zip code to location_id
        const { data: loc } = await db
          .from('locations')
          .select('id')
          .contains('zip_codes', [zipCode])
          .limit(1)
          .single();

        if (loc) {
          resolvedLocationId = loc.id;
        }
      }

      if (!resolvedLocationId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'location_id or valid zip_code required in payload' }));
        return;
      }

      const { data: newRun, error: insertErr } = await db
        .from('runs')
        .insert({
          question_text: run.question_text,
          location_id: resolvedLocationId,
          retailer_ids: run.retailer_ids,
          parameters: {
            ...run.parameters,
            source: 'rerun_with_location',
            original_run_id: runId,
          },
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertErr || !newRun) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to create run: ${insertErr?.message}` }));
        return;
      }

      void executeAndEnrich(newRun.id).catch((err) => {
        console.error(`[run-action] rerun executeAndEnrich failed for ${newRun.id}:`, err);
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ run_id: newRun.id, stream_url: `/runs/${newRun.id}/stream` }));
      return;
    }

    default: {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown action: ${body.action}` }));
    }
  }
}
