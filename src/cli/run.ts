import { readFileSync, writeFileSync } from 'fs';
import { z } from 'zod';
import { AppStoreConnectClient } from '../programs/api-client/client.js';
import { AscHttpError, type HttpCall, type HttpTransport } from '../programs/api-client/policy.js';
import { executeTool } from './execute.js';
import { parseArgs } from './parse.js';
import { applyLimit, apiError, authError, formatData, projectFields, redact, usageError } from './output.js';
import { asParser, commandPositionals, helpText, objectShape, resolveCommand, toolsJson } from './registry.js';
import { decideSafety, extractAppId } from './safety.js';
import { includesJson, planWrite } from './write-plan.js';
import { AppManager } from '../programs/apps/index.js';
import { ReviewManager } from '../programs/reviews/index.js';
import { VersionManager } from '../programs/versions/index.js';

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
    calls: HttpCall[];
}

export interface RunOptions {
    env?: NodeJS.ProcessEnv;
    transport?: HttpTransport;
    cwd?: string;
    sleep?: (ms: number) => Promise<void>;
}

class UsageError extends Error {}

export async function runCli(argv: string[], options: RunOptions = {}): Promise<RunResult> {
    const env = options.env ?? process.env;
    const calls: HttpCall[] = [];
    const verbose: string[] = [];
    const secrets = [env.APP_STORE_CONNECT_KEY_ID, env.APP_STORE_CONNECT_ISSUER_ID, env.APP_STORE_CONNECT_PRIVATE_KEY]
        .filter((value): value is string => !!value);

    const finish = (code: number, out = '', err = ''): RunResult => ({
        code,
        stdout: redact(out, secrets),
        stderr: redact(err, secrets),
        calls,
    });

    try {
        const parsed = parseArgs(argv, options.cwd);
        if (parsed.error) return finish(2, '', usageError(parsed.error));
        if (parsed.profile !== undefined) return finish(2, '', usageError('--profile 尚未实现'));

        const [resource, verb] = parsed.positionals;
        if (parsed.help && !resource) return finish(0, helpText() + '\n');
        if (parsed.help && resource && !verb) return finish(0, helpText(resource) + '\n');

        if (resource === 'tools') {
            if (parsed.help) return finish(0, 'ascli tools --json\n打印命令目录。\n');
            return finish(0, JSON.stringify(toolsJson(), null, 2) + '\n');
        }

        if (resource === 'smoke') {
            if (parsed.help) return finish(0, 'ascli smoke --output <path>\n只读线上验收。\n');
            if (!parsed.output) return finish(2, '', usageError('smoke 需要 --output <path>'));
            const report = await runSmoke(env, options, calls, verbose);
            writeFileSync(parsed.output, JSON.stringify(report, null, 2) + '\n');
            const failed = report.checks.some((check) => !check.ok);
            return finish(failed ? 3 : 0, JSON.stringify(report, null, 2) + '\n', verbose.join(''));
        }

        if (!resource) return finish(2, '', usageError('缺少 resource。运行 ascli --help'));
        const entry = resolveCommand(parsed.positionals);
        if (!entry) return finish(2, '', usageError(`未知命令: ${parsed.positionals.join(' ')}`));
        if (parsed.help) {
            const [res, ver] = entry.command?.split(' ') ?? [];
            return finish(0, helpText(res, ver) + '\n');
        }
        if (entry.command === null) {
            return finish(2, '', usageError('stateless：CLI 不保存凭据，只读取环境变量'));
        }

        const rest = commandPositionals(entry, parsed.positionals);
        const args = buildArgs(entry.tool.inputSchema, parsed, rest, entry.meta.idParam);
        const bodyApp = extractAppId(parsed.body);
        const argApp = typeof args.appId === 'string' ? args.appId : undefined;
        if (parsed.app && bodyApp && parsed.app !== bodyApp) {
            return finish(2, '', usageError('--app 与 --body 里的 app id 不一致'));
        }
        if (parsed.app && argApp && parsed.app !== argApp) {
            return finish(2, '', usageError('--app 与参数里的 app id 不一致'));
        }
        const declaredApp = parsed.app ?? argApp ?? bodyApp;

        const decision = decideSafety({
            kind: entry.meta.kind,
            risk: entry.meta.risk,
            yes: parsed.yes,
            confirm: parsed.confirm,
            appId: declaredApp,
        });
        if (decision.action === 'reject') return finish(2, '', usageError(decision.message));
        if (decision.action === 'dry-run') {
            const plan = planWrite(entry.meta, { ...args, ...(parsed.file ? { file: parsed.file } : {}) }, parsed.body);
            if (parsed.body && !includesJson(plan.body, parsed.body) && plan.body !== parsed.body) {
                plan.body = { ...(typeof plan.body === 'object' && plan.body ? plan.body as object : {}), input: parsed.body };
            }
            if (parsed.verbose) verbose.push('dry-run: network writes=0\n');
            return finish(0, formatData(plan, parsed.format), verbose.join(''));
        }

        const schema = asParser(entry.tool.inputSchema);
        const checked = schema.safeParse(args);
        if (!checked.success) {
            return finish(2, '', usageError(formatZod(checked.error)));
        }
        const input = checked.data as Record<string, any>;
        if (parsed.limit != null) input.limit = parsed.limit;

        const creds = readCredentials(env);
        const client = new AppStoreConnectClient(creds, {
            transport: options.transport
                ? {
                    async send(call) {
                        calls.push(call);
                        const started = Date.now();
                        const result = await options.transport!.send(call);
                        if (parsed.verbose) verbose.push(`${call.method} ${call.url} ${result.status} ${Date.now() - started}ms\n`);
                        return result;
                    },
                }
                : undefined,
            sleep: options.sleep,
            onRequest: (info) => {
                if (parsed.verbose) verbose.push(`${info.method} ${info.path} ${info.status} ${info.ms}ms\n`);
            },
        });

        const data = await executeTool(entry.tool.name, input, client, { all: parsed.all, limit: parsed.limit });
        const projected = projectFields(applyLimit(data, parsed.limit), parsed.fields);
        return finish(0, formatData(projected, parsed.format), verbose.join(''));
    } catch (error) {
        if (error instanceof UsageError) return finish(2, '', usageError(error.message));
        if (error instanceof AuthMissing) return finish(4, '', authError(error.message));
        if (error instanceof AscHttpError) return finish(3, '', apiError(error.status, error.code, error.detail));
        const message = error instanceof Error ? error.message : String(error);
        return finish(3, '', apiError(0, 'UNKNOWN', message));
    }
}

