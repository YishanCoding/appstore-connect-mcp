export interface BetaGroup {
    type: string;
    id: string;
    attributes: {
        name: string;
        isInternalGroup: boolean;
        hasAccessToAllBuilds: boolean;
        publicLinkEnabled: boolean;
        publicLinkLimit?: number;
        publicLinkLimitEnabled: boolean;
        publicLink?: string;
        feedbackEnabled: boolean;
        createdDate: string;
    };
    relationships?: {
        app?: {
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
        betaTesters?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
    };
}
export interface BetaGroupsResponse {
    data: BetaGroup[];
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
export interface BetaTester {
    type: string;
    id: string;
    attributes: {
        firstName?: string;
        lastName?: string;
        email: string;
        inviteType: string;
        state: string;
    };
}
export interface BetaTestersResponse {
    data: BetaTester[];
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
//# sourceMappingURL=types.d.ts.map