import axios, { AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { JWTGenerator } from '../auth/index.js';
import { ApiClientConfig } from './types.js';
import { HttpCall, HttpResult, HttpTransport, sendWithPolicy } from './policy.js';

function getProxyAgent() {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    if (!proxyUrl) return undefined;
    return new HttpsProxyAgent(proxyUrl);
}

export const API_HOST = 'api.appstoreconnect.apple.com';

/** links.next is only followed on Apple's API host, so the JWT never goes elsewhere. */
export function assertApiHost(next: string): void {
    let host: string;
    try {
        host = new URL(next, AppStoreConnectClient.BASE_URL).host;
    } catch {
        throw new Error(`links.next 不是合法 URL，已停止翻页: ${next}`);
    }
    if (host !== API_HOST) throw new Error(`links.next 指向 ${host}，不是 ${API_HOST}，已停止翻页`);
}

export interface ClientOptions {
    transport?: HttpTransport;
    sleep?: (ms: number) => Promise<void>;
    onRequest?: (info: { method: string; path: string; status: number; ms: number }) => void;
}

export class AppStoreConnectClient {
    public static readonly BASE_URL = 'https://api.appstoreconnect.apple.com/v1';
    private client?: AxiosInstance;
    private config: ApiClientConfig;
    private transport?: HttpTransport;
    private sleep?: (ms: number) => Promise<void>;
    private onRequest?: ClientOptions['onRequest'];

    constructor(config: ApiClientConfig, options?: ClientOptions) {
        this.config = config;
        this.transport = options?.transport;
        this.sleep = options?.sleep;
        this.onRequest = options?.onRequest;
        if (this.transport) return;

        const agent = getProxyAgent();
        this.client = axios.create({
            baseURL: config.baseURL || AppStoreConnectClient.BASE_URL,
            timeout: 60_000,
            headers: {
                'Content-Type': 'application/json',
            },
            ...(agent ? { httpsAgent: agent, proxy: false } : {}),
        });

        this.client.interceptors.request.use((req) => {
            const token = JWTGenerator.generateToken({
                keyId: this.config.keyId,
                issuerId: this.config.issuerId,
                privateKey: this.config.privateKey,
            });
            req.headers.Authorization = `Bearer ${token}`;
            return req;
        });
    }

    public getClient(): AxiosInstance {
        if (!this.client) {
            throw new Error('No axios client when a custom transport is injected');
        }
        return this.client;
    }

    public getBaseURL(): string {
        return this.config.baseURL || AppStoreConnectClient.BASE_URL;
    }

    private async sendOnce(call: HttpCall): Promise<HttpResult> {
        if (this.transport) return this.transport.send(call);
        const started = Date.now();
        try {
            const response = await this.client!.request({
                method: call.method,
                url: call.url,
                params: call.params,
                data: call.data,
                validateStatus: () => true,
            });
            const headers: Record<string, string | undefined> = {};
            for (const [key, value] of Object.entries(response.headers ?? {})) {
                if (typeof value === 'string') headers[key.toLowerCase()] = value;
                else if (Array.isArray(value) && typeof value[0] === 'string') headers[key.toLowerCase()] = value[0];
            }
            this.onRequest?.({
                method: call.method,
                path: call.url,
                status: response.status,
                ms: Date.now() - started,
            });
            return { status: response.status, headers, data: response.data };
        } catch (error) {
            this.onRequest?.({
                method: call.method,
                path: call.url,
                status: 0,
                ms: Date.now() - started,
            });
            throw error;
        }
    }

    private async request<T>(method: HttpCall['method'], url: string, params?: Record<string, any>, data?: unknown): Promise<T> {
        const result = await sendWithPolicy((call) => this.sendOnce(call), { method, url, params, data }, { sleep: this.sleep });
        return result.data as T;
    }

    public async get<T>(path: string, params?: Record<string, any>): Promise<T> {
        return this.request<T>('GET', path, params);
    }

    public async post<T>(path: string, data: any): Promise<T> {
        return this.request<T>('POST', path, undefined, data);
    }

    public async patch<T>(path: string, data: any): Promise<T> {
        return this.request<T>('PATCH', path, undefined, data);
    }

    public async delete(path: string, data?: any): Promise<void> {
        await this.request('DELETE', path, undefined, data);
    }

    /**
     * Follow links.next until the optional item cap is reached.
     * Page size is capped at 200 (App Store Connect's max). limit 0 / unset fetches every page.
     */
    public async getAllPages<T = any>(
        path: string,
        params: Record<string, any> = {},
        options?: { limit?: number }
    ): Promise<T[]> {
        const maxItems = options?.limit && options.limit > 0 ? options.limit : Number.POSITIVE_INFINITY;
        const items: T[] = [];
        let nextUrl: string | undefined;
        let first = true;
        let pages = 0;
        let emptyWithNext = false;

        while (items.length < maxItems && pages < 1000) {
            pages += 1;
            const remaining = maxItems - items.length;
            const requested = Number(params.limit ?? 200);
            const pageSize = Math.min(200, remaining, Number.isFinite(requested) && requested > 0 ? requested : 200);
            let response: { data?: T[]; links?: { next?: string } };
            if (first) {
                response = await this.get(path, { ...params, limit: pageSize });
                first = false;
            } else if (nextUrl) {
                response = await this.get(nextUrl);
            } else {
                break;
            }

            const page = response.data ?? [];
            items.push(...page);
            nextUrl = response.links?.next;
            if (nextUrl && page.length === 0) emptyWithNext = true;
            if (!nextUrl || page.length === 0) break;
            assertApiHost(nextUrl);
        }

        if (nextUrl && items.length < maxItems) {
            throw new Error(emptyWithNext
                ? `分页在第 ${pages} 页返回空数据但仍有下一页，结果不完整`
                : '分页在 1000 页后仍有下一页，结果不完整');
        }

        return Number.isFinite(maxItems) ? items.slice(0, maxItems) : items;
    }

    public async followPages<T extends { data: any[]; links?: { next?: string } }>(
        path: string,
        params: Record<string, any> = {},
        maxItems = 0
    ): Promise<T['data']> {
        return this.getAllPages(path, params, { limit: maxItems > 0 ? maxItems : undefined });
    }
}
