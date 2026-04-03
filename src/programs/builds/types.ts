export interface Build {
    type: string;
    id: string;
    attributes: {
        version: string;
        uploadedDate: string;
        expirationDate: string;
        expired: boolean;
        minOsVersion: string;
        lsMinimumSystemVersion?: string;
        computedMinMacOsVersion?: string;
        iconAssetToken?: string;
        processingState: string;
        buildAudienceType: string;
        usesNonExemptEncryption?: boolean;
    };
    relationships?: {
        app?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
        betaAppReviewSubmission?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
        buildBetaDetail?: {
            links?: {
                self?: string;
                related?: string;
            };
        };
    };
}

export interface BuildsResponse {
    data: Build[];
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

export interface BuildResponse {
    data: Build;
}

export interface BuildBetaDetail {
    type: string;
    id: string;
    attributes: {
        autoNotifyEnabled: boolean;
        internalBuildState: string;
        externalBuildState: string;
    };
}