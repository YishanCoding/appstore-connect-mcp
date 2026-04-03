export interface CustomerReview {
    type: string;
    id: string;
    attributes: {
        rating: number;
        title?: string;
        body?: string;
        reviewerNickname?: string;
        createdDate: string;
        territory: string;
    };
}

export interface CustomerReviewsResponse {
    data: CustomerReview[];
    links?: { self?: string; next?: string };
    meta?: { paging?: { total: number; limit: number } };
}

export interface CustomerReviewResponse {
    type: string;
    id: string;
    attributes: {
        responseBody: string;
        lastModifiedDate: string;
        state: string;
    };
}

export interface ReviewInfo {
    id: string;
    rating: number;
    title?: string;
    body?: string;
    reviewerNickname?: string;
    createdDate: string;
    territory: string;
}
