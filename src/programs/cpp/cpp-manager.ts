import axios from 'axios';
import { createHash } from 'crypto';
import { accessSync, constants, readFileSync, statSync } from 'fs';
import { basename } from 'path';
import { AppStoreConnectClient } from '../api-client/index.js';
import { getReference, libraryIdForApp, orderBody, placementBody, screenshotLimit, uploadImage, validateGroup } from '../assets/library.js';
import {
    CppInfo,
    CppLocaleInfo,
    CreateCppResult,
    ListCppsResponse,
    ScreenshotReserveResponse,
    UploadOperation,
} from './types.js';

// Bypass system proxy for S3 and CDN calls — same fix as the Python upload script
const s3Client = axios.create({ proxy: false });

export class CppPreflightError extends Error {}

export function buildCppCreateBody(appId: string, name: string, promotionalText: string) {
    return {
        data: {
            type: 'appCustomProductPages',
            attributes: { name },
            relationships: {
                app: { data: { type: 'apps', id: appId } },
                appCustomProductPageVersions: {
                    data: [{ type: 'appCustomProductPageVersions', id: '${v1}' }],
                },
            },
        },
        included: [
            {
                type: 'appCustomProductPageVersions',
                id: '${v1}',
                relationships: {
                    appCustomProductPageLocalizations: {
                        data: [{ type: 'appCustomProductPageLocalizations', id: '${loc1}' }],
                    },
                },
            },
            {
                type: 'appCustomProductPageLocalizations',
                id: '${loc1}',
                attributes: { locale: 'en-US', promotionalText },
            },
        ],
    };
}

function md5File(path: string): string {
    const data = readFileSync(path);
    return createHash('md5').update(data).digest('hex');
}

export class CppManager {
    constructor(
        private client: AppStoreConnectClient,
        private appId: string
    ) {}

    public async listCpps(options?: { all?: boolean; limit?: number }): Promise<CppInfo[]> {
        const path = `/apps/${this.appId}/appCustomProductPages`;
        const map = (d: ListCppsResponse['data'][number]): CppInfo => ({
            id: d.id,
            name: d.attributes.name,
            state: d.attributes.state,
            url: `https://apps.apple.com/us/app/id${this.appId}?ppid=${d.id}`,
        });
        if (options?.all) {
            const items = await this.client.getAllPages<ListCppsResponse['data'][number]>(path, {}, { limit: options.limit });
            return items.map(map);
        }
        const resp = await this.client.get<ListCppsResponse>(path, { limit: Math.min(options?.limit ?? 200, 200) });
        const data = options?.limit ? resp.data.slice(0, options.limit) : resp.data;
        return data.map(map);
    }

    public async deleteCpp(cppId: string): Promise<void> {
        await this.client.delete(`/appCustomProductPages/${cppId}`);
    }

    public async updateCppPromo(localeId: string, promotionalText: string): Promise<CppLocaleInfo> {
        const resp = await this.client.patch<{ data: { id: string; attributes: { locale: string; promotionalText: string } } }>(
            `/appCustomProductPageLocalizations/${localeId}`,
            {
                data: {
                    type: 'appCustomProductPageLocalizations',
                    id: localeId,
                    attributes: { promotionalText },
                },
            }
        );
        return {
            id: resp.data.id,
            locale: resp.data.attributes.locale,
            promotionalText: resp.data.attributes.promotionalText,
        };
    }

