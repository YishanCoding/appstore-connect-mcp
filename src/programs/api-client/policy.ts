export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface HttpCall {
    method: HttpMethod;
    url: string;
    params?: Record<string, unknown>;
    data?: unknown;
}

export interface HttpResult {
    status: number;
    headers: Record<string, string | undefined>;
    data: unknown;
}

export interface HttpTransport {
    send(call: HttpCall): Promise<HttpResult>;
}

export class AscHttpError extends Error {
    readonly status: number;
    readonly code: string;
    readonly detail: string;

    constructor(status: number, code: string, detail: string) {
        super(detail || code || `HTTP ${status}`);
        this.name = 'AscHttpError';
        this.status = status;
        this.code = code || 'UNKNOWN';
        this.detail = detail || this.message;
    }
}

/** Same text origin/main's axios interceptor produced: every error, joined by `, `. */
export function formatApiErrors(errors: { title?: string; detail?: string }[] | undefined): string | undefined {
    if (!errors || errors.length === 0) return undefined;
    return errors.map((error) => `${error.title}: ${error.detail || ''}`).join(', ');
}

export function errorFromResponse(result: HttpResult): AscHttpError {
    const data = result.data as
        | { errors?: { status?: string; code?: string; title?: string; detail?: string }[] }
        | undefined;
    const errors = data?.errors ?? [];
    const first = errors[0];
    const status = Number(first?.status ?? result.status) || result.status;
    const code = first?.code || 'UNKNOWN';
    const formatted = formatApiErrors(errors);
    const detail = formatted || `Request failed with status code ${result.status}`;
    return new AscHttpError(status, code, detail);
}

export function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

export const MAX_RETRY_AFTER_MS = 60_000;

export function retryDelayMs(
    headers: Record<string, string | undefined>,
    attempt: number,
    now = Date.now()
): number {
    const raw = headers['retry-after'] ?? headers['Retry-After'];
    let delay: number | undefined;
    if (raw) {
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) delay = Math.max(0, seconds * 1000);
        else {
            const when = Date.parse(raw);
            if (!Number.isNaN(when)) delay = Math.max(0, when - now);
        }
    }
    if (delay === undefined) delay = Math.min(8000, 200 * 2 ** attempt);
    if (delay > MAX_RETRY_AFTER_MS) {
        throw new AscHttpError(
            429,
            'RETRY_AFTER',
            `Retry-After ${Math.ceil(delay / 1000)}s exceeds 60s`
        );
    }
    return delay;
}

const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * GET retries 429/5xx at most `maxGetRetries` times (default 3) and waits for Retry-After.
 * Any other method is sent exactly once.
 */
export async function sendWithPolicy(
    send: (call: HttpCall) => Promise<HttpResult>,
    call: HttpCall,
    opts?: { maxGetRetries?: number; sleep?: (ms: number) => Promise<void> }
): Promise<HttpResult> {
    const maxRetries = call.method === 'GET' ? (opts?.maxGetRetries ?? 3) : 0;
    const sleep = opts?.sleep ?? sleepDefault;
    let lastError: AscHttpError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let result: HttpResult;
        try {
            result = await send(call);
        } catch (error) {
            // Network failures (ENOTFOUND and the like) are not retried. origin/main
            // only surfaced the axios error once; HTTP 429/5xx still retry below.
            throw error;
        }

        if (result.status < 400) return result;

        const err = errorFromResponse(result);
        const canRetry = call.method === 'GET' && isRetryableStatus(result.status) && attempt < maxRetries;
        if (!canRetry) throw err;
        lastError = err;
        await sleep(retryDelayMs(result.headers, attempt));
    }

    throw lastError ?? new AscHttpError(0, 'UNKNOWN', 'request failed');
}