class AuthMissing extends Error {}

export function readCredentials(env: NodeJS.ProcessEnv) {
    const missing: string[] = [];
    if (!env.APP_STORE_CONNECT_KEY_ID) missing.push('APP_STORE_CONNECT_KEY_ID');
    if (!env.APP_STORE_CONNECT_ISSUER_ID) missing.push('APP_STORE_CONNECT_ISSUER_ID');
    const inline = env.APP_STORE_CONNECT_PRIVATE_KEY;
    const file = env.APP_STORE_CONNECT_PRIVATE_KEY_PATH;
    if (!inline && !file) missing.push('APP_STORE_CONNECT_PRIVATE_KEY_PATH');
    if (missing.length) throw new AuthMissing(`缺 ${missing.join(', ')}`);

    let privateKey = inline ? inline.replace(/\\n/g, '\n') : '';
    if (!inline && file) {
        try {
            privateKey = readFileSync(file, 'utf8');
        } catch {
            throw new AuthMissing('缺 APP_STORE_CONNECT_PRIVATE_KEY_PATH');
        }
    }
    if (!privateKey.trim()) throw new AuthMissing('缺 APP_STORE_CONNECT_PRIVATE_KEY');
    return {
        keyId: env.APP_STORE_CONNECT_KEY_ID!,
        issuerId: env.APP_STORE_CONNECT_ISSUER_ID!,
        privateKey,
    };
}

