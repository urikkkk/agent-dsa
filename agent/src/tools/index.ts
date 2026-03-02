import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { serpSearchTool } from './serp-search.js';
import { pdpFetchTool } from './pdp-fetch.js';
import { webSearchFallbackTool } from './web-search.js';
import { urlExtractFallbackTool } from './url-extract.js';
import { findTemplateTool } from './find-template.js';
import { readConfigTool } from './read-config.js';
import {
  writeObservationTool,
  writeSerpCandidatesTool,
  writeAnswerTool,
} from './write-results.js';
import { dedupAndWriteSerpCandidatesTool } from './dedup.js';
import { readObservationsTool } from './read-observations.js';
import { readCandidatesTool } from './read-candidates.js';
import { memorySearchTool } from './memory-search.js';
import { memoryAddTool } from './memory-add.js';
import type { CollectionPlan } from '@agent-dsa/shared';

/**
 * WebOps: collection + writing observations/candidates.
 * Cannot write answers or read config (config is injected into its prompt).
 */
export function createWebOpsToolServer() {
  return createSdkMcpServer({
    name: 'webops-tools',
    tools: [
      serpSearchTool,
      pdpFetchTool,
      webSearchFallbackTool,
      urlExtractFallbackTool,
      findTemplateTool,
      writeObservationTool,
      writeSerpCandidatesTool,
      dedupAndWriteSerpCandidatesTool,
    ],
  });
}

/**
 * DSA Analysis: read collected data + compute answers.
 * Cannot call any Nimble/web tools or write observations.
 */
export function createDsaAnalysisToolServer() {
  return createSdkMcpServer({
    name: 'dsa-tools',
    tools: [
      readConfigTool,
      readObservationsTool,
      readCandidatesTool,
      writeAnswerTool,
      memorySearchTool,
      memoryAddTool,
    ],
  });
}

/**
 * Planner: read config + submit a structured collection plan.
 * Returns { server, getPlan } so the caller can retrieve the submitted plan.
 */
export function createPlannerToolServer() {
  let plan: CollectionPlan | null = null;

  const submitPlanTool = tool(
    'submit_plan',
    'Submit a structured collection plan. Call this exactly once after reading config.',
    {
      question_type: z.enum([
        'best_price',
        'price_trend',
        'oos_monitor',
        'serp_sov',
        'assortment_coverage',
        'promotion_scan',
      ]).describe('The type of question being answered'),
      keywords: z.array(
        z.object({
          keyword: z.string().describe('Search keyword'),
          priority: z.number().describe('Priority (1 = highest)'),
        })
      ).describe('Keywords to search, ordered by priority'),
      retailers: z.array(z.string()).describe('Retailer IDs to target'),
    },
    async (args) => {
      plan = {
        question_type: args.question_type,
        keywords: args.keywords,
        retailers: args.retailers,
      };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Plan submitted.' }),
          },
        ],
      };
    }
  );

  const server = createSdkMcpServer({
    name: 'planner-tools',
    tools: [readConfigTool, submitPlanTool],
  });

  return {
    server,
    getPlan(): CollectionPlan | null {
      return plan;
    },
  };
}
