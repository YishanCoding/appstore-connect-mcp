import axios from 'axios';
import { JWTGenerator } from '../auth/index.js';
export class AppStoreConnectClient {
    static BASE_URL = 'https://api.appstoreconnect.apple.com/v1';
    client;
    config;
    constructor(config) {
        this.config = config;
        this.client = axios.create({
            baseURL: config.baseURL || AppStoreConnectClient.BASE_URL,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        this.setupInterceptors();
    }
    setupInterceptors() {
        this.client.interceptors.request.use((config) => {
            const token = JWTGenerator.generateToken({
                keyId: this.config.keyId,
                issuerId: this.config.issuerId,
                privateKey: this.config.privateKey,
            });
            config.headers.Authorization = `Bearer ${token}`;
            return config;
        });
        this.client.interceptors.response.use((response) => response, (error) => {
            if (error.response?.data) {
                const apiErrors = error.response.data.errors;
                if (apiErrors && apiErrors.length > 0) {
                    const errorMessage = apiErrors
                        .map((e) => `${e.title}: ${e.detail || ''}`)
                        .join(', ');
                    throw new Error(errorMessage);
                }
            }
            throw error;
        });
    }
    getClient() {
        return this.client;
    }
    async get(path, params) {
        const response = await this.client.get(path, { params });
        return response.data;
    }
    async post(path, data) {
        const response = await this.client.post(path, data);
        return response.data;
    }
    async patch(path, data) {
        const response = await this.client.patch(path, data);
        return response.data;
    }
    async delete(path) {
        await this.client.delete(path);
    }
}
//# sourceMappingURL=client.js.map