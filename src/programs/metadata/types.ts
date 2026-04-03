// ── AppStoreVersionLocalizations (version-scoped) ────────────────────────
export interface AppVersionLocalization {
    type: string;
    id: string;
    attributes: {
        locale: string;
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
    description?: string;
    keywords?: string;
    promotionalText?: string;
    whatsNew?: string;
    marketingUrl?: string;
    supportUrl?: string;
}

// ── AppInfoLocalizations (app-scoped: name, subtitle) ────────────────────
export interface AppInfoLocalization {
    type: string;
    id: string;
    attributes: {
        locale: string;
        name?: string;
        subtitle?: string;
        privacyChoicesUrl?: string;
        privacyPolicyText?: string;
        privacyPolicyUrl?: string;
    };
}

export interface AppInfoLocalizationsResponse {
    data: AppInfoLocalization[];
    links?: { self?: string; next?: string };
}

export interface AppInfoLocalizationResponse {
    data: AppInfoLocalization;
}

export interface AppInfoLocalizationInfo {
    id: string;
    locale: string;
    name?: string;
    subtitle?: string;
    privacyChoicesUrl?: string;
}
