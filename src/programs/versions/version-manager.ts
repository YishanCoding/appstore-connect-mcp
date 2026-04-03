import { AppStoreConnectClient } from '../api-client/index.js';
import {
    AppStoreVersionsResponse,
    AppStoreVersionResponse,
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
