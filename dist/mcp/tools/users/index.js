import { registerListUsers } from './list-users.js';
import { registerInviteUser } from './invite-user.js';
export function registerUserTools(server) {
    registerListUsers(server);
    registerInviteUser(server);
}
//# sourceMappingURL=index.js.map