import jwt from 'jsonwebtoken';
import { AuthConfig, JWTPayload } from './types.js';

interface CachedToken {
    token: string;
    expiresAt: number; // unix seconds
}

export class JWTGenerator {
    private static readonly AUDIENCE = 'appstoreconnect-v1';
    private static readonly ALGORITHM = 'ES256' as const;
    private static readonly DEFAULT_EXPIRATION_MINUTES = 20;
    // Refresh token 60 s before expiry to avoid clock skew issues
    private static readonly REFRESH_BUFFER_SECONDS = 60;

    private static cache = new Map<string, CachedToken>();

    public static generateToken(config: AuthConfig): string {
        const cacheKey = `${config.keyId}:${config.issuerId}`;
        const now = Math.floor(Date.now() / 1000);
        const cached = JWTGenerator.cache.get(cacheKey);

        if (cached && cached.expiresAt - JWTGenerator.REFRESH_BUFFER_SECONDS > now) {
            return cached.token;
        }

        const expirationMinutes = config.expirationMinutes || this.DEFAULT_EXPIRATION_MINUTES;
        const exp = now + expirationMinutes * 60;

        const payload: JWTPayload = {
            iss: config.issuerId,
            iat: now,
            exp,
            aud: this.AUDIENCE,
        };

        const token = jwt.sign(payload, config.privateKey, {
            algorithm: this.ALGORITHM,
            keyid: config.keyId,
        });

        JWTGenerator.cache.set(cacheKey, { token, expiresAt: exp });
        return token;
    }

    public static validatePrivateKey(privateKey: string): boolean {
        try {
            const lines = privateKey.trim().split('\n');
            const firstLine = lines[0] ?? '';
            const lastLine = lines[lines.length - 1] ?? '';
            // Apple .p8 keys use either PKCS#8 ("BEGIN PRIVATE KEY") or
            // SEC1 ("BEGIN EC PRIVATE KEY") format depending on generation time
            const hasBeginMarker =
                firstLine.includes('BEGIN PRIVATE KEY') ||
                firstLine.includes('BEGIN EC PRIVATE KEY');
            const hasEndMarker =
                lastLine.includes('END PRIVATE KEY') ||
                lastLine.includes('END EC PRIVATE KEY');

            return hasBeginMarker && hasEndMarker;
        } catch {
            return false;
        }
    }
}
