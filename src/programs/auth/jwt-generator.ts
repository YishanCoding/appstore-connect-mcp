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