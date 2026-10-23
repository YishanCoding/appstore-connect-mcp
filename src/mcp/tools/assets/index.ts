import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
import { executeTool } from '../../../cli/execute.js';
import { bindConfirm } from '../../../cli/safety.js';

const target = {
    appStoreVersionLocalizationId: z.string().optional().describe('Version localization ID'),
    appCustomProductPageLocalizationId: z.string().optional().describe('CPP localization ID'),
};
const exactlyOneTarget = (value: { appStoreVersionLocalizationId?: string; appCustomProductPageLocalizationId?: string }) =>
    !!value.appStoreVersionLocalizationId !== !!value.appCustomProductPageLocalizationId;
const creativeTarget = { ...target,
    appEventLocalizationId: z.string().optional().describe('Event localization ID'),
    appStoreVersionExperimentTreatmentLocalizationId: z.string().optional().describe('Experiment treatment localization ID'),
};
const exactlyOneCreativeTarget = (value: Record<string, unknown>) =>
    Object.keys(creativeTarget).filter((key) => !!value[key]).length === 1;
const creativeType = z.enum(['header', 'search', 'event-card', 'event-details']);

export function registerAssetTools(server: McpServer) {
    const definitions = [
        ['appstore_get_asset_library', 'Read an app asset library.', z.object({ appId: z.string() })],
        ['appstore_list_asset_library_images', 'List image assets with state, specId and dimensions.', z.object({ appId: z.string() })],
        ['appstore_get_asset_library_reference', 'Read runtime placement groups, types and specifications.', z.object({ appId: z.string() })],
        ['appstore_list_asset_placements', 'List version or CPP localization placements.', z.object(target).refine(exactlyOneTarget, '指定一个版本或 CPP 本地化 ID')],
        ['appstore_upload_asset_library_image', 'Reserve, upload, commit and poll an image asset.', z.object({ appId: z.string(), file: z.string(), category: z.enum(['APP_SCREENSHOTS_AND_PREVIEWS', 'CREATIVE_ASSETS']).optional() })],
        ['appstore_create_asset_placement', 'Place an image in a version or CPP localization.', z.object({ imageId: z.string(), placementType: z.string(), placementGroup: z.string(), ...target }).refine(exactlyOneTarget, '指定一个版本或 CPP 本地化 ID')],
        ['appstore_order_asset_placements', 'Order placements within a localization and group.', z.object({ placementIds: z.array(z.string()).min(1), placementGroup: z.string(), ...target }).refine(exactlyOneTarget, '指定一个版本或 CPP 本地化 ID')],
        ['appstore_delete_asset_placement', 'Remove a placement, leaving the image in the library.', z.object({ placementId: z.string() })],
        ['appstore_delete_asset_library_image', 'Delete an image after its placements have been removed.', z.object({ imageId: z.string() })],
        ['appstore_list_creative_assets', 'List creative image placements on a localization.', z.object(creativeTarget).refine(exactlyOneCreativeTarget, '必须且只能指定一个本地化 ID')],
        ['appstore_set_creative_asset', 'Upload and place one creative image; replacement needs confirmation.', z.object({ ...creativeTarget,
            type: creativeType, file: z.string(), replaceExisting: z.boolean().optional(), deleteOldImage: z.boolean().optional(),
            yes: z.boolean().optional(), confirm: z.string().optional() }).refine(exactlyOneCreativeTarget, '必须且只能指定一个本地化 ID')],
        ['appstore_remove_creative_asset', 'Remove one creative placement, optionally its image; needs confirmation.', z.object({ ...creativeTarget,
            type: creativeType, deleteImage: z.boolean().optional(), yes: z.boolean().optional(), confirm: z.string().optional() })
            .refine(exactlyOneCreativeTarget, '必须且只能指定一个本地化 ID')],
    ] as const;
    for (const [name, description, inputSchema] of definitions) {
        server.registerTool(name, { description, inputSchema }, async (args: Record<string, any>) => {
            const creds = getStoredCredentials();
            if (!creds) return { content: [{ type: 'text' as const, text: 'No credentials. Use appstore_store_credentials first.' }], isError: true };
            try {
                const client = new AppStoreConnectClient({ keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey });
                if (name === 'appstore_remove_creative_asset' ||
                    (name === 'appstore_set_creative_asset' && (args.replaceExisting || args.deleteOldImage))) {
                    if (!args.yes || !args.confirm) throw new Error('高风险命令需要 yes=true 和 confirm=<app-id>');
                    const gate = await bindConfirm(name, args, args.confirm, {
                        get: (path, params) => client.get(path, params),
                        getAll: (path, params) => client.getAllPages(path, params),
                    });
                    if (!gate.ok) throw new Error(gate.message);
                }
                const data = await executeTool(name, args, client, { all: true });
                return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
            } catch (error) {
                return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
            }
        });
    }
}
