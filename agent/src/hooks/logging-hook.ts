import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';

/**
 * PostToolUse hook that logs every tool call to the agent_logs table.
 * This powers the debugger UI.
 */
export function createLoggingHook(runId: string): HookCallback {
  return async (input, toolUseId) => {
    const db = getSupabase();
    const hookInput = input as Record<string, unknown>;

    try {
      await db.from('agent_logs').insert({
        run_id: runId,
        session_id: hookInput.session_id || null,
        tool_name: hookInput.tool_name || null,
        tool_input: hookInput.tool_input as Record<string, unknown> || null,
        tool_output: hookInput.tool_response as Record<string, unknown> || null,
      });
    } catch {
      // Don't let logging failures break the agent
    }

    return {};
  };
}
