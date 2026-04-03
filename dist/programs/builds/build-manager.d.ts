import { AppStoreConnectClient } from '../api-client/index.js';
import { BuildInfo } from '../../types.js';
export declare class BuildManager {
    private client;
    constructor(client: AppStoreConnectClient);
    listBuilds(appId: string, limit?: number): Promise<BuildInfo[]>;
    getBuild(buildId: string): Promise<BuildInfo>;
    getLatestBuild(appId: string): Promise<BuildInfo | null>;
    getBuildsByVersion(appId: string, version: string): Promise<BuildInfo[]>;
    private mapBuildToInfo;
}
//# sourceMappingURL=build-manager.d.ts.map