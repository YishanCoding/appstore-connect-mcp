import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, UserManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    userId: z.string().describe('User ID to update (from appstore_list_users)'),
    roles: z.array(z.enum([
        'ADMIN',
        'FINANCE',
        'TECHNICAL',
        'ACCOUNT_HOLDER',
        'READ_ONLY',
        'SALES',
        'MARKETING',
        'APP_MANAGER',
        'CUSTOMER_SUPPORT',
        'ACCESS_TO_REPORTS',
        'CREATE_APPS',
        'DEVELOPER',
        'CLOUD_MANAGED_DEVELOPER_ID',
        'CLOUD_MANAGED_APP_DISTRIBUTION',
        'GENERATE_INDIVIDUAL_KEYS',
    ])).describe('New roles to assign to the user (replaces existing roles)'),
});

export function registerUpdateUserRoles(server: McpServer) {
    server.registerTool(
        'appstore_update_user_roles',
        {
            description: 'Update the roles of an existing App Store Connect user',
            inputSchema,
        },
        async ({ userId, roles }) => {
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

                await new UserManager(client).updateUserRoles(userId, roles);

                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, userId, roles }, null, 2) }],
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
