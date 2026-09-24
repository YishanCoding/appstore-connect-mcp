export interface SafetyInput {
    kind: 'read' | 'write';
    risk: 'normal' | 'high';
    yes: boolean;
    confirm?: string;
    /** App id declared by --app or an appId field. Both must already agree. */
    appId?: string;
}

export type SafetyDecision =
    | { action: 'run' }
    | { action: 'dry-run' }
    | { action: 'reject'; message: string };

/**
 * Writes default to dry-run. --yes executes.
 * High-risk also needs --confirm equal to the declared app id, decided locally so a mismatch sends nothing.
 */
export function decideSafety(input: SafetyInput): SafetyDecision {
    if (input.kind !== 'write') return { action: 'run' };
    if (!input.yes) return { action: 'dry-run' };
    if (input.risk === 'high') {
        if (!input.confirm) {
            return { action: 'reject', message: '高风险命令需要 --confirm <app-id>' };
        }
        if (!input.appId) {
            return { action: 'reject', message: '高风险命令需要 --app <app-id>，且必须与 --confirm 一致' };
        }
        if (input.confirm !== input.appId) {
            return { action: 'reject', message: '--confirm 与目标 app-id 不一致' };
        }
    }
    return { action: 'run' };
}

const APP_KEYS = ['appId', 'app_id', 'adamId'];

export function extractAppId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    for (const key of APP_KEYS) {
        const found = record[key];
        if (typeof found === 'string' && found) return found;
    }
    const data = record.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const relationships = (data as Record<string, unknown>).relationships;
        const app = relationships && typeof relationships === 'object'
            ? (relationships as Record<string, unknown>).app
            : undefined;
        const id = app && typeof app === 'object'
            ? ((app as Record<string, unknown>).data as Record<string, unknown> | undefined)?.id
            : undefined;
        if (typeof id === 'string' && id) return id;
    }
    return undefined;
}
