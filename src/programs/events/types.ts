export interface AppEventInfo {
    id: string;
    referenceName: string;
    badge: string;
    eventState: string;
    deepLink?: string;
    purchaseRequirement?: string;
    primaryLocale?: string;
    territorySchedules?: TerritorySchedule[];
}

export interface TerritorySchedule {
    territories: string[];
    publishStart?: string;
    eventStart?: string;
    eventEnd?: string;
}

export interface AppEventLocalizationInfo {
    id: string;
    locale: string;
    name?: string;
    shortDescription?: string;
    longDescription?: string;
    promotionalText?: string;
}

export interface AppEventSubmissionInfo {
    id: string;
    eventId: string;
}

export interface AppEventsResponse {
    data: any[];
    links?: { next?: string };
}

export interface AppEventResponse {
    data: any;
}

export interface AppEventLocalizationsResponse {
    data: any[];
}

export interface AppEventLocalizationResponse {
    data: any;
}

export interface AppEventSubmissionResponse {
    data: any;
}
