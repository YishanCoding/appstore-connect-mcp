export interface AppStoreCredentials {
    keyId: string;
    issuerId: string;
    privateKey: string;
}
export interface AppInfo {
    id: string;
    bundleId: string;
    name: string;
    sku: string;
    primaryLocale: string;
}
export interface BuildInfo {
    id: string;
    version: string;
    buildNumber: string;
    processingState: string;
    uploadedDate: string;
}
export interface TestFlightInfo {
    id: string;
    name: string;
    isInternalGroup: boolean;
    isActive: boolean;
}
export interface UserInfo {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    roles: string[];
}
//# sourceMappingURL=types.d.ts.map