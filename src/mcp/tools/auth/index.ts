import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStoreCredentials } from './store-credentials.js';
import { registerValidateCredentials } from './validate-credentials.js';

export function registerAuthTools(server: McpServer) {
    registerStoreCredentials(server);
    registerValidateCredentials(server);
}