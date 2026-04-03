import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { JWTGenerator } from '../../../programs/index.js';

const inputSchema = z.object({
    keyId: z.string().describe('App Store Connect API Key ID'),
    issuerId: z.string().describe('App Store Connect Issuer ID (Team ID)'),
    privateKey: z.string().describe('P8 private key content (include BEGIN/END markers)'),
});

let storedCredentials: z.infer<typeof inputSchema> | null = null;

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