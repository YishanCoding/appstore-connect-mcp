import axios from 'axios';
import { createHash } from 'crypto';
import { accessSync, constants, readFileSync, statSync } from 'fs';
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

export function assertReadableFiles(paths: string[]): void {
    const bad: string[] = [];
    for (const file of paths) {
        try {
            accessSync(file, constants.R_OK);
            const stat = statSync(file);
            if (!stat.isFile() || stat.size <= 0) bad.push(file);
        } catch {
            bad.push(file);
        }
    }
    if (bad.length) {
        throw new Error(`文件不存在、不可读、不是普通文件或为空: ${bad.join(', ')}`);
    }
}

export function screenshotSetBody(localizationId: string, screenshotDisplayType: string) {
    return {
        data: {
            type: 'appScreenshotSets',
            attributes: { screenshotDisplayType },
            relationships: {
                appStoreVersionLocalization: {
                    data: { type: 'appStoreVersionLocalizations', id: localizationId },
                },
            },
        },
    };
}

export function reserveScreenshotBody(setId: string, filePath: string) {
    return {
        data: {
            type: 'appScreenshots',
            attributes: { fileName: basename(filePath), fileSize: statSync(filePath).size },
            relationships: {
                appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } },
            },
        },
    };
}

export function commitScreenshotBody(shotId: string, filePath: string) {
    return {
        data: {
            type: 'appScreenshots',
            id: shotId,
            attributes: { uploaded: true, sourceFileChecksum: md5File(filePath) },
        },
    };
}

export async function uploadScreenshot(client: AppStoreConnectClient, setId: string, filePath: string): Promise<string> {
    const reserveBody = reserveScreenshotBody(setId, filePath);
    const reserveResp = await client.post<ScreenshotReserveResponse>('/appScreenshots', reserveBody);
    const shotId = reserveResp.data.id;
    const ops: UploadOperation[] = reserveResp.data.attributes.uploadOperations || [];

    // Step 2: Upload bytes to S3 (proxy bypassed)
    const fileData = readFileSync(filePath);
    for (const op of ops) {
        const offset = op.offset ?? 0;
        const length = op.length ?? fileData.length;
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

    await client.patch(`/appScreenshots/${shotId}`, commitScreenshotBody(shotId, filePath));

    return shotId;
}

export function registerScreenshotTools(server: McpServer) {
    server.registerTool(
        'appstore_list_screenshot_sets',
        {
            description: 'Deprecated: list legacy screenshot sets for an App Store version localization.',
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
            description: 'Upload ordered screenshots to a version or CPP localization through App Asset Library. Use --legacy only for version screenshot sets.',
            inputSchema: z.object({
                appStoreVersionLocalizationId: z.string().optional().describe('Version localization ID'),
                appCustomProductPageLocalizationId: z.string().optional().describe('CPP localization ID; unavailable with --legacy'),
                appId: z.string().optional().describe('App ID; required for Asset Library uploads'),
                placementGroup: z.string().optional().describe('Runtime placement group from asset-library reference'),
                screenshotDisplayType: z.string().optional().describe('Deprecated display type, accepted only with --legacy'),
                imagePaths: z.array(z.string()).min(1).describe('Ordered list of local file paths to upload'),
                replaceExisting: z.boolean().optional().describe('Replace existing placements in this group; legacy defaults to true (high risk)'),
                legacy: z.boolean().optional().default(false).describe('Use deprecated screenshot-set API'),
            }).refine((value) => !!value.appStoreVersionLocalizationId !== !!value.appCustomProductPageLocalizationId,
                '指定一个版本或 CPP 本地化 ID').refine((value) => !value.legacy || !!value.appStoreVersionLocalizationId,
                '--legacy 仅支持版本本地化'),
        },
        async ({ appStoreVersionLocalizationId, appCustomProductPageLocalizationId, screenshotDisplayType, imagePaths, replaceExisting, appId, placementGroup, legacy }) => {
            const client = makeClient();
            if (!client) return noCredentials();
            try {
                if (!legacy) {
                    const { runWrite } = await import('../../../cli/write-call.js');
                    const result = await runWrite(client, 'appstore_upload_screenshots', { appStoreVersionLocalizationId, appCustomProductPageLocalizationId, imagePaths, replaceExisting, appId, placementGroup, legacy }, true);
                    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
                }
                if (!appStoreVersionLocalizationId) throw new Error('--legacy 仅支持版本本地化');
                if (!screenshotDisplayType) throw new Error('--legacy 需要 screenshotDisplayType');
                assertReadableFiles(imagePaths);
                // Step 1: Optionally delete existing sets of this displayType
                if (replaceExisting !== false) {
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
                const createSetBody = screenshotSetBody(appStoreVersionLocalizationId, screenshotDisplayType);
                const newSetResp = await client.post<any>('/appScreenshotSets', createSetBody);
                const newSetId: string = newSetResp.data.id;

                // Step 3: Upload each image in order with 400ms delay between uploads
                const screenshotIds: string[] = [];
                for (const [i, imagePath] of imagePaths.entries()) {
                    if (i > 0) {
                        await new Promise((r) => setTimeout(r, 400));
                    }
                    const shotId = await uploadScreenshot(client, newSetId, imagePath);
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
            description: 'Deprecated: delete a legacy screenshot set and all screenshots within it.',
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
