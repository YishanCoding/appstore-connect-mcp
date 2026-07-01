import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, IapManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

function getClient() {
    const credentials = getStoredCredentials();
    if (!credentials) return null;

    return new AppStoreConnectClient({
        keyId: credentials.keyId,
        issuerId: credentials.issuerId,
        privateKey: credentials.privateKey,
    });
}

function missingCredentialsResponse() {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({ error: 'No credentials. Use appstore_store_credentials first.' }, null, 2),
            },
        ],
        isError: true,
    };
}

export function registerIapTools(server: McpServer) {
    server.registerTool(
        'appstore_list_in_app_purchases',
        {
            description: 'List In-App Purchases for an app using the App Store Connect API v2 IAP resource',
            inputSchema: {
                appId: z.string().describe('App ID to list In-App Purchases for'),
                limit: z.number().optional().default(200).describe('Maximum number of In-App Purchases to return'),
            },
        },
        async ({ appId, limit }) => {
            try {
                const client = getClient();
                if (!client) return missingCredentialsResponse();

                const manager = new IapManager(client);
                const inAppPurchases = await manager.listInAppPurchases(appId, limit);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({ inAppPurchases, count: inAppPurchases.length }, null, 2),
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }, null, 2) }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'appstore_get_in_app_purchase',
        {
            description: 'Get details for a single In-App Purchase by ID',
            inputSchema: {
                inAppPurchaseId: z.string().describe('In-App Purchase ID from appstore_list_in_app_purchases'),
            },
        },
        async ({ inAppPurchaseId }) => {
            try {
                const client = getClient();
                if (!client) return missingCredentialsResponse();

                const manager = new IapManager(client);
                const inAppPurchase = await manager.getInAppPurchase(inAppPurchaseId);

                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ inAppPurchase }, null, 2) }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }, null, 2) }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'appstore_list_subscription_groups',
        {
            description: 'List auto-renewable subscription groups for an app',
            inputSchema: {
                appId: z.string().describe('App ID to list subscription groups for'),
                limit: z.number().optional().default(200).describe('Maximum number of subscription groups to return'),
            },
        },
        async ({ appId, limit }) => {
            try {
                const client = getClient();
                if (!client) return missingCredentialsResponse();

                const manager = new IapManager(client);
                const subscriptionGroups = await manager.listSubscriptionGroups(appId, limit);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({ subscriptionGroups, count: subscriptionGroups.length }, null, 2),
                        },
                    ],
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
