import { AppStoreConnectClient } from '../api-client/index.js';
import { App, AppsResponse, AppResponse } from './types.js';
import { AppInfo } from '../../types.js';

export class AppManager {
    constructor(private client: AppStoreConnectClient) {}

    /** API resource shape (keeps attributes.*) so callers can project fields. */
    public async listAppResources(options?: { limit?: number; all?: boolean }): Promise<App[]> {
        const limit = options?.limit ?? 200;
        if (options?.all) {
            return this.client.getAllPages<App>('/apps', {}, { limit: options.limit });
        }
        const response = await this.client.get<AppsResponse>('/apps', { limit: Math.min(limit, 200) });
        return (response.data ?? []).slice(0, limit);
    }

    public async listApps(limit: number = 200): Promise<AppInfo[]> {
        const apps = await this.listAppResources({ limit, all: false });
        return apps.map((app) => this.mapAppToInfo(app));
    }

    public async getApp(appId: string): Promise<AppInfo> {
        const response = await this.client.get<AppResponse>(`/apps/${appId}`);
        return this.mapAppToInfo(response.data);
    }

    public async getAppByBundleId(bundleId: string): Promise<AppInfo | null> {
        const response = await this.client.get<AppsResponse>('/apps', {
            'filter[bundleId]': bundleId,
        });

        if (response.data.length === 0) {
            return null;
        }

        return this.mapAppToInfo(response.data[0]!);
    }

    private mapAppToInfo(app: App): AppInfo {
        return {
            id: app.id,
            bundleId: app.attributes.bundleId,
            name: app.attributes.name,
            sku: app.attributes.sku,
            primaryLocale: app.attributes.primaryLocale,
        };
    }
}