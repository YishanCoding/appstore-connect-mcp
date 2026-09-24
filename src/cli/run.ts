import { readFileSync, writeFileSync } from 'fs';
import { z } from 'zod';
import { AppStoreConnectClient } from '../programs/api-client/client.js';
import { AscHttpError, type HttpCall, type HttpTransport } from '../programs/api-client/policy.js';
import { executeTool } from './execute.js';
import { parseArgs } from './parse.js';
import { applyLimit, apiError, authError, CliUsage, formatData, projectFields, redact, usageError } from './output.js';
import { asParser, commandPositionals, helpText, objectShape, resolveCommand, toolsJson } from './registry.js';
import { BIND_VERSION_ID_TOOLS, bindConfirm, bindingReads, decideSafety, effectiveRisk, extractAppId, type BindContext } from './safety.js';
import { describeFiles } from './write-plan.js';
import { assertWriteInputs, ExportFailed, PartialBatch, runWrite, writeNeedsRead, type WritePreview } from './write-call.js';
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

    let toolName = '';
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

        toolName = entry.tool.name;
        const envelope = dataEnvelope(parsed.body);
        if (envelope) return finish(2, '', usageError(envelope));

        // --version-id is CLI-only for phased-release update/delete: it is not in the MCP schema.
        let bindVersionId: string | undefined;
        if (BIND_VERSION_ID_TOOLS.has(toolName) && parsed.flags.versionId !== undefined) {
            bindVersionId = String(parsed.flags.versionId);
            delete parsed.flags.versionId;
        }
        const bindCtx: BindContext = { app: parsed.app, versionId: bindVersionId, confirm: parsed.confirm };

        const rest = commandPositionals(entry, parsed.positionals);
        const built = buildArgs(entry.tool.inputSchema, parsed, rest, entry.meta.idParam);
        if (built.error) return finish(2, '', usageError(built.error));
        const args = built.args;
        const bodyApp = extractAppId(parsed.body);
        if (parsed.app && bodyApp && parsed.app !== bodyApp) {
            return finish(2, '', usageError('--app 与 --body 里的 app id 不一致'));
        }

        const schema = asParser(entry.tool.inputSchema);
        const checked = schema.safeParse(args);
        if (!checked.success) {
            return finish(2, '', usageError(formatZod(checked.error)));
        }
        const input = checked.data as Record<string, any>;
        if (parsed.limit != null) input.limit = parsed.limit;
        assertWriteInputs(entry.tool.name, input);

        const risk = effectiveRisk(entry.tool.name, entry.meta.risk, input);
        const decision = decideSafety({
            kind: entry.meta.kind,
            risk,
            yes: parsed.yes,
            confirm: parsed.confirm,
            confirmKind: entry.meta.confirm ?? (risk === 'high' ? 'app' : undefined),
        });
        if (decision.action === 'reject') return finish(2, '', usageError(decision.message));

        if (decision.action === 'dry-run' && !writeNeedsRead(entry.tool.name, input)) {
            const plan = await runWrite(null, entry.tool.name, input, false) as WritePreview;
            if (parsed.verbose) verbose.push('dry-run: network writes=0\n');
            return finish(0, formatData(dryRunOutput(plan, input, entry.tool.name, risk, bindCtx), parsed.format), verbose.join(''));
        }

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

        if (decision.action === 'dry-run') {
            const previewClient = writeNeedsRead(entry.tool.name, input) ? client : null;
            const plan = await runWrite(previewClient, entry.tool.name, input, false) as WritePreview;
            if (parsed.verbose) verbose.push('dry-run: network writes=0\n');
            return finish(0, formatData(dryRunOutput(plan, input, entry.tool.name, risk, bindCtx), parsed.format), verbose.join(''));
        }

        if (risk === 'high') {
            const gate = await bindConfirm(entry.tool.name, input, parsed.confirm!, {
                get: (path, params) => client.get(path, params),
                getAll: (path, params) => client.getAllPages(path, params),
            }, bindCtx);
            if (!gate.ok) return finish(2, '', usageError(gate.message));
        }

        const data = await executeTool(entry.tool.name, input, client, { all: parsed.all, limit: parsed.limit });
        const projected = projectFields(applyLimit(data, parsed.limit), parsed.fields);
        return finish(0, formatData(projected, parsed.format), verbose.join(''));
    } catch (error) {
        if (error instanceof CliUsage) return finish(2, '', usageError(error.message));
        if (error instanceof PartialBatch) {
            return finish(3, formatData(error.payload, 'json'), apiError(0, 'PARTIAL', error.message));
        }
        if (error instanceof ExportFailed) {
            const failed = (error.payload as { failed?: unknown[] }).failed?.length ?? 0;
            return finish(3, formatData(error.payload, 'json'), apiError(0, 'EXPORT_FAILED', `${failed} 项导出失败`));
        }
        if (error instanceof AuthMissing) return finish(4, '', authError(error.message));
        if (error instanceof AscHttpError && error.status === 401) {
            return finish(4, '', authError('凭据被 App Store Connect 拒绝（HTTP 401）'));
        }
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

function dataEnvelope(body: unknown): string | undefined {
    if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in (body as object)) {
        return 'body 不要带 data 信封，请改用字段形式，例如 {"whatsNew":"..."}';
    }
    return undefined;
}

