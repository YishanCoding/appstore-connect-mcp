import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { MetadataManager } from '../../../programs/metadata/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';

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

export function registerMetadataTools(server: McpServer) {
    server.registerTool(
        'appstore_list_localizations',
        {
            description: 'List all locale metadata (name, subtitle, description, keywords, whatsNew) for an App Store version',
            inputSchema: z.object({
                appStoreVersionId: z.string().describe('App Store Version ID'),
            }),
        },
        async ({ appStoreVersionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const locs = await new MetadataManager(client).listLocalizations(appStoreVersionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ localizations: locs, count: locs.length }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_update_localization',
        {
            description: 'Update App Store metadata for a specific locale (name, subtitle, description, keywords, promotionalText, whatsNew)',
            inputSchema: z.object({
                localizationId: z.string().describe('Localization ID from appstore_list_localizations'),
                name: z.string().optional().describe('App name (max 30 chars)'),
                subtitle: z.string().optional().describe('Subtitle (max 30 chars)'),
                description: z.string().optional().describe('Full description (max 4000 chars)'),
                keywords: z.string().optional().describe('Keywords comma-separated (max 100 chars total)'),
                promotionalText: z.string().optional().describe('Promotional text (max 170 chars)'),
                whatsNew: z.string().optional().describe("What's New text (max 4000 chars)"),
                marketingUrl: z.string().optional(),
                supportUrl: z.string().optional(),
            }),
        },
        async ({ localizationId, ...fields }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const updated = await new MetadataManager(client).updateLocalization(localizationId, fields);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization: updated }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_create_localization',
        {
            description: 'Create a new locale entry for an App Store version',
            inputSchema: z.object({
                appStoreVersionId: z.string(),
                locale: z.string().describe('Locale code, e.g. zh-Hans, en-US, ja'),
                name: z.string().optional(),
                subtitle: z.string().optional(),
                description: z.string().optional(),
                keywords: z.string().optional(),
                promotionalText: z.string().optional(),
                whatsNew: z.string().optional(),
            }),
        },
        async ({ appStoreVersionId, locale, ...fields }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const loc = await new MetadataManager(client).createLocalization(appStoreVersionId, locale, fields);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization: loc }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );
}
