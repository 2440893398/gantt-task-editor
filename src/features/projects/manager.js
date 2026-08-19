/**
 * 项目管理 CRUD
 * @module src/features/projects/manager.js
 */
import { db, initProjectFieldConfig, removeProjectFieldConfig } from '../../core/storage.js';

const CURRENT_PROJECT_ID_KEY = 'gantt_current_project_id';

async function resolveConfigSource(copyConfigFrom) {
    if (copyConfigFrom !== undefined && copyConfigFrom !== null) {
        return copyConfigFrom;
    }

    try {
        const rememberedProjectId = globalThis.localStorage?.getItem(CURRENT_PROJECT_ID_KEY);
        if (!rememberedProjectId) return 'defaults';
        return (await db.projects.get(rememberedProjectId)) ? rememberedProjectId : 'defaults';
    } catch (error) {
        console.warn('[Projects] Failed to resolve current project config source:', error);
        return 'defaults';
    }
}

function genProjectId() {
    return 'prj_' + Math.random().toString(36).slice(2, 10);
}

/**
 * 构建项目直达链接（加载时会自动切换到该项目）
 * @param {string} projectId
 * @returns {string} 如 https://host/path?project=prj_xxx；无 location 时返回相对形式
 */
export function buildProjectUrl(projectId) {
    if (!projectId) return '';
    const query = `?project=${encodeURIComponent(projectId)}`;
    try {
        const { origin, pathname } = globalThis.location ?? {};
        if (!origin || origin === 'null') {
            return query;
        }
        return `${origin}${pathname}${query}`;
    } catch {
        return query;
    }
}

/**
 * 获取所有项目（按创建时间升序）
 * @returns {Promise<Project[]>}
 */
export async function getAllProjects() {
    return db.projects.orderBy('createdAt').toArray();
}

/**
 * 新建项目
 * @param {{ name: string, color?: string, description?: string,
 *           copyConfigFrom?: string }} opts
 *   copyConfigFrom：字段配置来源——源项目 ID 或 'defaults'（系统默认）；
 *   省略时复制当前项目配置；首次启动没有当前项目时写入系统默认配置
 * @returns {Promise<Project>}
 */
export async function createProject({
    name,
    color = '#4f46e5',
    description = '',
    copyConfigFrom,
} = {}) {
    const configSource = await resolveConfigSource(copyConfigFrom);
    const now = new Date().toISOString();
    const project = {
        id: genProjectId(),
        name,
        color,
        description,
        createdAt: now,
        updatedAt: now,
    };
    await db.projects.add(project);
    initProjectFieldConfig(project.id, configSource);
    return project;
}

/**
 * 更新项目元数据
 * @param {string} id
 * @param {{ name?: string, color?: string, description?: string }} updates
 */
export async function updateProject(id, updates) {
    await db.projects.update(id, { ...updates, updatedAt: new Date().toISOString() });
}

/**
 * 删除项目及其所有关联数据（级联删除）
 * @param {string} id
 */
export async function deleteProject(id) {
    // 日历表（settings/custom/leaves）不在级联范围：EXC-GUI-01 拍板（2026-08-19）
    // 日历是跨项目共享的全局资源，删项目不得清掉别的项目还在用的日历数据。
    const tables = ['tasks', 'links', 'baselines', 'history'];
    await db.transaction('rw', [db.projects, ...tables.map((t) => db[t])], async () => {
        for (const t of tables) {
            await db[t].where('project_id').equals(id).delete();
        }
        await db.projects.delete(id);
    });
    removeProjectFieldConfig(id);
}

/**
 * 获取项目任务数
 * @param {string} id
 * @returns {Promise<number>}
 */
export async function getProjectTaskCount(id) {
    return db.tasks.where('project_id').equals(id).count();
}
