import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing env vars'); process.exit(1); }

const db = createClient(url, key);

async function check() {
  const { data: retailers, error: re } = await db.from('retailers').select('id, name, domain').eq('is_active', true);
  console.log('Retailers:', retailers?.length || 0, re?.message || '');
  retailers?.forEach(r => console.log('  -', r.name, r.domain));

  const { data: locations, error: le } = await db.from('locations').select('id, city, state');
  console.log('\nLocations:', locations?.length || 0, le?.message || '');
  locations?.forEach(l => console.log('  -', l.city, l.state));

  const { data: products, error: pe } = await db.from('products').select('id, name, brand').limit(5);
  console.log('\nProducts:', products?.length || 0, pe?.message || '');
  products?.forEach(p => console.log('  -', p.name, '(' + p.brand + ')'));

  const { data: agents, error: ae } = await db.from('nimble_agents').select('id, agent_name, agent_type');
  console.log('\nNimble Agents:', agents?.length || 0, ae?.message || '');
  agents?.forEach(a => console.log('  -', a.agent_name, a.agent_type));
}

check();