function buildArgs(
    schema: unknown,
    parsed: ReturnType<typeof parseArgs>,
    rest: string[],
    idParam?: string
): Record<string, unknown> {
    const shape = objectShape(schema) ?? {};
    const args: Record<string, unknown> = {};
    const assign = (key: string, value: unknown) => {
        if (!(key in shape) || value === undefined) return;
        args[key] = coerce(shape[key]!, value);
    };

    const body = parsed.body;
    if (body && typeof body === 'object' && !Array.isArray(body) && !('data' in (body as object))) {
        for (const [key, value] of Object.entries(body as Record<string, unknown>)) assign(key, value);
    }
    if (parsed.query && typeof parsed.query === 'object' && !Array.isArray(parsed.query)) {
        for (const [key, value] of Object.entries(parsed.query as Record<string, unknown>)) assign(key, value);
    }
    for (const [key, value] of Object.entries(parsed.flags)) assign(key, value);
    if (idParam && rest[0]) assign(idParam, rest[0]);
    if (parsed.app && 'appId' in shape && args.appId === undefined) assign('appId', parsed.app);
    if (parsed.app && 'adamId' in shape && args.adamId === undefined) assign('adamId', parsed.app);
    if (parsed.file && 'imagePaths' in shape) {
        const current = Array.isArray(args.imagePaths) ? args.imagePaths : [];
        args.imagePaths = [...current, parsed.file];
    }
    if (parsed.limit != null && 'limit' in shape) args.limit = parsed.limit;
    return args;
}

function coerce(field: z.ZodType, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (field.safeParse(value).success) return value;
    if ((value === 'true' || value === 'false') && field.safeParse(value === 'true').success) return value === 'true';
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric) && field.safeParse(numeric).success) return numeric;
    try {
        const json = JSON.parse(value);
        if (field.safeParse(json).success) return json;
    } catch {
        // keep the original string
    }
    return value;
}

function formatZod(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || '参数'}: ${issue.message}`).join('; ');
}

async function runSmoke(
    env: NodeJS.ProcessEnv,
    options: RunOptions,
    calls: HttpCall[],
    verbose: string[]
) {
    const creds = readCredentials(env);
    const client = new AppStoreConnectClient(creds, {
        transport: options.transport
            ? { async send(call) { calls.push(call); return options.transport!.send(call); } }
            : undefined,
        sleep: options.sleep,
        onRequest: (info) => verbose.push(`${info.method} ${info.path} ${info.status} ${info.ms}ms\n`),
    });
    const checks: { name: string; method: 'GET'; path: string; ok: boolean; status: number; readOnly: true; detail?: string }[] = [];
    const record = async (name: string, path: string, run: () => Promise<unknown>) => {
        try {
            await run();
            checks.push({ name, method: 'GET', path, ok: true, status: 200, readOnly: true });
        } catch (error) {
            const status = error instanceof AscHttpError ? error.status : 0;
            const detail = error instanceof Error ? error.message : String(error);
            checks.push({ name, method: 'GET', path, ok: false, status, readOnly: true, detail });
        }
    };

    let appId = '';
    await record('apps', '/apps', async () => {
        const apps = await new AppManager(client).listAppResources({ limit: 1, all: false });
        appId = apps[0]?.id ?? '';
        if (!appId) throw new AscHttpError(404, 'NOT_FOUND', '账号下没有 App');
    });
    if (appId) {
        await record('reviews', `/apps/${appId}/customerReviews`, async () => {
            await new ReviewManager(client).listReviews(appId, { limit: 1, all: false });
        });
        await record('versions', `/apps/${appId}/appStoreVersions`, async () => {
            await new VersionManager(client).listVersions(appId, 'IOS', { all: false, limit: 1 });
        });
    }
    return { ok: checks.every((check) => check.ok), checks };
}
