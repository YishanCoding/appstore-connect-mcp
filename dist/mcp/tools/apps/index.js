import { registerListApps } from './list-apps.js';
import { registerGetApp } from './get-app.js';
export function registerAppTools(server) {
    registerListApps(server);
    registerGetApp(server);
}
//# sourceMappingURL=index.js.map