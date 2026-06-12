import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient, TestFlightManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
import { registerListBetaGroups } from './list-beta-groups.js';
import { registerAddBuildToBetaGroup } from './add-build-to-beta-group.js';
import { registerRemoveBuildFromBetaGroup } from './remove-build-from-beta-group.js';
import { registerAddBetaTester } from './add-beta-tester.js';
import { registerListBetaTesters } from './list-beta-testers.js';

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

const betaLocalizationInputSchema = z.object({
    appId: z.string().describe('App ID (numeric)'),
    locale: z.string().describe('Locale, e.g. en-US'),
    description: z.string().optional(),
    feedbackEmail: z.string().optional(),
    marketingUrl: z.string().optional(),
    privacyPolicyUrl: z.string().optional(),
});

export function registerTestFlightTools(server: McpServer) {
    registerListBetaGroups(server);
    registerAddBuildToBetaGroup(server);
    registerRemoveBuildFromBetaGroup(server);
    registerAddBetaTester(server);
    registerListBetaTesters(server);

    server.registerTool(
        'appstore_list_beta_localizations',
        {
            description: 'List TestFlight beta app localizations for an app.',
            inputSchema: z.object({
                appId: z.string().describe('App ID (numeric)'),
            }),
        },
        async ({ appId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const localizations = await new TestFlightManager(client).listBetaLocalizations(appId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ localizations, count: localizations.length }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );

    server.registerTool(
        'appstore_upsert_beta_localization',
        {
            description: 'Create or update a TestFlight beta app localization by locale.',
            inputSchema: betaLocalizationInputSchema,
        },
        async ({ appId, locale, description, feedbackEmail, marketingUrl, privacyPolicyUrl }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const localization = await new TestFlightManager(client).upsertBetaLocalization(appId, {
                    locale,
                    description,
                    feedbackEmail,
                    marketingUrl,
                    privacyPolicyUrl,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization }, null, 2) }] };
            } catch (e: any) {
                return errorResponse(e);
            }
        }
    );
}
