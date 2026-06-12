import { AppStoreConnectClient } from '../api-client/index.js';
import {
    BetaAppLocalization,
    BetaAppLocalizationAttributes,
    BetaAppLocalizationResponse,
    BetaAppLocalizationsResponse,
    BetaGroup,
    BetaGroupsResponse,
    BetaTester,
    BetaTestersResponse,
} from './types.js';
import { TestFlightInfo, BetaTesterInfo } from '../../types.js';

export class TestFlightManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listBetaGroups(appId: string): Promise<TestFlightInfo[]> {
        const response = await this.client.get<BetaGroupsResponse>('/betaGroups', {
            'filter[app]': appId,
            limit: 200,
        });

        return response.data.map((group) => this.mapBetaGroupToInfo(group));
    }

    public async addBuildToBetaGroup(buildId: string, betaGroupId: string): Promise<void> {
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

    public async removeBuildFromBetaGroup(buildId: string, betaGroupId: string): Promise<void> {
        const data = {
            data: [
                {
                    type: 'builds',
                    id: buildId,
                },
            ],
        };

        await this.client.delete(`/betaGroups/${betaGroupId}/relationships/builds`, data);
    }

    public async listBetaTesters(betaGroupId: string, limit: number = 200): Promise<BetaTesterInfo[]> {
        const response = await this.client.get<BetaTestersResponse>(`/betaGroups/${betaGroupId}/betaTesters`, {
            limit,
        });

        return response.data.map((t) => this.mapBetaTesterToInfo(t));
    }

    public async addBetaTester(email: string, firstName: string, lastName: string, betaGroupIds: string[]) {
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

    public async listBetaLocalizations(appId: string): Promise<BetaAppLocalization[]> {
        const response = await this.client.get<BetaAppLocalizationsResponse>(
            `/apps/${appId}/betaAppLocalizations`
        );
        return response.data;
    }

    public async upsertBetaLocalization(appId: string, attributes: BetaAppLocalizationAttributes & { locale: string }) {
        const localizations = await this.listBetaLocalizations(appId);
        const existing = localizations.find((localization) => localization.attributes.locale === attributes.locale);

        if (existing) {
            const response = await this.client.patch<BetaAppLocalizationResponse>(
                `/betaAppLocalizations/${existing.id}`,
                {
                    data: {
                        type: 'betaAppLocalizations',
                        id: existing.id,
                        attributes,
                    },
                }
            );
            return response.data;
        }

        const response = await this.client.post<BetaAppLocalizationResponse>(
            '/betaAppLocalizations',
            {
                data: {
                    type: 'betaAppLocalizations',
                    attributes,
                    relationships: {
                        app: { data: { type: 'apps', id: appId } },
                    },
                },
            }
        );
        return response.data;
    }

    private mapBetaTesterToInfo(tester: BetaTester): BetaTesterInfo {
        return {
            id: tester.id,
            email: tester.attributes.email,
            firstName: tester.attributes.firstName ?? null,
            lastName: tester.attributes.lastName ?? null,
            inviteType: tester.attributes.inviteType,
            state: tester.attributes.state,
        };
    }

    private mapBetaGroupToInfo(group: BetaGroup): TestFlightInfo {
        return {
            id: group.id,
            name: group.attributes.name,
            isInternalGroup: group.attributes.isInternalGroup,
            publicLinkEnabled: group.attributes.publicLinkEnabled ?? false,
            publicLink: group.attributes.publicLink ?? null,
        };
    }
}
