import { AppStoreConnectClient } from '../api-client/index.js';
import { CustomerReviewsResponse, ReviewInfo } from './types.js';
import { AxiosError } from 'axios';

function isNotFound(e: unknown): boolean {
    return (e instanceof AxiosError && e.response?.status === 404);
}

export class ReviewManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listReviews(
        appId: string,
        options: {
            limit?: number;
            sort?: string;
            filterRating?: number;
            filterTerritory?: string;
        } = {}
    ): Promise<ReviewInfo[]> {
        const params: Record<string, any> = {
            limit: options.limit ?? 100,
            sort: options.sort ?? '-createdDate',
        };
        if (options.filterRating) params['filter[rating]'] = options.filterRating;
        if (options.filterTerritory) params['filter[territory]'] = options.filterTerritory;

        const items = await this.client.followPages<CustomerReviewsResponse>(
            `/apps/${appId}/customerReviews`,
            params,
            options.limit ?? 100
        );
        return items.map((r) => this.mapToInfo(r));
    }

    public async respondToReview(reviewId: string, responseBody: string): Promise<void> {
        let existingResponseId: string | undefined;
        try {
            const existing = await this.client.get<any>(`/customerReviews/${reviewId}/response`);
            existingResponseId = existing?.data?.id;
        } catch (e) {
            if (!isNotFound(e)) throw e;
            // 404 means no response exists yet — proceed to create
        }

        if (existingResponseId) {
            await this.client.patch(`/customerReviewResponses/${existingResponseId}`, {
                data: {
                    type: 'customerReviewResponses',
                    id: existingResponseId,
                    attributes: { responseBody },
                },
            });
        } else {
            await this.client.post('/customerReviewResponses', {
                data: {
                    type: 'customerReviewResponses',
                    attributes: { responseBody },
                    relationships: {
                        review: { data: { type: 'customerReviews', id: reviewId } },
                    },
                },
            });
        }
    }

    public async deleteReviewResponse(reviewId: string): Promise<void> {
        let existingResponseId: string | undefined;
        try {
            const existing = await this.client.get<any>(`/customerReviews/${reviewId}/response`);
            existingResponseId = existing?.data?.id;
        } catch (e) {
            if (!isNotFound(e)) throw e;
        }
        if (existingResponseId) {
            await this.client.delete(`/customerReviewResponses/${existingResponseId}`);
        }
    }

    private mapToInfo(r: any): ReviewInfo {
        return {
            id: r.id,
            rating: r.attributes.rating,
            title: r.attributes.title,
            body: r.attributes.body,
            reviewerNickname: r.attributes.reviewerNickname,
            createdDate: r.attributes.createdDate,
            territory: r.attributes.territory,
        };
    }
}
