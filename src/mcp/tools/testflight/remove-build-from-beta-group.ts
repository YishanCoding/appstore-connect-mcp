import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, TestFlightManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    buildId: z.string().describe('Build ID to remove from beta group'),
    betaGroupId: z.string().describe('Beta group ID to remove the build from'),
});

export function registerRemoveBuildFromBetaGroup(server: McpServer) {
    server.registerTool(
        'appstore_remove_build_from_beta_group',
        {
            description: 'Remove a build from a TestFlight beta group',
            inputSchema,
        },
        async ({ buildId, betaGroupId }) => {
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

                await new TestFlightManager(client).removeBuildFromBetaGroup(buildId, betaGroupId);

                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, buildId, betaGroupId }, null, 2) }],
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
