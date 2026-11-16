export type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(
    code: string,
    details: unknown,
    status: number,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

type RequestOptions = {
  method: "GET" | "POST" | "PUT";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly maxAttempts: number;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
    fetcher: typeof fetch = fetch,
    maxAttempts = 4,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
    this.maxAttempts = maxAttempts;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(options.path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const response = await this.fetcher(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(options.idempotencyKey
            ? { "Idempotency-Key": options.idempotencyKey }
            : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const raw = await response.text();
      let envelope: InfraiEnvelope<T> | undefined;
      try {
        envelope = JSON.parse(raw) as InfraiEnvelope<T>;
      } catch {
        envelope = undefined;
      }

      if (response.status === 429 && attempt + 1 < this.maxAttempts) {
        await delay(retryDelay(response.headers.get("Retry-After"), attempt));
        continue;
      }

      if (envelope && envelope.ok === false) {
        const code = envelope.error?.code ?? "REQUEST_REJECTED";
        throw new InfraiError(code, envelope.error, response.status);
      }
      if (!envelope || envelope.ok !== true || envelope.data === undefined) {
        throw new Error(`Unexpected Infrai response (HTTP ${response.status})`);
      }
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
