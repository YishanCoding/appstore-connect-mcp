import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListUsers } from './list-users.js';
import { registerInviteUser } from './invite-user.js';

export function registerUserTools(server: McpServer) {
    registerListUsers(server);
    registerInviteUser(server);
}