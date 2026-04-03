import { AppStoreConnectClient } from '../api-client/index.js';
import { Build, BuildsResponse, BuildResponse } from './types.js';
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

        return this.mapBuildToInfo(response.data[0]);
    }

    public async getBuildsByVersion(appId: string, version: string): Promise<BuildInfo[]> {
        const response = await this.client.get<BuildsResponse>('/builds', {
            'filter[app]': appId,
            'filter[version]': version,
            sort: '-uploadedDate',
        });

        return response.data.map((build) => this.mapBuildToInfo(build));
    }

    private mapBuildToInfo(build: Build): BuildInfo {
        return {
            id: build.id,
            version: build.attributes.version,
            buildNumber: build.attributes.version,
            processingState: build.attributes.processingState,
            uploadedDate: build.attributes.uploadedDate,
        };
    }
}