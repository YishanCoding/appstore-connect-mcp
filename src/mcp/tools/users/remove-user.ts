import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, UserManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    userId: z.string().describe('User ID to remove from App Store Connect (from appstore_list_users)'),
});

export function registerRemoveUser(server: McpServer) {
    server.registerTool(
        'appstore_remove_user',
        {
            description: 'Remove a user from App Store Connect. This action cannot be undone.',
            inputSchema,
        },
        async ({ userId }) => {
            try {
                const credentials = getStoredCredentials();
                if (!credentials) {
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No credentials stored. Use appstore_store_credentials first' }, null, 2) }],
                        isError: true,
                    };
                }

                const client = new AppStoreConnectClient({
                    keyId: credentials.keyId,
                    issuerId: credentials.issuerId,
                    privateKey: credentials.privateKey,
                });

                await new UserManager(client).removeUser(userId);

                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, userId }, null, 2) }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }, null, 2) }],
                    isError: true,
                };
            }
        }
    );
}
