import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, UserManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    email: z.string().email().describe('Email address of the user to invite'),
    firstName: z.string().describe('First name of the user'),
    lastName: z.string().describe('Last name of the user'),
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
    ])).describe('Roles to assign to the user'),
    allAppsVisible: z.boolean().optional().default(false).describe('Whether the user can see all apps'),
});

export function registerInviteUser(server: McpServer) {
    server.registerTool(
        'appstore_invite_user',
        {
            description: 'Invite a new user to the App Store Connect team',
            inputSchema,
        },
        async ({ email, firstName, lastName, roles, allAppsVisible }) => {
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

                const userManager = new UserManager(client);
                await userManager.inviteUser(email, firstName, lastName, roles, allAppsVisible);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                message: 'User invitation sent successfully',
                                user: { email, firstName, lastName, roles },
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