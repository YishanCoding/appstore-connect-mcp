import { AxiosInstance } from 'axios';
import { ApiClientConfig } from './types.js';
export declare class AppStoreConnectClient {
    private static readonly BASE_URL;
    private client;
    private config;
    constructor(config: ApiClientConfig);
    private setupInterceptors;
    getClient(): AxiosInstance;
    get<T>(path: string, params?: Record<string, any>): Promise<T>;
    post<T>(path: string, data: any): Promise<T>;
    patch<T>(path: string, data: any): Promise<T>;
    delete(path: string): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map