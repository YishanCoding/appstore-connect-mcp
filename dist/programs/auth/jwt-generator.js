import jwt from 'jsonwebtoken';
export class JWTGenerator {
    static AUDIENCE = 'appstoreconnect-v1';
    static ALGORITHM = 'ES256';
    static DEFAULT_EXPIRATION_MINUTES = 20;
    static generateToken(config) {
        const now = Math.floor(Date.now() / 1000);
        const expirationMinutes = config.expirationMinutes || this.DEFAULT_EXPIRATION_MINUTES;
        const payload = {
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
    static validatePrivateKey(privateKey) {
        try {
            const lines = privateKey.trim().split('\n');
            const hasBeginMarker = lines[0].includes('BEGIN PRIVATE KEY');
            const hasEndMarker = lines[lines.length - 1].includes('END PRIVATE KEY');
            return hasBeginMarker && hasEndMarker;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=jwt-generator.js.map