/**
 * steps = what the write itself sends. confirm_reads = the extra ownership GETs that --yes
 * sends before any write (not executed in dry-run).
 */
function dryRunOutput(
    plan: WritePreview,
    input: Record<string, unknown>,
    toolName: string,
    risk: 'normal' | 'high',
    ctx: BindContext
): Record<string, unknown> {
    const files = safeFiles(input);
    const out: Record<string, unknown> = files.length ? { ...plan, files } : { ...plan };
    if (risk === 'high') {
        out.confirm_reads = bindingReads(toolName, input, ctx);
        out.confirm_note = confirmNote(toolName);
    }
    return out;
}

function confirmNote(toolName: string): string {
    if (toolName === 'appstore_cancel_review') return '--yes 会直接拒绝：Apple 规范里没有 appStoreReviewRequests，无法确认归属';
    if (toolName === 'appstore_respond_to_review' || toolName === 'appstore_delete_review_response') {
        return '--yes 时分页读完 GET /apps/{confirm}/customerReviews（limit 200），列表里必须有这条 reviewId。--confirm 与 --app 字面相等不算归属。';
    }
    if (toolName === 'appstore_invite_user') return '--yes 时 --confirm 必须等于 email（不区分大小写），不发归属 GET';
    return '--yes 时先按 confirm_reads 发只读 GET 确认归属，通过后才发 steps 里的写请求';
}

function safeFiles(args: Record<string, unknown>) {
    try {
        return describeFiles(args);
    } catch {
        return [];
    }
}

function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function flagName(key: string): string {
    return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function buildArgs(
    schema: unknown,
    parsed: ReturnType<typeof parseArgs>,
    rest: string[],
    idParam?: string
): { args: Record<string, unknown>; error?: string } {
    const shape = objectShape(schema) ?? {};
    const args: Record<string, unknown> = {};
    const origin = new Map<string, string>();

    for (const key of Object.keys(parsed.flags)) {
        if (!(key in shape)) return { args, error: `未知 flag: --${flagName(key)}` };
    }

    const assign = (key: string, value: unknown, source: string): string | undefined => {
        if (!(key in shape) || value === undefined) return;
        const coerced = coerce(shape[key]!, value);
        const previous = origin.get(key);
        if (previous) {
            if (!sameValue(args[key], coerced)) return `参数 ${key} 在 ${previous} 与 ${source} 中的值不一致`;
            return;
        }
        origin.set(key, source);
        args[key] = coerced;
        return;
    };

    const body = parsed.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
            const error = assign(key, value, '--body');
            if (error) return { args, error };
        }
    }
    if (parsed.query && typeof parsed.query === 'object' && !Array.isArray(parsed.query)) {
        for (const [key, value] of Object.entries(parsed.query as Record<string, unknown>)) {
            const error = assign(key, value, '--query');
            if (error) return { args, error };
        }
    }
    for (const [key, value] of Object.entries(parsed.flags)) {
        const error = assign(key, value, `--${flagName(key)}`);
        if (error) return { args, error };
    }
    if (idParam && rest[0]) {
        const error = assign(idParam, rest[0], '位置参数');
        if (error) return { args, error };
    }
    if (parsed.app && 'appId' in shape) {
        const error = assign('appId', parsed.app, '--app');
        if (error) return { args, error };
    }
    if (parsed.app && 'adamId' in shape) {
        const error = assign('adamId', parsed.app, '--app');
        if (error) return { args, error };
    }
    if (parsed.file && 'imagePaths' in shape) {
        const current = Array.isArray(args.imagePaths) ? (args.imagePaths as string[]) : [];
        if (!current.includes(parsed.file)) args.imagePaths = [...current, parsed.file];
    }
    if (parsed.limit != null && 'limit' in shape) {
        const error = assign('limit', parsed.limit, '--limit');
        if (error) return { args, error };
    }
    return { args };
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
