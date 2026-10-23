import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HttpCall, HttpResult } from '../programs/api-client/policy.js';
import { runCli } from './run.js';
import { bindConfirm } from './safety.js';
import { matchSpec, specViolation, startUploadSink } from './test-support/apple-spec-mock.js';

const env = { APP_STORE_CONNECT_KEY_ID: 'TEST', APP_STORE_CONNECT_PRIVATE_KEY: 'local-test-material' };
const file = join(mkdtempSync(join(tmpdir(), 'creative-')), 'image.png');
writeFileSync(file, 'image-bytes');
const target = ['--app-store-version-localization-id', 'LOC'];
const creativeTypes = ['PRODUCT_PAGE_HEADER_ASSET', 'APP_STORE_SEARCH_RESULTS_ASSET', 'EVENT_CARD_ASSET', 'EVENT_DETAILS_PAGE_ASSET'];
const reference = { placementProfileGroups: [{ placementProfileGroupId: 'DEFAULT_PROFILE' }],
    placementTypes: creativeTypes.map((placementTypeId) => ({ placementTypeId, acceptsAssetCategories: ['CREATIVE_ASSETS'],
        specMappings: [{ placementGroupId: 'DEFAULT_PROFILE', specs: ['valid-spec'] }] })),
    imageSpecs: [{ specId: 'valid-spec', dimensions: { width: 5244, height: 2950 } }] };
const ok = (data: unknown, status = 200): HttpResult => ({ status, headers: {}, data: { data } });
const failure = (): HttpResult => ({ status: 409, headers: {}, data: { errors: [{ status: '409', code: 'STATE_ERROR', detail: 'placement failed' }] } });

function creativeMock(sink: string, options: { previous?: boolean; spec?: string; failPlacement?: boolean; sharedImage?: boolean } = {}) {
    const calls: HttpCall[] = [];
    const transport = { async send(call: HttpCall): Promise<HttpResult> {
        calls.push(call);
        const invalid = specViolation(call);
        if (invalid) return invalid;
        if (call.url === '/appStoreVersionLocalizations/LOC') return ok({ id: 'LOC', relationships: { appStoreVersion: { data: { id: 'V' } } } });
        if (call.url === '/appStoreVersions/V') return ok({ id: 'V', relationships: { app: { data: { id: 'APP' } } } });
        if (call.url === '/apps/APP/assetLibrary') return ok({ id: 'LIB' });
        if (call.url === '/appAssetLibraryRefData') return ok([{ id: 'ref', attributes: reference }]);
        if (call.url === '/appStoreVersionLocalizations/LOC/placements') return ok(options.previous ? [{
            id: 'OLD', attributes: { placementType: 'PRODUCT_PAGE_HEADER_ASSET', state: 'ACTIVE' },
            relationships: { image: { data: { id: 'OLD-IMAGE' } } },
        }] : []);
        if (call.url === '/appAssetLibraryImages' && call.method === 'POST') return ok({ id: 'NEW', attributes: {
            uploadOperations: [{ method: 'PUT', url: `${sink}/upload` }],
        } }, 201);
        if (call.url === '/appAssetLibraryImages/NEW' && call.method === 'PATCH') return ok({ id: 'NEW' });
        if (call.url === '/appAssetLibraryImages/NEW' && call.method === 'GET') return ok({ id: 'NEW', attributes: {
            state: 'PREPARE_FOR_SUBMISSION', specId: options.spec ?? 'valid-spec', category: 'CREATIVE_ASSETS',
        } });
        if (call.url === '/appAssetLibraryImages/OLD-IMAGE' && call.method === 'GET') return ok({ id: 'OLD-IMAGE', attributes: {
            category: 'CREATIVE_ASSETS', specId: 'valid-spec', imageAsset: { width: 5244, height: 2950 },
        } });
        if (call.url === '/appAssetLibraryImages/OLD-IMAGE/placements') return ok(options.sharedImage ? [{ id: 'ANOTHER' }] : []);
        if (call.url === '/appAssetLibraryPlacements' && call.method === 'POST') return options.failPlacement ? failure() : ok({ id: 'CREATED' }, 201);
        if (call.method === 'DELETE') return { status: 204, headers: {}, data: undefined };
        throw new Error(`unexpected ${call.method} ${call.url}`);
    } };
    return { calls, transport };
}

