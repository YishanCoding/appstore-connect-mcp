export class BuildManager {
    client;
    constructor(client) {
        this.client = client;
    }
    async listBuilds(appId, limit = 100) {
        const response = await this.client.get('/builds', {
            'filter[app]': appId,
            limit,
            sort: '-uploadedDate',
        });
        return response.data.map((build) => this.mapBuildToInfo(build));
    }
    async getBuild(buildId) {
        const response = await this.client.get(`/builds/${buildId}`);
        return this.mapBuildToInfo(response.data);
    }
    async getLatestBuild(appId) {
        const response = await this.client.get('/builds', {
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
    async getBuildsByVersion(appId, version) {
        const response = await this.client.get('/builds', {
            'filter[app]': appId,
            'filter[version]': version,
            sort: '-uploadedDate',
        });
        return response.data.map((build) => this.mapBuildToInfo(build));
    }
    mapBuildToInfo(build) {
        return {
            id: build.id,
            version: build.attributes.version,
            buildNumber: build.attributes.version,
            processingState: build.attributes.processingState,
            uploadedDate: build.attributes.uploadedDate,
        };
    }
}
//# sourceMappingURL=build-manager.js.map