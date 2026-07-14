import { state, switchProject } from '../../../core/store.js';
import { buildProjectUrl, createProject, getAllProjects } from '../../projects/manager.js';
import { defineCommand, getCommand } from '../registry.js';
import { fail } from '../runtime/result.js';

const CREATE_PARAMS = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        color: { type: 'string' },
        description: { type: 'string' },
        // 字段配置来源：省略=复制当前项目；'defaults'=系统默认；或指定源项目 ID
        copyConfigFrom: { type: 'string' },
        idempotencyKey: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
};

const SWITCH_PARAMS = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        idempotencyKey: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: false,
};

async function listProjects() {
    const projects = await getAllProjects();
    return projects.map((project) => ({
        ...project,
        active: project.id === state.currentProjectId,
        url: buildProjectUrl(project.id),
    }));
}

async function createProjectCommand(args) {
    const name = args.name.trim();
    if (!name) {
        return fail('BAD_ARGS', 'Project name is required.');
    }

    // 字段配置默认复用当前项目；'defaults' 表示系统默认；否则必须是已存在的项目 ID
    const copyConfigFrom = args.copyConfigFrom ?? state.currentProjectId ?? 'defaults';
    if (copyConfigFrom !== 'defaults') {
        const projects = await getAllProjects();
        if (!projects.some((project) => project.id === copyConfigFrom)) {
            return fail('NOT_FOUND', `copyConfigFrom project not found: ${copyConfigFrom}`);
        }
    }

    const project = await createProject({
        name,
        color: args.color,
        description: args.description,
        copyConfigFrom,
    });
    state.projects = [...state.projects.filter((item) => item.id !== project.id), project];
    document.dispatchEvent(new CustomEvent('projectsUpdated'));
    // url 是项目直达链接：任务完成后展示给用户，点击即可打开对应甘特图。
    return { project, url: buildProjectUrl(project.id) };
}

async function switchProjectCommand(args) {
    const projects = await getAllProjects();
    if (!projects.some((project) => project.id === args.id)) {
        return fail('NOT_FOUND', `Project not found: ${args.id}`);
    }

    state.projects = projects;
    const switched = await switchProject(args.id);
    if (!switched?.loaded || switched.projectId !== args.id) {
        return fail('EXEC_ERROR', `Project did not finish loading: ${args.id}`);
    }
    return {
        activeProjectId: state.currentProjectId,
        url: buildProjectUrl(state.currentProjectId),
    };
}

export function registerProjectCommands() {
    if (!getCommand('project.list')) {
        defineCommand({
            name: 'project.list',
            summary: 'List projects and identify the active project',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler: listProjects,
            examples: ['app.project.list()'],
        });
    }

    if (!getCommand('project.create')) {
        defineCommand({
            name: 'project.create',
            summary:
                'Create a project without switching the active project; field config copies the current project unless copyConfigFrom is a project id or "defaults"; result.url is a direct link — show it to the user when the task is done',
            params: CREATE_PARAMS,
            mutating: true,
            execution: 'direct',
            handler: createProjectCommand,
            examples: [
                "app.project.create({ name: 'Imported schedule' })",
                "app.project.create({ name: 'Clean slate', copyConfigFrom: 'defaults' })",
            ],
        });
    }

    if (!getCommand('project.switch')) {
        defineCommand({
            name: 'project.switch',
            summary:
                'Switch projects and wait until the target Gantt is loaded; result.url is a direct link to the project',
            params: SWITCH_PARAMS,
            mutating: true,
            execution: 'direct',
            handler: switchProjectCommand,
            examples: ["app.project.switch({ id: 'prj_...' })"],
        });
    }
}
