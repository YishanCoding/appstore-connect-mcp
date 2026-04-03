import { AppStoreConnectClient } from '../api-client/index.js';
import {
    AppVersionLocalizationsResponse,
    AppVersionLocalizationResponse,
    LocalizationInfo,
} from './types.js';

export class MetadataManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listLocalizations(appStoreVersionId: string): Promise<LocalizationInfo[]> {
        const response = await this.client.get<AppVersionLocalizationsResponse>(
            `/appStoreVersions/${appStoreVersionId}/appStoreVersionLocalizations`
        );
        return response.data.map((loc) => this.mapToInfo(loc));
    }

    public async getLocalization(localizationId: string): Promise<LocalizationInfo> {
        const response = await this.client.get<AppVersionLocalizationResponse>(
            `/appStoreVersionLocalizations/${localizationId}`
        );
        return this.mapToInfo(response.data);
    }

    public async updateLocalization(
        localizationId: string,
        fields: {
            name?: string;
            subtitle?: string;
            description?: string;
            keywords?: string;
            promotionalText?: string;
            whatsNew?: string;
            marketingUrl?: string;
            supportUrl?: string;
        }
    ): Promise<LocalizationInfo> {
        const data = {
            data: {
                type: 'appStoreVersionLocalizations',
                id: localizationId,
                attributes: fields,
            },
        };
        const response = await this.client.patch<AppVersionLocalizationResponse>(
            `/appStoreVersionLocalizations/${localizationId}`,
            data
        );
        return this.mapToInfo(response.data);
    }

    public async createLocalization(
        appStoreVersionId: string,
        locale: string,
        fields: {
            name?: string;
            subtitle?: string;
            description?: string;
            keywords?: string;
            promotionalText?: string;
            whatsNew?: string;
        }
    ): Promise<LocalizationInfo> {
        const data = {
            data: {
                type: 'appStoreVersionLocalizations',
                attributes: { locale, ...fields },
                relationships: {
                    appStoreVersion: {
                        data: { type: 'appStoreVersions', id: appStoreVersionId },
                    },
                },
            },
        };
        const response = await this.client.post<AppVersionLocalizationResponse>(
            `/appStoreVersionLocalizations`,
            data
        );
        return this.mapToInfo(response.data);
    }

    private mapToInfo(loc: any): LocalizationInfo {
        return {
            id: loc.id,
            locale: loc.attributes.locale,
            name: loc.attributes.name,
            subtitle: loc.attributes.subtitle,
            description: loc.attributes.description,
            keywords: loc.attributes.keywords,
            promotionalText: loc.attributes.promotionalText,
            whatsNew: loc.attributes.whatsNew,
        };
    }
}
