import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { VersionManager } from '../../../programs/versions/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

function makeClient() {
    const creds = getStoredCredentials();
    if (!creds) return null;
    return new AppStoreConnectClient({ keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey });
}

function noCredentials() {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No credentials. Use appstore_store_credentials first.' }, null, 2) }],
        isError: true,
    };
}

export function registerVersionTools(server: McpServer) {
    server.registerTool(
        'appstore_list_versions',
        {
            description: 'List App Store versions for an app (includes state like PREPARE_FOR_SUBMISSION, READY_FOR_SALE, etc.)',
            inputSchema: z.object({
                appId: z.string(),
                platform: z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']).optional().default('IOS'),
            }),
        },
        async ({ appId, platform }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const versions = await new VersionManager(client).listVersions(appId, platform);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ versions, count: versions.length }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_get_version',
        {
            description: 'Get details of a specific App Store version by ID',
            inputSchema: z.object({ versionId: z.string() }),
        },
        async ({ versionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const version = await new VersionManager(client).getVersion(versionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ version }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_create_version',
        {
            description: 'Create a new App Store version (starts in PREPARE_FOR_SUBMISSION state)',
            inputSchema: z.object({
                appId: z.string(),
                versionString: z.string().describe('Version number, e.g. "2.1.0"'),
                platform: z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']).optional().default('IOS'),
            }),
        },
        async ({ appId, versionString, platform }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const version = await new VersionManager(client).createVersion(appId, versionString, platform);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, version }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );
}
