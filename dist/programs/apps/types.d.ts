export interface App {
    type: string;
    id: string;
    attributes: {
        name: string;
        bundleId: string;
        sku: string;
        primaryLocale: string;
        isOrEverWasMadeForKids: boolean;
        subscriptionStatusUrl?: string;
        subscriptionStatusUrlVersion?: string;
        subscriptionStatusUrlForSandbox?: string;
        subscriptionStatusUrlVersionForSandbox?: string;
        availableInNewTerritories?: boolean;
        contentRightsDeclaration?: string;
    };
    relationships?: {
        appInfos?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
        appStoreVersions?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
        builds?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
    };
}
export interface AppsResponse {
    data: App[];
    links?: {
        self?: string;
        next?: string;
    };
    meta?: {
        paging?: {
            total: number;
            limit: number;
        };
    };
}
export interface AppResponse {
    data: App;
}
//# sourceMappingURL=types.d.ts.map