export function projectFields(data: unknown, fields: string[] | undefined): unknown {
    if (!fields || fields.length === 0) return data;
    if (Array.isArray(data)) return data.map((item) => projectFields(item, fields));
    if (!data || typeof data !== 'object') return data;
    const source = data as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of fields) {
        const value = getPath(source, field);
        if (value !== undefined) setPath(out, field, value);
    }
    return out;
}

export function applyLimit(data: unknown, limit: number | undefined): unknown {
    if (limit == null || !Number.isFinite(limit)) return data;
    if (Array.isArray(data)) return data.slice(0, limit);
    if (data && typeof data === 'object') {
        const entries = Object.entries(data as Record<string, unknown>).filter(([, value]) => Array.isArray(value));
        if (entries.length === 1) {
            const [key, value] = entries[0]!;
            return { ...(data as Record<string, unknown>), [key]: (value as unknown[]).slice(0, limit) };
        }
    }
    return data;
}

export function formatData(data: unknown, format: 'json' | 'ndjson' | 'table'): string {
    if (format === 'ndjson') {
        const rows = Array.isArray(data) ? data : [data];
        return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    }
    if (format === 'table') return toTable(data);
    return JSON.stringify(data, null, 2) + '\n';
}

export class CliUsage extends Error {}

export function usageError(message: string): string {
    return JSON.stringify({ error: { type: 'usage', message } }) + '\n';
}

export function authError(message: string): string {
    return JSON.stringify({ error: { type: 'auth', message } }) + '\n';
}

export function apiError(status: number, code: string, detail: string): string {
    return JSON.stringify({ error: { type: 'api', status, code, detail } }) + '\n';
}

export function redact(text: string, secrets: string[]): string {
    let out = text.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]');
    out = out.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
    for (const secret of secrets) {
        if (secret && secret.length >= 8) out = out.split(secret).join('[REDACTED]');
    }
    return out;
}

function getPath(source: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.').filter(Boolean);
    let current: unknown = source;
    for (const part of parts) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.').filter(Boolean);
    let current = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        const next = current[part];
        if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {};
        current = current[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (leaf) current[leaf] = value;
}

function toTable(data: unknown): string {
    const rows = (Array.isArray(data) ? data : [data]).filter(
        (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)
    );
    if (rows.length === 0) return JSON.stringify(data) + '\n';
    const cols = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const lines = [
        cols.join('\t'),
        ...rows.map((row) => cols.map((col) => stringifyCell(row[col])).join('\t')),
    ];
    return lines.join('\n') + '\n';
}

function stringifyCell(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value.replace(/\t|\n/g, ' ');
    return JSON.stringify(value);
}
