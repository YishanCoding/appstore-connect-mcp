import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { AppStoreConnectClient } from '../programs/api-client/client.js';
import { AscHttpError, errorFromResponse, sendWithPolicy, type HttpCall, type HttpResult } from '../programs/api-client/policy.js';
import { ReviewManager } from '../programs/reviews/review-manager.js';
import { assertReadableFiles, uploadScreenshot } from '../mcp/tools/versions/screenshots.js';
import { projectFields } from './output.js';
import { runCli } from './run.js';
import { decideSafety } from './safety.js';
import { appleTransport } from './test-support/apple-spec-mock.js';

const env = {
    APP_STORE_CONNECT_KEY_ID: 'TESTKEYID',
    APP_STORE_CONNECT_ISSUER_ID: 'TESTISSUERID',
    APP_STORE_CONNECT_PRIVATE_KEY: 'local-test-material',
};

function json(text: string) {
    return JSON.parse(text);
}

describe('ascli', () => {
    test('tools --json lists every MCP tool and marks store-credentials stateless', async () => {
        const result = await runCli(['tools', '--json']);
        expect(result.code).toBe(0);
        const items = json(result.stdout) as {
            command: string | null;
            aliases: string[];
            mcp_tool: string;
            kind: string;
            risk: string;
            params: unknown;
            description: string;
            reason?: string;
        }[];
        expect(items.filter((item) => item.mcp_tool).length).toBe(64);
        for (const item of items) {
            expect(item.kind === 'read' || item.kind === 'write').toBe(true);
            expect(item.risk === 'normal' || item.risk === 'high').toBe(true);
            expect(item.params).toBeTruthy();
            expect(typeof item.description).toBe('string');
            expect(Array.isArray(item.aliases)).toBe(true);
            if (item.command === null) expect(item.reason ?? '').toContain('stateless');
        }
        const stored = items.find((item) => item.mcp_tool === 'appstore_store_credentials');
        expect(stored?.command).toBeNull();
    });

    test('inline JSON and @file produce the same dry-run body', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ascli-body-'));
        const file = join(dir, 'body.json');
        const payload = { whatsNew: 'from-file', keywords: 'a,b' };
        writeFileSync(file, JSON.stringify(payload));
        const inline = await runCli(['version', 'update-localization', 'loc-1', '--body', JSON.stringify(payload)]);
        const fromFile = await runCli(['version', 'update-localization', 'loc-1', '--body', `@${file}`]);
        expect(inline.code).toBe(0);
        expect(fromFile.code).toBe(0);
        const inlineBody = json(inline.stdout);
        const fileBody = json(fromFile.stdout);
        expect(inlineBody.dry_run).toBe(true);
        expect(fileBody.dry_run).toBe(true);
        expect(inlineBody.method).toBe('PATCH');
        expect(fileBody.path).toBe('/appStoreVersionLocalizations/loc-1');
        expect(inlineBody.body.data.attributes).toEqual(payload);
        expect(fileBody.body.data.attributes).toEqual(payload);
        expect(JSON.stringify(inlineBody.body)).toBe(JSON.stringify(fileBody.body));
        expect(inline.calls).toEqual([]);
        expect(fromFile.calls).toEqual([]);
    });

    test('--fields keeps only the requested paths', async () => {
        const calls: HttpCall[] = [];
        const transport = {
            async send(call: HttpCall): Promise<HttpResult> {
                calls.push(call);
                return {
                    status: 200,
                    headers: {},
                    data: {
                        data: [{ id: '1', type: 'apps', attributes: { name: 'Demo', bundleId: 'demo.app' } }],
                    },
                };
            },
        };
        const direct = projectFields(
            [{ id: '1', attributes: { name: 'Demo', bundleId: 'demo.app' }, extra: true }],
            ['id', 'attributes.name']
        );
        expect(direct).toEqual([{ id: '1', attributes: { name: 'Demo' } }]);

        const result = await runCli(['app', 'list', '--fields', 'id,attributes.name', '--limit', '5'], { env, transport });
        expect(result.code).toBe(0);
        expect(json(result.stdout)).toEqual([{ id: '1', attributes: { name: 'Demo' } }]);
        expect(calls.length).toBe(1);
        expect(calls[0]?.method).toBe('GET');
    });

    test('dry-run write does not call the transport', async () => {
        const calls: HttpCall[] = [];
        const result = await runCli(['review', 'reply', 'rev-1', '--response-body', 'hello', '--verbose'], {
            env,
            transport: {
                async send(call) {
                    calls.push(call);
                    return { status: 200, headers: {}, data: {} };
                },
            },
        });
        expect(result.code).toBe(0);
        expect(calls.map((call) => call.method)).toEqual(['GET']);
        expect(calls.some((call) => call.method !== 'GET')).toBe(false);
        const body = json(result.stdout);
        expect(body.dry_run).toBe(true);
        expect(body.method).toBe('POST');
        expect(body.path).toBe('/customerReviewResponses');
        expect(body.body.data.attributes.responseBody).toBe('hello');
        expect(body.body.data.attributes.reviewId).toBeUndefined();
        expect(body.body.data.relationships.review.data.id).toBe('rev-1');
        expect(result.stderr).toContain('network writes=0');
        expect(result.stderr).not.toContain('Bearer');
        expect(result.stdout).not.toContain('local-test-material');
    });

    test('--confirm mismatch and missing --confirm send nothing', async () => {
        const calls: HttpCall[] = [];
        const transport = {
            async send(call: HttpCall): Promise<HttpResult> {
                calls.push(call);
                return { status: 200, headers: {}, data: {} };
            },
        };
        const mismatch = await runCli(
            ['review', 'reply', 'rev-1', '--response-body', 'hello', '--yes', '--confirm', 'app-a', '--app', 'app-b'],
            { env, transport }
        );
        expect(mismatch.code).toBe(2);
        expect(json(mismatch.stderr).error.type).toBe('usage');
        expect(json(mismatch.stderr).error.message).toContain('rev-1');
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        expect(calls.some((call) => call.method === 'POST')).toBe(false);

        const beforeMissing = calls.length;
        const missing = await runCli(['review', 'reply', 'rev-1', '--response-body', 'hello', '--yes', '--app', 'app-a'], {
            env,
            transport,
        });
        expect(missing.code).toBe(2);
        expect(json(missing.stderr).error.type).toBe('usage');
        expect(calls.length).toBe(beforeMissing);

        const noApp = await runCli(['review', 'reply', 'rev-1', '--response-body', 'hello', '--yes', '--confirm', 'app-a'], {
            env,
            transport,
        });
        expect(noApp.code).toBe(2);
        expect(json(noApp.stderr).error.message).toContain('rev-1');
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        expect(decideSafety({ kind: 'write', risk: 'high', yes: true }).action).toBe('reject');
        expect(decideSafety({ kind: 'write', risk: 'high', yes: true, confirm: 'app-a' }).action).toBe('run');
    });

    test('missing credentials exit 4 and name the variable', async () => {
        const result = await runCli(['app', 'list'], { env: {} });
        expect(result.code).toBe(4);
        const error = json(result.stderr).error;
        expect(error.type).toBe('auth');
        expect(error.message).toContain('缺 APP_STORE_CONNECT_KEY_ID');
    });

    test('unknown command is a usage error', async () => {
        const result = await runCli(['no-such-resource']);
        expect(result.code).toBe(2);
        expect(json(result.stderr).error.type).toBe('usage');
    });
});

