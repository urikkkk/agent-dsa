// ============================================================
// Shared Types for agent-dsa
// ============================================================

// --- Enums ---

export type ProductCategory =
  | 'cereal'
  | 'snacks'
  | 'baking'
  | 'yogurt'
  | 'meals'
  | 'pet'
  | 'other';

export type RunStatus =
  | 'pending'
  | 'planning'
  | 'collecting'
  | 'analyzing'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

export type CollectionMethod = 'website_search_agent' | 'nimble_web_tools';

export type CollectionTier = 'wsa' | 'search_extract' | 'generic_llm';

export type MatchMethod = 'upc' | 'exact_title' | 'fuzzy' | 'manual';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'custom';

export type LocationSource = 'discovered' | 'manual';

export type AgentEntityType = 'serp' | 'pdp' | 'clp';

export type ValidationStatus = 'pass' | 'warn' | 'fail';

export type RunStepType =
  | 'serp'
  | 'pdp'
  | 'category'
  | 'validation'
  | 'aggregation';

export type NimbleStep = 'serp' | 'pdp' | 'fallback';

export type RetryOutcome = 'success' | 'fail' | 'timeout';

export type QuestionType =
  | 'best_price'
  | 'price_trend'
  | 'oos_monitor'
  | 'serp_sov'
  | 'assortment_coverage'
  | 'promotion_scan';

export interface CollectionPlan {
  question_type: QuestionType;
  keywords: Array<{
    keyword: string;
    priority: number;
  }>;
  retailers: string[];
}

export type AnswerStatus = 'pending' | 'ready' | 'error';

// --- Core Entities ---

