import { registerStoreCredentials } from './store-credentials.js';
import { registerValidateCredentials } from './validate-credentials.js';
export function registerAuthTools(server) {
    registerStoreCredentials(server);
    registerValidateCredentials(server);
}
//# sourceMappingURL=index.js.map