describe('creative-asset CLI', () => {
    test('dry-run shows preflight, upload, rollback and replacement bodies with OpenAPI paths', async () => {
        const result = await runCli(['creative-asset', 'set', '--type', 'header', '--file', file, ...target,
            '--replace-existing', '--delete-old-image'], { env, transport: { async send() { throw new Error('network request'); } } });
        expect(result.code).toBe(0);
        expect(result.calls).toEqual([]);
        const plan = JSON.parse(result.stdout);
        expect(plan.confirm_reads[0].path).toBe('/appStoreVersionLocalizations/LOC');
        expect(plan.steps.map((step: { method: string }) => step.method)).toContain('DELETE');
        expect(plan.steps.find((step: { path: string; method: string }) => step.path === '/appAssetLibraryPlacements' && step.method === 'POST')
            .body.data.relationships.appStoreVersionLocalization.data.id).toBe('LOC');
        expect(plan.steps.find((step: { path: string; method: string }) => step.path === '/appAssetLibraryImages' && step.method === 'POST')
            .body.data.attributes.category).toBe('CREATIVE_ASSETS');
        for (const step of plan.steps) {
            if (step.path.startsWith('{uploadOperations')) continue;
            expect(matchSpec(step.path.replace(/\{[^/}]+\}/g, 'example'))).toBeTruthy();
        }
        const invalid = await runCli(['creative-asset', 'set', '--type', 'event-card', '--file', file, ...target], { env });
        expect(invalid.code).toBe(2);
        expect(invalid.calls).toEqual([]);
    });

    test('new set and list expose image and placement details', async () => {
        const sink = await startUploadSink();
        try {
            const mock = creativeMock(sink.url, { previous: false });
            const set = await runCli(['creative-asset', 'set', '--type', 'header', '--file', file, ...target, '--yes'], { env, transport: mock.transport });
            expect(set.code).toBe(0);
            expect(JSON.parse(set.stdout)).toEqual({ imageId: 'NEW', placementId: 'CREATED' });
            expect(mock.calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual(['/appAssetLibraryImages', '/appAssetLibraryPlacements']);
            const listMock = creativeMock(sink.url, { previous: true });
            const list = await runCli(['creative-asset', 'list', ...target], { env, transport: listMock.transport });
            expect(list.code).toBe(0);
            expect(JSON.parse(list.stdout)[0]).toMatchObject({ placementId: 'OLD', imageId: 'OLD-IMAGE', specId: 'valid-spec', width: 5244, height: 2950 });
        } finally { await sink.stop(); }
    });

    test('existing placement rejects before upload; replacement deletes placement before creating the new one', async () => {
        const sink = await startUploadSink();
        try {
            const blocked = creativeMock(sink.url, { previous: true });
            const noReplace = await runCli(['creative-asset', 'set', '--type', 'header', '--file', file, ...target, '--yes'], { env, transport: blocked.transport });
            expect(noReplace.code).toBe(2);
            expect(noReplace.stderr).toContain('OLD');
            expect(blocked.calls.every((call) => call.method === 'GET')).toBe(true);
            const mock = creativeMock(sink.url, { previous: true });
            const result = await runCli(['creative-asset', 'set', '--type', 'header', '--file', file, ...target,
                '--replace-existing', '--yes', '--confirm', 'APP'], { env, transport: mock.transport });
            expect(result.code).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({ replacedPlacementId: 'OLD', placementId: 'CREATED' });
            const calls = mock.calls.map((call) => `${call.method} ${call.url}`);
            expect(calls.indexOf('DELETE /appAssetLibraryPlacements/OLD')).toBeLessThan(calls.indexOf('POST /appAssetLibraryPlacements'));
        } finally { await sink.stop(); }
    });

    test('invalid spec and placement failure roll back the newly uploaded image', async () => {
        const sink = await startUploadSink();
        try {
            for (const options of [{ spec: 'wrong-spec' }, { failPlacement: true }]) {
                const mock = creativeMock(sink.url, options);
                const result = await runCli(['creative-asset', 'set', '--type', 'header', '--file', file, ...target, '--yes'], { env, transport: mock.transport });
                expect(result.code).not.toBe(0);
                expect(mock.calls.some((call) => call.method === 'DELETE' && call.url === '/appAssetLibraryImages/NEW')).toBe(true);
                if (options.spec) expect(result.stderr).toContain('valid-spec');
            }
        } finally { await sink.stop(); }
    });

    test('remove deletes placement then optionally image', async () => {
        const mock = creativeMock('http://127.0.0.1:1', { previous: true });
        const result = await runCli(['creative-asset', 'remove', '--type', 'header', ...target,
            '--delete-image', '--yes', '--confirm', 'APP'], { env, transport: mock.transport });
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).deletedImageId).toBe('OLD-IMAGE');
        expect(mock.calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
            '/appAssetLibraryPlacements/OLD', '/appAssetLibraryImages/OLD-IMAGE',
        ]);
        const shared = creativeMock('http://127.0.0.1:1', { previous: true, sharedImage: true });
        const denied = await runCli(['creative-asset', 'remove', '--type', 'header', ...target,
            '--delete-image', '--yes', '--confirm', 'APP'], { env, transport: shared.transport });
        expect(denied.code).toBe(2);
        expect(shared.calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test('event and both experiment chains resolve app ownership before upload', async () => {
        const sink = await startUploadSink();
        try {
            for (const kind of ['event', 'experiment', 'experiment-v2']) {
                const base = creativeMock(sink.url);
                const calls: HttpCall[] = [];
                const transport = { async send(call: HttpCall): Promise<HttpResult> {
                    calls.push(call);
                    const invalid = specViolation(call);
                    if (invalid) return invalid;
                    if (call.url === '/appEventLocalizations/LOC') return ok({ relationships: { appEvent: { data: { id: 'EVENT' } } } });
                    if (call.url === '/apps') return ok([{ id: 'APP' }]);
                    if (call.url === '/apps/APP/appEvents') return ok([{ id: 'EVENT' }]);
                    if (call.url === '/appStoreVersionExperimentTreatmentLocalizations/LOC') return ok({ relationships: {
                        appStoreVersionExperimentTreatment: { data: { id: 'TREATMENT' } },
                    } });
                    if (call.url === '/appStoreVersionExperimentTreatments/TREATMENT') return ok({ relationships: {
                        [kind === 'experiment-v2' ? 'appStoreVersionExperimentV2' : 'appStoreVersionExperiment']: { data: { id: 'EXPERIMENT' } },
                    } });
                    if (call.url === '/appStoreVersionExperiments/EXPERIMENT') return ok({ relationships: {
                        appStoreVersion: { data: { id: 'V' } },
                    } });
                    if (call.url === '/apps/APP/appStoreVersionExperimentsV2') return ok([{ id: 'EXPERIMENT' }]);
                    if (call.url === '/appEventLocalizations/LOC/placements' ||
                        call.url === '/appStoreVersionExperimentTreatmentLocalizations/LOC/placements') return ok([]);
                    return base.transport.send(call);
                } };
                const flag = kind === 'event' ? '--app-event-localization-id' : '--app-store-version-experiment-treatment-localization-id';
                const type = kind === 'event' ? 'event-card' : 'header';
                const result = await runCli(['creative-asset', 'set', '--type', type, '--file', file, flag, 'LOC', '--yes'], { env, transport });
                expect(result.code).toBe(0);
                expect(calls.some((call) => call.method === 'POST' && call.url === '/appAssetLibraryImages')).toBe(true);
            }
        } finally { await sink.stop(); }
    });
});

