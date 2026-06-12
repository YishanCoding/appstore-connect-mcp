import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, BuildManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
import { registerListBuilds } from './list-builds.js';
import { registerGetBuild } from './get-build.js';
import { registerGetLatestBuild } from './get-latest-build.js';
import { registerListBuildsByVersion } from './list-builds-by-version.js';

function makeClient() {
    const creds = getStoredCredentials();
    if (!creds) return null;
    return new AppStoreConnectClient({
        keyId: creds.keyId,
        issuerId: creds.issuerId,
        privateKey: creds.privateKey,
    });
}

function noCredentials() {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No credentials. Use appstore_store_credentials first.' }, null, 2) }],
        isError: true,
    };
}

function errorResponse(e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
}

export function registerBuildTools(server: McpServer) {
    registerListBuilds(server);
    registerGetBuild(server);
    registerGetLatestBuild(server);
    registerListBuildsByVersion(server);

    server.registerTool(
        'appstore_get_build_beta_detail',
        {
            description: 'Get TestFlight beta detail for a build.',
            inputSchema: z.object({
                buildId: z.string().describe('Build ID'),
            }),
        },
        async ({ buildId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const buildBetaDetail = await new BuildManager(client).getBuildBetaDetail(buildId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ buildBetaDetail }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_update_build_beta_detail',
        {
            description: 'Update TestFlight beta detail for a build.',
            inputSchema: z.object({
                buildBetaDetailId: z.string().describe('buildBetaDetails ID'),
                autoNotifyEnabled: z.boolean().optional(),
                internalBuildState: z.string().optional(),
                externalBuildState: z.string().optional(),
            }),
        },
        async ({ buildBetaDetailId, autoNotifyEnabled, internalBuildState, externalBuildState }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const buildBetaDetail = await new BuildManager(client).updateBuildBetaDetail(buildBetaDetailId, {
                    autoNotifyEnabled,
                    internalBuildState,
                    externalBuildState,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, buildBetaDetail }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );
}
