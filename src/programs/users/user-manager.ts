import { AppStoreConnectClient } from '../api-client/index.js';
import { User, UsersResponse } from './types.js';
import { UserInfo } from '../../types.js';

export class UserManager {
    constructor(private client: AppStoreConnectClient) {}

    public async listUsers(limit: number = 200): Promise<UserInfo[]> {
        const response = await this.client.get<UsersResponse>('/users', {
            limit,
        });

        return response.data.map((user) => this.mapUserToInfo(user));
    }

    public async inviteUser(
        email: string,
        firstName: string,
        lastName: string,
        roles: string[],
        allAppsVisible: boolean = false
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
                    provisioningAllowed: false,
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