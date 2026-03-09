/**
 * 项目管理 CRUD
 * @module src/features/projects/manager.js
 */
import { db } from '../../core/storage.js';

function genProjectId() {
    return 'prj_' + Math.random().toString(36).slice(2, 10);
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
 * @param {{ name: string, color?: string, description?: string }} opts
 * @returns {Promise<Project>}
 */
export async function createProject({ name, color = '#4f46e5', description = '' } = {}) {
    const now = new Date().toISOString();
    const project = { id: genProjectId(), name, color, description, createdAt: now, updatedAt: now };
    await db.projects.add(project);
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
    const tables = ['tasks', 'links', 'baselines', 'calendar_settings',
                    'calendar_custom', 'person_leaves', 'history'];
    await db.transaction('rw',
        [db.projects, ...tables.map(t => db[t])],
        async () => {
            for (const t of tables) {
                await db[t].where('project_id').equals(id).delete();
            }
            await db.projects.delete(id);
        }
    );
}

/**
 * 获取项目任务数
 * @param {string} id
 * @returns {Promise<number>}
 */
export async function getProjectTaskCount(id) {
    return db.tasks.where('project_id').equals(id).count();
}
