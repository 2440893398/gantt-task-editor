// src/config/platform.js
// 平台配置：根据环境变量决定启用哪些功能

const isUttools = import.meta.env.VITE_PLATFORM === 'utools';

export const platformConfig = {
    // 平台标识
    platform: import.meta.env.VITE_PLATFORM || 'web',

    // 功能开关
    enableAI: !isUttools && import.meta.env.VITE_ENABLE_AI !== 'false',
    enableShare: !isUttools && import.meta.env.VITE_ENABLE_SHARE !== 'false',
    enableHolidayAPI: !isUttools && import.meta.env.VITE_ENABLE_HOLIDAY !== 'false',

    // 数据存储
    storage: 'indexeddb',

    // 窗口配置
    window: {
        width: isUttools ? 1200 : undefined,
        height: isUttools ? 800 : undefined,
    }
};

export default platformConfig;
