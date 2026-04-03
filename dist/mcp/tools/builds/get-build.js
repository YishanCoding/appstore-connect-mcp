import { z } from 'zod';
import { AppStoreConnectClient, BuildManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
const inputSchema = z.object({
    buildId: z.string().describe('Build ID to retrieve'),
});
export function registerGetBuild(server) {
    server.registerTool('appstore_get_build', {
        description: 'Get details for a specific build',
        inputSchema,
    }, async ({ buildId }) => {
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
            const build = await buildManager.getBuild(buildId);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ build }, null, 2),
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
//# sourceMappingURL=get-build.js.map