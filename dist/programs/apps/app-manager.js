export class AppManager {
    client;
    constructor(client) {
        this.client = client;
    }
    async listApps(limit = 200) {
        const response = await this.client.get('/apps', {
            limit,
        });
        return response.data.map((app) => this.mapAppToInfo(app));
    }
    async getApp(appId) {
        const response = await this.client.get(`/apps/${appId}`);
        return this.mapAppToInfo(response.data);
    }
    async getAppByBundleId(bundleId) {
        const response = await this.client.get('/apps', {
            'filter[bundleId]': bundleId,
        });
        if (response.data.length === 0) {
            return null;
        }
        return this.mapAppToInfo(response.data[0]);
    }
    mapAppToInfo(app) {
        return {
            id: app.id,
            bundleId: app.attributes.bundleId,
            name: app.attributes.name,
            sku: app.attributes.sku,
            primaryLocale: app.attributes.primaryLocale,
        };
    }
}
//# sourceMappingURL=app-manager.js.map