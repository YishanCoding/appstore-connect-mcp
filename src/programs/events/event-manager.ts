import { AppStoreConnectClient } from '../api-client/index.js';
import {
    AppEventInfo,
    AppEventLocalizationInfo,
    AppEventSubmissionInfo,
    AppEventResponse,
    AppEventLocalizationsResponse,
    AppEventLocalizationResponse,
    AppEventSubmissionResponse,
    TerritorySchedule,
} from './types.js';

export class EventManager {
    constructor(private client: AppStoreConnectClient) {}

    private mapEvent(v: any): AppEventInfo {
        return {
            id: v.id,
            referenceName: v.attributes.referenceName,
            badge: v.attributes.badge,
            eventState: v.attributes.eventState,
            deepLink: v.attributes.deepLink,
            purchaseRequirement: v.attributes.purchaseRequirement,
            primaryLocale: v.attributes.primaryLocale,
            territorySchedules: v.attributes.territorySchedules,
        };
    }

    private mapLocalization(v: any): AppEventLocalizationInfo {
        return {
            id: v.id,
            locale: v.attributes.locale,
            name: v.attributes.name,
            shortDescription: v.attributes.shortDescription,
            longDescription: v.attributes.longDescription,
            promotionalText: v.attributes.promotionalText,
        };
    }

    public async listEvents(appId: string): Promise<AppEventInfo[]> {
        const items = await this.client.followPages<any>(`/apps/${appId}/appEvents`);
        return items.map((v) => this.mapEvent(v));
    }

    public async createEvent(
        appId: string,
        attrs: {
            referenceName: string;
            badge: string;
            eventState?: string;
            deepLink?: string;
            purchaseRequirement?: string;
            primaryLocale?: string;
            territorySchedules?: TerritorySchedule[];
        }
    ): Promise<AppEventInfo> {
        const resp = await this.client.post<AppEventResponse>('/appEvents', {
            data: {
                type: 'appEvents',
                attributes: attrs,
                relationships: {
                    app: { data: { type: 'apps', id: appId } },
                },
            },
        });
        return this.mapEvent(resp.data);
    }

    public async getEvent(eventId: string): Promise<AppEventInfo> {
        const resp = await this.client.get<AppEventResponse>(`/appEvents/${eventId}`);
        return this.mapEvent(resp.data);
    }

    public async updateEvent(
        eventId: string,
        attrs: Partial<{
            referenceName: string;
            badge: string;
            eventState: string;
            deepLink: string;
            purchaseRequirement: string;
            primaryLocale: string;
            territorySchedules: TerritorySchedule[];
        }>
    ): Promise<AppEventInfo> {
        const resp = await this.client.patch<AppEventResponse>(`/appEvents/${eventId}`, {
            data: {
                type: 'appEvents',
                id: eventId,
                attributes: attrs,
            },
        });
        return this.mapEvent(resp.data);
    }

    public async deleteEvent(eventId: string): Promise<void> {
        await this.client.delete(`/appEvents/${eventId}`);
    }

    public async listLocalizations(eventId: string): Promise<AppEventLocalizationInfo[]> {
        const resp = await this.client.get<AppEventLocalizationsResponse>(
            `/appEvents/${eventId}/localizations`
        );
        return resp.data.map((v) => this.mapLocalization(v));
    }

    public async createLocalization(
        eventId: string,
        attrs: {
            locale: string;
            name: string;
            shortDescription: string;
            longDescription?: string;
            promotionalText?: string;
        }
    ): Promise<AppEventLocalizationInfo> {
        const resp = await this.client.post<AppEventLocalizationResponse>(
            '/appEventLocalizations',
            {
                data: {
                    type: 'appEventLocalizations',
                    attributes: attrs,
                    relationships: {
                        appEvent: { data: { type: 'appEvents', id: eventId } },
                    },
                },
            }
        );
        return this.mapLocalization(resp.data);
    }

    public async updateLocalization(
        localizationId: string,
        attrs: Partial<{
            name: string;
            shortDescription: string;
            longDescription: string;
            promotionalText: string;
        }>
    ): Promise<AppEventLocalizationInfo> {
        const resp = await this.client.patch<AppEventLocalizationResponse>(
            `/appEventLocalizations/${localizationId}`,
            {
                data: {
                    type: 'appEventLocalizations',
                    id: localizationId,
                    attributes: attrs,
                },
            }
        );
        return this.mapLocalization(resp.data);
    }

    public async submitEvent(eventId: string): Promise<AppEventSubmissionInfo> {
        const resp = await this.client.post<AppEventSubmissionResponse>(
            '/appEventSubmissions',
            {
                data: {
                    type: 'appEventSubmissions',
                    relationships: {
                        appEvent: { data: { type: 'appEvents', id: eventId } },
                    },
                },
            }
        );
        return {
            id: resp.data.id,
            eventId,
        };
    }
}
