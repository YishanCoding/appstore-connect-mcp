import { z } from 'zod';
import { AppStoreConnectClient, TestFlightManager } from '../../../programs/index.js';
import { getStoredCredentials } from '../auth/store-credentials.js';
const inputSchema = z.object({
    email: z.string().email().describe('Email address of the beta tester'),
    firstName: z.string().describe('First name of the beta tester'),
    lastName: z.string().describe('Last name of the beta tester'),
    betaGroupIds: z.array(z.string()).describe('Beta group IDs to add the tester to'),
});
export function registerAddBetaTester(server) {
    server.registerTool('appstore_add_beta_tester', {
        description: 'Add a new beta tester to TestFlight beta groups',
        inputSchema,
    }, async ({ email, firstName, lastName, betaGroupIds }) => {
        try {
            const credentials = getStoredCredentials();
            if (!credentials) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'No credentials stored. Use appstore_store_credentials first',
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
            const client = new AppStoreConnectClient({
                keyId: credentials.keyId,
                issuerId: credentials.issuerId,
                privateKey: credentials.privateKey,
            });
            const testFlightManager = new TestFlightManager(client);
            await testFlightManager.addBetaTester(email, firstName, lastName, betaGroupIds);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: 'Beta tester added successfully',
                            tester: { email, firstName, lastName },
                            betaGroupIds,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ error: error.message }, null, 2),
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=add-beta-tester.js.map