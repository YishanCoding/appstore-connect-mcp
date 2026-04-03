import jwt from 'jsonwebtoken';
import { AuthConfig, JWTPayload } from './types.js';

export class JWTGenerator {
    private static readonly AUDIENCE = 'appstoreconnect-v1';
    private static readonly ALGORITHM = 'ES256' as const;
    private static readonly DEFAULT_EXPIRATION_MINUTES = 20;

    public static generateToken(config: AuthConfig): string {
        const now = Math.floor(Date.now() / 1000);
        const expirationMinutes = config.expirationMinutes || this.DEFAULT_EXPIRATION_MINUTES;
        
        const payload: JWTPayload = {
            iss: config.issuerId,
            iat: now,
            exp: now + (expirationMinutes * 60),
            aud: this.AUDIENCE,
        };

        const token = jwt.sign(payload, config.privateKey, {
            algorithm: this.ALGORITHM,
            keyid: config.keyId,
        });

        return token;
    }

    public static validatePrivateKey(privateKey: string): boolean {
        try {
            const lines = privateKey.trim().split('\n');
            const hasBeginMarker = lines[0].includes('BEGIN PRIVATE KEY');
            const hasEndMarker = lines[lines.length - 1].includes('END PRIVATE KEY');
            
            return hasBeginMarker && hasEndMarker;
        } catch {
            return false;
        }
    }
}