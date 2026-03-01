import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
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
    ],
  });
}
