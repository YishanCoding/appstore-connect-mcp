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
    // ── Version-scoped localizations (description, keywords, whatsNew, etc.) ──

    server.registerTool(
        'appstore_list_version_localizations',
        {
            description: 'List all locale entries for an App Store version (description, keywords, promotionalText, whatsNew). Note: name and subtitle are app-level — use appstore_list_app_info_localizations instead.',
            inputSchema: z.object({
                appStoreVersionId: z.string().describe('App Store Version ID (from appstore_list_versions)'),
            }),
        },
        async ({ appStoreVersionId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const locs = await new MetadataManager(client).listVersionLocalizations(appStoreVersionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ localizations: locs, count: locs.length }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_update_version_localization',
        {
            description: 'Update version-scoped metadata for a specific locale: description, keywords (max 100 chars), promotionalText, whatsNew. Does NOT update name/subtitle (those are app-level).',
            inputSchema: z.object({
                localizationId: z.string().describe('Localization ID from appstore_list_version_localizations'),
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
                const updated = await new MetadataManager(client).updateVersionLocalization(localizationId, fields);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization: updated }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_create_version_localization',
        {
            description: 'Create a new version locale entry (description, keywords, whatsNew). For name/subtitle, use appstore_update_app_info_localization.',
            inputSchema: z.object({
                appStoreVersionId: z.string(),
                locale: z.string().describe('Locale code. Standard: zh-Hans, zh-Hant, en-US, en-GB, en-CA, en-AU, ja, ko, ru, vi, ar-SA, es-MX, es-ES, pt-BR, pt-PT, fr-FR, fr-CA, de-DE, it, nl-NL, sv, da, no, fi, pl, ro, cs, hu, el, hr, sk, tr, id, th, uk, ms, he, hi, ca. New in 2026/03 (require country suffix): bn-BD, gu-IN, kn-IN, ml-IN, mr-IN, or-IN, pa-IN, sl-SI, ta-IN, te-IN, ur-PK. Note: zh-HK is NOT a separate locale — Hong Kong/Macau/Taiwan all use zh-Hant.'),
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
                const loc = await new MetadataManager(client).createVersionLocalization(appStoreVersionId, locale, fields);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization: loc }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    // ── App-scoped localizations (name, subtitle) ──────────────────────────

    server.registerTool(
        'appstore_list_app_info_localizations',
        {
            description: 'List app-level localization entries (name, subtitle) for all locales. These are stable across versions.',
            inputSchema: z.object({
                appId: z.string(),
            }),
        },
        async ({ appId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const locs = await new MetadataManager(client).listAppInfoLocalizations(appId);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ localizations: locs, count: locs.length }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_update_app_info_localization',
        {
            description: 'Update app-level metadata: name (max 30 chars), subtitle (max 30 chars). These apply across all versions for this locale.',
            inputSchema: z.object({
                appInfoLocalizationId: z.string().describe('ID from appstore_list_app_info_localizations'),
                name: z.string().optional().describe('App name (max 30 chars)'),
                subtitle: z.string().optional().describe('Subtitle (max 30 chars)'),
                privacyChoicesUrl: z.string().optional(),
                privacyPolicyText: z.string().optional(),
                privacyPolicyUrl: z.string().optional(),
            }),
        },
        async ({ appInfoLocalizationId, ...fields }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const updated = await new MetadataManager(client).updateAppInfoLocalization(appInfoLocalizationId, fields);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, localization: updated }, null, 2) }] };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_batch_update_app_info_localizations',
        {
            description: 'Batch update name/subtitle for multiple locales in one call. More efficient than calling appstore_update_app_info_localization repeatedly.',
            inputSchema: z.object({
                updates: z.array(z.object({
                    appInfoLocalizationId: z.string().describe('ID from appstore_list_app_info_localizations'),
                    name: z.string().optional().describe('App name (max 30 chars)'),
                    subtitle: z.string().optional().describe('Subtitle (max 30 chars)'),
                    privacyChoicesUrl: z.string().optional(),
                    privacyPolicyText: z.string().optional(),
                    privacyPolicyUrl: z.string().optional(),
                })).describe('Array of locale updates to apply'),
            }),
        },
        async ({ updates }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            const manager = new MetadataManager(client);
            const results: Array<{ success: boolean; locale?: string; id: string; error?: string }> = [];
            for (const { appInfoLocalizationId, ...fields } of updates) {
                try {
                    const updated = await manager.updateAppInfoLocalization(appInfoLocalizationId, fields);
                    results.push({ success: true, locale: updated.locale, id: appInfoLocalizationId });
                } catch (e: any) {
                    results.push({ success: false, id: appInfoLocalizationId, error: e.message });
                }
            }
            const succeeded = results.filter(r => r.success).length;
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ total: updates.length, succeeded, failed: updates.length - succeeded, results }, null, 2),
                }],
            };
        }
    );

    server.registerTool(
        'appstore_batch_update_version_localizations',
        {
            description: 'Batch update version-scoped metadata (description, keywords, whatsNew, etc.) for multiple locales in one call.',
            inputSchema: z.object({
                updates: z.array(z.object({
                    localizationId: z.string().describe('ID from appstore_list_version_localizations'),
                    description: z.string().optional(),
                    keywords: z.string().optional(),
                    promotionalText: z.string().optional(),
                    whatsNew: z.string().optional(),
                    marketingUrl: z.string().optional(),
                    supportUrl: z.string().optional(),
                })).describe('Array of locale updates to apply'),
            }),
        },
        async ({ updates }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            const manager = new MetadataManager(client);
            const results: Array<{ success: boolean; locale?: string; id: string; error?: string }> = [];
            for (const { localizationId, ...fields } of updates) {
                try {
                    const updated = await manager.updateVersionLocalization(localizationId, fields);
                    results.push({ success: true, locale: updated.locale, id: localizationId });
                } catch (e: any) {
                    results.push({ success: false, id: localizationId, error: e.message });
                }
            }
            const succeeded = results.filter(r => r.success).length;
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ total: updates.length, succeeded, failed: updates.length - succeeded, results }, null, 2),
                }],
            };
        }
    );
}
