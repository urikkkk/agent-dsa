import type {
  NimbleSearchAgentParams,
  NimblePdpAgentParams,
  NimbleWebSearchParams,
  NimbleUrlExtractParams,
  NimbleAgentRunResponse,
  NimbleSearchResponse,
  NimbleExtractResponse,
} from '@agent-dsa/shared';

const NIMBLE_BASE_URL =
  process.env.NIMBLE_API_BASE_URL || 'https://sdk.nimbleway.com';
const NIMBLE_API_KEY = process.env.NIMBLE_API_KEY || '';

// WSA agents can take 30-120s to scrape real websites
const WSA_TIMEOUT = 120_000;
const SEARCH_TIMEOUT = 60_000;
const EXTRACT_TIMEOUT = 60_000;
const DEFAULT_TIMEOUT = 30_000;

export class NimbleClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || NIMBLE_BASE_URL;
    this.apiKey = apiKey || NIMBLE_API_KEY;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (response.status === 400) {
          console.error(`[NimbleClient] 400 Bad Request on ${endpoint}:`, text.slice(0, 500));
        }
        throw new NimbleApiError(
          response.status,
          `Nimble API error: ${response.status} ${response.statusText}`,
          text
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Run a WSA agent (SERP or PDP) via /v1/agents/run.
   * The API blocks until the agent finishes scraping (can take 10-120s).
   */
  async runAgent<T = unknown>(
    agentName: string,
    params: Record<string, unknown>
  ): Promise<NimbleAgentRunResponse<T>> {
    return this.request<NimbleAgentRunResponse<T>>(
      'POST',
      '/v1/agents/run',
      { agent: agentName, params },
      WSA_TIMEOUT
    );
  }

  async runSearchAgent<T = unknown>(
    params: NimbleSearchAgentParams
  ): Promise<NimbleAgentRunResponse<T>> {
    const agentParams: Record<string, unknown> = {
      keyword: params.keyword,
    };
    if (params.zip_code) {
      // Amazon uses zip_code, Walmart uses zipcode
      agentParams.zip_code = params.zip_code;
      agentParams.zipcode = params.zip_code;
    }
    return this.runAgent<T>(params.agent_name, agentParams);
  }

  async runPdpAgent<T = unknown>(
    params: NimblePdpAgentParams
  ): Promise<NimbleAgentRunResponse<T>> {
    const agentParams: Record<string, unknown> = {};
    // Amazon PDP uses "asin", Walmart PDP uses "product_id"
    if (params.agent_name.includes('amazon')) {
      agentParams.asin = params.product_id;
    } else {
      agentParams.product_id = params.product_id;
    }
    if (params.zip_code) {
      agentParams.zip_code = params.zip_code;
      agentParams.zipcode = params.zip_code;
    }
    return this.runAgent<T>(params.agent_name, agentParams);
  }

  async webSearch<T = unknown>(
    params: NimbleWebSearchParams
  ): Promise<NimbleSearchResponse<T>> {
    const body: Record<string, unknown> = {
      query: params.query,
      focus: params.focus || 'general',
      max_results: params.max_results || 10,
    };
    if (params.include_domains) body.include_domains = params.include_domains;
    if (params.exclude_domains) body.exclude_domains = params.exclude_domains;
    if (params.deep_search !== undefined) body.deep_search = params.deep_search;
    if (params.country) body.country = params.country;

    return this.request<NimbleSearchResponse<T>>(
      'POST',
      '/v1/search',
      body,
      SEARCH_TIMEOUT
    );
  }

  async urlExtract(
    params: NimbleUrlExtractParams
  ): Promise<NimbleExtractResponse> {
    const body: Record<string, unknown> = {
      url: params.url,
      formats: [params.output_format || 'markdown'],
    };
    if (params.render) body.render = params.render;
    if (params.driver) body.driver = params.driver;
    if (params.country) body.country = params.country;

    return this.request<NimbleExtractResponse>(
      'POST',
      '/v1/extract',
      body,
      EXTRACT_TIMEOUT
    );
  }

  async listAgents(): Promise<unknown[]> {
    const data = await this.request<unknown>('GET', '/v1/agents/list');
    return Array.isArray(data) ? data : (data as Record<string, unknown>).templates as unknown[] || [];
  }

  async getAgent(agentName: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/v1/agents/get?template_name=${encodeURIComponent(agentName)}`
    );
  }
}

export class NimbleApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly responseBody: string
  ) {
    super(message);
    this.name = 'NimbleApiError';
  }
}

let _client: NimbleClient | null = null;
export function getNimbleClient(): NimbleClient {
  if (!_client) _client = new NimbleClient();
  return _client;
}
