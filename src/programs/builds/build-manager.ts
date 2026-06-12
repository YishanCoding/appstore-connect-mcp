import { AppStoreConnectClient } from '../api-client/index.js';
import { Build, BuildsResponse, BuildResponse, BuildBetaDetailAttributes, BuildBetaDetailResponse } from './types.js';
import { BuildInfo } from '../../types.js';

export class BuildManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listBuilds(appId: string, limit: number = 100): Promise<BuildInfo[]> {
        const response = await this.client.get<BuildsResponse>('/builds', {
            'filter[app]': appId,
            limit,
            sort: '-uploadedDate',
        });

        return response.data.map((build) => this.mapBuildToInfo(build));
    }

    public async getBuild(buildId: string): Promise<BuildInfo> {
        const response = await this.client.get<BuildResponse>(`/builds/${buildId}`);
        return this.mapBuildToInfo(response.data);
    }

    public async getLatestBuild(appId: string): Promise<BuildInfo | null> {
        const response = await this.client.get<BuildsResponse>('/builds', {
            'filter[app]': appId,
            'filter[expired]': false,
            limit: 1,
            sort: '-uploadedDate',
        });

        if (response.data.length === 0) {
            return null;
        }

        return this.mapBuildToInfo(response.data[0]!);
    }

    public async getBuildsByVersion(appId: string, version: string, limit: number = 50): Promise<BuildInfo[]> {
        const response = await this.client.get<BuildsResponse>('/builds', {
            'filter[app]': appId,
            'filter[version]': version,
            sort: '-uploadedDate',
            limit,
        });

        return response.data.map((build) => this.mapBuildToInfo(build));
    }

    public async getBuildBetaDetail(buildId: string) {
        const response = await this.client.get<BuildBetaDetailResponse>(`/builds/${buildId}/buildBetaDetail`);
        return response.data;
    }

    public async updateBuildBetaDetail(buildBetaDetailId: string, attributes: BuildBetaDetailAttributes) {
        const response = await this.client.patch<BuildBetaDetailResponse>(
            `/buildBetaDetails/${buildBetaDetailId}`,
            {
                data: {
                    type: 'buildBetaDetails',
                    id: buildBetaDetailId,
                    attributes,
                },
            }
        );
        return response.data;
    }

    private mapBuildToInfo(build: Build): BuildInfo {
        return {
            id: build.id,
            version: build.attributes.version,
            processingState: build.attributes.processingState,
            uploadedDate: build.attributes.uploadedDate,
            expirationDate: build.attributes.expirationDate,
            expired: build.attributes.expired,
            minOsVersion: build.attributes.minOsVersion,
        };
    }
}