export interface Location {
  id: string;
  city: string;
  state: string;
  country: string;
  zip_codes: string[];
  timezone: string;
  is_active: boolean;
  source: LocationSource;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface NimbleAgent {
  id: string;
  template_id: number;
  name: string;
  domain?: string;
  entity_type: AgentEntityType;
  capabilities: Record<string, unknown>;
  last_seen_at?: string;
  is_healthy: boolean;
  status_note?: string;
  created_at: string;
  updated_at: string;
}

export interface Retailer {
  id: string;
  name: string;
  domain: string;
  serp_agent_id?: string;
  pdp_agent_id?: string;
  supports_location: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category?: ProductCategory;
  is_competitor: boolean;
  upc?: string;
  synonyms: string[];
  created_at: string;
  updated_at: string;
}

export interface ProductMatch {
  id: string;
  retailer_id: string;
  retailer_sku: string;
  retailer_url?: string;
  product_id?: string;
  confidence?: number;
  match_method?: MatchMethod;
  manual_override: boolean;
  created_at: string;
  updated_at: string;
}

// --- Question-driven ---

export interface QuestionTemplate {
  id: string;
  type: QuestionType;
  name: string;
  prompt_template: string;
  description?: string;
  default_parameters: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  location_id?: string;
  retailer_ids: string[];
  keyword_set_id?: string;
  keyword_set_version?: number;
  categories?: string[];
  parameters: Record<string, unknown>;
  question_text?: string;
  question_template_id?: string;
  agent_session_id?: string;
  status: RunStatus;
  started_at?: string;
  finished_at?: string;
  summary?: string;
  total_cost_usd?: number;
  created_at: string;
  updated_at: string;
}

export interface Answer {
  id: string;
  run_id: string;
  question_template_id?: string;
  question_text: string;
  answer_text: string;
  answer_data?: Record<string, unknown>;
  status: AnswerStatus;
  confidence?: number;
  sources_count: number;
  created_at: string;
}

// --- Execution ---

export interface RunStep {
  id: string;
  run_id: string;
  step_type: RunStepType;
  retailer_id?: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  request_count: number;
  success_count: number;
  failure_count: number;
  summary?: Record<string, unknown>;
}

export interface SerpCandidate {
  id: string;
  run_id: string;
  keyword_set_item_id?: string;
  retailer_id: string;
  rank?: number;
  title?: string;
  is_sponsored: boolean;
  snippet_price?: number;
  badge?: string;
  pdp_url?: string;
  retailer_product_id?: string;
  raw_payload?: Record<string, unknown>;
  created_at: string;
}

export interface Observation {
  id: string;
  run_id: string;
  retailer_id: string;
  location_id: string;
  product_id?: string;
  product_match_id?: string;
  shelf_price?: number;
  promo_price?: number;
  unit_price?: number;
  size_oz?: number;
  size_raw?: string;
  pack_count: number;
  in_stock?: boolean;
  rating?: number;
  review_count?: number;
  serp_rank?: number;
  confidence?: number;
  raw_payload?: Record<string, unknown>;
  source_url?: string;
  collection_method?: CollectionMethod;
  collection_tier?: CollectionTier;
  zip_used?: string;
  validation_status?: ValidationStatus;
  validation_reasons: string[];
  quality_score?: number;
  ai_parsed_fields?: Record<string, unknown>;
  ai_confidence?: number;
  is_published: boolean;
  created_at: string;
}

// --- Nimble I/O ---

export interface NimbleRequest {
  id: string;
  run_id?: string;
  run_step_id?: string;
  retailer_id?: string;
  agent_template_id?: number;
  collection_tier?: CollectionTier;
  request_payload?: Record<string, unknown>;
  keyword?: string;
  location_context?: Record<string, unknown>;
  attempt_number: number;
  created_at: string;
}

export interface NimbleResponse {
  id: string;
  nimble_request_id: string;
  raw_payload?: Record<string, unknown>;
  payload_ref?: string;
  payload_sha256?: string;
  payload_size_bytes?: number;
  parsing_summary?: Record<string, unknown>;
  http_status?: number;
  response_size_bytes?: number;
  latency_ms?: number;
  created_at: string;
}

// --- Quality ---

export interface ValidationResult {
  id: string;
  run_id?: string;
  observation_id?: string;
  status: ValidationStatus;
  reasons: string[];
  quality_score?: number;
  validator_version?: string;
  created_at: string;
}

export interface FallbackEvent {
  id: string;
  run_id: string;
  retailer_id?: string;
  keyword?: string;
  from_tier?: CollectionTier;
  to_tier?: CollectionTier;
  trigger_reason?: string;
  trigger_details?: Record<string, unknown>;
  created_at: string;
}

export interface AgentHealthDaily {
  id: string;
  date: string;
  retailer_id?: string;
  agent_template_id?: number;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  success_rate?: number;
  pct_wsa?: number;
  pct_fallback?: number;
  last_failure_reason?: string;
  first_failure_at?: string;
}

// --- Scheduling ---

export interface Subscription {
  id: string;
  name: string;
  location_id?: string;
  retailer_ids: string[];
  keyword_set_id?: string;
  question_template_id?: string;
  categories?: string[];
  frequency: ScheduleFrequency;
  interval_hours?: number;
  schedule_time?: string;
  days_of_week?: number[];
  timezone?: string;
  next_run_at?: string;
  last_run_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KeywordSet {
  id: string;
  name: string;
  description?: string;
  version: number;
  category_tag?: string;
  is_default: boolean;
  parent_id?: string;
  created_at: string;
}

export interface KeywordSetItem {
  id: string;
  keyword_set_id: string;
  keyword: string;
  retailer_scope?: string;
  category_tag?: string;
  expected_brand?: string;
  priority: number;
}

// --- Observability ---

export interface RunError {
  id: string;
  run_id: string;
  retailer_id?: string;
  step?: NimbleStep;
  keyword?: string;
  input_params?: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
  error_type?: string;
  attempt_count: number;
  last_attempt_at?: string;
  retry_count: number;
  created_at: string;
}

export interface AgentLog {
  id: string;
  run_id: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  reasoning?: string;
  token_usage?: { input: number; output: number };
  cost_usd?: number;
  duration_ms?: number;
  created_at: string;
}

// --- Ledger / Observability ---

export type AgentName = 'webops' | 'dsa' | 'planner';

export type LedgerEventStatus = 'started' | 'completed' | 'failed' | 'skipped' | 'retrying';

export type LedgerEventType = 'task' | 'step' | 'tool_door_violation' | 'watchdog_timeout';

export type NextActionHint = 'retry' | 'fallback' | 'skip' | 'abort';

export interface LedgerEvent {
  id: string;
  run_id: string;
  event_type: LedgerEventType;
  agent_name: AgentName;
  step_name: string;
  task_id: string;
  attempt: number;
  status: LedgerEventStatus;
  span_id: string;
  parent_span_id?: string;
  tool_name?: string;
  input_ref?: string;
  output_ref?: string;
  error?: { code: string; message: string; stack?: string };
  metrics?: { latency_ms?: number; tokens?: { input: number; output: number }; cost_usd?: number };
  provenance?: Record<string, unknown>;
  next_action_hint?: NextActionHint;
  created_at: string;
}

export interface LedgerArtifact {
  id: string;
  run_id: string;
  content_type: string;
  payload?: Record<string, unknown>;
  storage_ref?: string;
  size_bytes?: number;
  sha256?: string;
  created_at: string;
}

// --- Run Event Streaming ---

export type RunEventType =
  | 'step_started'
  | 'step_summary'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'retrying'
  | 'skipped'
  | 'heartbeat'
  | 'run_complete';

export interface RunEvent {
  timestamp: string;
  run_id: string;
  event_type: RunEventType;
  agent_name: AgentName;
  step_name: string;
  tool_name?: string;
  task_id?: string;
  attempt?: number;
  status?: LedgerEventStatus;
  message: string;
  error?: { code: string; message: string };
  next_action_hint?: NextActionHint;
  summary?: StepSummary;
  final?: {
    success: boolean;
    answer_id?: string;
    total_cost_usd?: number;
    num_turns?: number;
    webops_summary?: StepSummary;
    dsa_summary?: StepSummary;
  };
}

export interface StepSummary {
  total_tasks: number;
  completed: number;
  failed: number;
  skipped: number;
  coverage_pct: number;
  fallback_rate: number;
  validation_breakdown: { pass: number; warn: number; fail: number };
  error_clusters: Array<{ code: string; count: number; sample_task_id: string }>;
  rerun_plan: Array<{ task_id: string; next_action_hint: NextActionHint; reason: string }>;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

export interface AuditEvent {
  id: string;
  user_action: string;
  entity_type?: string;
  entity_id?: string;
  before_state?: Record<string, unknown>;
  after_state?: Record<string, unknown>;
  notes?: string;
  created_at: string;
}

// --- Nimble API types ---

export interface NimbleAgentRunParams {
  agent_name: string;
  params: Record<string, unknown>;
}

export interface NimbleSearchAgentParams {
  agent_name: string;
  keyword: string;
  zip_code?: string;
}

export interface NimblePdpAgentParams {
  agent_name: string;
  product_id: string;
  zip_code?: string;
}

export interface NimbleWebSearchParams {
  query: string;
  focus?: 'general' | 'shopping' | 'news' | 'geo' | 'social';
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
  deep_search?: boolean;
  country?: string;
}

export interface NimbleUrlExtractParams {
  url: string;
  output_format?: 'html' | 'markdown' | 'simplified_html';
  render?: boolean;
  driver?: string;
  country?: string;
}

export interface NimbleAgentRunResponse<T = unknown> {
  url: string;
  task_id: string;
  status: string;
  data: T;
}

export interface NimbleSearchResponse<T = unknown> {
  total_results: number;
  results: T[];
  request_id?: string;
}

export interface NimbleExtractResponse {
  content: string;
  title: string;
  description: string;
  url: string;
  metadata?: Record<string, unknown>;
}

/** @deprecated Use NimbleAgentRunResponse or NimbleSearchResponse */
export interface NimbleApiResponse<T = unknown> {
  status: string;
  data: T;
  request_id?: string;
}

// --- Parsed product from PDP ---

export interface ParsedProduct {
  name: string;
  brand: string;
  size_oz: number;
  size_raw: string;
  pack_count: number;
  shelf_price: number;
  promo_price?: number;
  unit_price: number;
  in_stock: boolean;
  rating?: number;
  review_count?: number;
  source_url: string;
  retailer_product_id?: string;
  confidence: number;
}

export interface NimbleSerpResult {
  rank: number;
  title: string;
  url: string;
  price?: number;
  is_sponsored: boolean;
  badge?: string;
  retailer_product_id?: string;
  rating?: number;
  review_count?: number;
}

export interface NimblePdpResult {
  title: string;
  brand?: string;
  price: number | null;
  promo_price?: number;
  size_raw?: string;
  unit_price?: number;
  in_stock: boolean;
  rating?: number;
  review_count?: number;
  variants?: unknown[];
  url: string;
}

// --- Validation ---

export interface ValidationRuleResult {
  passed: boolean;
  severity: 'fail' | 'warn';
  reason?: string;
}

export interface ValidationRule {
  name: string;
  check: (obs: Observation, history?: Observation[]) => ValidationRuleResult;
}

// --- HTTP Server Types ---

export type SuggestedActionType =
  | 'retry_failed' | 'show_debug' | 'rerun_with_location' | 'rerun_broader';

export interface SuggestedAction {
  action: SuggestedActionType;
  label: string;
  description: string;
  payload: Record<string, unknown>;
}

export interface EnrichedRunResult {
  run_id: string;
  success: boolean;
  final_answer: string | null;
  confidence: number | null;
  summaries: Record<string, unknown>[];
  suggested_next_actions: SuggestedAction[];
  total_cost_usd: number | null;
  num_turns: number | null;
  error: string | null;
}

export interface StartRunRequest {
  question_text: string;
  location_id?: string;
  retailer_ids?: string[];
  parameters?: Record<string, unknown>;
}

export interface StartRunResponse {
  run_id: string;
  stream_url: string;
}

export interface RunActionRequest {
  action: 'retry_failed' | 'show_debug' | 'rerun_with_location';
  payload?: Record<string, unknown>;
}
