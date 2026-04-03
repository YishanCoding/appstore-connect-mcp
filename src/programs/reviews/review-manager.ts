import { AppStoreConnectClient } from '../api-client/index.js';
import { CustomerReviewsResponse, ReviewInfo } from './types.js';

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

        const response = await this.client.get<CustomerReviewsResponse>(
            `/apps/${appId}/customerReviews`,
            params
        );
        return response.data.map((r) => this.mapToInfo(r));
    }

    public async respondToReview(reviewId: string, responseBody: string): Promise<void> {
        const existing = await this.client.get<any>(
            `/customerReviews/${reviewId}/response`
        ).catch(() => null);

        if (existing?.data) {
            await this.client.patch(`/customerReviewResponses/${existing.data.id}`, {
                data: {
                    type: 'customerReviewResponses',
                    id: existing.data.id,
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
        const existing = await this.client.get<any>(
            `/customerReviews/${reviewId}/response`
        ).catch(() => null);
        if (existing?.data) {
            await this.client.delete(`/customerReviewResponses/${existing.data.id}`);
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
