/**
 * weknora-sync.js
 * 
 * 自动同步修改的 .md 文件到 weknora 知识库
 * 
 * 环境变量:
 *   WEKNORA_API_URL   - weknora 服务地址 (如 http://localhost:8080)
 *   WEKNORA_API_KEY   - API 密钥 (可选)
 * 
 * 用法:
 *   node scripts/weknora-sync.js           # 同步本次 commit 修改的文件
 *   node scripts/weknora-sync.js --all    # 同步所有 .md 文件
 *   node scripts/weknora-sync.js AGENTS.md docs/spec.md  # 同步指定文件
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MAP_FILE = path.join(__dirname, 'weknora-sync-map.json');

// weknora 配置
const KB_ID = 'f6dd9088-2e05-4dcb-b53e-7eb43d3dda4c';
const API_URL = process.env.WEKNORA_API_URL || 'http://localhost:8080';
const API_KEY = process.env.WEKNORA_API_KEY || '';

/**
 * 读取映射文件
 */
function loadMap() {
    if (!existsSync(MAP_FILE)) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(MAP_FILE, 'utf-8'));
    } catch (error) {
        console.error('[weknora-sync] 读取映射文件失败:', error.message);
        return {};
    }
}

/**
 * 保存映射文件
 */
function saveMap(map) {
    try {
        writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), 'utf-8');
    } catch (error) {
        console.error('[weknora-sync] 保存映射文件失败:', error.message);
    }
}

/**
 * 获取 GitHub raw URL
 */
function getGitHubRawUrl(filePath) {
    // 获取当前远程仓库 URL
    let remoteUrl;
    try {
        remoteUrl = execSync('git remote get-url origin', { 
            cwd: ROOT_DIR, 
            encoding: 'utf-8' 
        }).trim();
    } catch (error) {
        console.error('[weknora-sync] 获取远程仓库 URL 失败:', error.message);
        return null;
    }

    // 解析 owner/repo
    let match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!match) {
        // 尝试 https 格式
        match = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    }
    
    if (!match) {
        console.error('[weknora-sync] 无法解析 GitHub 仓库信息:', remoteUrl);
        return null;
    }

    const [, owner, repo] = match;
    // 获取当前分支
    let branch = 'master';
    try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', { 
            cwd: ROOT_DIR, 
            encoding: 'utf-8' 
        }).trim();
    } catch (error) {
        // 默认使用 master
    }

    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

/**
 * 获取本次 commit 修改的 .md 文件
 */
function getModifiedMdFiles() {
    try {
        // 获取本次 commit 修改的文件（相对于根目录）
        const output = execSync('git diff --name-only HEAD~1 HEAD', { 
            cwd: ROOT_DIR, 
            encoding: 'utf-8' 
        });
        
        const files = output
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.endsWith('.md') && existsSync(path.join(ROOT_DIR, f)));
        
        return files;
    } catch (error) {
        console.error('[weknora-sync] 获取修改文件失败:', error.message);
        return [];
    }
}

/**
 * 获取所有 .md 文件
 */
function getAllMdFiles() {
    try {
        const output = execSync('git ls-files "*.md"', { 
            cwd: ROOT_DIR, 
            encoding: 'utf-8' 
        });
        
        return output
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.endsWith('.md') && f.includes('/'));
    } catch (error) {
        console.error('[weknora-sync] 获取所有 md 文件失败:', error.message);
        return [];
    }
}

/**
 * 调用 weknora API 添加知识
 */
async function createKnowledge(url, title) {
    try {
        const response = await fetch(`${API_URL}/api/v1/knowledge`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
            },
            body: JSON.stringify({
                knowledge_base_id: KB_ID,
                source: url,
                type: 'file_url',
                title: title,
                enable_multimodel: true
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`HTTP ${response.status}: ${error}`);
        }
        
        const data = await response.json();
        console.log(`[weknora-sync] 创建成功: ${title}, ID: ${data.data?.id}`);
        return data.data;
    } catch (error) {
        console.error(`[weknora-sync] 创建知识失败: ${error.message}`);
        throw error;
    }
}

/**
 * 调用 weknora API 删除知识
 */
async function deleteKnowledge(knowledgeId) {
    try {
        const response = await fetch(`${API_URL}/api/v1/knowledge/${knowledgeId}`, {
            method: 'DELETE',
            headers: {
                ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
            }
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`HTTP ${response.status}: ${error}`);
        }
        
        console.log(`[weknora-sync] 删除成功: ${knowledgeId}`);
        return true;
    } catch (error) {
        console.error(`[weknora-sync] 删除知识失败: ${error.message}`);
        throw error;
    }
}

/**
 * 主同步函数
 */
async function sync(files) {
    if (!files || files.length === 0) {
        console.log('[weknora-sync] 没有需要同步的文件');
        return;
    }

    const map = loadMap();
    console.log(`[weknora-sync] 开始同步 ${files.length} 个文件...\n`);
    console.log(`[weknora-sync] 目标知识库: ${KB_ID}`);
    console.log(`[weknora-sync] API 地址: ${API_URL}\n`);

    for (const file of files) {
        const filePath = file.startsWith('/') ? file.slice(1) : file;
        const url = getGitHubRawUrl(filePath);
        
        if (!url) {
            console.error(`[weknora-sync] 跳过 ${filePath}: 无法生成 URL`);
            continue;
        }

        const title = path.basename(filePath);
        
        // 如果已存在，先删除
        if (map[filePath]) {
            console.log(`[weknora-sync] 更新已有文档: ${filePath}`);
            try {
                await deleteKnowledge(map[filePath]);
            } catch (error) {
                console.warn(`[weknora-sync] 删除旧记录失败，继续尝试创建: ${error.message}`);
            }
        } else {
            console.log(`[weknora-sync] 新增文档: ${filePath}`);
        }

        // 创建新记录
        try {
            const result = await createKnowledge(url, title);
            if (result && result.id) {
                map[filePath] = result.id;
            } else {
                // API 返回格式不同时，记录时间戳作为临时占位
                map[filePath] = `pending-${Date.now()}`;
            }
            console.log(`[weknora-sync] 已添加到知识库: ${title}\n`);
        } catch (error) {
            console.error(`[weknora-sync] 添加到知识库失败: ${error.message}`);
            console.error(`[weknora-sync] 请手动执行以下操作:`);
            console.error(`  创建知识: ${title}`);
            console.error(`  URL: ${url}\n`);
        }
    }

    // 保存映射
    saveMap(map);
    console.log('[weknora-sync] 同步完成！');
    console.log(`[weknora-sync] 映射文件已更新: ${MAP_FILE}`);
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--all')) {
    // 同步所有 .md 文件
    const allFiles = getAllMdFiles();
    sync(allFiles);
} else if (args.length > 0) {
    // 同步指定文件
    sync(args);
} else {
    // 同步本次 commit 修改的文件
    const modifiedFiles = getModifiedMdFiles();
    sync(modifiedFiles);
}
