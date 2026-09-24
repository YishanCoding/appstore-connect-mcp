import { toJSONSchema, z } from 'zod';
import { loadToolCatalog, type CollectedTool } from '../mcp/tools/index.js';
import { TOOL_META, mechanicalAlias, type ToolMeta } from './meta.js';

export interface CatalogEntry {
    tool: CollectedTool;
    meta: ToolMeta;
    command: string | null;
    aliases: string[];
}

export interface ToolJsonItem {
    command: string | null;
    aliases: string[];
    mcp_tool: string;
    kind: 'read' | 'write';
    risk: 'normal' | 'high';
    params: unknown;
    description: string;
    reason?: string;
    capability?: string;
    owner?: string;
}

let entriesCache: CatalogEntry[] | null = null;

export function catalogEntries(): CatalogEntry[] {
    if (entriesCache) return entriesCache;
    const tools = loadToolCatalog();
    entriesCache = tools.map((tool) => {
        const meta = TOOL_META[tool.name];
        if (!meta) throw new Error(`MCP 工具 ${tool.name} 没有 CLI 映射`);
        const aliases = [...new Set([mechanicalAlias(tool.name), ...(meta.aliases ?? [])])];
        return { tool, meta, command: meta.command, aliases };
    });
    const missing = Object.keys(TOOL_META).filter((name) => !tools.some((tool) => tool.name === name));
    if (missing.length) throw new Error(`CLI 映射没有对应的 MCP 工具: ${missing.join(', ')}`);
    return entriesCache;
}

export function toolsJson(): ToolJsonItem[] {
    return catalogEntries()
        .map((entry) => {
            const item: ToolJsonItem = {
                command: entry.command,
                aliases: entry.aliases,
                mcp_tool: entry.tool.name,
                kind: entry.meta.kind,
                risk: entry.meta.risk,
                params: schemaToJson(entry.tool.inputSchema),
                description: entry.tool.description,
            };
            if (entry.command === null) {
                item.reason = entry.meta.reason ?? 'stateless';
                if (entry.meta.capability) item.capability = entry.meta.capability;
                if (entry.meta.owner) item.owner = entry.meta.owner;
            }
            return item;
        })
        .sort((a, b) => a.mcp_tool.localeCompare(b.mcp_tool));
}

export function resolveCommand(positionals: string[]): CatalogEntry | undefined {
    if (positionals.length === 0) return undefined;
    const entries = catalogEntries();
    const two = `${positionals[0]} ${positionals[1] ?? ''}`.trim();
    const byCommand = entries.find((entry) => entry.command === two);
    if (byCommand) return byCommand;
    const joined = positionals.join(' ');
    const byAlias = entries.find((entry) => entry.aliases.some((alias) => alias === joined || alias === positionals[0]));
    if (byAlias) return byAlias;
    return entries.find((entry) => entry.command === positionals[0]);
}

export function commandPositionals(entry: CatalogEntry, positionals: string[]): string[] {
    if (entry.command && positionals.join(' ').startsWith(entry.command)) {
        return positionals.slice(entry.command.split(' ').length);
    }
    if (entry.aliases.includes(positionals.join(' ')) || entry.aliases.includes(positionals[0] ?? '')) {
        if (entry.aliases.includes(positionals[0] ?? '') && positionals[0]?.includes(' ') !== true) {
            const alias = entry.aliases.find((item) => item === positionals[0]);
            if (alias && !alias.includes(' ')) return positionals.slice(1);
        }
        const full = entry.aliases.find((alias) => alias === positionals.join(' '));
        if (full) return [];
        const prefix = entry.aliases.find((alias) => positionals.join(' ').startsWith(alias + ' ') || positionals.join(' ') === alias);
        if (prefix) return positionals.slice(prefix.split(' ').length);
    }
    return positionals.slice(entry.command?.split(' ').length ?? 1);
}

