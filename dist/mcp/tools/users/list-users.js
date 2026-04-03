import { z } from 'zod';
import { AppStoreConnectClient, UserManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
const inputSchema = z.object({
    limit: z.number().optional().default(200).describe('Maximum number of users to return'),
});
export function registerListUsers(server) {
    server.registerTool('appstore_list_users', {
        description: 'List all users with access to the App Store Connect account',
        inputSchema,
    }, async ({ limit }) => {
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
            const userManager = new UserManager(client);
            const users = await userManager.listUsers(limit);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            users,
                            count: users.length,
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
//# sourceMappingURL=list-users.js.map