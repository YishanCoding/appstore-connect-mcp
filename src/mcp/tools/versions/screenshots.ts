import axios from 'axios';
import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppStoreConnectClient } from '../../../programs/api-client/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
import { ScreenshotReserveResponse, UploadOperation } from '../../../programs/cpp/types.js';

// Bypass system proxy for S3 and CDN calls
const s3Client = axios.create({ proxy: false });

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

function md5File(path: string): string {
    const data = readFileSync(path);
    return createHash('md5').update(data).digest('hex');
}

async function uploadScreenshot(client: AppStoreConnectClient, setId: string, filePath: string): Promise<string> {
    const fileSize = statSync(filePath).size;
    const fileName = basename(filePath);
    const checksum = md5File(filePath);

    // Step 1: Reserve upload slot
    const reserveBody = {
        data: {
            type: 'appScreenshots',
            attributes: { fileName, fileSize },
            relationships: {
                appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } },
            },
        },
    };
    const reserveResp = await client.post<ScreenshotReserveResponse>('/appScreenshots', reserveBody);
    const shotId = reserveResp.data.id;
    const ops: UploadOperation[] = reserveResp.data.attributes.uploadOperations || [];

    // Step 2: Upload bytes to S3 (proxy bypassed)
    const fileData = readFileSync(filePath);
    for (const op of ops) {
        const offset = op.offset ?? 0;
        const length = op.length ?? fileSize;
        const chunk = fileData.slice(offset, offset + length);
        const reqHeaders = Object.fromEntries(
            (op.requestHeaders ?? []).map((h) => [h.name, h.value])
        );
        await s3Client.request({
            method: op.method || 'PUT',
            url: op.url,
            headers: reqHeaders,
            data: chunk,
        });
    }

    // Step 3: Commit with checksum (retry up to 3×)
    const commitBody = {
        data: {
            type: 'appScreenshots',
            id: shotId,
            attributes: { uploaded: true, sourceFileChecksum: checksum },
        },
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await client.patch(`/appScreenshots/${shotId}`, commitBody);
            break;
        } catch (e) {
            if (attempt === 2) throw e;
            await new Promise((r) => setTimeout(r, 3000));
        }
    }

    return shotId;
}

export function registerScreenshotTools(server: McpServer) {
    server.registerTool(
        'appstore_list_screenshot_sets',
        {
            description: 'List all screenshot sets (by display type) for an App Store version localization, including screenshots in each set.',
            inputSchema: z.object({
                appStoreVersionLocalizationId: z.string().describe('Version localization ID (from appstore_list_version_localizations)'),
            }),
        },
        async ({ appStoreVersionLocalizationId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                const resp = await client.get<any>(
                    `/appStoreVersionLocalizations/${appStoreVersionLocalizationId}/appScreenshotSets`,
                    { include: 'appScreenshots' }
                );
                const sets = (resp.data || []).map((set: any) => ({
                    id: set.id,
                    screenshotDisplayType: set.attributes?.screenshotDisplayType,
                    screenshotCount: set.relationships?.appScreenshots?.data?.length ?? 0,
                    screenshots: (set.relationships?.appScreenshots?.data || []).map((s: any) => s.id),
                }));
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ sets, count: sets.length }, null, 2),
                    }],
                };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_upload_screenshots',
        {
            description: 'Upload screenshots for a specific display type to an App Store version localization. Optionally replaces existing screenshots of that type first.',
            inputSchema: z.object({
                appStoreVersionLocalizationId: z.string().describe('Version localization ID (from appstore_list_version_localizations)'),
                screenshotDisplayType: z.string().describe('Display type, e.g. APP_IPHONE_65, APP_IPHONE_67, APP_IPHONE_35, APP_IPAD_PRO_3GEN_129, etc.'),
                imagePaths: z.array(z.string()).describe('Ordered list of local file paths to upload'),
                replaceExisting: z.boolean().optional().default(true).describe('If true, delete existing screenshots of this display type before uploading'),
            }),
        },
        async ({ appStoreVersionLocalizationId, screenshotDisplayType, imagePaths, replaceExisting }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                // Step 1: Optionally delete existing sets of this displayType
                if (replaceExisting) {
                    const existingResp = await client.get<any>(
                        `/appStoreVersionLocalizations/${appStoreVersionLocalizationId}/appScreenshotSets`,
                        { 'filter[screenshotDisplayType]': screenshotDisplayType, include: 'appScreenshots' }
                    );
                    for (const existingSet of existingResp.data || []) {
                        // Delete individual screenshots first
                        const screenshotIds: string[] = (existingSet.relationships?.appScreenshots?.data || []).map((s: any) => s.id);
                        for (const ssId of screenshotIds) {
                            await client.delete(`/appScreenshots/${ssId}`);
                        }
                        // Delete the set
                        await client.delete(`/appScreenshotSets/${existingSet.id}`);
                    }
                }

                // Step 2: Create new screenshot set
                const createSetBody = {
                    data: {
                        type: 'appScreenshotSets',
                        attributes: { screenshotDisplayType },
                        relationships: {
                            appStoreVersionLocalization: {
                                data: { type: 'appStoreVersionLocalizations', id: appStoreVersionLocalizationId },
                            },
                        },
                    },
                };
                const newSetResp = await client.post<any>('/appScreenshotSets', createSetBody);
                const newSetId: string = newSetResp.data.id;

                // Step 3: Upload each image in order with 400ms delay between uploads
                const screenshotIds: string[] = [];
                for (let i = 0; i < imagePaths.length; i++) {
                    if (i > 0) {
                        await new Promise((r) => setTimeout(r, 400));
                    }
                    const shotId = await uploadScreenshot(client, newSetId, imagePaths[i]);
                    screenshotIds.push(shotId);
                }

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            setId: newSetId,
                            screenshotDisplayType,
                            successCount: screenshotIds.length,
                            screenshotIds,
                        }, null, 2),
                    }],
                };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );

    server.registerTool(
        'appstore_delete_screenshot_set',
        {
            description: 'Delete a screenshot set and all screenshots within it.',
            inputSchema: z.object({
                screenshotSetId: z.string().describe('Screenshot set ID (from appstore_list_screenshot_sets)'),
            }),
        },
        async ({ screenshotSetId }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                // List screenshots in the set
                const setResp = await client.get<any>(`/appScreenshotSets/${screenshotSetId}`, { include: 'appScreenshots' });
                const screenshotIds: string[] = (setResp.data?.relationships?.appScreenshots?.data || []).map((s: any) => s.id);

                // Delete each screenshot
                for (const ssId of screenshotIds) {
                    await client.delete(`/appScreenshots/${ssId}`);
                }

                // Delete the set itself
                await client.delete(`/appScreenshotSets/${screenshotSetId}`);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            screenshotSetId,
                            deletedCount: screenshotIds.length,
                        }, null, 2),
                    }],
                };
            } catch (e: any) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }], isError: true };
            }
        }
    );
}
