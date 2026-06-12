import { AppStoreConnectClient } from '../api-client/index.js';
import {
    AppStoreVersionsResponse,
    AppStoreVersionResponse,
    AppStoreReviewDetailResponse,
    AppStoreReviewRequestResponse,
    AppStoreVersionPhasedReleaseResponse,
    AppStoreVersionReleaseRequestResponse,
    ReviewDetailAttributes,
    VersionInfo,
} from './types.js';

export class VersionManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listVersions(appId: string, platform = 'IOS'): Promise<VersionInfo[]> {
        const response = await this.client.get<AppStoreVersionsResponse>(
            `/apps/${appId}/appStoreVersions`,
            { 'filter[platform]': platform }
        );
        return response.data.map((v) => this.mapToInfo(v));
    }

    public async getVersion(versionId: string): Promise<VersionInfo> {
        const response = await this.client.get<AppStoreVersionResponse>(
            `/appStoreVersions/${versionId}`
        );
        return this.mapToInfo(response.data);
    }

    public async createVersion(
        appId: string,
        versionString: string,
        platform = 'IOS'
    ): Promise<VersionInfo> {
        const data = {
            data: {
                type: 'appStoreVersions',
                attributes: { platform, versionString },
                relationships: {
                    app: { data: { type: 'apps', id: appId } },
                },
            },
        };
        const response = await this.client.post<AppStoreVersionResponse>(
            `/appStoreVersions`,
            data
        );
        return this.mapToInfo(response.data);
    }

    public async submitForReview(versionId: string): Promise<any> {
        const response = await this.client.post<AppStoreReviewRequestResponse>(
            '/appStoreReviewRequests',
            {
                data: {
                    type: 'appStoreReviewRequests',
                    relationships: {
                        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
                    },
                },
            }
        );
        return response.data;
    }

    public async cancelReview(reviewRequestId: string): Promise<void> {
        await this.client.delete(`/appStoreReviewRequests/${reviewRequestId}`);
    }

    public async createPhasedRelease(versionId: string): Promise<any> {
        const response = await this.client.post<AppStoreVersionPhasedReleaseResponse>(
            '/appStoreVersionPhasedReleases',
            {
                data: {
                    type: 'appStoreVersionPhasedReleases',
                    attributes: { phasedReleaseState: 'ACTIVE' },
                    relationships: {
                        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
                    },
                },
            }
        );
        return response.data;
    }

    public async getPhasedRelease(versionId: string): Promise<any> {
        const response = await this.client.get<AppStoreVersionPhasedReleaseResponse>(
            `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`
        );
        return response.data;
    }

    public async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<any> {
        const response = await this.client.patch<AppStoreVersionPhasedReleaseResponse>(
            `/appStoreVersionPhasedReleases/${phasedReleaseId}`,
            {
                data: {
                    type: 'appStoreVersionPhasedReleases',
                    id: phasedReleaseId,
                    attributes: { phasedReleaseState },
                },
            }
        );
        return response.data;
    }

    public async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
        await this.client.delete(`/appStoreVersionPhasedReleases/${phasedReleaseId}`);
    }

    public async releaseVersion(versionId: string): Promise<any> {
        const response = await this.client.post<AppStoreVersionReleaseRequestResponse>(
            '/appStoreVersionReleaseRequests',
            {
                data: {
                    type: 'appStoreVersionReleaseRequests',
                    relationships: {
                        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
                    },
                },
            }
        );
        return response.data;
    }

    public async getReviewDetail(versionId: string): Promise<any> {
        const response = await this.client.get<AppStoreReviewDetailResponse>(
            `/appStoreVersions/${versionId}/appStoreReviewDetail`
        );
        return response.data;
    }

    public async upsertReviewDetail(versionId: string, attributes: ReviewDetailAttributes): Promise<any> {
        let existing: any | null = null;
        try {
            existing = await this.getReviewDetail(versionId);
        } catch (e: any) {
            if (!/not found|does not exist|could not be found/i.test(e.message ?? '')) {
                throw e;
            }
        }

        if (existing?.id) {
            const response = await this.client.patch<AppStoreReviewDetailResponse>(
                `/appStoreReviewDetails/${existing.id}`,
                {
                    data: {
                        type: 'appStoreReviewDetails',
                        id: existing.id,
                        attributes,
                    },
                }
            );
            return response.data;
        }

        const response = await this.client.post<AppStoreReviewDetailResponse>(
            '/appStoreReviewDetails',
            {
                data: {
                    type: 'appStoreReviewDetails',
                    attributes,
                    relationships: {
                        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
                    },
                },
            }
        );
        return response.data;
    }

    private mapToInfo(v: any): VersionInfo {
        return {
            id: v.id,
            platform: v.attributes.platform,
            versionString: v.attributes.versionString,
            appStoreState: v.attributes.appStoreState,
            releaseType: v.attributes.releaseType,
            createdDate: v.attributes.createdDate,
        };
    }
}
