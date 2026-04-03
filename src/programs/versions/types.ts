export interface AppStoreVersion {
    type: string;
    id: string;
    attributes: {
        platform: string;
        versionString: string;
        appStoreState: string;
        releaseType?: string;
        earliestReleaseDate?: string;
        createdDate: string;
    };
}

export interface AppStoreVersionsResponse {
    data: AppStoreVersion[];
    links?: { self?: string; next?: string };
}

export interface AppStoreVersionResponse {
    data: AppStoreVersion;
}

export interface VersionInfo {
    id: string;
    platform: string;
    versionString: string;
    appStoreState: string;
    releaseType?: string;
    createdDate: string;
}
