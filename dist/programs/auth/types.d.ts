export interface JWTPayload {
    iss: string;
    iat: number;
    exp: number;
    aud: string;
}
export interface AuthConfig {
    keyId: string;
    issuerId: string;
    privateKey: string;
    expirationMinutes?: number;
}
//# sourceMappingURL=types.d.ts.map