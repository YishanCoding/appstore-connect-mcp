import { AppStoreConnectClient } from '../api-client/index.js';
import { UserInfo } from '../../types.js';
export declare class UserManager {
    private client;
    constructor(client: AppStoreConnectClient);
    listUsers(limit?: number): Promise<UserInfo[]>;
    inviteUser(email: string, firstName: string, lastName: string, roles: string[], allAppsVisible?: boolean): Promise<void>;
    removeUser(userId: string): Promise<void>;
    updateUserRoles(userId: string, roles: string[]): Promise<void>;
    private mapUserToInfo;
}
//# sourceMappingURL=user-manager.d.ts.map