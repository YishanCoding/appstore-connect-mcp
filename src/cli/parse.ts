import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';

export interface ParsedArgs {
    positionals: string[];
    format: 'json' | 'ndjson' | 'table';
    fields?: string[];
    limit?: number;
    all: boolean;
    yes: boolean;
    verbose: boolean;
    help: boolean;
    json: boolean;
    output?: string;
    confirm?: string;
    query?: unknown;
    body?: unknown;
    app?: string;
    file?: string;
    profile?: string;
    flags: Record<string, string | boolean>;
    error?: string;
}

const VALUE_GLOBALS = new Set([
    'format',
    'fields',
    'limit',
    'output',
    'confirm',
    'query',
    'body',
    'app',
    'file',
    'profile',
]);
const BOOL_GLOBALS = new Set(['all', 'yes', 'verbose', 'help', 'json']);

export function kebabToCamel(value: string): string {
    return value.replace(/-([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function parseArgs(argv: string[], cwd = process.cwd()): ParsedArgs {
    const parsed: ParsedArgs = {
        positionals: [],
        format: 'json',
        all: false,
        yes: false,
        verbose: false,
        help: false,
        json: false,
        flags: {},
    };

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!;
        if (token === '--') {
            parsed.positionals.push(...argv.slice(i + 1));
            break;
        }
        if (!token.startsWith('--')) {
            parsed.positionals.push(token);
            continue;
        }

        const eq = token.indexOf('=');
        const rawName = (eq === -1 ? token.slice(2) : token.slice(2, eq)).trim();
        const inline = eq === -1 ? undefined : token.slice(eq + 1);
        if (!rawName) {
            parsed.error = '空的 flag';
            return parsed;
        }

        if (BOOL_GLOBALS.has(rawName)) {
            if (inline !== undefined) {
                parsed.error = `未知 flag: --${rawName}=${inline}；--${rawName} 是开关，不能赋值`;
                return parsed;
            }
            if (rawName === 'all') parsed.all = true;
            if (rawName === 'yes') parsed.yes = true;
            if (rawName === 'verbose') parsed.verbose = true;
            if (rawName === 'help') parsed.help = true;
            if (rawName === 'json') parsed.json = true;
            continue;
        }

        let value = inline;
        if (value === undefined) {
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) {
                parsed.error = `--${rawName} 需要一个值`;
                return parsed;
            }
            value = next;
            i += 1;
        }

        if (VALUE_GLOBALS.has(rawName)) {
            const assigned = assignGlobal(parsed, rawName, value, cwd);
            if (assigned) parsed.error = assigned;
            if (parsed.error) return parsed;
            continue;
        }

        parsed.flags[kebabToCamel(rawName)] = value;
    }

    if (parsed.format !== 'json' && parsed.format !== 'ndjson' && parsed.format !== 'table') {
        parsed.error = '--format 只能是 json、ndjson 或 table';
    }
    return parsed;
}

function assignGlobal(parsed: ParsedArgs, name: string, value: string, cwd: string): string | undefined {
    if (name === 'format') {
        parsed.format = value as ParsedArgs['format'];
        return;
    }
    if (name === 'fields') {
        parsed.fields = value.split(',').map((part) => part.trim()).filter(Boolean);
        return;
    }
    if (name === 'limit') {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 0) return '--limit 必须是非负整数';
        parsed.limit = limit;
        return;
    }
    if (name === 'output') {
        parsed.output = value;
        return;
    }
    if (name === 'confirm') {
        parsed.confirm = value;
        return;
    }
    if (name === 'app') {
        parsed.app = value;
        return;
    }
    if (name === 'file') {
        parsed.file = value;
        return;
    }
    if (name === 'profile') {
        parsed.profile = value;
        return;
    }
    if (name === 'query' || name === 'body') {
        try {
            const loaded = loadJson(value, cwd);
            if (name === 'query') parsed.query = loaded;
            else parsed.body = loaded;
        } catch (error) {
            return error instanceof Error ? error.message : `无法解析 --${name}`;
        }
    }
    return;
}

export function loadJson(value: string, cwd: string): unknown {
    const text = value.startsWith('@') ? readFileSync(resolvePath(value.slice(1), cwd), 'utf8') : value;
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(value.startsWith('@') ? `无法解析 JSON 文件 ${value.slice(1)}` : '无法解析内联 JSON');
    }
}

function resolvePath(file: string, cwd: string): string {
    return isAbsolute(file) ? file : resolve(cwd, file);
}
