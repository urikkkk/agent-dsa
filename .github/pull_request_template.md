## Summary

<!-- 1-3 bullet points describing what this PR does and why -->

## Changes

### New Files
<!-- List any new files added -->

### Modified Files
<!-- List files changed and what changed in each -->

## Type of Change

- [ ] New feature
- [ ] Bug fix
- [ ] Refactor (no behavior change)
- [ ] Database migration
- [ ] Documentation
- [ ] Performance optimization

## Testing

- [ ] `npx tsc -p agent/tsconfig.json --noEmit` passes
- [ ] Tested locally with `npm run agent:cli "..."`
- [ ] Database migration applies cleanly (`supabase db reset` or `supabase migration up`)
- [ ] No regressions in existing tool behavior

## Observability Checklist

_If this PR touches tools, hooks, or the orchestrator:_

- [ ] New tools emit `started` ledger events before execution
- [ ] PostToolUse hook emits `completed`/`failed` events with `parent_span_id` linkage
- [ ] Circuit breaker check added for external API calls
- [ ] Tool is registered in the correct MCP server (WebOps or DSA)
- [ ] Tool is added to the allowed set in `logging-hook.ts` ALLOWED_TOOLS

## Database Migration Checklist

_If this PR includes a migration:_

- [ ] Migration file follows naming convention (`NNN_description.sql`)
- [ ] Indexes added for frequently queried columns
- [ ] Backward-compatible (no breaking changes to existing views/queries)
- [ ] Seed data updated if new required fields added
