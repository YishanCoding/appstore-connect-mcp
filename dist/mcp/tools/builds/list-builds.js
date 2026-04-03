import { z } from 'zod';
import { AppStoreConnectClient, BuildManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
const inputSchema = z.object({
    appId: z.string().describe('App ID to list builds for'),
    limit: z.number().optional().default(100).describe('Maximum number of builds to return'),
});
export function registerListBuilds(server) {
    server.registerTool('appstore_list_builds', {
        description: 'List builds for a specific app, sorted by upload date (newest first)',
        inputSchema,
    }, async ({ appId, limit }) => {
        try {
            const credentials = getStoredCredentials();
            if (!credentials) {
                return {
                    content: [
                        {
                            type: 'text',
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
            const builds = await buildManager.listBuilds(appId, limit);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            builds,
                            count: builds.length,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ error: error.message }, null, 2),
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=list-builds.js.map