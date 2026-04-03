import { registerListBetaGroups } from './list-beta-groups.js';
import { registerAddBuildToBetaGroup } from './add-build-to-beta-group.js';
import { registerAddBetaTester } from './add-beta-tester.js';
export function registerTestFlightTools(server) {
    registerListBetaGroups(server);
    registerAddBuildToBetaGroup(server);
    registerAddBetaTester(server);
}
//# sourceMappingURL=index.js.map