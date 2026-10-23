import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HttpCall, HttpResult } from '../programs/api-client/policy.js';
import { runCli } from './run.js';
import { matchSpec, specViolation, startUploadSink } from './test-support/apple-spec-mock.js';

const env = { APP_STORE_CONNECT_KEY_ID: 'TEST', APP_STORE_CONNECT_PRIVATE_KEY: 'local-test-material' };
const group = 'IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE';
const reference = { placementProfileGroups: [{ placementProfileGroupId: group }], placementTypes: [{
    placementTypeId: 'APP_SCREENSHOT', acceptsAssetCategories: ['APP_SCREENSHOTS_AND_PREVIEWS'],
    specMappings: [{ placementGroupId: group, specs: ['spec-1'] }],
}], imageSpecs: [{ specId: 'spec-1', dimensions: { minWidth: 1290, minHeight: 2796 } }],
features: [{ featureId: 'APP_STORE_VERSIONS', placementPolicies: [{ placementType: 'APP_SCREENSHOT', groupLimits: [{ groupIds: [group], maxCount: 10 }] }] },
    { featureId: 'CUSTOM_PRODUCT_PAGES', placementPolicies: [{ placementType: 'APP_SCREENSHOT', groupLimits: [{ groupIds: [group], maxCount: 10 }] }] }] };

function ok(data: unknown, status = 200): HttpResult { return { status, headers: {}, data: { data } }; }