export function helpText(resource?: string, verb?: string): string {
    const entries = catalogEntries().filter((entry) => entry.command);
    if (!resource) {
        const resources = [...new Set(entries.map((entry) => entry.command!.split(' ')[0]!))].sort();
        return [
            'ascli <resource> <verb> [id] [flags]',
            'ascli tools --json',
            'ascli auth check',
            'ascli smoke --output <path>',
            '',
            'Resources:',
            ...resources.map((name) => `  ${name}`),
            '',
            'Global flags: --format json|ndjson|table --fields a,b.c --limit N --all --yes --verbose --help',
            'Writes default to dry-run. --yes executes. High-risk also needs --confirm <app-id>.',
        ].join('\n');
    }

    const matches = entries.filter((entry) => entry.command!.split(' ')[0] === resource);
    if (matches.length === 0) return `未知 resource: ${resource}`;
    if (!verb) {
        return [
            `ascli ${resource} <verb>`,
            '',
            ...matches.map((entry) => `  ${entry.command}  ${entry.tool.description}`),
        ].join('\n');
    }

    const entry = matches.find((item) => item.command === `${resource} ${verb}`);
    if (!entry) return `未知命令: ${resource} ${verb}`;
    const schema = asParser(entry.tool.inputSchema);
    const shape = objectShape(entry.tool.inputSchema);
    const lines = [
        `ascli ${entry.command}${entry.meta.idParam ? ' <id>' : ''}`,
        entry.tool.description,
        '',
        `kind: ${entry.meta.kind}  risk: ${entry.meta.risk}`,
        entry.meta.kind === 'write' ? '默认 dry-run；真正执行加 --yes。' : '',
        entry.meta.risk === 'high' ? '高风险：--yes 之外还要 --confirm <app-id>，并与 --app 一致。' : '',
        '参数:',
    ];
    if (shape) {
        for (const [key, field] of Object.entries(shape)) {
            const description = typeof (field as { description?: string }).description === 'string'
                ? (field as { description: string }).description
                : fieldDescription(field);
            const required = isRequired(field) ? '必填' : '可选';
            const positional = entry.meta.idParam === key ? '（位置参数）' : '';
            lines.push(`  --${camelToKebab(key)}  ${required}${positional}  ${description}`.trimEnd());
        }
    } else {
        lines.push('  （见 tools --json 的 params）');
    }
    if (entry.aliases.length) lines.push('', `别名: ${entry.aliases.join(', ')}`);
    void schema;
    return lines.filter((line) => line !== '').join('\n');
}

export function asParser(schema: unknown): z.ZodType {
    if (schema && typeof (schema as { safeParse?: unknown }).safeParse === 'function') return schema as z.ZodType;
    return z.object((schema ?? {}) as z.ZodRawShape);
}

export function objectShape(schema: unknown): Record<string, z.ZodType> | undefined {
    const seen = new Set<unknown>();
    let current: unknown = schema;
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        const shape = (current as { shape?: unknown }).shape;
        if (shape && typeof shape === 'object') return shape as Record<string, z.ZodType>;
        const record = current as { def?: { schema?: unknown; innerType?: unknown }; _def?: { schema?: unknown; innerType?: unknown } };
        current = record.def?.schema || record.def?.innerType || record._def?.schema || record._def?.innerType;
    }
    if (schema && typeof schema === 'object' && typeof (schema as { safeParse?: unknown }).safeParse !== 'function') {
        return schema as Record<string, z.ZodType>;
    }
    return undefined;
}

function schemaToJson(schema: unknown): unknown {
    try {
        return toJSONSchema(asParser(schema) as never);
    } catch {
        return { type: 'object' };
    }
}

function isRequired(field: z.ZodType): boolean {
    return !field.safeParse(undefined).success;
}

function fieldDescription(field: unknown): string {
    const def = (field as { description?: string; def?: { description?: string } }).description
        ?? (field as { def?: { description?: string } }).def?.description;
    return def ?? '';
}

function camelToKebab(value: string): string {
    return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
