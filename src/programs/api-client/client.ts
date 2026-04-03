import axios, { AxiosInstance, AxiosError } from 'axios';
import { JWTGenerator } from '../auth/index.js';
import { ApiClientConfig, ApiError } from './types.js';

export class AppStoreConnectClient {
    public static readonly BASE_URL = 'https://api.appstoreconnect.apple.com/v1';
    private client: AxiosInstance;
    private config: ApiClientConfig;

    constructor(config: ApiClientConfig) {
        this.config = config;
        this.client = axios.create({
            baseURL: config.baseURL || AppStoreConnectClient.BASE_URL,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        this.setupInterceptors();
    }

    private setupInterceptors() {
        this.client.interceptors.request.use((config) => {
            const token = JWTGenerator.generateToken({
                keyId: this.config.keyId,
                issuerId: this.config.issuerId,
                privateKey: this.config.privateKey,
            });

            config.headers.Authorization = `Bearer ${token}`;
            return config;
        });

        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                if (error.response?.data) {
                    const apiErrors = (error.response.data as any).errors as ApiError[];
                    if (apiErrors && apiErrors.length > 0) {
                        const errorMessage = apiErrors
                            .map((e) => `${e.title}: ${e.detail || ''}`)
                            .join(', ');
                        throw new Error(errorMessage);
                    }
                }
                throw error;
            }
        );
    }

    public getClient(): AxiosInstance {
        return this.client;
    }

    public async get<T>(path: string, params?: Record<string, any>): Promise<T> {
        const response = await this.client.get<T>(path, { params });
        return response.data;
    }

    public async post<T>(path: string, data: any): Promise<T> {
        const response = await this.client.post<T>(path, data);
        return response.data;
    }

    public async patch<T>(path: string, data: any): Promise<T> {
        const response = await this.client.patch<T>(path, data);
        return response.data;
    }

    public async delete(path: string, data?: any): Promise<void> {
        await this.client.delete(path, { data });
    }

    /**
     * Follow pagination links and collect all items from a list endpoint.
     * Respects the caller-supplied limit; if limit is 0 or unset, fetches all pages.
     */
    public async followPages<T extends { data: any[]; links?: { next?: string } }>(
        path: string,
        params: Record<string, any> = {},
        maxItems = 0
    ): Promise<any[]> {
        const items: any[] = [];
        let nextUrl: string | undefined = undefined;

        do {
            let response: T;
            if (nextUrl) {
                // next is a full URL; strip base and use as path
                const relative = nextUrl.replace(AppStoreConnectClient.BASE_URL, '');
                response = await this.get<T>(relative);
            } else {
                response = await this.get<T>(path, params);
            }

            items.push(...response.data);
            nextUrl = response.links?.next;

            if (maxItems > 0 && items.length >= maxItems) break;
        } while (nextUrl);

        return maxItems > 0 ? items.slice(0, maxItems) : items;
    }
}