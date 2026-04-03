import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, AppManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    appId: z.string().optional().describe('App ID to retrieve'),
    bundleId: z.string().optional().describe('Bundle ID to search for'),
}).refine(data => data.appId || data.bundleId, {
    message: 'Either appId or bundleId must be provided',
});

export function registerGetApp(server: McpServer) {
    server.registerTool(
        'appstore_get_app',
        {
            description: 'Get details for a specific app by ID or bundle ID',
            inputSchema,
        },
        async ({ appId, bundleId }) => {
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
                
                let app;
                if (appId) {
                    app = await appManager.getApp(appId);
                } else if (bundleId) {
                    app = await appManager.getAppByBundleId(bundleId);
                    if (!app) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: JSON.stringify({
                                        error: `No app found with bundle ID: ${bundleId}`,
                                    }, null, 2),
                                },
                            ],
                            isError: true,
                        };
                    }
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({ app }, null, 2),
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