import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, BuildManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

const inputSchema = z.object({
    appId: z.string().describe('App ID to filter builds for'),
    version: z.string().describe('Version string (build number) to filter by, e.g. "169"'),
});

export function registerListBuildsByVersion(server: McpServer) {
    server.registerTool(
        'appstore_list_builds_by_version',
        {
            description: 'List builds for a specific app filtered by version/build number',
            inputSchema,
        },
        async ({ appId, version }) => {
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

                const builds = await new BuildManager(client).getBuildsByVersion(appId, version);

                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ builds, count: builds.length }, null, 2) }],
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
