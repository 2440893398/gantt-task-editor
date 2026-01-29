// src/features/ai/tools/registry.js
import { taskTools } from './taskTools.js';

const allTools = {
  ...taskTools
};

/**
 * 根据 Skill 的 allowed-tools 获取工具子集
 * @param {string[]} allowedTools - 工具名列表
 * @returns {Object} 工具子集
 */
export function getToolsForSkill(allowedTools) {
  if (!allowedTools || allowedTools.length === 0) return {};
  const tools = {};
  for (const name of allowedTools) {
    if (allTools[name]) tools[name] = allTools[name];
  }
  return tools;
}

export { allTools };