describe('creative target ownership', () => {
    const rel = (name: string, value: string) => ({ data: { relationships: { [name]: { data: { id: value } } } } });
    const cases: { args: Record<string, string>; responses: Record<string, unknown>; lists?: Record<string, unknown[]> }[] = [
        { args: { appStoreVersionLocalizationId: 'LOC' }, responses: {
            '/appStoreVersionLocalizations/LOC': rel('appStoreVersion', 'V'), '/appStoreVersions/V': rel('app', 'APP') } },
        { args: { appCustomProductPageLocalizationId: 'CPPLOC' }, responses: {
            '/appCustomProductPageLocalizations/CPPLOC': rel('appCustomProductPageVersion', 'CV'),
            '/appCustomProductPageVersions/CV': rel('appCustomProductPage', 'CPP'), '/appCustomProductPages/CPP': rel('app', 'APP') } },
        { args: { appEventLocalizationId: 'EVENTLOC' }, responses: {
            '/appEventLocalizations/EVENTLOC': rel('appEvent', 'EVENT') }, lists: { '/apps/APP/appEvents': [{ id: 'EVENT' }] } },
        { args: { appStoreVersionExperimentTreatmentLocalizationId: 'TLOC' }, responses: {
            '/appStoreVersionExperimentTreatmentLocalizations/TLOC': rel('appStoreVersionExperimentTreatment', 'TREATMENT'),
            '/appStoreVersionExperimentTreatments/TREATMENT': rel('appStoreVersionExperiment', 'EXPERIMENT'),
            '/appStoreVersionExperiments/EXPERIMENT': rel('appStoreVersion', 'V'), '/appStoreVersions/V': rel('app', 'APP') } },
    ];
    test('all four chains bind --confirm to the actual app', async () => {
        for (const item of cases) {
            const reader = { get: async (path: string) => {
                expect(matchSpec(path)).toBeTruthy();
                return item.responses[path];
            }, getAll: async (path: string) => item.lists?.[path] ?? [] };
            expect(await bindConfirm('appstore_remove_creative_asset', item.args, 'APP', reader)).toEqual({ ok: true });
            expect((await bindConfirm('appstore_remove_creative_asset', item.args, 'OTHER', reader)).ok).toBe(false);
        }
    });

    test('V2 treatment chain binds through the confirmed app experiment list', async () => {
        const args = { appStoreVersionExperimentTreatmentLocalizationId: 'TLOC' };
        const reader = { get: async (path: string) => {
            if (path === '/appStoreVersionExperimentTreatmentLocalizations/TLOC') return rel('appStoreVersionExperimentTreatment', 'TREATMENT');
            if (path === '/appStoreVersionExperimentTreatments/TREATMENT') return rel('appStoreVersionExperimentV2', 'V2');
            throw new Error(`unexpected ${path}`);
        }, getAll: async (path: string) => path === '/apps/APP/appStoreVersionExperimentsV2' ? [{ id: 'V2' }] : [] };
        expect(await bindConfirm('appstore_remove_creative_asset', args, 'APP', reader)).toEqual({ ok: true });
        expect((await bindConfirm('appstore_remove_creative_asset', args, 'OTHER', reader)).ok).toBe(false);
    });

    test('all four targets render the matching placement relationship', async () => {
        for (const [flag, key, type] of [
            ['--app-store-version-localization-id', 'appStoreVersionLocalization', 'header'],
            ['--app-custom-product-page-localization-id', 'appCustomProductPageLocalization', 'search'],
            ['--app-event-localization-id', 'appEventLocalization', 'event-card'],
            ['--app-store-version-experiment-treatment-localization-id', 'appStoreVersionExperimentTreatmentLocalization', 'header'],
        ] as [string, string, string][]) {
            const result = await runCli(['creative-asset', 'set', '--type', type, '--file', file, flag, 'LOC'], { env });
            expect(result.code).toBe(0);
            const plan = JSON.parse(result.stdout);
            expect(plan.steps.find((step: { path: string }) => step.path === '/appAssetLibraryPlacements')
                .body.data.relationships[key].data.id).toBe('LOC');
        }
    });
});
