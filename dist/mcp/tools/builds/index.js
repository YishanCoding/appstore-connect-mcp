import { registerListBuilds } from './list-builds.js';
import { registerGetBuild } from './get-build.js';
import { registerGetLatestBuild } from './get-latest-build.js';
export function registerBuildTools(server) {
    registerListBuilds(server);
    registerGetBuild(server);
    registerGetLatestBuild(server);
}
//# sourceMappingURL=index.js.map