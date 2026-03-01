import { EventEmitter } from 'node:events';
import type { RunEvent, RunEventType, AgentName, StepSummary, LedgerEventStatus, NextActionHint } from '@agent-dsa/shared';

export type RunEventPartial = Omit<RunEvent, 'timestamp' | 'run_id'>;

export class RunEventBus extends EventEmitter {
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private lastEventTime = Date.now();
  private currentAgent: AgentName = 'webops';
  private currentStep = 'collection';

  constructor(private readonly runId: string) {
    super();
  }

  send(partial: RunEventPartial): void {
    const event: RunEvent = {
      ...partial,
      timestamp: new Date().toISOString(),
      run_id: this.runId,
    };
    this.lastEventTime = Date.now();
    this.currentAgent = event.agent_name;
    this.currentStep = event.step_name;
    try {
      this.emit('run_event', event);
    } catch {
      // listener errors never propagate
    }
  }

  startHeartbeat(intervalMs = 10_000): void {
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastEventTime >= intervalMs) {
        this.send({
          event_type: 'heartbeat',
          agent_name: this.currentAgent,
          step_name: this.currentStep,
          message: `Still running (${this.currentAgent}/${this.currentStep})...`,
        });
      }
    }, intervalMs);
    // Allow the process to exit even if heartbeat is running
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  dispose(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.removeAllListeners();
  }
}

// --- ANSI color helpers ---

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

const ICONS: Record<RunEventType, string> = {
  step_started: '▶',
  step_summary: '■',
  task_started: '┌',
  task_completed: '└ ✓',
  task_failed: '└ ✗',
  retrying: '↻',
  skipped: '⊘',
  heartbeat: '…',
  run_complete: '✓',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function fmtTag(agent: string, step: string): string {
  return `${DIM}[${agent}/${step}]${RESET}`;
}

export function formatRunEvent(e: RunEvent): string {
  const time = `${DIM}${fmtTime(e.timestamp)}${RESET}`;
  const tag = fmtTag(e.agent_name, e.step_name);
  const icon = ICONS[e.event_type] ?? '•';

  switch (e.event_type) {
    case 'step_started':
      return `${time} ${tag} ${CYAN}${icon}${RESET} ${BOLD}${e.message}${RESET}`;

    case 'task_started':
      return `${time} ${tag}   ${DIM}${icon}${RESET} ${e.tool_name ?? ''} ${DIM}(task ${e.task_id?.slice(0, 8) ?? '?'}${e.attempt ? `, attempt ${e.attempt}` : ''})${RESET}`;

    case 'task_completed':
      return `${time} ${tag}   ${GREEN}${icon}${RESET} ${GREEN}${e.tool_name ?? ''} completed${RESET} ${DIM}(attempt ${e.attempt ?? 1})${RESET}`;

    case 'task_failed': {
      const errInfo = e.error ? ` ${RED}[${e.error.code}: ${e.error.message}]${RESET}` : '';
      const hint = e.next_action_hint ? ` → ${YELLOW}${e.next_action_hint}${RESET}` : '';
      return `${time} ${tag}   ${RED}${icon}${RESET} ${RED}${e.tool_name ?? ''} failed${RESET}${errInfo}${hint}`;
    }

    case 'retrying':
      return `${time} ${tag}   ${YELLOW}${icon}${RESET} ${YELLOW}${e.tool_name ?? ''} retrying${RESET} ${DIM}(attempt ${e.attempt ?? '?'})${RESET}`;

    case 'skipped':
      return `${time} ${tag}   ${MAGENTA}${icon}${RESET} ${MAGENTA}${e.message}${RESET}`;

    case 'heartbeat':
      return `${time} ${tag} ${DIM}${icon} ${e.message}${RESET}`;

    case 'step_summary': {
      const s = e.summary;
      if (s) {
        return `${time} ${tag} ${CYAN}${icon}${RESET} ${s.completed}/${s.total_tasks} tasks, ${s.coverage_pct.toFixed(0)}% coverage, ${s.failed} failed, ${s.skipped} skipped`;
      }
      return `${time} ${tag} ${CYAN}${icon}${RESET} ${e.message}`;
    }

    case 'run_complete': {
      const f = e.final;
      if (f?.success) {
        const cost = f.total_cost_usd != null ? ` | $${f.total_cost_usd.toFixed(4)}` : '';
        const turns = f.num_turns != null ? ` | ${f.num_turns} turns` : '';
        return `${time} ${tag} ${GREEN}${icon} Run completed successfully${RESET}${cost}${turns}`;
      }
      return `${time} ${tag} ${RED}✗ ${e.message}${RESET}`;
    }

    default:
      return `${time} ${tag} ${icon} ${e.message}`;
  }
}