    public async createCpp(
        name: string,
        promotionalText: string,
        cppImagePath: string,
        templateShotPaths: string[],
        placementGroup = 'IPHONE_FACE_ID_LARGE_PROFILE',
        legacy = false
    ): Promise<CreateCppResult> {
        if (promotionalText.length > 170) {
            throw new Error(`promotionalText exceeds 170 chars (${promotionalText.length})`);
        }

        const allShots = [cppImagePath, ...templateShotPaths];
        for (const file of allShots) {
            try {
                const stat = statSync(file);
                if (!stat.isFile() || stat.size === 0) throw new Error('不是非空普通文件');
                accessSync(file, constants.R_OK);
            } catch {
                throw new CppPreflightError(`截图文件不存在、不可读、不是普通文件或为空: ${file}`);
            }
        }
        // Preflight the full batch before creating a CPP: a failed check must not leave one behind.
        let libraryId: string | undefined;
        let reference: any;
        if (!legacy) {
            reference = await getReference(this.client);
            try {
                validateGroup(reference, 'APP_SCREENSHOT', placementGroup);
                const maxCount = screenshotLimit(reference, 'CUSTOM_PRODUCT_PAGES', placementGroup);
                if (allShots.length > maxCount) throw new Error(`该 group 最多 ${maxCount} 张 CPP 截图；本次 ${allShots.length} 张`);
            } catch (error) {
                throw new CppPreflightError(error instanceof Error ? error.message : String(error));
            }
            libraryId = await libraryIdForApp(this.client, this.appId);
        }
        const createBody = buildCppCreateBody(this.appId, name, promotionalText);

        const createResp = await this.client.post<{ data: { id: string }; included: { type: string; id: string }[] }>(
            '/appCustomProductPages',
            createBody
        );

        const cppId = createResp.data.id;
        const localeId = createResp.included.find(
            (x) => x.type === 'appCustomProductPageLocalizations'
        )!.id;

        if (!legacy) {
            const target = { appCustomProductPageLocalizationId: localeId };
            const uploaded: { id: string; state: string; specId: string }[] = [];
            for (const file of allShots) {
                const image = await uploadImage(this.client, libraryId!, file);
                validateGroup(reference, 'APP_SCREENSHOT', placementGroup, image.specId);
                uploaded.push({ id: image.id, state: image.state, specId: image.specId });
            }
            const createdPlacementIds: string[] = [];
            for (const image of uploaded) {
                const placed = await this.client.post<{ data: { id: string } }>('/appAssetLibraryPlacements', placementBody(image.id, target, 'APP_SCREENSHOT', placementGroup));
                createdPlacementIds.push(placed.data.id);
            }
            await this.client.post('/appAssetLibraryPlacementOrderingRequests', orderBody(createdPlacementIds, target, placementGroup));
            return { cppId, localeId, screenshotsUploaded: uploaded.length, uploaded, createdPlacementIds,
                url: `https://apps.apple.com/us/app/id${this.appId}?ppid=${cppId}` };
        }

        // Deprecated screenshot-set flow, only when explicitly requested.
        const setResp = await this.client.post<{ data: { id: string } }>(
            '/appScreenshotSets',
            {
                data: {
                    type: 'appScreenshotSets',
                    attributes: { screenshotDisplayType: 'APP_IPHONE_65' },
                    relationships: {
                        appCustomProductPageLocalization: {
                            data: { type: 'appCustomProductPageLocalizations', id: localeId },
                        },
                    },
                },
            }
        );
        const screenshotSetId = setResp.data.id;

        // 3. Upload CPP image as #1, then template shots as #2-8
        let uploaded = 0;

        for (const shotPath of allShots) {
            await this.uploadScreenshot(screenshotSetId, shotPath);
            uploaded++;
            // Small delay to avoid overwhelming the API
            await new Promise((r) => setTimeout(r, 500));
        }

        return {
            cppId,
            localeId,
            screenshotSetId,
            screenshotsUploaded: uploaded,
            url: `https://apps.apple.com/us/app/id${this.appId}?ppid=${cppId}`,
        };
    }

    private async uploadScreenshot(setId: string, filePath: string): Promise<string> {
        const fileSize = statSync(filePath).size;
        const fileName = basename(filePath);
        const checksum = md5File(filePath);

        // Step 1: Reserve upload slot (no sourceFileChecksum in POST)
        const reserveBody = {
            data: {
                type: 'appScreenshots',
                attributes: { fileName, fileSize },
                relationships: {
                    appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } },
                },
            },
        };
        const reserveResp = await this.client.post<ScreenshotReserveResponse>(
            '/appScreenshots',
            reserveBody
        );
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

        const commitBody = {
            data: {
                type: 'appScreenshots',
                id: shotId,
                attributes: { uploaded: true, sourceFileChecksum: checksum },
            },
        };
        await this.client.patch(`/appScreenshots/${shotId}`, commitBody);

        return shotId;
    }
}