describe('http policy', () => {
    test('GET retries 429 at most 3 times and stops when Retry-After succeeds', async () => {
        let calls = 0;
        const sleeps: number[] = [];
        const client = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                sleep: async (ms) => {
                    sleeps.push(ms);
                },
                transport: {
                    async send() {
                        calls += 1;
                        if (calls < 3) {
                            return { status: 429, headers: { 'retry-after': '12' }, data: { errors: [{ code: 'RATE_LIMIT', title: 'Slow down' }] } };
                        }
                        return { status: 200, headers: {}, data: { ok: true } };
                    },
                },
            }
        );
        const data = await client.get<{ ok: boolean }>('/apps');
        expect(data.ok).toBe(true);
        expect(calls).toBe(3);
        expect(sleeps).toEqual([12000, 12000]);

        let failed = 0;
        const failing = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                sleep: async () => undefined,
                transport: {
                    async send() {
                        failed += 1;
                        return { status: 503, headers: {}, data: {} };
                    },
                },
            }
        );
        await expect(failing.get('/apps')).rejects.toBeInstanceOf(AscHttpError);
        expect(failed).toBe(4);
    });

    test('writes are not retried', async () => {
        let calls = 0;
        const client = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                sleep: async () => undefined,
                transport: {
                    async send() {
                        calls += 1;
                        return { status: 500, headers: { 'retry-after': '1' }, data: { errors: [{ code: 'SERVER', title: 'down' }] } };
                    },
                },
            }
        );
        await expect(client.post('/customerReviewResponses', { data: {} })).rejects.toBeInstanceOf(AscHttpError);
        expect(calls).toBe(1);

        let policyCalls = 0;
        await expect(
            sendWithPolicy(
                async () => {
                    policyCalls += 1;
                    return { status: 429, headers: { 'retry-after': '1' }, data: {} };
                },
                { method: 'PATCH', url: '/apps/1' },
                { sleep: async () => undefined }
            )
        ).rejects.toBeInstanceOf(AscHttpError);
        expect(policyCalls).toBe(1);
    });

    test('getAllPages merges links.next and honors limit', async () => {
        let calls = 0;
        const client = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                transport: {
                    async send(call) {
                        calls += 1;
                        if (call.url === '/reviews') {
                            return {
                                status: 200,
                                headers: {},
                                data: { data: [{ id: 'a' }, { id: 'b' }], links: { next: 'https://api.appstoreconnect.apple.com/v1/reviews?page=2' } },
                            };
                        }
                        return { status: 200, headers: {}, data: { data: [{ id: 'c' }] } };
                    },
                },
            }
        );
        const merged = await client.getAllPages<{ id: string }>('/reviews', {}, { limit: 10 });
        expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
        expect(calls).toBe(2);

        let limited = 0;
        const capped = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                transport: {
                    async send() {
                        limited += 1;
                        return {
                            status: 200,
                            headers: {},
                            data: { data: [{ id: 'only' }], links: { next: 'https://api.appstoreconnect.apple.com/v1/more' } },
                        };
                    },
                },
            }
        );
        const page = await capped.getAllPages<{ id: string }>('/reviews', {}, { limit: 1 });
        expect(page).toEqual([{ id: 'only' }]);
        expect(limited).toBe(1);
    });
});

describe('review response 404', () => {
    function clientFor(handler: (call: HttpCall) => HttpResult) {
        return new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            { transport: { send: async (call) => handler(call) } }
        );
    }

    test('404 on the existing response still creates, and delete is a no-op', async () => {
        const calls: HttpCall[] = [];
        const client = clientFor((call) => {
            calls.push(call);
            if (call.method === 'GET') {
                return { status: 404, headers: {}, data: { errors: [{ status: '404', code: 'NOT_FOUND', title: 'The specified resource does not exist' }] } };
            }
            return { status: 201, headers: {}, data: { data: { id: 'created' } } };
        });
        const reviews = new ReviewManager(client);
        await reviews.respondToReview('rev-1', 'thanks');
        expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
        expect(calls[1]?.url).toBe('/customerReviewResponses');

        calls.length = 0;
        await reviews.deleteReviewResponse('rev-1');
        expect(calls.map((call) => call.method)).toEqual(['GET']);
    });

    test('a non-404 on the existing response is not turned into a create', async () => {
        const calls: HttpCall[] = [];
        const client = clientFor((call) => {
            calls.push(call);
            return { status: 500, headers: {}, data: { errors: [{ status: '500', code: 'SERVER', title: 'down' }] } };
        });
        await expect(new ReviewManager(client).respondToReview('rev-1', 'thanks')).rejects.toBeInstanceOf(AscHttpError);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        expect(calls.length).toBe(4);
    });
});

describe('--all ignores schema default limits', () => {
    function paged(count: number) {
        const calls: HttpCall[] = [];
        let page = 0;
        const transport = {
            calls,
            async send(call: HttpCall): Promise<HttpResult> {
                calls.push(call);
                page += 1;
                if (page === 1) {
                    return {
                        status: 200,
                        headers: {},
                        data: {
                            data: Array.from({ length: count }, (_, index) => ({
                                id: `p1-${index}`,
                                attributes: {
                                    version: '1',
                                    processingState: 'VALID',
                                    uploadedDate: '2026-01-01',
                                    expirationDate: '2026-02-01',
                                    expired: false,
                                    minOsVersion: '15',
                                    username: 'u',
                                    firstName: 'A',
                                    lastName: 'B',
                                    roles: [],
                                    email: 'a@example.com',
                                    inviteType: 'EMAIL',
                                    state: 'ACTIVE',
                                },
                            })),
                            links: { next: 'https://api.appstoreconnect.apple.com/v1/next' },
                        },
                    };
                }
                return {
                    status: 200,
                    headers: {},
                    data: {
                        data: [{
                            id: 'extra',
                            attributes: {
                                version: '1',
                                processingState: 'VALID',
                                uploadedDate: '2026-01-01',
                                expirationDate: '2026-02-01',
                                expired: false,
                                minOsVersion: '15',
                                username: 'u',
                                firstName: 'A',
                                lastName: 'B',
                                roles: [],
                                email: 'a@example.com',
                                inviteType: 'EMAIL',
                                state: 'ACTIVE',
                            },
                        }],
                    },
                };
            },
        };
        return transport;
    }

    test('build, user, tester, iap, and subscription lists follow the next page', async () => {
        const cases: { args: string[]; firstPage: number }[] = [
            { args: ['build', 'list', '--app', 'app-1', '--all'], firstPage: 100 },
            { args: ['user', 'list', '--all'], firstPage: 200 },
            { args: ['beta-tester', 'list', '--beta-group-id', 'grp-1', '--all'], firstPage: 200 },
            { args: ['in-app-purchase', 'list', '--app', 'app-1', '--all'], firstPage: 200 },
            { args: ['subscription-group', 'list', '--app', 'app-1', '--all'], firstPage: 200 },
        ];
        for (const item of cases) {
            const transport = paged(item.firstPage);
            const result = await runCli(item.args, { env, transport });
            expect(result.code).toBe(0);
            const rows = json(result.stdout) as { id: string }[];
            expect(rows.length).toBe(item.firstPage + 1);
            expect(transport.calls.length).toBe(2);
            expect(rows[rows.length - 1]?.id).toBe('extra');
        }
    });
});

