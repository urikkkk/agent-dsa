import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';
import { getNimbleClient } from '../lib/nimble-client.js';

export const findTemplateTool = tool(
  'find_wsa_template',
  'Discover available Nimble WSA agents for a retailer. Checks our database first, then falls back to the Nimble API. Returns agent names for SERP and PDP agents that can be used with serp_search and pdp_fetch.',
  {
    domain: z
      .string()
      .optional()
      .describe('Retailer domain to look up (e.g., "walmart.com")'),
    retailer_name: z
      .string()
      .optional()
      .describe('Retailer name to search for'),
    refresh: z
      .boolean()
      .optional()
      .default(false)
      .describe('Force refresh from Nimble API'),
  },
  async (args) => {
    const db = getSupabase();

    // First check our database
    if (!args.refresh) {
      let query = db.from('nimble_agents').select('*');
      if (args.domain) {
        query = query.ilike('domain', `%${args.domain}%`);
      }
      if (args.retailer_name) {
        query = query.ilike('name', `%${args.retailer_name}%`);
      }

      const { data: agents } = await query;

      if (agents && agents.length > 0) {
        // Also get the linked retailer info
        const domains = [...new Set(agents.map((a) => a.domain).filter(Boolean))];
        const { data: retailers } = await db
          .from('retailers')
          .select('id, name, domain, serp_agent_id, pdp_agent_id')
          .in('domain', domains);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                source: 'database',
                agents: agents.map((a) => ({
                  agent_name: a.name,
                  template_id: a.template_id,
                  domain: a.domain,
                  entity_type: a.entity_type,
                  is_healthy: a.is_healthy,
                })),
                retailers: retailers || [],
              }),
            },
          ],
        };
      }
    }

    // Fallback: query Nimble API
    try {
      const nimble = getNimbleClient();
      const agents = await nimble.listAgents();

      // Filter if domain provided
      const filtered = args.domain
        ? agents.filter((a: unknown) => {
            const agent = a as Record<string, unknown>;
            return String(agent.domain || '').includes(args.domain!);
          })
        : agents;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              source: 'nimble_api',
              agents: filtered,
              note: 'These are live templates from Nimble. Use the agent name with serp_search or pdp_fetch.',
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Failed to list agents: ${err instanceof Error ? err.message : String(err)}`,
            }),
          },
        ],
      };
    }
  }
);
