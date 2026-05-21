import axios from 'axios';
import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename } from 'path';
import { AppStoreConnectClient } from '../api-client/index.js';
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

function md5File(path: string): string {
    const data = readFileSync(path);
    return createHash('md5').update(data).digest('hex');
}

export class CppManager {
    constructor(
        private client: AppStoreConnectClient,
        private appId: string
    ) {}

    public async listCpps(): Promise<CppInfo[]> {
        const resp = await this.client.get<ListCppsResponse>(
            `/apps/${this.appId}/appCustomProductPages`,
            { limit: 200 }
        );
        return resp.data.map((d) => ({
            id: d.id,
            name: d.attributes.name,
            state: d.attributes.state,
            url: `https://apps.apple.com/us/app/id${this.appId}?ppid=${d.id}`,
        }));
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
        templateShotPaths: string[]
    ): Promise<CreateCppResult> {
        if (promotionalText.length > 170) {
            throw new Error(`promotionalText exceeds 170 chars (${promotionalText.length})`);
        }

        // 1. Atomic creation: CPP + version + locale in a single POST
        const createBody = {
            data: {
                type: 'appCustomProductPages',
                attributes: { name },
                relationships: {
                    app: { data: { type: 'apps', id: this.appId } },
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

        const createResp = await this.client.post<{ data: { id: string }; included: { type: string; id: string }[] }>(
            '/appCustomProductPages',
            createBody
        );

        const cppId = createResp.data.id;
        const localeId = createResp.included.find(
            (x) => x.type === 'appCustomProductPageLocalizations'
        )!.id;

        // 2. Create screenshot set for iPhone 6.5"
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
        const allShots = [cppImagePath, ...templateShotPaths];
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
                await this.client.patch(`/appScreenshots/${shotId}`, commitBody);
                break;
            } catch (e) {
                if (attempt === 2) throw e;
                await new Promise((r) => setTimeout(r, 3000));
            }
        }

        return shotId;
    }
}
