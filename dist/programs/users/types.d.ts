export interface User {
    type: string;
    id: string;
    attributes: {
        username: string;
        firstName: string;
        lastName: string;
        roles: string[];
        allAppsVisible: boolean;
        provisioningAllowed: boolean;
    };
    relationships?: {
        visibleApps?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
    };
}
export interface UsersResponse {
    data: User[];
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
export interface UserInvitation {
    type: string;
    id: string;
    attributes: {
        email: string;
        firstName: string;
        lastName: string;
        roles: string[];
        allAppsVisible: boolean;
        provisioningAllowed: boolean;
        expirationDate: string;
    };
}
//# sourceMappingURL=types.d.ts.map