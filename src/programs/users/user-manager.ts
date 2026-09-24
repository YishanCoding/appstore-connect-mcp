import { AppStoreConnectClient } from '../api-client/index.js';
import { User, UsersResponse } from './types.js';
import { UserInfo } from '../../types.js';

export class UserManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listUsers(limit?: number, options?: { all?: boolean }): Promise<UserInfo[]> {
        const cap = options?.all ? limit : (limit ?? 200);
        const pageSize = Math.min(cap ?? 200, 200);
        if (options?.all) {
            const items = await this.client.getAllPages<User>('/users', { limit: pageSize }, { limit: cap });
            return items.map((user) => this.mapUserToInfo(user));
        }
        const response = await this.client.get<UsersResponse>('/users', { limit: pageSize });
        return response.data.slice(0, cap ?? 200).map((user) => this.mapUserToInfo(user));
    }

    public async inviteUser(
        email: string,
        firstName: string,
        lastName: string,
        roles: string[],
        allAppsVisible: boolean = false,
        provisioningAllowed: boolean = false
    ): Promise<void> {
        const data = {
            data: {
                type: 'userInvitations',
                attributes: {
                    email,
                    firstName,
                    lastName,
                    roles,
                    allAppsVisible,
                    provisioningAllowed,
                },
            },
        };

        await this.client.post('/userInvitations', data);
    }

    public async removeUser(userId: string): Promise<void> {
        await this.client.delete(`/users/${userId}`);
    }

    public async updateUserRoles(userId: string, roles: string[]): Promise<void> {
        const data = {
            data: {
                type: 'users',
                id: userId,
                attributes: {
                    roles,
                },
            },
        };

        await this.client.patch(`/users/${userId}`, data);
    }

    private mapUserToInfo(user: User): UserInfo {
        return {
            id: user.id,
            username: user.attributes.username,
            firstName: user.attributes.firstName,
            lastName: user.attributes.lastName,
            roles: user.attributes.roles,
        };
    }
}