describe('screenshot commit', () => {
    test('the commit PATCH is sent once', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ascli-shot-'));
        const file = join(dir, 'shot.png');
        writeFileSync(file, 'png');
        const calls: HttpCall[] = [];
        const client = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                transport: {
                    async send(call) {
                        calls.push(call);
                        if (call.method === 'POST') {
                            return { status: 201, headers: {}, data: { data: { id: 'shot-1', attributes: { uploadOperations: [] } } } };
                        }
                        return { status: 500, headers: {}, data: { errors: [{ status: '500', code: 'SERVER', title: 'commit failed' }] } };
                    },
                },
            }
        );
        await expect(uploadScreenshot(client, 'set-1', file)).rejects.toBeInstanceOf(AscHttpError);
        expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    });

    test('cpp create sends the commit PATCH once', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ascli-cpp-'));
        const hero = join(dir, 'hero.png');
        const extra = join(dir, 'extra.png');
        writeFileSync(hero, 'hero');
        writeFileSync(extra, 'extra');
        const calls: HttpCall[] = [];
        const result = await runCli(
            [
                'cpp', 'create',
                '--app', 'app-1',
                '--name', 'Hero',
                '--promotional-text', 'hello',
                '--cpp-image-path', hero,
                '--template-shot-paths', JSON.stringify([extra]),
                '--yes',
            ],
            {
                env,
                transport: {
                    async send(call) {
                        calls.push(call);
                        if (call.method === 'PATCH') {
                            return { status: 500, headers: {}, data: { errors: [{ status: '500', code: 'SERVER', title: 'commit failed' }] } };
                        }
                        if (String(call.url).includes('appCustomProductPages')) {
                            return {
                                status: 201,
                                headers: {},
                                data: {
                                    data: { id: 'cpp-1' },
                                    included: [{ type: 'appCustomProductPageLocalizations', id: 'loc-1' }],
                                },
                            };
                        }
                        if (String(call.url).includes('appScreenshotSets')) {
                            return { status: 201, headers: {}, data: { data: { id: 'set-1' } } };
                        }
                        return {
                            status: 201,
                            headers: {},
                            data: { data: { id: 'shot-1', attributes: { uploadOperations: [] } } },
                        };
                    },
                },
            }
        );
        expect(result.code).toBe(3);
        expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
        expect(json(result.stderr).error.type).toBe('api');
    });
});

function reviewRow(id: string) {
    return {
        id,
        attributes: {
            rating: 5,
            title: 't',
            body: 'b',
            reviewerNickname: 'n',
            createdDate: '2026-01-01',
            territory: 'USA',
        },
    };
}

