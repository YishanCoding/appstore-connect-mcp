/**
 * Keywords guard for version-localization writes.
 *
 * Why: callers that only mean to change whatsNew/description often "read-modify-write" —
 * list the localization, edit one field, and send the whole record back. A stale snapshot
 * then silently overwrites the live keywords (JuJuBit 1.2.0 / 1.4.0). The CLI now refuses
 * any update that carries a keywords field unless --allow-keywords is passed.
 */
export const KEYWORD_GUARD_TOOLS = new Set([
    'appstore_update_version_localization',
    'appstore_batch_update_version_localizations',
]);

/** Localization ids whose keywords this request would write. Empty when none. */
export function keywordTargets(toolName: string, input: Record<string, any>): string[] {
    if (toolName === 'appstore_update_version_localization') {
        return input.keywords !== undefined ? [String(input.localizationId ?? '?')] : [];
    }
    if (toolName === 'appstore_batch_update_version_localizations') {
        const updates = Array.isArray(input.updates) ? input.updates : [];
        return updates
            .filter((update: any) => update && typeof update === 'object' && update.keywords !== undefined)
            .map((update: any) => String(update.localizationId ?? '?'));
    }
    return [];
}
