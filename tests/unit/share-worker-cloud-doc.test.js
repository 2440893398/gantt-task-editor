import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { CloudDocDurableObject } from '../../workers/share-worker.js';

class MemoryStorage {
    constructor() {
        this.map = new Map();
    }

    async get(key) {
        return this.map.get(key);
    }

    async put(key, value) {
        this.map.set(key, value);
    }
}

class MemoryDurableObjectNamespace {
    constructor(ObjectClass) {
        this.ObjectClass = ObjectClass;
        this.objects = new Map();
    }

    idFromName(name) {
        return name;
    }

    get(id) {
        if (!this.objects.has(id)) {
            const state = { storage: new MemoryStorage() };
            const instance = new this.ObjectClass(state, {});
            this.objects.set(id, instance);
        }

        return {
            fetch: (request) => this.objects.get(id).fetch(request),
        };
    }
}

class MemoryKV {
    async get() {
        return null;
    }

    async put() {}
}

function createEnv() {
    return {
        SHARE_KV: new MemoryKV(),
        CLOUD_DOCS: new MemoryDurableObjectNamespace(CloudDocDurableObject),
    };
}

function createSnapshot(overrides = {}) {
    return {
        schemaVersion: 1,
        exportedAt: '2026-06-12T00:00:00.000Z',
        project: {
            name: 'Demo Project',
            color: '#4f46e5',
            description: '',
        },
        tasks: [{ id: 1, text: 'Task 1' }],
        links: [],
        customFields: [],
        fieldOrder: ['text'],
        systemFieldSettings: {},
        baseline: null,
        calendar: {
            settings: null,
            customDays: [],
            leaves: [],
        },
        ...overrides,
    };
}

async function request(env, path, options = {}) {
    return worker.fetch(
        new Request(`https://worker.test${path}`, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
        }),
        env
    );
}

async function createCloudDoc(env, data = createSnapshot()) {
    const response = await request(env, '/api/cloud-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
    });

    return {
        response,
        body: await response.json(),
    };
}

describe('cloud doc Worker routes', () => {
    let env;
    const originalGetRandomValues = crypto.getRandomValues.bind(crypto);

    beforeEach(() => {
        env = createEnv();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        crypto.getRandomValues = originalGetRandomValues;
    });

    it('creates a cloud document with view and edit tokens', async () => {
        const { response, body } = await createCloudDoc(env);

        expect(response.status).toBe(200);
        expect(body.docId).toMatch(/^[a-z0-9]{16}$/);
        expect(body.viewToken).toMatch(/^[a-z0-9]{24}$/);
        expect(body.editToken).toMatch(/^[a-z0-9]{24}$/);
        expect(body.version).toBe(1);
        expect(body.updatedAt).toBeTruthy();
        expect(body.expiresAt).toBeTruthy();
    });

    it('rejects invalid cloud document create JSON with 400', async () => {
        const response = await request(env, '/api/cloud-docs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{bad json',
        });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON');
    });

    it('allows a view token to read the latest cloud document snapshot', async () => {
        const { body: created } = await createCloudDoc(env);
        const response = await request(
            env,
            `/api/cloud-docs/${created.docId}?token=${created.viewToken}`
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.docId).toBe(created.docId);
        expect(body.permission).toBe('view');
        expect(body.version).toBe(1);
        expect(body.data.project.name).toBe('Demo Project');
    });

    it('allows an edit token to update when baseVersion matches', async () => {
        const { body: created } = await createCloudDoc(env);
        const nextSnapshot = createSnapshot({
            tasks: [{ id: 1, text: 'Updated task' }],
        });

        const response = await request(env, `/api/cloud-docs/${created.docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: created.editToken,
                baseVersion: 1,
                data: nextSnapshot,
            }),
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.version).toBe(2);

        const readResponse = await request(
            env,
            `/api/cloud-docs/${created.docId}?token=${created.viewToken}`
        );
        const readBody = await readResponse.json();
        expect(readBody.version).toBe(2);
        expect(readBody.data.tasks[0].text).toBe('Updated task');
    });

    it('rejects reads and writes after a cloud document expires', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-12T00:00:00.000Z'));
        const { body: created } = await createCloudDoc(env);

        vi.setSystemTime(new Date('2027-06-13T00:00:00.000Z'));

        const readResponse = await request(
            env,
            `/api/cloud-docs/${created.docId}?token=${created.viewToken}`
        );
        const readBody = await readResponse.json();
        expect(readResponse.status).toBe(410);
        expect(readBody.error).toBe('Document expired');

        const writeResponse = await request(env, `/api/cloud-docs/${created.docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: created.editToken,
                baseVersion: 1,
                data: createSnapshot({ tasks: [{ id: 1, text: 'Expired update' }] }),
            }),
        });
        const writeBody = await writeResponse.json();
        expect(writeResponse.status).toBe(410);
        expect(writeBody.error).toBe('Document expired');

        vi.useRealTimers();
    });

    it('rejects updates when baseVersion is stale', async () => {
        const { body: created } = await createCloudDoc(env);
        await request(env, `/api/cloud-docs/${created.docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: created.editToken,
                baseVersion: 1,
                data: createSnapshot({ tasks: [{ id: 1, text: 'First update' }] }),
            }),
        });

        const response = await request(env, `/api/cloud-docs/${created.docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: created.editToken,
                baseVersion: 1,
                data: createSnapshot({ tasks: [{ id: 1, text: 'Stale update' }] }),
            }),
        });
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body.error).toBe('Version conflict');
        expect(body.currentVersion).toBe(2);
    });

    it('rejects writes from a view token', async () => {
        const { body: created } = await createCloudDoc(env);

        const response = await request(env, `/api/cloud-docs/${created.docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: created.viewToken,
                baseVersion: 1,
                data: createSnapshot({ tasks: [{ id: 1, text: 'Not allowed' }] }),
            }),
        });

        expect(response.status).toBe(403);
    });

    it('retries document creation when a generated document id collides', async () => {
        const sequences = [
            new Array(16).fill(0),
            new Array(24).fill(1),
            new Array(24).fill(2),
            new Array(16).fill(0),
            new Array(16).fill(3),
            new Array(24).fill(4),
            new Array(24).fill(5),
        ];
        vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
            const values = sequences.shift() || new Array(array.length).fill(6);
            values.forEach((value, index) => {
                array[index] = value;
            });
            return array;
        });

        const first = await createCloudDoc(env);
        const second = await createCloudDoc(env);

        expect(first.response.status).toBe(200);
        expect(second.response.status).toBe(200);
        expect(first.body.docId).toBe('aaaaaaaaaaaaaaaa');
        expect(second.body.docId).toBe('dddddddddddddddd');
        expect(second.body.editToken).not.toBe(first.body.editToken);
    });
});
