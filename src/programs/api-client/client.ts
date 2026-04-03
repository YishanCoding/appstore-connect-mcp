import axios, { AxiosInstance, AxiosError } from 'axios';
import { JWTGenerator } from '../auth/index.js';
import { ApiClientConfig, ApiError } from './types.js';

export class AppStoreConnectClient {
    private static readonly BASE_URL = 'https://api.appstoreconnect.apple.com/v1';
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

    public async delete(path: string): Promise<void> {
        await this.client.delete(path);
    }
}