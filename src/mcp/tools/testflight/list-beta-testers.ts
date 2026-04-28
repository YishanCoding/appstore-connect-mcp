import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, TestFlightManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    betaGroupId: z.string().describe('Beta group ID to list testers for'),
});

export function registerListBetaTesters(server: McpServer) {
    server.registerTool(
        'appstore_list_beta_testers',
        {
            description: 'List all beta testers in a TestFlight beta group',
            inputSchema,
        },
        async ({ betaGroupId }) => {
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

                const testers = await new TestFlightManager(client).listBetaTesters(betaGroupId);

                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ testers, count: testers.length }, null, 2) }],
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
