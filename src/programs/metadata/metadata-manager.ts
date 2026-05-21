import { AppStoreConnectClient } from '../api-client/index.js';
import {
    AppVersionLocalizationsResponse,
    AppVersionLocalizationResponse,
    AppInfoLocalizationsResponse,
    AppInfoLocalizationResponse,
    LocalizationInfo,
    AppInfoLocalizationInfo,
} from './types.js';

/**
 * Manages two separate Apple ASC resources:
 *
 * 1. AppStoreVersionLocalizations — version-scoped metadata
 *    Fields: description, keywords, promotionalText, whatsNew, marketingUrl, supportUrl, privacyPolicyUrl
 *
 * 2. AppInfoLocalizations — app-scoped metadata (stable across versions)
 *    Fields: name, subtitle, privacyChoicesUrl, privacyPolicyText, privacyPolicyUrl
 *
 * Note: name and subtitle belong to AppInfoLocalizations, NOT AppStoreVersionLocalizations.
 */
export class MetadataManager {
    constructor(private client: AppStoreConnectClient) {}

    // ── AppStoreVersionLocalizations ──────────────────────────────────────

    public async listVersionLocalizations(appStoreVersionId: string): Promise<LocalizationInfo[]> {
        const response = await this.client.get<AppVersionLocalizationsResponse>(
            `/appStoreVersions/${appStoreVersionId}/appStoreVersionLocalizations`
        );
        return response.data.map((loc) => this.mapVersionLocToInfo(loc));
    }

    public async updateVersionLocalization(
        localizationId: string,
        fields: {
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
        return this.mapVersionLocToInfo(response.data);
    }

    public async createVersionLocalization(
        appStoreVersionId: string,
        locale: string,
        fields: {
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
        return this.mapVersionLocToInfo(response.data);
    }

    // ── AppInfoLocalizations (name, subtitle) ─────────────────────────────

    public async listAppInfoLocalizations(appId: string): Promise<AppInfoLocalizationInfo[]> {
        // Each app has multiple appInfos — typically one EDITABLE (for the next
        // unsubmitted version) and one tied to the live READY_FOR_SALE version.
        // Live appInfo's name/subtitle is locked; only the EDITABLE one can be
        // modified. Prefer states in this order: PREPARE_FOR_SUBMISSION (editable
        // for next version) → REPLACED_WITH_NEW_INFO (older editable) → fallback
        // to first available.
        const appInfosResponse = await this.client.get<any>(`/apps/${appId}/appInfos`);
        const infos = appInfosResponse.data || [];
        if (infos.length === 0) throw new Error('No appInfo found for this app');

        const editableStates = ['PREPARE_FOR_SUBMISSION', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'REPLACED_WITH_NEW_INFO'];
        let chosen = infos.find((i: any) => editableStates.includes(i.attributes?.appStoreState));
        if (!chosen) chosen = infos[0];

        const response = await this.client.get<AppInfoLocalizationsResponse>(
            `/appInfos/${chosen.id}/appInfoLocalizations`
        );
        return response.data.map((loc) => this.mapAppInfoLocToInfo(loc));
    }

    public async updateAppInfoLocalization(
        appInfoLocalizationId: string,
        fields: {
            name?: string;
            subtitle?: string;
            privacyChoicesUrl?: string;
            privacyPolicyText?: string;
            privacyPolicyUrl?: string;
        }
    ): Promise<AppInfoLocalizationInfo> {
        const data = {
            data: {
                type: 'appInfoLocalizations',
                id: appInfoLocalizationId,
                attributes: fields,
            },
        };
        const response = await this.client.patch<AppInfoLocalizationResponse>(
            `/appInfoLocalizations/${appInfoLocalizationId}`,
            data
        );
        return this.mapAppInfoLocToInfo(response.data);
    }

    // ── Private mappers ───────────────────────────────────────────────────

    private mapVersionLocToInfo(loc: any): LocalizationInfo {
        return {
            id: loc.id,
            locale: loc.attributes.locale,
            description: loc.attributes.description,
            keywords: loc.attributes.keywords,
            promotionalText: loc.attributes.promotionalText,
            whatsNew: loc.attributes.whatsNew,
            marketingUrl: loc.attributes.marketingUrl,
            supportUrl: loc.attributes.supportUrl,
        };
    }

    private mapAppInfoLocToInfo(loc: any): AppInfoLocalizationInfo {
        return {
            id: loc.id,
            locale: loc.attributes.locale,
            name: loc.attributes.name,
            subtitle: loc.attributes.subtitle,
            privacyChoicesUrl: loc.attributes.privacyChoicesUrl,
        };
    }
}