describe('round 2 write safety', () => {
    test('F-01 confirm follows the resource app, not the --app string', async () => {
        const calls: HttpCall[] = [];
        const transport = {
            async send(call: HttpCall): Promise<HttpResult> {
                calls.push(call);
                if (call.method === 'GET') {
                    return {
                        status: 200,
                        headers: {},
                        data: { data: { id: 'V_OF_APP_B', relationships: { app: { data: { id: 'APP_B' } } } } },
                    };
                }
                return { status: 201, headers: {}, data: { data: { id: 'rel-1' } } };
            },
        };
        const dry = await runCli(['version', 'release', 'V_OF_APP_B']);
        expect(dry.code).toBe(0);
        expect(dry.calls).toEqual([]);

        const wrong = await runCli(
            ['version', 'release', 'V_OF_APP_B', '--yes', '--app', 'APP_A', '--confirm', 'APP_A'],
            { env, transport }
        );
        expect(wrong.code).toBe(2);
        expect(calls.map((call) => call.method)).toEqual(['GET']);
        expect(calls[0]?.url).toBe('/appStoreVersions/V_OF_APP_B');
        expect(calls[0]?.params).toEqual({ include: 'app' });

        calls.length = 0;
        const ok = await runCli(['version', 'release', 'V_OF_APP_B', '--yes', '--confirm', 'APP_B'], { env, transport });
        expect(ok.code).toBe(0);
        const post = calls.find((call) => call.method === 'POST');
        expect(post?.url).toBe('/appStoreVersionReleaseRequests');
        expect(JSON.stringify(post?.data)).toBe(JSON.stringify(json(dry.stdout).body));
    });

    test('F-01 user confirm must equal the user id or email', async () => {
        const calls: HttpCall[] = [];
        const transport = {
            async send(call: HttpCall): Promise<HttpResult> {
                calls.push(call);
                if (call.method === 'GET') {
                    return { status: 200, headers: {}, data: { data: { id: 'U1', attributes: { username: 'real@example.com' } } } };
                }
                return { status: 204, headers: {}, data: {} };
            },
        };
        const wrong = await runCli(['user', 'remove', 'U1', '--yes', '--app', 'ANY', '--confirm', 'ANY'], { env, transport });
        expect(wrong.code).toBe(2);
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

        calls.length = 0;
        const byId = await runCli(['user', 'remove', 'U1', '--yes', '--confirm', 'U1'], { env, transport });
        expect(byId.code).toBe(0);
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['DELETE /users/U1']);

        calls.length = 0;
        const invite = await runCli(
            ['user', 'invite', '--email', 'ada@example.com', '--first-name', 'Ada', '--last-name', 'Lovelace', '--roles', '["MARKETING"]', '--yes', '--confirm', 'ada@example.com'],
            { env, transport }
        );
        expect(invite.code).toBe(0);
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('/userInvitations');
        expect((calls[0]?.data as { data: { attributes: { email: string } } }).data.attributes.email).toBe('ada@example.com');

        const badInvite = await runCli(
            ['user', 'invite', '--email', 'ada@example.com', '--first-name', 'Ada', '--last-name', 'Lovelace', '--roles', '["MARKETING"]', '--yes', '--confirm', 'other@example.com'],
            { env, transport }
        );
        expect(badInvite.code).toBe(2);
        expect(badInvite.calls).toEqual([]);
    });

    test('F-02 dry-run body matches the request --yes sends, and a data envelope is rejected', async () => {
        const envelope = await runCli([
            'version', 'update-localization', 'L1',
            '--body', JSON.stringify({ data: { type: 'appStoreVersionLocalizations', id: 'L9', attributes: { whatsNew: 'ENVELOPE' } } }),
        ]);
        expect(envelope.code).toBe(2);
        expect(json(envelope.stderr).error.message).toContain('字段');
        expect(envelope.calls).toEqual([]);

        const payload = { whatsNew: 'ENVELOPE' };
        const dry = await runCli(['version', 'update-localization', 'L1', '--body', JSON.stringify(payload)]);
        const calls: HttpCall[] = [];
        const live = await runCli(['version', 'update-localization', 'L1', '--body', JSON.stringify(payload), '--yes'], {
            env,
            transport: {
                async send(call) {
                    calls.push(call);
                    return { status: 200, headers: {}, data: { data: { id: 'L1', attributes: { locale: 'en-US', ...payload } } } };
                },
            },
        });
        expect(dry.code).toBe(0);
        expect(live.code).toBe(0);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('PATCH');
        expect(calls[0]?.url).toBe('/appStoreVersionLocalizations/L1');
        expect(JSON.stringify(calls[0]?.data)).toBe(JSON.stringify(json(dry.stdout).body));
        expect((calls[0]?.data as { data: { id: string; attributes: { whatsNew: string } } }).data.id).toBe('L1');
        expect((calls[0]?.data as { data: { attributes: { whatsNew: string } } }).data.attributes.whatsNew).toBe('ENVELOPE');
    });

    test('F-02 review delete-response dry-run uses the response id the GET returns', async () => {
        const calls: HttpCall[] = [];
        const transport = {
            async send(call: HttpCall): Promise<HttpResult> {
                calls.push(call);
                if (call.method === 'GET') {
                    return { status: 200, headers: {}, data: { data: { id: 'resp-9' } } };
                }
                return { status: 204, headers: {}, data: {} };
            },
        };
        const dry = await runCli(['review', 'delete-response', 'rev-1'], { env, transport });
        expect(dry.code).toBe(0);
        expect(calls.map((call) => call.method)).toEqual(['GET']);
        const plan = json(dry.stdout);
        const deletion = plan.steps.find((step: { method: string }) => step.method === 'DELETE');
        expect(deletion.path).toBe('/customerReviewResponses/resp-9');

        calls.length = 0;
        const live = await runCli(['review', 'delete-response', 'rev-1', '--yes', '--app', 'APP', '--confirm', 'APP'], {
            env,
            transport: appleTransport({ reviews: { 'rev-1': { response: 'resp-9', app: 'APP' } } }, calls),
        });
        expect(live.code).toBe(0);
        const sent = calls.find((call) => call.method === 'DELETE');
        expect(sent?.url).toBe(deletion.path);
        expect(sent?.data ?? null).toBe(deletion.body ?? null);
    });

    test('F-03 screenshot upload checks files before deleting and treats replace as high risk', async () => {
        const missing = await runCli([
            'screenshot', 'upload',
            '--app-store-version-localization-id', 'LOC',
            '--screenshot-display-type', 'APP_IPHONE_67',
            '--image-paths', '["/nonexistent.png"]',
            '--yes', '--confirm', 'APP',
        ], { env, transport: { async send() { throw new Error('should not send'); } } });
        expect(missing.code).toBe(2);
        expect(missing.calls).toEqual([]);
        expect(json(missing.stderr).error.message).toContain('不存在');

        const dir = mkdtempSync(join(tmpdir(), 'ascli-safe-shot-'));
        const file = join(dir, 'shot.png');
        writeFileSync(file, 'png-bytes');
        const calls: HttpCall[] = [];
        const transport = appleTransport({
            versions: { V1: { app: 'APP' } },
            versionLocalizations: { LOC: { version: 'V1' } },
            screenshotSets: { 'set-old': { versionLocalization: 'LOC', screenshots: ['shot1'] } },
        }, calls);
        const dry = await runCli([
            'screenshot', 'upload',
            '--app-store-version-localization-id', 'LOC',
            '--screenshot-display-type', 'APP_IPHONE_67',
            '--image-paths', JSON.stringify([file]),
        ], { env, transport });
        expect(dry.code).toBe(0);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        const drySteps = json(dry.stdout).steps as { method: string; path: string }[];
        expect(drySteps.map((step) => `${step.method} ${step.path}`)).toContain('DELETE /appScreenshots/shot1');
        expect(drySteps.map((step) => `${step.method} ${step.path}`)).toContain('DELETE /appScreenshotSets/set-old');

        calls.length = 0;
        const noConfirm = await runCli([
            'screenshot', 'upload',
            '--app-store-version-localization-id', 'LOC',
            '--screenshot-display-type', 'APP_IPHONE_67',
            '--image-paths', JSON.stringify([file]),
            '--yes',
        ], { env, transport });
        expect(noConfirm.code).toBe(2);
        expect(calls).toEqual([]);

        const live = await runCli([
            'screenshot', 'upload',
            '--app-store-version-localization-id', 'LOC',
            '--screenshot-display-type', 'APP_IPHONE_67',
            '--image-paths', JSON.stringify([file]),
            '--yes', '--confirm', 'APP',
        ], { env, transport });
        expect(live.code === 0 || live.code === 3).toBe(true);
        expect(calls.slice(0, 2).map((call) => `${call.method} ${call.url} ${JSON.stringify(call.params)}`)).toEqual([
            'GET /appStoreVersionLocalizations/LOC {"include":"appStoreVersion"}',
            'GET /appStoreVersions/V1 {"include":"app"}',
        ]);
        const methods = calls.map((call) => call.method);
        expect(methods.indexOf('DELETE')).toBeGreaterThan(methods.indexOf('GET'));
        const setPost = calls.find((call) => call.method === 'POST' && call.url === '/appScreenshotSets');
        const drySet = drySteps.find((step) => step.method === 'POST' && step.path === '/appScreenshotSets') as unknown as { body: unknown };
        expect(JSON.stringify(setPost?.data)).toBe(JSON.stringify(drySet.body));
        expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
            '/appScreenshots/shot1',
            '/appScreenshotSets/set-old',
        ]);
    });

    test('F-04 conflicting sources and unknown flags exit 2', async () => {
        const conflict = await runCli([
            'version', 'create',
            '--app-id', 'A',
            '--version-string', '1.2.3',
            '--body', JSON.stringify({ appId: 'B' }),
        ]);
        expect(conflict.code).toBe(2);
        expect(json(conflict.stderr).error.message).toContain('不一致');

        const positional = await runCli([
            'version', 'update-localization', 'L1',
            '--localization-id', 'L9',
            '--body', JSON.stringify({ whatsNew: 'x' }),
        ]);
        expect(positional.code).toBe(2);

        const typo = await runCli(['review', 'list', '--app', 'APP', '--filter-ratng', '1']);
        expect(typo.code).toBe(2);
        expect(json(typo.stderr).error.message).toContain('filter-ratng');
        expect(typo.calls).toEqual([]);

        const yesEquals = await runCli(['review', 'reply', 'rev-1', '--response-body', 'hello', '--yes=true']);
        expect(yesEquals.code).toBe(2);
        expect(json(yesEquals.stderr).error.message).toContain('--yes=true');
        expect(yesEquals.calls).toEqual([]);
    });

    test('F-05 Retry-After above 60s fails immediately and axios times out at 60s', async () => {
        const sleeps: number[] = [];
        await expect(sendWithPolicy(
            async () => ({ status: 429, headers: { 'retry-after': '86400' }, data: { errors: [{ title: 'Slow', detail: 'down' }] } }),
            { method: 'GET', url: '/apps' },
            { sleep: async (ms) => { sleeps.push(ms); } }
        )).rejects.toBeInstanceOf(AscHttpError);
        expect(sleeps).toEqual([]);

        const client = new AppStoreConnectClient({ keyId: 'k', issuerId: 'i', privateKey: 'p' });
        expect(client.getClient().defaults.timeout).toBe(60000);
    });

    test('F-06 joins every API error with a comma', () => {
        const error = errorFromResponse({
            status: 400,
            headers: {},
            data: {
                errors: [
                    { title: 'First', detail: 'one' },
                    { title: 'Second', detail: 'two' },
                ],
            },
        });
        expect(error.message).toBe('First: one, Second: two');
    });

    test('auth check maps 401 to exit 4', async () => {
        const result = await runCli(['auth', 'check'], {
            env,
            transport: {
                async send() {
                    return { status: 401, headers: {}, data: { errors: [{ status: '401', code: 'UNAUTHORIZED', title: 'Unauthorized', detail: 'bad key' }] } };
                },
            },
        });
        expect(result.code).toBe(4);
        expect(json(result.stderr).error.type).toBe('auth');
    });

    test('limit above 200 follows the next page without --all', async () => {
        let page = 0;
        const result = await runCli(['review', 'list', '--app', 'APP', '--limit', '300'], {
            env,
            transport: {
                async send() {
                    page += 1;
                    if (page === 1) {
                        return {
                            status: 200,
                            headers: {},
                            data: {
                                data: Array.from({ length: 200 }, (_, index) => reviewRow(`r-${index}`)),
                                links: { next: 'https://api.appstoreconnect.apple.com/v1/reviews?page=2' },
                            },
                        };
                    }
                    return { status: 200, headers: {}, data: { data: [reviewRow('r-last')] } };
                },
            },
        });
        expect(result.code).toBe(0);
        expect(json(result.stdout)).toHaveLength(201);
        expect(page).toBe(2);
    });

    test('--all is honored for event localizations, beta localizations, and screenshot sets', async () => {
        const cases = [
            ['event-localization', 'list', '--event-id', 'E1', '--all'],
            ['beta-localization', 'list', '--app', 'APP', '--all'],
            ['screenshot-set', 'list', '--app-store-version-localization-id', 'LOC', '--all'],
        ];
        for (const args of cases) {
            let page = 0;
            const result = await runCli(args, {
                env,
                transport: {
                    async send() {
                        page += 1;
                        if (page === 1) {
                            return {
                                status: 200,
                                headers: {},
                                data: {
                                    data: [{ id: 'first', attributes: { locale: 'en-US', name: 'n', shortDescription: 's', longDescription: 'l' } }],
                                    links: { next: 'https://api.appstoreconnect.apple.com/v1/next' },
                                },
                            };
                        }
                        return {
                            status: 200,
                            headers: {},
                            data: { data: [{ id: 'second', attributes: { locale: 'zh-Hans', name: 'n', shortDescription: 's', longDescription: 'l' } }] },
                        };
                    },
                },
            });
            expect(result.code).toBe(0);
            expect(json(result.stdout)).toHaveLength(2);
            expect(page).toBe(2);
        }
    });

    test('batch update reports the item that already succeeded', async () => {
        let n = 0;
        const result = await runCli([
            'version-localization', 'batch-update',
            '--updates', JSON.stringify([
                { localizationId: 'L1', whatsNew: 'a' },
                { localizationId: 'L2', whatsNew: 'b' },
            ]),
            '--yes',
        ], {
            env,
            transport: {
                async send() {
                    n += 1;
                    if (n === 1) return { status: 200, headers: {}, data: { data: { id: 'L1', attributes: { locale: 'en-US' } } } };
                    return { status: 500, headers: {}, data: { errors: [{ status: '500', code: 'SERVER', title: 'down', detail: 'nope' }] } };
                },
            },
        });
        expect(result.code).toBe(3);
        const body = json(result.stdout);
        expect(body.succeeded).toBe(1);
        expect(body.failed).toBe(1);
        expect(body.results[0].success).toBe(true);
        expect(body.results[0].id).toBe('L1');
        expect(body.results[1].success).toBe(false);
        expect(n).toBe(2);
    });
});