describe('App Asset Library 4.5.1', () => {
    test('CPP create rolls back the CPP and uploaded images when placement fails', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cpp-rollback-'));
        const file = join(dir, 'hero.png');
        const extra = join(dir, 'extra.png');
        writeFileSync(file, 'image');
        writeFileSync(extra, 'image-2');
        let image = 0;
        const sink = await startUploadSink();
        const calls: HttpCall[] = [];
        const transport = { async send(call: HttpCall): Promise<HttpResult> {
            calls.push(call);
            if (call.url === '/appAssetLibraryRefData') return ok([{ id: 'ref', attributes: reference }]);
            if (call.url === '/apps/APP/assetLibrary') return ok({ id: 'LIB' });
            if (call.url === '/apps/APP') return ok({ id: 'APP', attributes: { primaryLocale: 'zh-Hans' } });
            if (call.url === '/appCustomProductPages') return { status: 201, headers: {}, data: { data: { id: 'CPP' }, included: [{ type: 'appCustomProductPageLocalizations', id: 'LOC' }] } };
            if (call.url === '/appAssetLibraryImages' && call.method === 'POST') return ok({ id: `IMAGE-${++image}`, attributes: { uploadOperations: [{ method: 'PUT', url: `${sink.url}/${image}` }] } }, 201);
            if (/^\/appAssetLibraryImages\/IMAGE-\d$/.test(call.url) && call.method === 'PATCH') return ok({ id: call.url.split('/').at(-1) });
            if (/^\/appAssetLibraryImages\/IMAGE-\d$/.test(call.url) && call.method === 'GET') return ok({ id: call.url.split('/').at(-1), attributes: { state: 'PREPARE_FOR_SUBMISSION', specId: 'spec-1' } });
            if (call.url === '/appAssetLibraryPlacements') return { status: 500, headers: {}, data: { errors: [{ status: '500', code: 'BOOM', title: 'boom' }] } };
            if (call.url === '/appCustomProductPages/CPP/appCustomProductPageVersions') return ok([]);
            if (call.method === 'DELETE') return { status: 204, headers: {}, data: undefined };
            throw new Error(`unexpected ${call.method} ${call.url}`);
        } };
        try {
            const result = await runCli(['cpp', 'create', '--app-id', 'APP', '--name', 'Hero', '--promotional-text', 'hi',
                '--cpp-image-path', file, '--template-shot-paths', JSON.stringify([extra]), '--placement-group', group, '--yes'], { env, transport });
            expect(result.code).not.toBe(0);
            expect(result.stderr).toContain('已回滚');
            const deletes = calls.filter((call) => call.method === 'DELETE').map((call) => call.url);
            expect(deletes).toContain('/appCustomProductPages/CPP');
            expect(deletes).toContain('/appAssetLibraryImages/IMAGE-1');
            expect(deletes).toContain('/appAssetLibraryImages/IMAGE-2');
        } finally { await sink.stop(); }
    });

    test('CPP create preflights reference data, then uploads, places and orders screenshots', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cpp-library-'));
        const files = [join(dir, 'hero.png'), join(dir, 'extra.png')];
        files.forEach((file, index) => writeFileSync(file, `image-${index}`));
        const command = ['cpp', 'create', '--app-id', 'APP', '--name', 'Hero', '--promotional-text', 'hello',
            '--cpp-image-path', files[0]!, '--template-shot-paths', JSON.stringify([files[1]]), '--placement-group', group];
        const dry = await runCli(command, { env, transport: { async send() { throw new Error('dry-run sent a request'); } } });
        expect(dry.code).toBe(0);
        expect(dry.calls).toEqual([]);
        const plan = JSON.parse(dry.stdout);
        expect(plan.steps.map((step: any) => step.path)).not.toContain('/appScreenshotSets');
        expect(plan.steps.map((step: any) => step.path)).toContain('/appAssetLibraryPlacementOrderingRequests');
        const defaultPlan = JSON.parse((await runCli(command.slice(0, -2), { env })).stdout);
        expect(defaultPlan.steps.find((step: any) => step.path === '/appAssetLibraryPlacements').body.data.attributes.placementGroup).toBe('IPHONE_FACE_ID_LARGE_PROFILE');
        for (const step of plan.steps) {
            if (step.path.startsWith('{uploadOperations')) continue;
            expect(matchSpec(step.path.replace(/\{[^/}]+\}/g, 'example'))).toBeTruthy();
        }

        const sink = await startUploadSink();
        const calls: HttpCall[] = [];
        let image = 0;
        let placement = 0;
        const transport = { async send(call: HttpCall): Promise<HttpResult> {
            calls.push(call);
            const invalid = specViolation(call);
            if (invalid) return invalid;
            if (call.url === '/appAssetLibraryRefData') return ok([{ id: 'ref', attributes: reference }]);
            if (call.url === '/apps/APP/assetLibrary') return ok({ id: 'LIB' });
            if (call.url === '/apps/APP') return ok({ id: 'APP', attributes: { primaryLocale: 'zh-Hans' } });
            if (call.url === '/appCustomProductPages') return { status: 201, headers: {}, data: { data: { id: 'CPP' }, included: [{ type: 'appCustomProductPageLocalizations', id: 'LOC' }] } };
            if (call.url === '/appAssetLibraryImages' && call.method === 'POST') return ok({ id: `IMAGE-${++image}`, attributes: { uploadOperations: [{ method: 'PUT', url: `${sink.url}/${image}` }] } }, 201);
            if (/^\/appAssetLibraryImages\/IMAGE-\d+$/.test(call.url) && call.method === 'PATCH') return ok({ id: call.url.split('/').at(-1) });
            if (/^\/appAssetLibraryImages\/IMAGE-\d+$/.test(call.url) && call.method === 'GET') return ok({ id: call.url.split('/').at(-1), attributes: { state: 'PREPARE_FOR_SUBMISSION', specId: 'spec-1' } });
            if (call.url === '/appAssetLibraryPlacements') return ok({ id: `P-${++placement}` }, 201);
            if (call.url === '/appAssetLibraryPlacementOrderingRequests') return ok({ id: 'ORDER' }, 201);
            throw new Error(`unexpected ${call.method} ${call.url}`);
        } };
        try {
            const result = await runCli([...command, '--yes'], { env, transport });
            expect(result.code).toBe(0);
            const data = JSON.parse(result.stdout);
            expect(data.createdPlacementIds).toEqual(['P-1', 'P-2']);
            expect(data.uploaded.map((item: any) => item.id)).toEqual(['IMAGE-1', 'IMAGE-2']);
            expect(data.screenshotSetId).toBeUndefined();
            const created = calls.find((call) => call.url === '/appCustomProductPages')?.data as any;
            expect(created.included[1].attributes.locale).toBe('zh-Hans');
            expect(sink.puts.map((item) => item.body)).toEqual(['image-0', 'image-1']);
            expect(calls.findIndex((call) => call.url === '/appAssetLibraryRefData')).toBeLessThan(calls.findIndex((call) => call.url === '/appCustomProductPages'));
            const order = calls.find((call) => call.url === '/appAssetLibraryPlacementOrderingRequests')!;
            expect((order.data as any).data.relationships.orderedPlacements.data.map((item: any) => item.id)).toEqual(['P-1', 'P-2']);
        } finally { await sink.stop(); }

        const bad = await runCli([...command.slice(0, -2), '--placement-group', 'FOO', '--yes'], { env, transport });
        expect(bad.code).toBe(2);
        expect(bad.stderr).toContain(group);
        expect(bad.calls.some((call) => call.method === 'POST')).toBe(false);
        const limited = await runCli([...command, '--yes'], { env, transport: { async send(call) {
            if (call.url === '/appAssetLibraryRefData') return ok([{ id: 'ref', attributes: {
                ...reference, features: [{ featureId: 'CUSTOM_PRODUCT_PAGES', placementPolicies: [
                    { placementType: 'APP_SCREENSHOT', groupLimits: [{ groupIds: [group], maxCount: 1 }] },
                ] }],
            } }]);
            throw new Error(`preflight should not call ${call.method} ${call.url}`);
        } } });
        expect(limited.code).toBe(2);
        expect(limited.stderr).toContain('最多 1 张');
        expect(limited.calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test('CPP screenshot upload targets its localization and binds ownership before replacement', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'cpp-append-')), 'shot.png');
        writeFileSync(file, 'shot');
        const dry = await runCli(['screenshot', 'upload', '--app-custom-product-page-localization-id', 'LOC',
            '--placement-group', group, '--file', file, '--replace-existing', 'true'], { env });
        expect(dry.code).toBe(0);
        const plan = JSON.parse(dry.stdout);
        expect(plan.confirm_reads.map((step: any) => step.path)).toContain('/appCustomProductPageLocalizations/LOC');
        expect(plan.steps.find((step: any) => step.path === '/appAssetLibraryPlacements').body.data.relationships.appCustomProductPageLocalization.data.id).toBe('LOC');
        const calls: HttpCall[] = [];
        const result = await runCli(['screenshot', 'upload', '--app-custom-product-page-localization-id', 'LOC',
            '--placement-group', group, '--file', file, '--replace-existing', 'true', '--yes', '--confirm', 'OTHER'], {
            env, transport: { async send(call) {
                calls.push(call);
                if (call.url === '/appCustomProductPageLocalizations/LOC') return ok({ id: 'LOC', relationships: { appCustomProductPageVersion: { data: { id: 'V' } } } });
                if (call.url === '/appCustomProductPageVersions/V') return ok({ id: 'V', relationships: { appCustomProductPage: { data: { id: 'CPP' } } } });
                if (call.url === '/appCustomProductPages/CPP') return ok({ id: 'CPP', relationships: { app: { data: { id: 'APP' } } } });
                throw new Error(`unexpected ${call.method} ${call.url}`);
            } } });
        expect(result.code).toBe(2);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test('deprecated report permission is rejected before invite or role update', async () => {
        for (const command of [
            ['user', 'invite', '--email', 'a@example.com', '--first-name', 'A', '--last-name', 'B'],
            ['user', 'update-roles', 'USER'],
        ]) {
            const result = await runCli([...command, '--roles', '["ACCESS_TO_REPORTS"]', '--yes', '--confirm', 'a@example.com'], { env });
            expect(result.code).toBe(2);
            expect(result.stderr).toContain('ACCESS_TO_REPORTS 已被 Apple 弃用');
            expect(result.stderr).toContain('FINANCE');
            expect(result.stderr).toContain('SALES');
            expect(result.calls).toEqual([]);
        }
    });

    test('every new write dry-run uses OpenAPI paths and exact JSON:API bodies without network', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'asset-plan-')), 'shot.png');
        writeFileSync(file, 'png');
        const commands = [
            ['asset-library', 'upload-image', '--app-id', 'APP', '--file', file],
            ['placement', 'create', '--image-id', 'IMAGE', '--app-store-version-localization-id', 'LOC', '--placement-type', 'APP_SCREENSHOT', '--placement-group', group],
            ['placement', 'order', '--app-store-version-localization-id', 'LOC', '--placement-group', group, '--placement-ids', '["P1","P2"]'],
            ['placement', 'delete', 'P1'],
            ['asset-library', 'delete-image', 'IMAGE'],
            ['screenshot', 'upload', '--app-store-version-localization-id', 'LOC', '--placement-group', group, '--file', file],
        ];
        for (const command of commands) {
            const result = await runCli(command, { env, transport: { async send() { throw new Error('dry-run sent a request'); } } });
            expect(result.code).toBe(0);
            expect(result.calls).toEqual([]);
            const plan = JSON.parse(result.stdout);
            expect(plan.dry_run).toBe(true);
            for (const step of plan.steps) {
                if (step.path.startsWith('{uploadOperations')) continue;
                const path = step.path.replace(/\{[^/}]+\}/g, 'example');
                expect(matchSpec(path)).toBeTruthy();
                if (step.method === 'POST' || step.method === 'PATCH') {
                    expect(step.body.data.type).toBeTruthy();
                    expect(step.body.data.attributes).toBeTruthy();
                }
            }
        }
        const upload = JSON.parse((await runCli(commands[0]!, { env })).stdout);
        expect(upload.steps.find((s: any) => s.method === 'PATCH').body.data.attributes).toEqual({ uploaded: true });
        expect(upload.steps[1].body.data.relationships.assetLibrary.data.type).toBe('appAssetLibraries');
        const placement = JSON.parse((await runCli(commands[1]!, { env })).stdout);
        expect(placement.body.data.relationships.appStoreVersionLocalization.data.id).toBe('LOC');
        const order = JSON.parse((await runCli(commands[2]!, { env })).stdout);
        expect(order.body.data.relationships.orderedPlacements.data.map((p: any) => p.id)).toEqual(['P1', 'P2']);
        const replacing = await runCli([...commands[5]!, '--replace-existing', 'true'], { env });
        const replacePlan = JSON.parse(replacing.stdout);
        expect(replacePlan.confirm_reads.map((read: any) => read.path)).toContain('/appStoreVersionLocalizations/LOC');
        expect(replacePlan.steps.some((step: any) => step.method === 'DELETE' && step.path.startsWith('/appAssetLibraryPlacements/'))).toBe(true);
    });

    test('mock sink completes reserve, multipart upload, commit, place and order', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'asset-upload-')), 'shot.png');
        writeFileSync(file, 'abcdef');
        const sink = await startUploadSink();
        const calls: HttpCall[] = [];
        const transport = { async send(call: HttpCall): Promise<HttpResult> {
            calls.push(call);
            const invalid = specViolation(call);
            if (invalid) return invalid;
            if (call.url === '/appStoreVersionLocalizations/LOC') return ok({ id: 'LOC', relationships: { appStoreVersion: { data: { id: 'V' } } } });
            if (call.url === '/appStoreVersions/V') return ok({ id: 'V', relationships: { app: { data: { id: 'APP' } } } });
            if (call.url === '/apps/APP/assetLibrary') return ok({ id: 'APP', type: 'appAssetLibraries' });
            if (call.url === '/appAssetLibraryRefData') return ok([{ id: 'ref', attributes: reference }]);
            if (call.url === '/appStoreVersionLocalizations/LOC/placements') return ok([]);
            if (call.url === '/appAssetLibraryImages' && call.method === 'POST') return ok({ id: 'IMAGE', attributes: { uploadOperations: [
                { method: 'PUT', url: `${sink.url}/one`, offset: 0, length: 2 },
                { method: 'PUT', url: `${sink.url}/two`, offset: 2, length: 4 },
            ] } }, 201);
            if (call.url === '/appAssetLibraryImages/IMAGE' && call.method === 'GET') return ok({ id: 'IMAGE', attributes: { state: 'PREPARE_FOR_SUBMISSION', specId: 'spec-1', category: 'APP_SCREENSHOTS_AND_PREVIEWS' } });
            if (call.url === '/appAssetLibraryImages/IMAGE' && call.method === 'PATCH') return ok({ id: 'IMAGE' });
            if (call.url === '/appAssetLibraryPlacements') return ok({ id: 'PLACEMENT' }, 201);
            if (call.url === '/appAssetLibraryPlacementOrderingRequests') return ok({ id: 'ORDER' }, 201);
            throw new Error(`unexpected ${call.method} ${call.url}`);
        } };
        try {
            const result = await runCli(['screenshot', 'upload', '--app-store-version-localization-id', 'LOC', '--placement-group', group, '--file', file, '--yes'], { env, transport });
            expect(result.code).toBe(0);
            expect(sink.puts.map((p) => p.body)).toEqual(['ab', 'cdef']);
            expect(calls.map((c) => `${c.method} ${c.url}`).filter((x) => x.startsWith('POST') || x.startsWith('PATCH'))).toEqual([
                'POST /appAssetLibraryImages', 'PATCH /appAssetLibraryImages/IMAGE',
                'POST /appAssetLibraryPlacements', 'POST /appAssetLibraryPlacementOrderingRequests',
            ]);
            const commit = calls.find((c) => c.method === 'PATCH');
            expect((commit?.data as any).data.attributes).toEqual({ uploaded: true });
            const order = calls.find((c) => c.url === '/appAssetLibraryPlacementOrderingRequests');
            expect((order?.data as any).data.relationships.orderedPlacements.data[0].id).toBe('PLACEMENT');
        } finally { await sink.stop(); }
    });

    test('invalid group lists allowed values before any placement write', async () => {
        const calls: HttpCall[] = [];
        const transport = { async send(call: HttpCall): Promise<HttpResult> {
            calls.push(call);
            if (call.url === '/appStoreVersionLocalizations/LOC') return ok({ relationships: { appStoreVersion: { data: { id: 'V' } } } });
            if (call.url === '/appStoreVersions/V') return ok({ relationships: { app: { data: { id: 'APP' } } } });
            if (call.url === '/apps/APP/assetLibrary') return ok({ id: 'APP' });
            if (call.url === '/appAssetLibraries/APP/images') return ok([{ id: 'IMAGE' }]);
            if (call.url === '/appAssetLibraryImages/IMAGE') return ok({ attributes: { specId: 'spec-1', category: 'APP_SCREENSHOTS_AND_PREVIEWS' } });
            if (call.url === '/appAssetLibraryRefData') return ok([{ attributes: reference }]);
            throw new Error(`unexpected ${call.url}`);
        } };
        const result = await runCli(['placement', 'create', '--image-id', 'IMAGE', '--app-store-version-localization-id', 'LOC', '--placement-type', 'APP_SCREENSHOT', '--placement-group', 'INVALID', '--yes'], { env, transport });
        expect(result.code).toBe(2);
        expect(result.stderr).toContain(group);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test('read commands and CPP placement target use the 4.5.1 relationships', async () => {
        const calls: HttpCall[] = [];
        const transport = { async send(call: HttpCall): Promise<HttpResult> {
            calls.push(call);
            const invalid = specViolation(call);
            if (invalid) return invalid;
            if (call.url === '/apps/APP/assetLibrary') return ok({ type: 'appAssetLibraries', id: 'APP' });
            if (call.url === '/appAssetLibraries/APP/images') return ok([{ id: 'IMAGE', attributes: { state: 'APPROVED', specId: 'spec-1', fileName: 'shot.png', imageAsset: { width: 1290, height: 2796 } } }]);
            if (call.url === '/appAssetLibraryRefData') return ok([{ id: 'ref', attributes: reference }]);
            if (call.url === '/appCustomProductPageLocalizations/CPPLOC/placements') return ok([{ id: 'P1', attributes: { placementType: 'APP_SCREENSHOT', placementGroup: group }, relationships: { image: { data: { id: 'IMAGE' } } } }]);
            throw new Error(`unexpected ${call.url}`);
        } };
        const library = await runCli(['asset-library', 'get', '--app-id', 'APP'], { env, transport });
        const images = await runCli(['asset-library', 'images', '--app-id', 'APP'], { env, transport });
        const ref = await runCli(['asset-library', 'reference', '--app-id', 'APP'], { env, transport });
        const placements = await runCli(['placement', 'list', '--app-custom-product-page-localization-id', 'CPPLOC'], { env, transport });
        expect([library.code, images.code, ref.code, placements.code]).toEqual([0, 0, 0, 0]);
        expect(JSON.parse(images.stdout)[0]).toMatchObject({ id: 'IMAGE', state: 'APPROVED', specId: 'spec-1', width: 1290, height: 2796 });
        expect(JSON.parse(ref.stdout).placementProfileGroups[0].placementProfileGroupId).toBe(group);
        expect(JSON.parse(placements.stdout)[0].imageId).toBe('IMAGE');
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        const dry = await runCli(['placement', 'create', '--image-id', 'IMAGE', '--app-custom-product-page-localization-id', 'CPPLOC', '--placement-type', 'APP_SCREENSHOT', '--placement-group', group], { env });
        expect(JSON.parse(dry.stdout).body.data.relationships.appCustomProductPageLocalization.data.id).toBe('CPPLOC');
    });

    test('image deletion refuses remaining placements; high-risk order requires ownership confirmation', async () => {
        const calls: HttpCall[] = [];
        const transport = { async send(call: HttpCall): Promise<HttpResult> {
            calls.push(call);
            const invalid = specViolation(call);
            if (invalid) return invalid;
            if (call.url === '/apps/APP/assetLibrary') return ok({ id: 'APP' });
            if (call.url === '/appAssetLibraries/APP/images') return ok([{ id: 'IMAGE' }]);
            if (call.url === '/appAssetLibraryImages/IMAGE/placements') return ok([{ id: 'P1' }]);
            throw new Error(`unexpected ${call.url}`);
        } };
        const noConfirm = await runCli(['placement', 'order', '--app-store-version-localization-id', 'LOC', '--placement-group', group, '--placement-ids', '["P1"]', '--yes'], { env, transport });
        expect(noConfirm.code).toBe(2);
        expect(calls).toEqual([]);
        const deletion = await runCli(['asset-library', 'delete-image', 'IMAGE', '--yes', '--confirm', 'APP'], { env, transport });
        expect(deletion.code).toBe(2);
        expect(deletion.stderr).toContain('先用 placement delete');
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
});
