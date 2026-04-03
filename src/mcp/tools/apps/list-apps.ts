import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, AppManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    limit: z.number().optional().default(200).describe('Maximum number of apps to return'),
});

export function registerListApps(server: McpServer) {
    server.registerTool(
        'appstore_list_apps',
        {
            description: 'List all apps available in your App Store Connect account',
            inputSchema,
        },
        async ({ limit }) => {
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
                const apps = await appManager.listApps(limit);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                apps,
                                count: apps.length,
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