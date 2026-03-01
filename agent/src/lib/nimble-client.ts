import type {
  NimbleSearchAgentParams,
  NimblePdpAgentParams,
  NimbleWebSearchParams,
  NimbleUrlExtractParams,
  NimbleApiResponse,
} from '@agent-dsa/shared';

const NIMBLE_BASE_URL =
  process.env.NIMBLE_API_BASE_URL || 'https://api.nimbleway.com';
const NIMBLE_API_KEY = process.env.NIMBLE_API_KEY || '';
const DEFAULT_TIMEOUT = 30_000;

export class NimbleClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || NIMBLE_BASE_URL;
    this.apiKey = apiKey || NIMBLE_API_KEY;
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT
  ): Promise<NimbleApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new NimbleApiError(
          response.status,
          `Nimble API error: ${response.status} ${response.statusText}`,
          await response.text().catch(() => '')
        );
      }

      return (await response.json()) as NimbleApiResponse<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  async runSearchAgent<T = unknown>(
    params: NimbleSearchAgentParams
  ): Promise<NimbleApiResponse<T>> {
    return this.request<T>('/api/v1/search', {
      template_id: params.template_id,
      query: params.query,
      zip_code: params.zip_code,
      country: params.country || 'US',
      num_results: params.num_results || 30,
      parse: params.parse ?? true,
    });
  }

  async runPdpAgent<T = unknown>(
    params: NimblePdpAgentParams
  ): Promise<NimbleApiResponse<T>> {
    return this.request<T>('/api/v1/product', {
      template_id: params.template_id,
      url: params.url,
      zip_code: params.zip_code,
      country: params.country || 'US',
      parse: params.parse ?? true,
    });
  }

  async webSearch<T = unknown>(
    params: NimbleWebSearchParams
  ): Promise<NimbleApiResponse<T>> {
    return this.request<T>('/api/v1/web/search', {
      query: params.query,
      focus: params.focus || 'general',
      max_results: params.max_results || 10,
      include_domains: params.include_domains,
    });
  }

  async urlExtract<T = unknown>(
    params: NimbleUrlExtractParams
  ): Promise<NimbleApiResponse<T>> {
    return this.request<T>(
      '/api/v1/web/extract',
      {
        url: params.url,
        render: params.render ?? false,
        content_type: params.content_type || 'markdown',
      },
      45_000
    );
  }

  async listAgents(): Promise<NimbleApiResponse<unknown[]>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/agents`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new NimbleApiError(
          response.status,
          `Nimble API error: ${response.status}`,
          ''
        );
      }
      return (await response.json()) as NimbleApiResponse<unknown[]>;
    } finally {
      clearTimeout(timer);
    }
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
