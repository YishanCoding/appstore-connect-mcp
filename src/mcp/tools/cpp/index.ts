import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { CppManager } from '../../../programs/cpp/index.js';
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

export function registerCppTools(server: McpServer) {
    server.registerTool(
        'appstore_list_cpps',
        {
            description: 'List all Custom Product Pages (CPPs) for an app.',
            inputSchema: z.object({
                appId: z.string().describe('App ID (numeric, e.g. 6754280964)'),
            }),
        },
        async ({ appId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const cpps = await new CppManager(client, appId).listCpps();
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ cpps, count: cpps.length }, null, 2) }],
                };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_create_cpp',
        {
            description: [
                'Create a Custom Product Page (CPP) and upload screenshots to App Store Connect.',
                'Screenshot order: cppImagePath is uploaded as #1 (landscape hero), then templateShotPaths as #2-8.',
                'promotionalText must be ≤170 characters.',
                'screenshotDisplayType defaults to APP_IPHONE_65 (6.5" iPhone, 2688×1242 landscape).',
                'Bypasses system proxy for S3 chunk uploads automatically.',
            ].join(' '),
            inputSchema: z.object({
                appId: z.string().describe('App ID (numeric)'),
                name: z.string().describe('CPP name shown in ASC (e.g. "JuJuBit - Dark Hero")'),
                promotionalText: z.string().max(170).describe('Promotional text for en-US locale (≤170 chars)'),
                cppImagePath: z.string().describe('Absolute path to the landscape CPP hero image (uploaded as screenshot #1)'),
                templateShotPaths: z.array(z.string()).min(1).max(10).describe('Absolute paths to the remaining screenshots (uploaded as #2 onward, typically 7 portrait shots)'),
            }),
        },
        async ({ appId, name, promotionalText, cppImagePath, templateShotPaths }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const result = await new CppManager(client, appId).createCpp(
                    name,
                    promotionalText,
                    cppImagePath,
                    templateShotPaths
                );
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ success: true, ...result }, null, 2),
                    }],
                };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_update_cpp_promo',
        {
            description: 'Update the promotional text of an existing CPP locale. promotionalText must be ≤170 characters.',
            inputSchema: z.object({
                localeId: z.string().describe('CPP locale ID (appCustomProductPageLocalizations ID)'),
                promotionalText: z.string().max(170).describe('New promotional text (≤170 chars)'),
            }),
        },
        async ({ localeId, promotionalText }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const updated = await new CppManager(client, '').updateCppPromo(localeId, promotionalText);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization: updated }, null, 2) }],
                };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_delete_cpp',
        {
            description: 'Delete a Custom Product Page. Only DRAFT state CPPs can be deleted.',
            inputSchema: z.object({
                appId: z.string().describe('App ID'),
                cppId: z.string().describe('CPP ID to delete'),
            }),
        },
        async ({ appId, cppId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                await new CppManager(client, appId).deleteCpp(cppId);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, deleted: cppId }, null, 2) }],
                };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );
}
