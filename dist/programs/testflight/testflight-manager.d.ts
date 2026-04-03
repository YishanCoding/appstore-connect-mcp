import { AppStoreConnectClient } from '../api-client/index.js';
import { BetaTester } from './types.js';
import { TestFlightInfo } from '../../types.js';
export declare class TestFlightManager {
    private client;
    constructor(client: AppStoreConnectClient);
    listBetaGroups(appId: string): Promise<TestFlightInfo[]>;
    addBuildToBetaGroup(buildId: string, betaGroupId: string): Promise<void>;
    removeBuildFromBetaGroup(buildId: string, betaGroupId: string): Promise<void>;
    listBetaTesters(betaGroupId: string): Promise<BetaTester[]>;
    addBetaTester(email: string, firstName: string, lastName: string, betaGroupIds: string[]): Promise<void>;
    private mapBetaGroupToInfo;
}
//# sourceMappingURL=testflight-manager.d.ts.map