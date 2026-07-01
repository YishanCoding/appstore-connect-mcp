export interface InAppPurchaseV2 {
    type: string;
    id: string;
    attributes?: {
        name?: string;
        productId?: string;
        inAppPurchaseType?: string;
        state?: string;
        reviewNote?: string;
        familySharable?: boolean;
        contentHosting?: boolean;
    };
}

export interface InAppPurchasesV2Response {
    data: InAppPurchaseV2[];
    links?: { self?: string; next?: string };
    meta?: { paging?: { total: number; limit: number } };
}

export interface InAppPurchaseV2Response {
    data: InAppPurchaseV2;
}

export interface InAppPurchaseInfo {
    id: string;
    name?: string;
    productId?: string;
    type?: string;
    state?: string;
    familySharable?: boolean;
    contentHosting?: boolean;
}

export interface SubscriptionGroup {
    type: string;
    id: string;
    attributes?: {
        referenceName?: string;
    };
}

export interface SubscriptionGroupsResponse {
    data: SubscriptionGroup[];
    links?: { self?: string; next?: string };
    meta?: { paging?: { total: number; limit: number } };
}

export interface SubscriptionGroupInfo {
    id: string;
    referenceName?: string;
}
