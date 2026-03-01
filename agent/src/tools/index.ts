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
import { validateObservationTool } from './validate.js';
import { dedupTool } from './dedup.js';

export function createDsaToolServer() {
  return createSdkMcpServer({
    name: 'dsa-tools',
    tools: [
      serpSearchTool,
      pdpFetchTool,
      webSearchFallbackTool,
      urlExtractFallbackTool,
      findTemplateTool,
      readConfigTool,
      writeObservationTool,
      writeSerpCandidatesTool,
      writeAnswerTool,
      validateObservationTool,
      dedupTool,
    ],
  });
}
