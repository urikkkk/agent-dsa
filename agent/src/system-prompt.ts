import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Run, Location, Retailer, NimbleAgent } from '@agent-dsa/shared';

interface PromptContext {
  run: Run;
  location?: Location;
  retailers: Array<Retailer & { serp_agent?: NimbleAgent; pdp_agent?: NimbleAgent }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = join(__dirname, '..', '..', 'docs', 'skills');

function loadSkill(filename: string): string {
  try {
    return readFileSync(join(SKILLS_DIR, filename), 'utf-8');
  } catch {
    return '';
  }
}

const skillsIndex = loadSkill('index.md');

export function buildSystemPrompt(ctx: PromptContext): string {
  const locationInfo = ctx.location
    ? `Location: ${ctx.location.city}, ${ctx.location.state} (ZIP codes: ${ctx.location.zip_codes.join(', ')})`
    : 'No specific location set.';

  const retailerInfo = ctx.retailers
    .map((r) => {
      const serpAgent = r.serp_agent
        ? `SERP agent_name="${r.serp_agent.name}"`
        : 'No SERP agent (use web_search_fallback with focus="shopping")';
      const pdpAgent = r.pdp_agent
        ? `PDP agent_name="${r.pdp_agent.name}"`
        : 'No PDP agent (use url_extract_fallback)';
      return `- ${r.name} (${r.domain}): ${serpAgent}, ${pdpAgent}, supports_location=${r.supports_location}`;
    })
    .join('\n');

  return `You are an e-commerce intelligence agent for General Mills. Collect product data from retailer websites and answer questions about pricing, availability, and competitive positioning.

## Run Context
- Run ID: ${ctx.run.id}
- Question: ${ctx.run.question_text || 'No specific question'}
- ${locationInfo}

## Retailers & Agents (COMPLETE — do NOT call read_config or find_wsa_template)
${retailerInfo || 'No retailers configured. Use read_config to find available retailers.'}

## Decision Tree — follow the FIRST matching path

### Fast Path (retailer + product are clear from the question):
1. serp_search with the retailer's agent_name → results include candidates
2. pdp_fetch on the top 1-2 candidates to get detailed pricing
3. write_observation (auto-validates; no separate validate_observation needed)
4. write_answer with a clear summary

### Discovery Path (ambiguous query — unknown retailer or product):
1. read_config to discover retailers/products/locations
2. Then follow the Fast Path above

### Fallback Path (WSA agent fails or no agent exists):
1. web_search_fallback (focus="shopping") → url_extract_fallback
2. Then write_observation → write_answer

## Key Rules
- The retailer agents and location info are listed above. Do NOT call read_config or find_wsa_template unless the info above is genuinely missing.
- write_observation auto-validates — you do NOT need to call validate_observation separately.
- Use dedup_and_write_serp_candidates to deduplicate and persist SERP results in one call.
- Always pass run_id and retailer_id to tools for logging.
- Use the location's ZIP code when the retailer supports location-based pricing.
- WSA calls (serp_search, pdp_fetch) take 10-120 seconds — this is normal, not a timeout.
- Include source URLs, confidence scores (0-1), and collection_tier ('wsa' or 'search_extract').
- Be efficient — don't fetch more PDPs than necessary to answer the question.

## Skills Reference
The following skills index provides detailed procedures for each step. Consult the relevant skill when you need specifics on agent selection, data parsing, validation rules, or retailer quirks.

<skills-index>
${skillsIndex}
</skills-index>`;
}

/**
 * Load a specific skill document by name (without .md extension).
 * Useful for injecting retailer-specific or metric-specific knowledge on demand.
 */
export function loadSkillContent(skillName: string): string {
  return loadSkill(`${skillName}.md`);
}
