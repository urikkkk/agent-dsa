import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function fix() {
  // Delete old retailers and agents (they reference wrong template IDs)
  console.log('Deleting old retailers...');
  await db.from('retailers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Deleting old nimble_agents...');
  await db.from('nimble_agents').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Insert correct agents
  const agents = [
    { template_id: 2627, name: 'walmart_serp', domain: 'www.walmart.com', entity_type: 'serp', capabilities: { supports_zip: true, input_param: 'keyword', zip_param: 'zipcode' } },
    { template_id: 2411, name: 'walmart_pdp', domain: 'www.walmart.com', entity_type: 'pdp', capabilities: { supports_zip: true, input_param: 'product_id', zip_param: 'zipcode' } },
    { template_id: 2196, name: 'amazon_serp', domain: 'www.amazon.com', entity_type: 'serp', capabilities: { supports_zip: true, input_param: 'keyword', zip_param: 'zip_code' } },
    { template_id: 2414, name: 'amazon_pdp', domain: 'www.amazon.com', entity_type: 'pdp', capabilities: { supports_zip: true, input_param: 'asin', zip_param: 'zip_code' } },
    { template_id: 2068, name: 'target_serp', domain: 'www.target.com', entity_type: 'serp', capabilities: { supports_zip: true, input_param: 'keyword' } },
    { template_id: 2702, name: 'target_pdp', domain: 'www.target.com', entity_type: 'pdp', capabilities: { supports_zip: true, input_param: 'product_id' } },
    { template_id: 1991, name: 'kroger_serp', domain: 'www.kroger.com', entity_type: 'serp', capabilities: { supports_zip: true, input_param: 'keyword' } },
    { template_id: 2100, name: 'kroger_pdp', domain: 'www.kroger.com', entity_type: 'pdp', capabilities: { supports_zip: true, input_param: 'product_id' } },
  ];

  console.log('Inserting correct agents...');
  const { data: insertedAgents, error: agentErr } = await db
    .from('nimble_agents')
    .insert(agents)
    .select('id, name, template_id');
  if (agentErr) {
    console.error('Agent insert error:', agentErr);
    return;
  }
  console.log('Inserted agents:', insertedAgents?.length);

  // Map agent names to IDs
  const agentMap: Record<string, string> = {};
  for (const a of insertedAgents || []) {
    agentMap[a.name] = a.id;
  }

  // Insert retailers
  const retailers = [
    { name: 'Walmart', domain: 'walmart.com', serp_agent_id: agentMap['walmart_serp'], pdp_agent_id: agentMap['walmart_pdp'], supports_location: true },
    { name: 'Amazon', domain: 'amazon.com', serp_agent_id: agentMap['amazon_serp'], pdp_agent_id: agentMap['amazon_pdp'], supports_location: true },
    { name: 'Target', domain: 'target.com', serp_agent_id: agentMap['target_serp'], pdp_agent_id: agentMap['target_pdp'], supports_location: true },
    { name: 'Kroger', domain: 'kroger.com', serp_agent_id: agentMap['kroger_serp'], pdp_agent_id: agentMap['kroger_pdp'], supports_location: true },
  ];

  console.log('Inserting retailers...');
  const { data: insertedRetailers, error: retErr } = await db
    .from('retailers')
    .insert(retailers)
    .select('id, name');
  if (retErr) {
    console.error('Retailer insert error:', retErr);
    return;
  }
  console.log('Inserted retailers:', insertedRetailers);

  // Verify
  const { data: verify } = await db
    .from('retailers')
    .select('name, domain, serp_agent_id, pdp_agent_id');
  console.log('\nVerification:');
  for (const r of verify || []) {
    console.log(`  ${r.name} (${r.domain}): serp=${r.serp_agent_id}, pdp=${r.pdp_agent_id}`);
  }
}

fix().catch(console.error);
