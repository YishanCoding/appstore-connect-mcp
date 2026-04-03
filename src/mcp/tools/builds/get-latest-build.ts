import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, BuildManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    appId: z.string().describe('App ID to get the latest build for'),
});

export function registerGetLatestBuild(server: McpServer) {
    server.registerTool(
        'appstore_get_latest_build',
        {
            description: 'Get the latest non-expired build for an app',
            inputSchema,
        },
        async ({ appId }) => {
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

                const buildManager = new BuildManager(client);
                const build = await buildManager.getLatestBuild(appId);

                if (!build) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    message: 'No active builds found for this app',
                                }, null, 2),
                            },
                        ],
                    };
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({ build }, null, 2),
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