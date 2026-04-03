import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, AppManager } from '../../../programs/index.js';
import { getStoredCredentials } from './store-credentials.js';

const inputSchema = z.object({});

export function registerValidateCredentials(server: McpServer) {
    server.registerTool(
        'appstore_validate_credentials',
        {
            description: 'Validate stored App Store Connect credentials by attempting to list apps',
            inputSchema,
        },
        async () => {
            try {
                const credentials = getStoredCredentials();
                if (!credentials) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    error: 'No credentials stored. Use appstore_store_credentials first',
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }

                const client = new AppStoreConnectClient({
                    keyId: credentials.keyId,
                    issuerId: credentials.issuerId,
                    privateKey: credentials.privateKey,
                });

                const appManager = new AppManager(client);
                const apps = await appManager.listApps(1);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                message: 'Credentials are valid',
                                appsFound: apps.length,
                            }, null, 2),
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                error: 'Invalid credentials',
                                details: error.message,
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}