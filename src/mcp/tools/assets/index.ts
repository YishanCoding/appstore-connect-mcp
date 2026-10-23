import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
import { executeTool } from '../../../cli/execute.js';

const target = {
    appStoreVersionLocalizationId: z.string().optional().describe('Version localization ID'),
    appCustomProductPageLocalizationId: z.string().optional().describe('CPP localization ID'),
};
const exactlyOneTarget = (value: { appStoreVersionLocalizationId?: string; appCustomProductPageLocalizationId?: string }) =>
    !!value.appStoreVersionLocalizationId !== !!value.appCustomProductPageLocalizationId;

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
    ] as const;
    for (const [name, description, inputSchema] of definitions) {
        server.registerTool(name, { description, inputSchema }, async (args: Record<string, any>) => {
            const creds = getStoredCredentials();
            if (!creds) return { content: [{ type: 'text' as const, text: 'No credentials. Use appstore_store_credentials first.' }], isError: true };
            try {
                const client = new AppStoreConnectClient({ keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey });
                const data = await executeTool(name, args, client, { all: true });
                return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
            } catch (error) {
                return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
            }
        });
    }
}
