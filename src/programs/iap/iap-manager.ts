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

    public async listInAppPurchases(
        appId: string,
        limit?: number,
        options?: { all?: boolean }
    ): Promise<InAppPurchaseInfo[]> {
        const path = `/apps/${appId}/inAppPurchasesV2`;
        const cap = options?.all ? limit : (limit ?? 200);
        const pageSize = Math.min(cap ?? 200, 200);
        if (options?.all === false) {
            const response = await this.client.get<InAppPurchasesV2Response>(path, { limit: pageSize });
            return (response.data ?? []).slice(0, cap ?? pageSize).map((item) => this.mapInAppPurchase(item as InAppPurchaseV2));
        }
        const items = await this.client.getAllPages<InAppPurchaseV2>(path, { limit: pageSize }, { limit: cap });
        return items.map((item) => this.mapInAppPurchase(item));
    }

    public async getInAppPurchase(inAppPurchaseId: string): Promise<InAppPurchaseInfo> {
        const v2BaseUrl = this.client.getBaseURL().replace(/\/v1$/, '/v2');
        const response = await this.client.get<InAppPurchaseV2Response>(
            `${v2BaseUrl}/inAppPurchases/${inAppPurchaseId}`
        );
        return this.mapInAppPurchase(response.data);
    }

    public async listSubscriptionGroups(
        appId: string,
        limit?: number,
        options?: { all?: boolean }
    ): Promise<SubscriptionGroupInfo[]> {
        const path = `/apps/${appId}/subscriptionGroups`;
        const cap = options?.all ? limit : (limit ?? 200);
        const pageSize = Math.min(cap ?? 200, 200);
        if (options?.all === false) {
            const response = await this.client.get<SubscriptionGroupsResponse>(path, { limit: pageSize });
            return (response.data ?? []).slice(0, cap ?? pageSize).map((item) => this.mapSubscriptionGroup(item));
        }
        const items = await this.client.getAllPages<SubscriptionGroup>(path, { limit: pageSize }, { limit: cap });
        return items.map((item) => this.mapSubscriptionGroup(item));
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
