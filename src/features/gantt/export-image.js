// src/features/gantt/export-image.js
// 纯前端导出:使用 snapDOM 截取甘特图 DOM(所见即所得),
// 替代原 https://export.dhtmlx.com/gantt 在线服务(慢、依赖外网、数据外发)。

import { snapdom } from '@zumer/snapdom';
import { showToast } from '../../utils/toast.js';
import i18n from '../../utils/i18n.js';

const OVERLAY_ID = 'export-progress-overlay';

// 浏览器 canvas 安全上限(Safari 最严格:单边 ~16384px / 总面积 ~16777216*16px)
const MAX_CANVAS_EDGE = 16000;
const MAX_CANVAS_AREA = 16000 * 16000;

/**
 * Show progress overlay
 * @param {string} message
 */
function showProgress(message) {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    overlay.innerHTML = `
        <div class="bg-base-100 rounded-lg p-6 shadow-xl text-center">
            <div class="loading loading-spinner loading-lg text-primary mb-4"></div>
            <div class="text-lg font-semibold">${message}</div>
        </div>
    `;
    document.body.appendChild(overlay);
}

/**
 * Hide progress overlay
 */
function hideProgress() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
}

/**
 * 获取甘特图容器
 * @returns {HTMLElement|null}
 */
function getGanttContainer() {
    return (typeof gantt !== 'undefined' && gantt.$root) || document.getElementById('gantt_here');
}

/**
 * 根据目标尺寸计算不超过 canvas 上限的缩放比例
 * @param {number} width  CSS 像素宽
 * @param {number} height CSS 像素高
 * @param {number} preferred 期望缩放(清晰度),默认 2
 * @returns {number}
 */
function safeScale(width, height, preferred = 2) {
    let scale = preferred;
    scale = Math.min(scale, MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height);
    const area = width * height;
    if (area * scale * scale > MAX_CANVAS_AREA) {
        scale = Math.sqrt(MAX_CANVAS_AREA / area);
    }
    return Math.max(0.3, Math.min(preferred, scale));
}

/**
 * 等待浏览器完成两帧渲染(确保 gantt.render() 后布局已生效)
 */
function nextFrames() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/**
 * 临时把甘特图容器撑到完整内容尺寸(绕过虚拟渲染/滚动裁剪),
 * 执行回调后恢复原状。
 * @param {(el: HTMLElement) => Promise<void>} fn 在展开状态下执行的截图逻辑
 */
async function withFullSizeContainer(fn) {
    const container = getGanttContainer();
    if (!container) throw new Error('Gantt container not found');

    // 保存现场
    const saved = {
        cssText: container.style.cssText,
        smartRendering: gantt.config.smart_rendering,
        scroll: gantt.getScrollState(),
    };

    try {
        // 完整内容尺寸 = 左侧表格宽度 + 时间轴总宽,表头 + 全部行高
        const gridWidth = gantt.$grid ? gantt.$grid.offsetWidth : 0;
        const timelineWidth = gantt.$task_bg ? gantt.$task_bg.scrollWidth : 0;
        const scaleHeight = gantt.config.scale_height || 0;
        const rowsHeight = gantt.$task_bg ? gantt.$task_bg.scrollHeight : 0;

        const fullWidth = gridWidth + timelineWidth + 2;
        const fullHeight = scaleHeight + rowsHeight + 2;

        gantt.config.smart_rendering = false;
        container.style.width = `${fullWidth}px`;
        container.style.height = `${fullHeight}px`;
        gantt.render();
        await nextFrames();

        await fn(container);
    } finally {
        // 恢复现场
        container.style.cssText = saved.cssText;
        gantt.config.smart_rendering = saved.smartRendering;
        gantt.render();
        gantt.scrollTo(saved.scroll.x, saved.scroll.y);
    }
}

/**
 * Export current viewport as PNG (client-side, snapDOM)
 */
export async function exportCurrentView() {
    const container = getGanttContainer();
    if (!container) {
        showToast(i18n.t('export.error'), 'error');
        return;
    }

    showProgress(i18n.t('export.capturing'));

    try {
        const filename = `gantt-view-${new Date().toISOString().slice(0, 10)}`;
        const scale = safeScale(container.offsetWidth, container.offsetHeight, 2);
        const result = await snapdom(container, {
            scale,
            backgroundColor: '#ffffff',
            embedFonts: true,
        });
        await result.download({ format: 'png', filename });
        showToast(i18n.t('export.success'), 'success');
    } catch (error) {
        showToast(`${i18n.t('export.error')}: ${error.message}`, 'error');
        console.error('Export error:', error);
    } finally {
        hideProgress();
    }
}

/**
 * Export full gantt chart as PNG (client-side, snapDOM)
 * 临时展开容器至完整尺寸后整图截取
 */
export async function exportFullGantt() {
    showProgress(i18n.t('export.preparing'));

    try {
        const filename = `gantt-full-${new Date().toISOString().slice(0, 10)}`;

        await withFullSizeContainer(async (container) => {
            const scale = safeScale(container.offsetWidth, container.offsetHeight, 2);
            const result = await snapdom(container, {
                scale,
                backgroundColor: '#ffffff',
                embedFonts: true,
            });
            await result.download({ format: 'png', filename });
        });

        showToast(i18n.t('export.success'), 'success');
    } catch (error) {
        showToast(`${i18n.t('export.error')}: ${error.message}`, 'error');
        console.error('Export error:', error);
    } finally {
        hideProgress();
    }
}

/**
 * Export full gantt chart to PDF (client-side, snapDOM + jsPDF)
 * 生成与图表等比的单页 PDF,保持完整清晰度
 */
export async function exportToPDF() {
    showProgress(i18n.t('export.preparing'));

    try {
        const { jsPDF } = await import('jspdf');
        const filename = `gantt-${new Date().toISOString().slice(0, 10)}.pdf`;

        await withFullSizeContainer(async (container) => {
            const scale = safeScale(container.offsetWidth, container.offsetHeight, 2);
            const canvas = await snapdom.toCanvas(container, {
                scale,
                backgroundColor: '#ffffff',
                embedFonts: true,
            });

            // 页面尺寸与图表等比(以 pt 计,1px ≈ 0.75pt)
            const pageW = container.offsetWidth * 0.75;
            const pageH = container.offsetHeight * 0.75;
            const pdf = new jsPDF({
                orientation: pageW >= pageH ? 'landscape' : 'portrait',
                unit: 'pt',
                format: [pageW, pageH],
            });
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, pageH);
            pdf.save(filename);
        });

        showToast(i18n.t('export.success'), 'success');
    } catch (error) {
        showToast(`${i18n.t('export.error')}: ${error.message}`, 'error');
        console.error('Export error:', error);
    } finally {
        hideProgress();
    }
}
