import { AppStoreConnectClient } from '../api-client/index.js';
import { AppInfo } from '../../types.js';
export declare class AppManager {
    private client;
    constructor(client: AppStoreConnectClient);
    listApps(limit?: number): Promise<AppInfo[]>;
    getApp(appId: string): Promise<AppInfo>;
    getAppByBundleId(bundleId: string): Promise<AppInfo | null>;
    private mapAppToInfo;
}
//# sourceMappingURL=app-manager.d.ts.map