import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs';
import { JWTGenerator } from '../../../programs/index.js';

const inputSchema = z.object({
    keyId: z.string().describe('App Store Connect API Key ID'),
    issuerId: z.string().describe('App Store Connect Issuer ID (Team ID)'),
    privateKey: z.string().describe('P8 private key content (include BEGIN/END markers)'),
});

// Load credentials from environment variables at startup if available
function loadEnvCredentials(): z.infer<typeof inputSchema> | null {
    const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
    const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
    const privateKeyPath = process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH;
    const privateKeyInline = process.env.APP_STORE_CONNECT_PRIVATE_KEY;

    if (!keyId || !issuerId) return null;

    let privateKey: string | undefined;
    if (privateKeyPath) {
        try {
            privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
        } catch {
            console.error(`[appstore-connect-mcp] Failed to read private key from: ${privateKeyPath}`);
            return null;
        }
    } else if (privateKeyInline) {
        // Support \n-escaped newlines (common in env var configs)
        privateKey = privateKeyInline.replace(/\\n/g, '\n');
    }

    if (!privateKey) return null;
    return { keyId, issuerId, privateKey };
}

let storedCredentials: z.infer<typeof inputSchema> | null = loadEnvCredentials();

export function registerStoreCredentials(server: McpServer) {
    server.registerTool(
        'appstore_store_credentials',
        {
            description: 'Store App Store Connect API credentials for use in subsequent operations',
            inputSchema,
        },
        async ({ keyId, issuerId, privateKey }) => {
            try {
                if (!JWTGenerator.validatePrivateKey(privateKey)) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    error: 'Invalid private key format. Must include BEGIN/END PRIVATE KEY markers',
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }

                storedCredentials = { keyId, issuerId, privateKey };

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                message: 'Credentials stored successfully',
                                keyId,
                                issuerId,
                            }, null, 2),
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({ error: error.message }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

export function getStoredCredentials() {
    return storedCredentials;
}