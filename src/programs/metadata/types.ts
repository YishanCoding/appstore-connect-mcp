export interface AppVersionLocalization {
    type: string;
    id: string;
    attributes: {
        locale: string;
        name?: string;
        subtitle?: string;
        description?: string;
        keywords?: string;
        promotionalText?: string;
        whatsNew?: string;
        marketingUrl?: string;
        supportUrl?: string;
        privacyPolicyUrl?: string;
    };
}

export interface AppVersionLocalizationsResponse {
    data: AppVersionLocalization[];
    links?: { self?: string; next?: string };
}

export interface AppVersionLocalizationResponse {
    data: AppVersionLocalization;
}

export interface LocalizationInfo {
    id: string;
    locale: string;
    name?: string;
    subtitle?: string;
    description?: string;
    keywords?: string;
    promotionalText?: string;
    whatsNew?: string;
}
