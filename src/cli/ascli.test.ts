import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { AppStoreConnectClient } from '../programs/api-client/client.js';
import { AscHttpError, errorFromResponse, sendWithPolicy, type HttpCall, type HttpResult } from '../programs/api-client/policy.js';
import { ReviewManager } from '../programs/reviews/review-manager.js';
import { uploadScreenshot } from '../mcp/tools/versions/screenshots.js';
import { projectFields } from './output.js';
import { runCli } from './run.js';
import { decideSafety } from './safety.js';

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
            {
                env,
                transport: {
                    async send(call) {
                        calls.push(call);
                        return {
                            status: 200,
                            headers: {},
                            data: { data: { relationships: { app: { data: { id: 'APP_B' } } } } },
                        };
                    },
                },
            }
        );
        expect(mismatch.code).toBe(2);
        expect(json(mismatch.stderr).error.type).toBe('usage');
        expect(json(mismatch.stderr).error.message).toContain('APP_B');
        expect(calls.map((call) => call.method)).toEqual(['GET']);

        const missing = await runCli(['review', 'reply', 'rev-1', '--response-body', 'hello', '--yes', '--app', 'app-a'], {
            env,
            transport,
        });
        expect(missing.code).toBe(2);
        expect(json(missing.stderr).error.type).toBe('usage');
        expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
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
                                data: { data: [{ id: 'a' }, { id: 'b' }], links: { next: 'https://example.test/reviews?page=2' } },
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
                            data: { data: [{ id: 'only' }], links: { next: 'https://example.test/more' } },
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
                            links: { next: 'https://example.test/next' },
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
        const live = await runCli(['review', 'delete-response', 'rev-1', '--yes', '--confirm', 'APP'], { env, transport: {
            async send(call) {
                calls.push(call);
                if (String(call.url).includes('/response') || call.params?.include === 'app') {
                    if (call.params?.include === 'app') {
                        return { status: 200, headers: {}, data: { data: { relationships: { app: { data: { id: 'APP' } } } } } };
                    }
                    return { status: 200, headers: {}, data: { data: { id: 'resp-9' } } };
                }
                return { status: 204, headers: {}, data: {} };
            },
        } });
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
        const transport = {
            async send(call: HttpCall): Promise<HttpResult> {
                calls.push(call);
                if (call.params?.include === 'app' && !String(call.url).includes('appScreenshotSets')) {
                    return { status: 200, headers: {}, data: { data: { relationships: { app: { data: { id: 'APP' } } } } } };
                }
                if (call.method === 'GET') {
                    return {
                        status: 200,
                        headers: {},
                        data: { data: [{ id: 'set-old', relationships: { appScreenshots: { data: [{ id: 'shot1' }] } } }] },
                    };
                }
                if (call.method === 'POST' && call.url === '/appScreenshotSets') {
                    return { status: 201, headers: {}, data: { data: { id: 'set-new' } } };
                }
                if (call.method === 'POST') {
                    return { status: 201, headers: {}, data: { data: { id: 'shot-new', attributes: { uploadOperations: [] } } } };
                }
                return { status: 200, headers: {}, data: {} };
            },
        };
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
        expect(live.code).toBe(0);
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
                                links: { next: 'https://example.test/reviews?page=2' },
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
                                    links: { next: 'https://example.test/next' },
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
