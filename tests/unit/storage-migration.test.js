import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';

function createMigrationTestDbName(prefix) {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${suffix}`;
}

/**
 * 辅助函数：创建一个已有 v3 数据的数据库，再用 v4/v5 schema 打开，触发真实的 upgrade 回调。
 * 每个测试用唯一的 dbName，避免 fake-indexeddb 单测之间共享状态。
 */
async function createV3ThenUpgradeToV5(dbName) {
    // --- Step 1: 建立 v3 数据库并写入旧数据 ---
    const dbV3 = new Dexie(dbName);
    dbV3.version(3).stores({
        tasks: '++id, priority, status, start_date, parent',
        links: '++id, source, target, type',
        history: '++id, timestamp, action',
        baselines: 'id',
        calendar_settings: '++id',
        calendar_holidays: 'date, year, countryCode',
        calendar_custom: 'id, date',
        person_leaves: 'id, assignee, startDate, endDate',
        calendar_meta: 'year',
    });
    await dbV3.open();
    await dbV3.tasks.add({ text: 'Old task', priority: 'normal' });
    await dbV3.links.add({ source: 1, target: 2, type: '0' });
    dbV3.close();

    // --- Step 2: 以 v3+v4+v5 重新打开，触发 upgrade ---
    const dbV5 = new Dexie(dbName);

    // 必须也声明 v3，Dexie 才能确定升级起点
    dbV5.version(3).stores({
        tasks: '++id, priority, status, start_date, parent',
        links: '++id, source, target, type',
        history: '++id, timestamp, action',
        baselines: 'id',
        calendar_settings: '++id',
        calendar_holidays: 'date, year, countryCode',
        calendar_custom: 'id, date',
        person_leaves: 'id, assignee, startDate, endDate',
        calendar_meta: 'year',
    });

    // v4: 主迁移——新增 projects，给各表加 project_id 索引
    //     calendar_holidays/calendar_meta 设为 null（主键要变，先删）
    dbV5.version(4)
        .stores({
            projects: 'id, name, createdAt, updatedAt',
            tasks: '++id, project_id, priority, status, start_date, parent',
            links: '++id, project_id, source, target, type',
            history: '++id, project_id, timestamp, action',
            baselines: 'id, project_id',
            calendar_settings: '++id, project_id',
            calendar_holidays: null,
            calendar_custom: 'id, date, project_id',
            person_leaves: 'id, project_id, assignee, startDate, endDate',
            calendar_meta: null,
        })
        .upgrade(async (tx) => {
            const DEFAULT_ID = 'prj_default';
            const now = new Date().toISOString();

            await tx.table('projects').add({
                id: DEFAULT_ID,
                name: '默认项目',
                color: '#4f46e5',
                description: '',
                createdAt: now,
                updatedAt: now,
            });

            await tx.table('tasks').toCollection().modify({ project_id: DEFAULT_ID });
            await tx.table('links').toCollection().modify({ project_id: DEFAULT_ID });
            await tx.table('baselines').toCollection().modify({ project_id: DEFAULT_ID });
            await tx.table('calendar_settings').toCollection().modify({ project_id: DEFAULT_ID });
            await tx.table('calendar_custom').toCollection().modify({ project_id: DEFAULT_ID });
            await tx.table('person_leaves').toCollection().modify({ project_id: DEFAULT_ID });
            await tx.table('history').toCollection().modify({ project_id: DEFAULT_ID });
        });

    // v5: 以新复合主键重建缓存表（缓存数据会自动重新拉取）
    dbV5.version(5).stores({
        calendar_holidays: '[date+countryCode], year, countryCode',
        calendar_meta: '[year+project_id]',
    });

    await dbV5.open();
    return dbV5;
}

/**
 * 辅助函数：在 v5 数据库（含复合主键 calendar_meta 数据）上应用 v6/v7，
 * 复刻 EXC-GUI-01 拍板后"日历全局化"的真实升级路径。
 */
async function upgradeV5ToV7(dbName) {
    const dbV5 = await createV3ThenUpgradeToV5(dbName);
    await dbV5.calendar_meta.put({ year: 2026, project_id: 'prj_default', fetchedAt: 1 });
    dbV5.close();

    const dbV7 = new Dexie(dbName);
    dbV7.version(5).stores({
        projects: 'id, name, createdAt, updatedAt',
        tasks: '++id, project_id, priority, status, start_date, parent',
        links: '++id, project_id, source, target, type',
        history: '++id, project_id, timestamp, action',
        baselines: 'id, project_id',
        calendar_settings: '++id, project_id',
        calendar_holidays: '[date+countryCode], year, countryCode',
        calendar_custom: 'id, date, project_id',
        person_leaves: 'id, project_id, assignee, startDate, endDate',
        calendar_meta: '[year+project_id]',
    });
    dbV7.version(6).stores({
        calendar_settings: '++id',
        calendar_custom: 'id, date',
        person_leaves: 'id, assignee, startDate, endDate',
        calendar_meta: null,
    });
    dbV7.version(7).stores({
        calendar_meta: 'year',
    });

    await dbV7.open();
    return dbV7;
}

describe('Storage migration v4', () => {
    it('should have projects table after upgrade', async () => {
        const { db } = await import('../../src/core/storage.js');
        await db.open();
        // projects 表应存在（version 4 新增）
        expect(db.tables.map((t) => t.name)).toContain('projects');
    });

    it('v4 schema should expose all expected tables', async () => {
        const { db } = await import('../../src/core/storage.js');
        await db.open();
        const tableNames = db.tables.map((t) => t.name);
        const expectedTables = [
            'projects',
            'tasks',
            'links',
            'history',
            'baselines',
            'calendar_settings',
            'calendar_holidays',
            'calendar_custom',
            'person_leaves',
            'calendar_meta',
        ];
        for (const name of expectedTables) {
            expect(tableNames, `table "${name}" should exist`).toContain(name);
        }
    });

    it('should create default project during v3->v4 upgrade', async () => {
        const dbName = createMigrationTestDbName('MigTest_projects');
        const db = await createV3ThenUpgradeToV5(dbName);
        try {
            const projects = await db.projects.toArray();
            expect(projects.length).toBeGreaterThanOrEqual(1);
            const defaultProj = projects.find((p) => p.id === 'prj_default');
            expect(defaultProj).toBeDefined();
            expect(defaultProj.name).toBe('默认项目');
            expect(defaultProj.color).toBe('#4f46e5');
        } finally {
            db.close();
            await Dexie.delete(dbName);
        }
    });

    it('should backfill project_id on existing tasks during v3->v4 upgrade', async () => {
        const dbName = createMigrationTestDbName('MigTest_tasks');
        const db = await createV3ThenUpgradeToV5(dbName);
        try {
            const tasks = await db.tasks.toArray();
            expect(tasks.length).toBeGreaterThanOrEqual(1);
            for (const task of tasks) {
                expect(task.project_id).toBe('prj_default');
            }
        } finally {
            db.close();
            await Dexie.delete(dbName);
        }
    });

    it('should backfill project_id on existing links during v3->v4 upgrade', async () => {
        const dbName = createMigrationTestDbName('MigTest_links');
        const db = await createV3ThenUpgradeToV5(dbName);
        try {
            const links = await db.links.toArray();
            expect(links.length).toBeGreaterThanOrEqual(1);
            for (const link of links) {
                expect(link.project_id).toBe('prj_default');
            }
        } finally {
            db.close();
            await Dexie.delete(dbName);
        }
    });

    it('v5->v7 rebuilds calendar_meta with year PK and keeps other tables intact (EXC-GUI-01)', async () => {
        const dbName = createMigrationTestDbName('MigTest_v7_meta');
        const db = await upgradeV5ToV7(dbName);
        try {
            // 旧复合主键数据随表重建清空（缓存数据，自动重新拉取）
            expect(await db.calendar_meta.count()).toBe(0);

            // 新主键为 year：同年写入两次是覆盖而非并存
            await db.calendar_meta.put({ year: 2026, fetchedAt: 1 });
            await db.calendar_meta.put({ year: 2026, fetchedAt: 2 });
            expect(await db.calendar_meta.count()).toBe(1);
            expect((await db.calendar_meta.get(2026)).fetchedAt).toBe(2);

            // 业务数据不受 v6/v7 影响
            expect(await db.tasks.count()).toBeGreaterThanOrEqual(1);
            expect(await db.projects.count()).toBeGreaterThanOrEqual(1);
        } finally {
            db.close();
            await Dexie.delete(dbName);
        }
    });

    it('calendar_holidays should use compound PK [date+countryCode] after upgrade', async () => {
        const dbName = createMigrationTestDbName('MigTest_holidays');
        const db = await createV3ThenUpgradeToV5(dbName);
        try {
            // 插入同一 date 不同 countryCode 的数据，不应冲突
            await db.calendar_holidays.add({
                date: '2024-01-01',
                countryCode: 'CN',
                year: 2024,
                name: '元旦',
            });
            await db.calendar_holidays.add({
                date: '2024-01-01',
                countryCode: 'US',
                year: 2024,
                name: "New Year's Day",
            });
            const all = await db.calendar_holidays.toArray();
            expect(all.length).toBe(2);
        } finally {
            db.close();
            await Dexie.delete(dbName);
        }
    });
});