describe('round 3 ownership binding follows Apple relationship chains', () => {
    const world = () => ({
        apps: { APP: { events: ['E1'] }, OTHER: { events: ['E9'] }, EMPTY: { events: [] } },
        versions: {
            V1: { app: 'APP', phasedRelease: 'PR1' },
            V2: { app: 'OTHER', phasedRelease: 'PR2' },
            V3: { app: 'APP' },
        },
        versionLocalizations: { LOC: { version: 'V1' }, LOC_OTHER: { version: 'V2' } },
        screenshotSets: {
            SET_V: { versionLocalization: 'LOC', screenshots: ['S1'] },
            SET_C: { cppLocalization: 'CLOC', screenshots: ['S2'] },
            SET_X: { screenshots: [] },
        },
        cppLocalizations: { CLOC: { cppVersion: 'CV1' } },
        cppVersions: { CV1: { cpp: 'CPP1' } },
        cpps: { CPP1: { app: 'APP' }, CPP2: { app: 'OTHER' } },
        reviews: { R1: { response: 'RESP1', app: 'APP' }, R2: { app: 'APP' }, R_OTHER: { app: 'OTHER' } },
        users: { U1: { username: 'Real@Example.com', email: 'Real@Example.com' } },
    });
    const run = async (argv: string[]) => {
        const calls: HttpCall[] = [];
        const result = await runCli(argv, { env, transport: appleTransport(world(), calls), sleep: async () => {} });
        return { ...result, calls, writes: calls.filter((call) => call.method !== 'GET') };
    };
    const firstGets = (calls: HttpCall[]) =>
        calls.filter((call) => call.method === 'GET').map((call) => `${call.url} ${JSON.stringify(call.params ?? {})}`);

    test('the mock enforces Apple spec: invalid include 400, missing path 404, no GET on phased releases', async () => {
        const t = appleTransport(world());
        const get = (url: string, params?: Record<string, unknown>) => t.send({ method: 'GET', url, params });
        expect((await get('/customerReviews/R1', { include: 'app' })).status).toBe(400);
        expect((await get('/appStoreVersionLocalizations/LOC', { include: 'app' })).status).toBe(400);
        expect((await get('/appScreenshotSets/SET_V', { include: 'app' })).status).toBe(400);
        expect((await get('/appEvents/E1', { include: 'app' })).status).toBe(400);
        expect((await get('/apps/APP/customerReviews', { 'filter[id]': 'R1' })).status).toBe(400);
        expect((await get('/appStoreReviewRequests/RR1')).status).toBe(404);
        expect((await get('/appStoreVersionPhasedReleases/PR1')).status).toBe(405);
        expect((await get('/appStoreVersions/V1', { include: 'app,appStoreVersionPhasedRelease' })).status).toBe(200);
    });

    test('version-scoped commands bind through appStoreVersions?include=app', async () => {
        for (const argv of [['version', 'release', 'V1'], ['version', 'submit', 'V1'], ['phased-release', 'create', 'V1']]) {
            const wrong = await run([...argv, '--yes', '--confirm', 'OTHER']);
            expect(wrong.code).toBe(2);
            expect(wrong.writes).toEqual([]);
            expect(firstGets(wrong.calls)).toEqual(['/appStoreVersions/V1 {"include":"app"}']);
            const ok = await run([...argv, '--yes', '--confirm', 'APP']);
            expect(ok.writes.length).toBe(1);
        }
    });

    test('phased-release update/delete need --version-id and the phased release must belong to it', async () => {
        for (const argv of [['phased-release', 'update', 'PR1', '--phased-release-state', 'PAUSED'], ['phased-release', 'delete', 'PR1']]) {
            const dry = await run(argv);
            expect(dry.code).toBe(0);
            expect(json(dry.stdout).confirm_reads[0].path).toBe('/appStoreVersions/{--version-id}');

            const noVersion = await run([...argv, '--yes', '--confirm', 'APP']);
            expect(noVersion.code).toBe(2);
            expect(json(noVersion.stderr).error.message).toContain('--version-id');
            expect(noVersion.calls).toEqual([]);

            const otherVersion = await run([...argv, '--version-id', 'V3', '--yes', '--confirm', 'APP']);
            expect(otherVersion.code).toBe(2);
            expect(otherVersion.writes).toEqual([]);

            const otherApp = await run([...argv, '--version-id', 'V2', '--yes', '--confirm', 'APP']);
            expect(otherApp.code).toBe(2);
            expect(otherApp.writes).toEqual([]);

            const ok = await run([...argv, '--version-id', 'V1', '--yes', '--confirm', 'APP']);
            expect(ok.code).toBe(0);
            expect(firstGets(ok.calls)).toEqual(['/appStoreVersions/V1 {"include":"app,appStoreVersionPhasedRelease"}']);
            expect(ok.writes.map((call) => call.url)).toEqual(['/appStoreVersionPhasedReleases/PR1']);
        }
        const typo = await run(['version', 'release', 'V1', '--version-id', 'V1']);
        expect(typo.code).toBe(0);
    });

    test('screenshot-set delete follows the version or the CPP chain and rejects anything else', async () => {
        const version = await run(['screenshot-set', 'delete', 'SET_V', '--yes', '--confirm', 'APP']);
        expect(version.code).toBe(0);
        expect(firstGets(version.calls).slice(0, 3)).toEqual([
            '/appScreenshotSets/SET_V {"include":"appStoreVersionLocalization,appCustomProductPageLocalization"}',
            '/appStoreVersionLocalizations/LOC {"include":"appStoreVersion"}',
            '/appStoreVersions/V1 {"include":"app"}',
        ]);
        expect(version.writes.map((call) => call.url)).toEqual(['/appScreenshots/S1', '/appScreenshotSets/SET_V']);

        const cpp = await run(['screenshot-set', 'delete', 'SET_C', '--yes', '--confirm', 'APP']);
        expect(cpp.code).toBe(0);
        expect(firstGets(cpp.calls).slice(1, 4)).toEqual([
            '/appCustomProductPageLocalizations/CLOC {"include":"appCustomProductPageVersion"}',
            '/appCustomProductPageVersions/CV1 {"include":"appCustomProductPage"}',
            '/appCustomProductPages/CPP1 {"include":"app"}',
        ]);

        const wrong = await run(['screenshot-set', 'delete', 'SET_C', '--yes', '--confirm', 'OTHER']);
        expect(wrong.code).toBe(2);
        expect(wrong.writes).toEqual([]);

        const orphan = await run(['screenshot-set', 'delete', 'SET_X', '--yes', '--confirm', 'APP']);
        expect(orphan.code).toBe(2);
        expect(orphan.writes).toEqual([]);
    });

    test('cpp delete binds through appCustomProductPages?include=app', async () => {
        const wrong = await run(['cpp', 'delete', 'CPP2', '--app', 'APP', '--yes', '--confirm', 'APP']);
        expect(wrong.code).toBe(2);
        expect(wrong.writes).toEqual([]);
        const ok = await run(['cpp', 'delete', 'CPP1', '--app', 'APP', '--yes', '--confirm', 'APP']);
        expect(ok.code).toBe(0);
        expect(ok.writes.map((call) => call.url)).toEqual(['/appCustomProductPages/CPP1']);
    });

    test('event delete/submit need the event id in the app list; a non-empty list is not enough', async () => {
        for (const argv of [['event', 'delete', 'E1'], ['event', 'submit', 'E1']]) {
            const ok = await run([...argv, '--yes', '--confirm', 'APP']);
            // POST /appEventSubmissions is not in Apple's spec (MCP's original endpoint), so the
            // strict mock answers 404 there; what matters here is that binding let the write through.
            expect(ok.code).toBe(argv[1] === 'submit' ? 3 : 0);
            expect(firstGets(ok.calls)[0]).toBe('/apps/APP/appEvents {"filter[id]":"E1","limit":200}');
            expect(ok.writes.length).toBe(1);

            // OTHER has events (E9) and Apple ignores filter[id], so the list is non-empty.
            const other = await run([...argv, '--yes', '--confirm', 'OTHER']);
            expect(other.code).toBe(2);
            expect(other.writes).toEqual([]);

            const empty = await run([...argv, '--yes', '--confirm', 'EMPTY']);
            expect(empty.code).toBe(2);
            expect(empty.writes).toEqual([]);
        }
    });

    test('screenshot upload binds localization → version → app', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ascli-r3-shot-'));
        const file = join(dir, 'a.png');
        writeFileSync(file, 'png-bytes');
        const base = ['screenshot', 'upload', '--screenshot-display-type', 'APP_IPHONE_67', '--file', file, '--yes'];
        const wrong = await run([...base, '--app-store-version-localization-id', 'LOC_OTHER', '--confirm', 'APP']);
        expect(wrong.code).toBe(2);
        expect(wrong.writes).toEqual([]);
        const ok = await run([...base, '--app-store-version-localization-id', 'LOC', '--confirm', 'APP']);
        expect(ok.calls.some((call) => call.method === 'POST' && call.url === '/appScreenshotSets')).toBe(true);
        expect(ok.code === 0 || ok.code === 3).toBe(true);
    });

    test('review reply/delete-response require the review id in the confirmed app list', async () => {
        const ok = await run(['review', 'reply', 'R2', '--response-body', 'hi', '--yes', '--app', 'OTHER', '--confirm', 'APP']);
        expect(ok.code).toBe(0);
        expect(ok.calls[0]?.url).toBe('/apps/APP/customerReviews');
        expect(ok.calls[0]?.params).toEqual({ limit: 200 });
        expect(ok.writes.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /customerReviewResponses']);
        const foreign = await run(['review', 'reply', 'R_OTHER', '--response-body', 'hi', '--yes', '--app', 'APP', '--confirm', 'APP']);
        expect(foreign.code).toBe(2);
        expect(foreign.writes).toEqual([]);
        expect(foreign.calls.every((call) => call.method === 'GET')).toBe(true);
        const del = await run(['review', 'delete-response', 'R1', '--yes', '--confirm', 'APP']);
        expect(del.code).toBe(0);
        expect(del.writes.map((call) => call.url)).toEqual(['/customerReviewResponses/RESP1']);
    });

    test('version cancel is rejected before any request: the endpoint is not in the spec', async () => {
        const cancel = await run(['version', 'cancel', 'RR1', '--yes', '--confirm', 'APP']);
        expect(cancel.code).toBe(2);
        expect(json(cancel.stderr).error.message).toContain('appStoreReviewRequests');
        expect(cancel.calls).toEqual([]);
    });

    test('user --confirm matches email/username case-insensitively, userId exactly', async () => {
        expect((await run(['user', 'remove', 'U1', '--yes', '--confirm', 'real@example.COM'])).code).toBe(0);
        expect((await run(['user', 'remove', 'U1', '--yes', '--confirm', 'u1'])).writes).toEqual([]);
        const invite = await run([
            'user', 'invite', '--email', 'Ada@Example.com', '--first-name', 'A', '--last-name', 'B', '--roles', '["MARKETING"]',
            '--yes', '--confirm', 'ada@example.com',
        ]);
        expect(invite.code).toBe(0);
    });

    test('dry-run lists the binding GETs separately from steps', async () => {
        const upload = await runCli(['screenshot-set', 'delete', 'SET_V'], { env, transport: appleTransport(world()) });
        const plan = json(upload.stdout);
        expect(plan.confirm_reads[0]).toEqual({
            method: 'GET',
            path: '/appScreenshotSets/SET_V',
            params: { include: 'appStoreVersionLocalization,appCustomProductPageLocalization' },
        });
        expect(plan.steps.some((step: { path: string }) => step.path.includes('{'))).toBe(false);
        const review = json((await runCli(['review', 'reply', 'R1', '--response-body', 'x', '--confirm', 'APP'], { env, transport: appleTransport(world()) })).stdout);
        expect(review.confirm_reads[0].path).toBe('/apps/APP/customerReviews');
        expect(review.confirm_reads[0].params).toEqual({ limit: 200 });
        expect(review.confirm_note).toContain('customerReviews');
        const event = json((await runCli(['event', 'delete', 'E1', '--confirm', 'APP'])).stdout);
        expect(event.confirm_reads[0].path).toBe('/apps/APP/appEvents');
        expect(event.confirm_reads[0].params).toEqual({ 'filter[id]': 'E1', limit: 200 });
        const normal = json((await runCli(['version', 'update-localization', 'L1', '--whats-new', 'x'])).stdout);
        expect(normal.confirm_reads).toBeUndefined();
    });
});

