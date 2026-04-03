export class UserManager {
    client;
    constructor(client) {
        this.client = client;
    }
    async listUsers(limit = 200) {
        const response = await this.client.get('/users', {
            limit,
        });
        return response.data.map((user) => this.mapUserToInfo(user));
    }
    async inviteUser(email, firstName, lastName, roles, allAppsVisible = false) {
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
    async removeUser(userId) {
        await this.client.delete(`/users/${userId}`);
    }
    async updateUserRoles(userId, roles) {
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
    mapUserToInfo(user) {
        return {
            id: user.id,
            username: user.attributes.username,
            firstName: user.attributes.firstName,
            lastName: user.attributes.lastName,
            roles: user.attributes.roles,
        };
    }
}
//# sourceMappingURL=user-manager.js.map