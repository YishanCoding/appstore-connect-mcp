import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, TestFlightManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    buildId: z.string().describe('Build ID to add to beta group'),
    betaGroupId: z.string().describe('Beta group ID to add the build to'),
});

export function registerAddBuildToBetaGroup(server: McpServer) {
    server.registerTool(
        'appstore_add_build_to_beta_group',
        {
            description: 'Add a build to a TestFlight beta group for testing',
            inputSchema,
        },
        async ({ buildId, betaGroupId }) => {
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

                const testFlightManager = new TestFlightManager(client);
                await testFlightManager.addBuildToBetaGroup(buildId, betaGroupId);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                message: 'Build added to beta group successfully',
                                buildId,
                                betaGroupId,
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