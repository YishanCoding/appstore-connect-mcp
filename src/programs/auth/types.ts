export interface JWTPayload {
    // 团队 Key 带 iss；个人 Key 不带 iss，改为 sub: 'user'
    iss?: string;
    sub?: 'user';
    iat: number;
    exp: number;
    aud: string;
}

export interface AuthConfig {
    keyId: string;
    /** 留空即个人 Key（Individual API Key） */
    issuerId?: string;
    privateKey: string;
    expirationMinutes?: number;
}