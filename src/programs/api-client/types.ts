export interface ApiClientConfig {
    keyId: string;
    /** 团队 Key 的 Issuer ID；留空即个人 Key（Individual API Key） */
    issuerId?: string;
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