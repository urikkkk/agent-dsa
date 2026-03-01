-- ============================================================
-- Seed Data for Agent DSA
-- ============================================================

-- Question templates (6 types)
INSERT INTO question_templates (type, name, prompt_template, description, default_parameters) VALUES
  ('best_price', 'Best Price Finder',
   'Find the best current price for {{product}} across {{retailers}} in {{location}}. Compare shelf prices, promo prices, and unit prices. Return the best deal with source URL.',
   'Finds the lowest price for a product across multiple retailers in a given location.',
   '{"num_results": 10, "include_promo": true}'::jsonb),

  ('price_trend', 'Price Trend Tracker',
   'Track the price trend for {{product}} at {{retailer}} in {{location}} over the last {{period}}. Identify any price changes, promotions, or patterns.',
   'Monitors price changes over time for a specific product-retailer combination.',
   '{"period": "30d", "min_observations": 3}'::jsonb),

  ('oos_monitor', 'Out-of-Stock Monitor',
   'Check availability of {{products}} across {{retailers}} in {{location}}. Report which items are in stock, out of stock, or have limited availability.',
   'Monitors product availability across retailers.',
   '{"check_variants": true}'::jsonb),

  ('serp_sov', 'SERP Share of Voice',
   'Search for "{{keyword}}" on {{retailer}} in {{location}}. Analyze the first {{num_results}} results. Report brand share of voice, sponsored vs organic positioning, and our brand rank.',
   'Measures brand visibility in retailer search results.',
   '{"num_results": 30, "our_brands": ["General Mills", "Cheerios", "Nature Valley"]}'::jsonb),

  ('assortment_coverage', 'Assortment Coverage',
   'Check which products from {{product_list}} are available at {{retailer}} in {{location}}. Report coverage percentage and any missing items.',
   'Verifies product assortment coverage at a retailer.',
   '{"match_threshold": 0.7}'::jsonb),

  ('promotion_scan', 'Promotion Scanner',
   'Scan {{retailer}} for active promotions on {{category}} products in {{location}}. Look for price cuts, BOGO deals, digital coupons, and special badges.',
   'Discovers active promotions for a product category at a retailer.',
   '{"include_sponsored": false}'::jsonb);

-- Nimble WSA agents (known templates)
INSERT INTO nimble_agents (template_id, name, domain, entity_type, capabilities) VALUES
  (649, 'Walmart SERP', 'walmart.com', 'serp', '{"supports_zip": true, "supports_query": true}'::jsonb),
  (650, 'Walmart PDP', 'walmart.com', 'pdp', '{"supports_zip": true, "supports_url": true}'::jsonb),
  (651, 'Amazon SERP', 'amazon.com', 'serp', '{"supports_zip": true, "supports_query": true}'::jsonb),
  (652, 'Amazon PDP', 'amazon.com', 'pdp', '{"supports_zip": false, "supports_url": true}'::jsonb),
  (661, 'Target SERP', 'target.com', 'serp', '{"supports_zip": true, "supports_query": true}'::jsonb),
  (662, 'Target PDP', 'target.com', 'pdp', '{"supports_zip": true, "supports_url": true}'::jsonb),
  (667, 'Kroger SERP', 'kroger.com', 'serp', '{"supports_zip": true, "supports_query": true}'::jsonb),
  (668, 'Kroger PDP', 'kroger.com', 'pdp', '{"supports_zip": true, "supports_url": true}'::jsonb);

-- Retailers (linked to agents)
INSERT INTO retailers (name, domain, serp_agent_id, pdp_agent_id, supports_location) VALUES
  ('Walmart', 'walmart.com',
    (SELECT id FROM nimble_agents WHERE template_id = 649),
    (SELECT id FROM nimble_agents WHERE template_id = 650),
    true),
  ('Amazon', 'amazon.com',
    (SELECT id FROM nimble_agents WHERE template_id = 651),
    (SELECT id FROM nimble_agents WHERE template_id = 652),
    true),
  ('Target', 'target.com',
    (SELECT id FROM nimble_agents WHERE template_id = 661),
    (SELECT id FROM nimble_agents WHERE template_id = 662),
    true),
  ('Kroger', 'kroger.com',
    (SELECT id FROM nimble_agents WHERE template_id = 667),
    (SELECT id FROM nimble_agents WHERE template_id = 668),
    true);

-- Sample locations
INSERT INTO locations (city, state, country, zip_codes, timezone) VALUES
  ('Chicago', 'IL', 'US', '["60601", "60602", "60603"]'::jsonb, 'America/Chicago'),
  ('New York', 'NY', 'US', '["10001", "10002", "10003"]'::jsonb, 'America/New_York'),
  ('Los Angeles', 'CA', 'US', '["90001", "90002", "90003"]'::jsonb, 'America/Los_Angeles');

-- Sample products (General Mills portfolio)
INSERT INTO products (name, brand, category, is_competitor) VALUES
  ('Cheerios Original', 'Cheerios', 'cereal', false),
  ('Honey Nut Cheerios', 'Cheerios', 'cereal', false),
  ('Lucky Charms', 'Lucky Charms', 'cereal', false),
  ('Cinnamon Toast Crunch', 'Cinnamon Toast Crunch', 'cereal', false),
  ('Nature Valley Crunchy Granola Bars', 'Nature Valley', 'snacks', false),
  ('Annie''s Organic Cheddar Bunnies', 'Annie''s', 'snacks', false),
  ('Pillsbury Crescent Rolls', 'Pillsbury', 'baking', false),
  ('Yoplait Original Strawberry', 'Yoplait', 'yogurt', false),
  -- Competitors
  ('Frosted Flakes', 'Kellogg''s', 'cereal', true),
  ('Raisin Bran', 'Kellogg''s', 'cereal', true),
  ('Froot Loops', 'Kellogg''s', 'cereal', true),
  ('Quaker Chewy Granola Bars', 'Quaker', 'snacks', true);

-- Default keyword set for cereal
INSERT INTO keyword_sets (name, description, version, category_tag, is_default) VALUES
  ('Core Cereal Keywords', 'Default search keywords for cereal category', 1, 'cereal', true);

INSERT INTO keyword_set_items (keyword_set_id, keyword, category_tag, expected_brand, priority) VALUES
  ((SELECT id FROM keyword_sets WHERE name = 'Core Cereal Keywords'), 'Cheerios cereal', 'cereal', 'Cheerios', 1),
  ((SELECT id FROM keyword_sets WHERE name = 'Core Cereal Keywords'), 'Honey Nut Cheerios', 'cereal', 'Cheerios', 1),
  ((SELECT id FROM keyword_sets WHERE name = 'Core Cereal Keywords'), 'Lucky Charms cereal', 'cereal', 'Lucky Charms', 2),
  ((SELECT id FROM keyword_sets WHERE name = 'Core Cereal Keywords'), 'Cinnamon Toast Crunch', 'cereal', 'Cinnamon Toast Crunch', 2),
  ((SELECT id FROM keyword_sets WHERE name = 'Core Cereal Keywords'), 'cereal', 'cereal', NULL, 3),
  ((SELECT id FROM keyword_sets WHERE name = 'Core Cereal Keywords'), 'breakfast cereal', 'cereal', NULL, 3);
