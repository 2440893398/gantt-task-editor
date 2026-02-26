/**
 * 工作日历设置面板
 * 包含：Tab1 基础设置 | Tab2 特殊工作日 | Tab3 人员请假
 */

import { i18n } from '../../utils/i18n.js';
import './panel.css';
import { renderTab1 } from './tab1-settings.js';
import { renderTab2 } from './tab2-special-days.js';
import { renderTab3 } from './tab3-leaves.js';

let overlayEl = null;

/**
 * 打开工作日历设置面板
 */
export function openCalendarPanel() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'calendar-panel-overlay';
    overlayEl.innerHTML = `
        <div class="calendar-panel">
            <div class="calendar-panel__header">
                <div class="calendar-panel__header-left">
                    <div class="calendar-panel__icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                    </div>
                    <div>
                        <div class="calendar-panel__title">${i18n.t('calendar.title') || '工作日历'}</div>
                        <div class="calendar-panel__subtitle">${i18n.t('calendar.subtitle') || '配置节假日、特殊工作日与人员请假'}</div>
                    </div>
                </div>
                <button class="calendar-panel__close" id="calendar-panel-close">✕</button>
            </div>

            <div class="calendar-panel__tabs">
                <div class="calendar-panel__tab active" data-tab="settings">${i18n.t('calendar.tab.settings') || '基础设置'}</div>
                <div class="calendar-panel__tab" data-tab="special">${i18n.t('calendar.tab.special') || '特殊工作日'}</div>
                <div class="calendar-panel__tab" data-tab="leaves">${i18n.t('calendar.tab.leaves') || '人员请假'}</div>
            </div>

            <div class="calendar-panel__body">
                <div class="calendar-panel__tab-content active" data-content="settings" id="tab-settings"></div>
                <div class="calendar-panel__tab-content" data-content="special" id="tab-special"></div>
                <div class="calendar-panel__tab-content" data-content="leaves" id="tab-leaves"></div>
            </div>

            <div class="calendar-panel__footer">
                <button class="calendar-panel__btn calendar-panel__btn--cancel" id="calendar-panel-cancel">
                    ${i18n.t('form.cancel') || '取消'}
                </button>
                <button class="calendar-panel__btn calendar-panel__btn--save" id="calendar-panel-save">
                    ${i18n.t('calendar.saveSettings') || '保存设置'}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlayEl);

    // 渲染各 Tab 内容
    renderTab1(document.getElementById('tab-settings'));
    renderTab2(document.getElementById('tab-special'));
    renderTab3(document.getElementById('tab-leaves'));

    // Tab 切换
    overlayEl.querySelectorAll('.calendar-panel__tab').forEach(tab => {
        tab.addEventListener('click', () => {
            overlayEl.querySelectorAll('.calendar-panel__tab').forEach(t => t.classList.remove('active'));
            overlayEl.querySelectorAll('.calendar-panel__tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById(`tab-${target}`)?.classList.add('active');
        });
    });

    // 关闭
    const closePanel = () => {
        overlayEl?.remove();
        overlayEl = null;
    };
    document.getElementById('calendar-panel-close').addEventListener('click', closePanel);
    document.getElementById('calendar-panel-cancel').addEventListener('click', closePanel);
    overlayEl.addEventListener('click', e => { if (e.target === overlayEl) closePanel(); });
    document.getElementById('calendar-panel-save').addEventListener('click', async () => {
        await saveAllSettings();
        closePanel();
    });
}

async function saveAllSettings() {
    // 各 Tab 自行处理保存（通过 CustomEvent 通知）
    document.dispatchEvent(new CustomEvent('calendar:save'));
}
