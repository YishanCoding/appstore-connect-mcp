import { z } from 'zod';
import { AppStoreConnectClient, TestFlightManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
const inputSchema = z.object({
    appId: z.string().describe('App ID to list beta groups for'),
});
export function registerListBetaGroups(server) {
    server.registerTool('appstore_list_beta_groups', {
        description: 'List all TestFlight beta groups for an app',
        inputSchema,
    }, async ({ appId }) => {
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
            const testFlightManager = new TestFlightManager(client);
            const betaGroups = await testFlightManager.listBetaGroups(appId);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            betaGroups,
                            count: betaGroups.length,
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
//# sourceMappingURL=list-beta-groups.js.map