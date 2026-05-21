export interface CppInfo {
    id: string;
    name: string;
    state: string;
    url: string;
}

export interface CppLocaleInfo {
    id: string;
    locale: string;
    promotionalText: string | null;
}

export interface UploadOperation {
    method: string;
    url: string;
    offset?: number;
    length?: number;
    requestHeaders?: { name: string; value: string }[];
}

export interface ScreenshotReserveResponse {
    data: {
        id: string;
        attributes: {
            uploadOperations: UploadOperation[];
        };
    };
}

export interface CreateCppResult {
    cppId: string;
    localeId: string;
    screenshotSetId: string;
    screenshotsUploaded: number;
    url: string;
}

export interface ListCppsResponse {
    data: {
        id: string;
        attributes: {
            name: string;
            state: string;
        };
    }[];
}