describe('round 3 file precheck and paging host', () => {
    test('R2-F07 --file pointing at a directory exits 2 before any request', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ascli-r3-dir-'));
        const empty = join(dir, 'empty.png');
        writeFileSync(empty, '');
        for (const target of [dir, empty]) {
            for (const extra of [[], ['--yes', '--confirm', 'APP']]) {
                const calls: HttpCall[] = [];
                const result = await runCli([
                    'screenshot', 'upload',
                    '--app-store-version-localization-id', 'LOC',
                    '--screenshot-display-type', 'APP_IPHONE_67',
                    '--file', target,
                    ...extra,
                ], { env, transport: appleTransport({}, calls) });
                expect(result.code).toBe(2);
                expect(calls).toEqual([]);
            }
        }
        expect(() => assertReadableFiles([dir])).toThrow();
        expect(() => assertReadableFiles([empty])).toThrow();
    });

    test('getAllPages refuses links.next on another host', async () => {
        const calls: HttpCall[] = [];
        const client = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                transport: {
                    async send(call) {
                        calls.push(call);
                        return { status: 200, headers: {}, data: { data: [{ id: 'a' }], links: { next: 'https://evil.example/v1/apps?cursor=2' } } };
                    },
                },
            }
        );
        await expect(client.getAllPages('/apps')).rejects.toThrow('evil.example');
        expect(calls.length).toBe(1);
    });
});

