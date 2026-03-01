import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt } from './system-prompt.js';
import { createDsaToolServer } from './tools/index.js';
import { createLoggingHook } from './hooks/logging-hook.js';
import { getSupabase } from './lib/supabase.js';
import type { Run, Location, Retailer, NimbleAgent } from '@agent-dsa/shared';

interface ExecuteResult {
  success: boolean;
  answerId?: string;
  totalCostUsd?: number;
  numTurns?: number;
  error?: string;
}

export async function executeQuestion(runId: string): Promise<ExecuteResult> {
  const db = getSupabase();

  // Mark run as running
  await db
    .from('runs')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  // Load run context
  const { data: run, error: runErr } = await db
    .from('runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    return { success: false, error: `Run not found: ${runErr?.message}` };
  }

  // Load location
  let location: Location | undefined;
  if (run.location_id) {
    const { data } = await db
      .from('locations')
      .select('*')
      .eq('id', run.location_id)
      .single();
    if (data) location = data as Location;
  }

  // Load retailers with their agents
  const retailerIds: string[] = run.retailer_ids || [];
  let retailers: Array<
    Retailer & { serp_agent?: NimbleAgent; pdp_agent?: NimbleAgent }
  > = [];

  if (retailerIds.length > 0) {
    const { data: retailerRows } = await db
      .from('retailers')
      .select('*')
      .in('id', retailerIds);

    if (retailerRows) {
      // Load agents for each retailer
      for (const r of retailerRows) {
        const retailer = r as Retailer & {
          serp_agent?: NimbleAgent;
          pdp_agent?: NimbleAgent;
        };
        if (r.serp_agent_id) {
          const { data: agent } = await db
            .from('nimble_agents')
            .select('*')
            .eq('id', r.serp_agent_id)
            .single();
          if (agent) retailer.serp_agent = agent as NimbleAgent;
        }
        if (r.pdp_agent_id) {
          const { data: agent } = await db
            .from('nimble_agents')
            .select('*')
            .eq('id', r.pdp_agent_id)
            .single();
          if (agent) retailer.pdp_agent = agent as NimbleAgent;
        }
        retailers.push(retailer);
      }
    }
  } else {
    // If no retailers specified, load all active ones
    const { data: allRetailers } = await db
      .from('retailers')
      .select('*')
      .eq('is_active', true);

    if (allRetailers) {
      for (const r of allRetailers) {
        const retailer = r as Retailer & {
          serp_agent?: NimbleAgent;
          pdp_agent?: NimbleAgent;
        };
        if (r.serp_agent_id) {
          const { data: agent } = await db
            .from('nimble_agents')
            .select('*')
            .eq('id', r.serp_agent_id)
            .single();
          if (agent) retailer.serp_agent = agent as NimbleAgent;
        }
        if (r.pdp_agent_id) {
          const { data: agent } = await db
            .from('nimble_agents')
            .select('*')
            .eq('id', r.pdp_agent_id)
            .single();
          if (agent) retailer.pdp_agent = agent as NimbleAgent;
        }
        retailers.push(retailer);
      }
    }
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    run: run as Run,
    location,
    retailers,
  });

  // Build the user prompt
  const userPrompt = run.question_text
    ? `Execute the following question for run ${runId}:\n\n${run.question_text}\n\nCollect data, validate it, write observations, and produce a final answer.`
    : `Execute run ${runId}. Read the run configuration and available data, then collect and analyze the requested information.`;

  // Create tools MCP server
  const dsaTools = createDsaToolServer();

  // Create logging hook
  const loggingHook = createLoggingHook(runId);

  const model = process.env.AGENT_MODEL || 'claude-sonnet-4-6';
  const maxTurns = parseInt(process.env.AGENT_MAX_TURNS || '30', 10);

  try {
    let totalCostUsd = 0;
    let numTurns = 0;
    let resultText = '';

    for await (const message of query({
      prompt: userPrompt,
      options: {
        model,
        maxTurns,
        systemPrompt,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'dsa-tools': dsaTools },
        hooks: {
          PostToolUse: [{ hooks: [loggingHook] }],
        },
      },
    })) {
      const msg = message as SDKMessage;
      if (msg.type === 'result') {
        const result = msg as Extract<SDKMessage, { type: 'result' }>;
        if ('total_cost_usd' in result) {
          totalCostUsd = result.total_cost_usd;
        }
        if ('num_turns' in result) {
          numTurns = result.num_turns;
        }
        if ('result' in result && typeof result.result === 'string') {
          resultText = result.result;
        }
      }
    }

    // Update run with cost
    await db
      .from('runs')
      .update({
        total_cost_usd: totalCostUsd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);

    // Check if the agent wrote an answer
    const { data: answer } = await db
      .from('answers')
      .select('id')
      .eq('run_id', runId)
      .limit(1)
      .single();

    if (!answer) {
      // Agent finished but didn't write an answer — mark as completed with errors
      await db
        .from('runs')
        .update({
          status: 'completed_with_errors',
          finished_at: new Date().toISOString(),
          summary: resultText || 'Agent completed but did not produce an answer',
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      return {
        success: false,
        totalCostUsd,
        numTurns,
        error: 'Agent did not produce an answer',
      };
    }

    return {
      success: true,
      answerId: answer.id,
      totalCostUsd,
      numTurns,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Mark run as failed
    await db
      .from('runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        summary: `Agent error: ${errorMsg}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);

    await db.from('run_errors').insert({
      run_id: runId,
      error_code: 'AGENT_ERROR',
      error_message: errorMsg,
      error_type: 'agent_execution',
    });

    return { success: false, error: errorMsg };
  }
}
