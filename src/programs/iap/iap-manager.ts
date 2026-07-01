import { AppStoreConnectClient } from '../api-client/index.js';
import {
    InAppPurchaseInfo,
    InAppPurchaseV2,
    InAppPurchaseV2Response,
    InAppPurchasesV2Response,
    SubscriptionGroup,
    SubscriptionGroupInfo,
    SubscriptionGroupsResponse,
} from './types.js';

export class IapManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listInAppPurchases(appId: string, limit: number = 200): Promise<InAppPurchaseInfo[]> {
        const items = await this.client.followPages<InAppPurchasesV2Response>(
            `/apps/${appId}/inAppPurchasesV2`,
            { limit },
            limit
        );

        return items.map((item) => this.mapInAppPurchase(item as InAppPurchaseV2));
    }

    public async getInAppPurchase(inAppPurchaseId: string): Promise<InAppPurchaseInfo> {
        const v2BaseUrl = this.client.getBaseURL().replace(/\/v1$/, '/v2');
        const response = await this.client.get<InAppPurchaseV2Response>(
            `${v2BaseUrl}/inAppPurchases/${inAppPurchaseId}`
        );
        return this.mapInAppPurchase(response.data);
    }

    public async listSubscriptionGroups(appId: string, limit: number = 200): Promise<SubscriptionGroupInfo[]> {
        const items = await this.client.followPages<SubscriptionGroupsResponse>(
            `/apps/${appId}/subscriptionGroups`,
            { limit },
            limit
        );

        return items.map((item) => this.mapSubscriptionGroup(item as SubscriptionGroup));
    }

    private mapInAppPurchase(item: InAppPurchaseV2): InAppPurchaseInfo {
        return {
            id: item.id,
            name: item.attributes?.name,
            productId: item.attributes?.productId,
            type: item.attributes?.inAppPurchaseType,
            state: item.attributes?.state,
            familySharable: item.attributes?.familySharable,
            contentHosting: item.attributes?.contentHosting,
        };
    }

    private mapSubscriptionGroup(item: SubscriptionGroup): SubscriptionGroupInfo {
        return {
            id: item.id,
            referenceName: item.attributes?.referenceName,
        };
    }
}
