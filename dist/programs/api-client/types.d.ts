export interface ApiClientConfig {
    keyId: string;
    issuerId: string;
    privateKey: string;
    baseURL?: string;
}
export interface ApiResponse<T> {
    data: T;
    meta?: Record<string, any>;
    links?: Record<string, string>;
}
export interface ApiError {
    code: string;
    title: string;
    detail?: string;
    status?: string;
}
//# sourceMappingURL=types.d.ts.map