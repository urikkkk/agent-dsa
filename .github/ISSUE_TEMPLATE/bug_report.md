---
name: Bug Report
about: Report incorrect behavior in the agent pipeline
labels: bug
---

## Description

<!-- Clear description of the bug -->

## Steps to Reproduce

```bash
npm run agent:cli "..."
```

## Expected Behavior

<!-- What should happen -->

## Actual Behavior

<!-- What actually happens -->

## Debug Data

<!-- If available, include: -->

- **Run ID:** `uuid`
- **Phase:** WebOps / DSA / Both
- **Step summary output:**
  ```
  [collecting] summary: X/Y tasks, Z% coverage
  ```
- **Error clusters:** <!-- from run_steps.error_clusters -->
- **Ledger query:**
  ```sql
  SELECT task_id, status, error, next_action_hint
  FROM ledger_events
  WHERE run_id = 'uuid' AND status = 'failed';
  ```

## Environment

- Node.js version:
- Agent model:
- Branch/commit:
