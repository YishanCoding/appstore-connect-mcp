import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { AppStoreConnectClient } from '../programs/api-client/client.js';
import { AscHttpError, sendWithPolicy, type HttpCall, type HttpResult } from '../programs/api-client/policy.js';
import { projectFields } from './output.js';
import { runCli } from './run.js';
import { decideSafety } from './safety.js';
import { includesJson } from './write-plan.js';

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
        expect(includesJson(inlineBody.body, payload)).toBe(true);
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
        expect(calls).toEqual([]);
        const body = json(result.stdout);
        expect(body.dry_run).toBe(true);
        expect(body.method).toBe('POST');
        expect(body.path).toBe('/customerReviewResponses');
        expect(body.body.data.attributes.responseBody).toBe('hello');
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
        expect(calls).toEqual([]);

        const missing = await runCli(['review', 'reply', 'rev-1', '--response-body', 'hello', '--yes', '--app', 'app-a'], {
            env,
            transport,
        });
        expect(missing.code).toBe(2);
        expect(json(missing.stderr).error.type).toBe('usage');
        expect(calls).toEqual([]);
        expect(decideSafety({ kind: 'write', risk: 'high', yes: true, confirm: 'app-a', appId: 'app-b' }).action).toBe('reject');
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
