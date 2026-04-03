export class TestFlightManager {
    client;
    constructor(client) {
        this.client = client;
    }
    async listBetaGroups(appId) {
        const response = await this.client.get('/betaGroups', {
            'filter[app]': appId,
            limit: 200,
        });
        return response.data.map((group) => this.mapBetaGroupToInfo(group));
    }
    async addBuildToBetaGroup(buildId, betaGroupId) {
        const data = {
            data: [
                {
                    type: 'builds',
                    id: buildId,
                },
            ],
        };
        await this.client.post(`/betaGroups/${betaGroupId}/relationships/builds`, data);
    }
    async removeBuildFromBetaGroup(buildId, betaGroupId) {
        const data = {
            data: [
                {
                    type: 'builds',
                    id: buildId,
                },
            ],
        };
        await this.client.delete(`/betaGroups/${betaGroupId}/relationships/builds`);
    }
    async listBetaTesters(betaGroupId) {
        const response = await this.client.get(`/betaGroups/${betaGroupId}/betaTesters`, {
            limit: 200,
        });
        return response.data;
    }
    async addBetaTester(email, firstName, lastName, betaGroupIds) {
        const data = {
            data: {
                type: 'betaTesters',
                attributes: {
                    email,
                    firstName,
                    lastName,
                },
                relationships: {
                    betaGroups: {
                        data: betaGroupIds.map((id) => ({
                            type: 'betaGroups',
                            id,
                        })),
                    },
                },
            },
        };
        await this.client.post('/betaTesters', data);
    }
    mapBetaGroupToInfo(group) {
        return {
            id: group.id,
            name: group.attributes.name,
            isInternalGroup: group.attributes.isInternalGroup,
            isActive: group.attributes.publicLinkEnabled || false,
        };
    }
}
//# sourceMappingURL=testflight-manager.js.map