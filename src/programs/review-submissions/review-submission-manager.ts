export interface ReviewSubmissionPort {
    preview?: boolean;
    get<T = any>(path: string, params?: Record<string, unknown>): Promise<T>;
    getAllPages<T = any>(path: string, params?: Record<string, unknown>): Promise<T[]>;
    post<T = any>(path: string, body: unknown): Promise<T>;
    patch<T = any>(path: string, body: unknown): Promise<T>;
}

type Resource = { id: string; attributes?: Record<string, any>; relationships?: Record<string, { data?: any }> };
const enc = encodeURIComponent;
const activeStates = 'WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES';

export class ReviewSubmissionManager {
    constructor(private port: ReviewSubmissionPort) {}

    private async submissions(appId: string, state?: string, platform?: string): Promise<Resource[]> {
        const params: Record<string, unknown> = { 'filter[app]': appId, limit: 200 };
        if (state) params['filter[state]'] = state;
        if (platform) params['filter[platform]'] = platform;
        return this.port.getAllPages<Resource>('/reviewSubmissions', params);
    }

    private async items(id: string): Promise<Resource[]> {
        return this.port.getAllPages<Resource>(`/reviewSubmissions/${enc(id)}/items`, { include: 'appStoreVersion,appEvent', limit: 200 });
    }

    async list(appId: string) {
        const rows = await this.submissions(appId);
        return Promise.all(rows.map(async (row) => ({
            id: row.id,
            state: row.attributes?.state,
            platform: row.attributes?.platform,
            submittedDate: row.attributes?.submittedDate,
            items: (await this.items(row.id)).map((item) => ({
                id: item.id,
                state: item.attributes?.state,
                appStoreVersionId: item.relationships?.appStoreVersion?.data?.id,
                appEventId: item.relationships?.appEvent?.data?.id,
            })),
        })));
    }

    private async target(kind: 'appStoreVersion' | 'appEvent', targetId: string, appId?: string) {
        if (kind === 'appStoreVersion') {
            const response = await this.port.get<{ data: Resource }>(`/appStoreVersions/${enc(targetId)}`, { include: 'app' });
            const owned = response.data.relationships?.app?.data?.id;
            if (!owned || (appId && appId !== owned)) throw new Error(`版本 ${targetId} 不属于 app ${appId ?? '(unknown)'}`);
            return { appId: owned as string, platform: response.data.attributes?.platform as string | undefined };
        }
        if (!appId) throw new Error('活动提交需要 --app-id <app-id>');
        const events = await this.port.getAllPages<Resource>(`/apps/${enc(appId)}/appEvents`, { limit: 200 });
        if (!events.some((event) => event.id === targetId)) throw new Error(`活动 ${targetId} 不属于 app ${appId}`);
        return { appId, platform: undefined };
    }

    async submit(kind: 'appStoreVersion' | 'appEvent', targetId: string, appId?: string) {
        const target = await this.target(kind, targetId, appId);
        const ready = await this.submissions(target.appId, 'READY_FOR_REVIEW', target.platform);
        if (ready.length > 1) throw new Error(`多个可复用 reviewSubmission：${ready.map((row) => row.id).join(', ')}`);
        let submissionId = ready[0]?.id;
        if (!submissionId) {
            const created = await this.port.post<{ data?: Resource }>('/reviewSubmissions', {
                data: { type: 'reviewSubmissions',
                    ...(target.platform ? { attributes: { platform: target.platform } } : {}),
                    relationships: { app: { data: { type: 'apps', id: target.appId } } } },
            });
            submissionId = created?.data?.id;
            if (!submissionId) {
                if (!this.port.preview) throw new Error('创建 reviewSubmission 未返回 id，已停止后续写入');
                submissionId = '{created-reviewSubmission.id}';
            }
        }
        const existing = ready[0] ? await this.items(submissionId) : [];
        if (!existing.some((item) => item.relationships?.[kind]?.data?.id === targetId)) {
            await this.port.post('/reviewSubmissionItems', {
                data: { type: 'reviewSubmissionItems', relationships: {
                    reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
                    [kind]: { data: { type: kind === 'appEvent' ? 'appEvents' : 'appStoreVersions', id: targetId } },
                } },
            });
        }
        const response = await this.port.patch<{ data?: Resource }>(`/reviewSubmissions/${enc(submissionId)}`, {
            data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } },
        });
        return response?.data ?? { id: submissionId, appId: target.appId, targetId };
    }

    async resolveCancel(options: { reviewSubmissionId?: string; versionId?: string; appId?: string }) {
        const { reviewSubmissionId, versionId } = options;
        let appId = options.appId;
        if (versionId) appId = (await this.target('appStoreVersion', versionId, appId)).appId;
        if (reviewSubmissionId) {
            const response = await this.port.get<{ data: Resource }>(`/reviewSubmissions/${enc(reviewSubmissionId)}`, { include: 'app' });
            const actual = response.data.relationships?.app?.data?.id;
            if (!actual || (appId && actual !== appId)) throw new Error(`reviewSubmission ${reviewSubmissionId} 不属于 app ${appId}`);
            if (!activeStates.split(',').includes(response.data.attributes?.state)) throw new Error(`reviewSubmission ${reviewSubmissionId} 状态 ${response.data.attributes?.state} 不可撤审`);
            if (versionId && !(await this.items(reviewSubmissionId)).some((item) => item.relationships?.appStoreVersion?.data?.id === versionId)) {
                throw new Error(`reviewSubmission ${reviewSubmissionId} 不含版本 ${versionId}`);
            }
            return { id: reviewSubmissionId, appId: actual as string };
        }
        if (!appId) throw new Error('撤审需要 reviewSubmissionId、--version-id 或 --app-id');
        const active = await this.submissions(appId, activeStates);
        const candidates = versionId
            ? (await Promise.all(active.map(async (row) => ({ row, items: await this.items(row.id) }))))
                .filter(({ items }) => items.some((item) => item.relationships?.appStoreVersion?.data?.id === versionId)).map(({ row }) => row)
            : active;
        if (candidates.length !== 1) throw new Error(`找到 ${candidates.length} 个在审 submission；候选：${candidates.map((row) => row.id).join(', ') || '无'}`);
        return { id: candidates[0]!.id, appId };
    }

    async cancel(options: { reviewSubmissionId?: string; versionId?: string; appId?: string }) {
        const target = await this.resolveCancel(options);
        const response = await this.port.patch<{ data?: Resource }>(`/reviewSubmissions/${enc(target.id)}`, {
            data: { type: 'reviewSubmissions', id: target.id, attributes: { canceled: true } },
        });
        return response?.data ?? { success: true, reviewSubmissionId: target.id, appId: target.appId };
    }
}