describe('round 4 review ownership, uploads, paging, mock, and 401', () => {
    test('F1 a matching --app does not authorize another app review', async () => {
        const world = {
            reviews: { R_A: { app: 'APP_A' }, R_B: { app: 'APP_B', response: 'RESP_B' } },
        };
        const calls: HttpCall[] = [];
        const blocked = await runCli(
            ['review', 'reply', 'R_B', '--response-body', 'audit', '--yes', '--app', 'APP_A', '--confirm', 'APP_A'],
            { env, transport: appleTransport(world, calls), sleep: async () => {} }
        );
        expect(blocked.code).toBe(2);
        expect(calls.map((call) => call.method)).toEqual(['GET']);
        expect(calls[0]?.url).toBe('/apps/APP_A/customerReviews');
        expect(json(blocked.stderr).error.message).toContain('R_B');

        calls.length = 0;
        const allowed = await runCli(
            ['review', 'reply', 'R_A', '--response-body', 'ok', '--yes', '--app', 'APP_B', '--confirm', 'APP_A'],
            { env, transport: appleTransport(world, calls), sleep: async () => {} }
        );
        expect(allowed.code).toBe(0);
        expect(calls[0]?.url).toBe('/apps/APP_A/customerReviews');
        expect(calls.some((call) => call.method === 'POST' && call.url === '/customerReviewResponses')).toBe(true);
    });

    test('F2 dry-run lists a conditional upload PUT for screenshots and CPP', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ascli-r4-'));
        const shot = join(dir, 'shot.png');
        const hero = join(dir, 'hero.png');
        const extra = join(dir, 'extra.png');
        writeFileSync(shot, 'png');
        writeFileSync(hero, 'png');
        writeFileSync(extra, 'png');
        const screen = await runCli([
            'screenshot', 'upload',
            '--app-store-version-localization-id', 'LOC',
            '--screenshot-display-type', 'APP_IPHONE_67',
            '--image-paths', JSON.stringify([shot]),
            '--replace-existing', 'false',
        ]);
        expect(screen.code).toBe(0);
        expect(screen.calls).toEqual([]);
        const screenSteps = json(screen.stdout).steps as { method: string; path: string; note?: string }[];
        const screenPut = screenSteps.find((step) => step.method === 'PUT');
        expect(screenPut?.path).toBe('{uploadOperations[i].url}');
        expect(screenPut?.note).toContain('reserve');

        const cpp = await runCli([
            'cpp', 'create', '--app', 'APP', '--name', 'Hero', '--promotional-text', 'hello',
            '--cpp-image-path', hero, '--template-shot-paths', JSON.stringify([extra]),
        ]);
        expect(cpp.code).toBe(0);
        expect(cpp.calls).toEqual([]);
        const cppPuts = (json(cpp.stdout).steps as { method: string; path: string }[]).filter((step) => step.method === 'PUT');
        expect(cppPuts).toHaveLength(2);
        expect(cppPuts.every((step) => step.path === '{uploadOperations[i].url}')).toBe(true);
    });

    test('F3 getAllPages throws when the page cap still has a next link', async () => {
        let page = 0;
        const client = new AppStoreConnectClient(
            { keyId: 'k', issuerId: 'i', privateKey: 'p' },
            {
                transport: {
                    async send() {
                        page += 1;
                        return {
                            status: 200,
                            headers: {},
                            data: { data: [{ id: `E${page}` }], links: { next: `https://api.appstoreconnect.apple.com/v1/apps/A/appEvents?cursor=${page + 1}` } },
                        };
                    },
                },
            }
        );
        await expect(client.getAllPages('/apps/A/appEvents')).rejects.toThrow('不完整');
        expect(page).toBe(1000);
    });

    test('F4 spec mock rejects an empty write body and an include hidden in the URL', async () => {
        const transport = appleTransport({});
        const empty = await transport.send({ method: 'POST', url: '/appScreenshotSets', data: {} });
        const bare = await transport.send({ method: 'POST', url: '/appScreenshotSets', data: { data: {} } });
        const inUrl = await transport.send({ method: 'GET', url: '/appStoreVersions/V1?include=NOT_A_RELATIONSHIP' });
        expect(empty.status).toBe(400);
        expect(bare.status).toBe(400);
        expect(inUrl.status).toBe(400);
    });

    test('F5 every 401 is exit 4 and 403 stays exit 3', async () => {
        const unauthorized = {
            async send(): Promise<HttpResult> {
                return { status: 401, headers: {}, data: { errors: [{ status: '401', code: 'NOT_AUTHORIZED', title: 'Unauthorized', detail: 'bad key' }] } };
            },
        };
        const listed = await runCli(['app', 'list'], { env, transport: unauthorized });
        expect(listed.code).toBe(4);
        expect(json(listed.stderr).error.type).toBe('auth');
        const released = await runCli(['version', 'release', 'V1', '--yes', '--confirm', 'APP'], { env, transport: unauthorized });
        expect(released.code).toBe(4);
        expect(json(released.stderr).error.type).toBe('auth');
        const forbidden = await runCli(['app', 'list'], {
            env,
            transport: {
                async send() {
                    return { status: 403, headers: {}, data: { errors: [{ status: '403', code: 'FORBIDDEN', title: 'Forbidden', detail: 'no' }] } };
                },
            },
        });
        expect(forbidden.code).toBe(3);
        expect(json(forbidden.stderr).error.type).toBe('api');
    });

    test('F6 an empty error envelope keeps the axios text and network errors are not retried', async () => {
        const error = errorFromResponse({ status: 403, headers: {}, data: {} });
        expect(error.message).toBe('Request failed with status code 403');
        let attempts = 0;
        await expect(sendWithPolicy(
            async () => {
                attempts += 1;
                throw new Error('getaddrinfo ENOTFOUND test.invalid');
            },
            { method: 'GET', url: '/apps' },
            { sleep: async () => undefined }
        )).rejects.toThrow('ENOTFOUND');
        expect(attempts).toBe(1);
    });

    test('F7 batch update tries every item and the usage doc says so', async () => {
        let n = 0;
        const result = await runCli([
            'version-localization', 'batch-update', '--yes',
            '--updates', JSON.stringify([
                { localizationId: 'L1', whatsNew: 'a' },
                { localizationId: 'L2', whatsNew: 'b' },
                { localizationId: 'L3', whatsNew: 'c' },
            ]),
        ], {
            env,
            transport: {
                async send() {
                    n += 1;
                    if (n === 2) return { status: 500, headers: {}, data: { errors: [{ title: 'down', detail: 'nope' }] } };
                    return { status: 200, headers: {}, data: { data: { id: `L${n}`, attributes: { locale: 'en-US' } } } };
                },
            },
        });
        expect(result.code).toBe(3);
        const body = json(result.stdout);
        expect(body.total).toBe(3);
        expect(body.succeeded).toBe(2);
        expect(body.results.map((item: { id: string }) => item.id)).toEqual(['L1', 'L2', 'L3']);
        expect(n).toBe(3);
        const usage = readFileSync(join(process.cwd(), 'docs/cli-usage.md'), 'utf8');
        expect(usage).toContain('逐条尝试全部更新');
        expect(usage).not.toContain('遇到第一条失败就退出码 3');
    });

    test('F8 the spec no longer claims MCP create_cpp preflights files', () => {
        const spec = readFileSync(join(process.cwd(), 'docs/cli-spec.md'), 'utf8');
        expect(spec).toContain('MCP 的 `create_cpp` 没有这个预检');
        expect(spec).not.toContain('`upload_screenshots` / `create_cpp` 在删除或上传前检查本地文件');
    });
});
