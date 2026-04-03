import { AuthConfig } from './types.js';
export declare class JWTGenerator {
    private static readonly AUDIENCE;
    private static readonly ALGORITHM;
    private static readonly DEFAULT_EXPIRATION_MINUTES;
    static generateToken(config: AuthConfig): string;
    static validatePrivateKey(privateKey: string): boolean;
}
//# sourceMappingURL=jwt-generator.d.ts.map