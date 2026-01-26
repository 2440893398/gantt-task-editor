/**
 * 通用下拉组件 - 支持 Portal 渲染以解决遮挡问题
 * 支持单选和多选
 */

import { escapeHtml as escapeSafe } from '../../utils/dom.js';

/**
 * 渲染下拉组件 Trigger HTML
 * @param {string} elementId - 元素唯一ID
 * @param {string|Array} currentValue - 当前值
 * @param {Array} options - 选项列表
 * @param {Object} config - 配置项 { placeholder, isMulti, width }
 */
export function renderSelectHTML(elementId, currentValue, options, config = {}) {
    const { placeholder = '请选择', isMulti = false, width = 'w-full' } = config;

    let displayLabel = '';

    if (isMulti) {
        // 多选展示逻辑
        const values = Array.isArray(currentValue) ? currentValue : [];
        if (values.length === 0) {
            displayLabel = `<span class="text-base-content/40 text-sm">${placeholder}</span>`;
        } else {
            // 显示选中数量或 Tags
            if (values.length <= 2) {
                displayLabel = values.map(v =>
                    `<span class="badge badge-xs badge-neutral mr-1">${escapeSafe(v)}</span>`
                ).join('');
            } else {
                displayLabel = `
                    <span class="badge badge-xs badge-neutral mr-1">${escapeSafe(values[0])}</span>
                    <span class="text-xs text-base-content/60">+${values.length - 1}</span>
                `;
            }
        }
    } else {
        // 单选展示逻辑
        const selectedOpt = options.find(o => (typeof o === 'object' ? o.value : o) == currentValue);
        const label = selectedOpt
            ? (typeof selectedOpt === 'object' ? selectedOpt.label : selectedOpt)
            : null;

        if (label) {
            displayLabel = `<span class="text-sm text-base-content truncate">${escapeSafe(label)}</span>`;
        } else {
            displayLabel = `<span class="text-base-content/40 text-sm">${placeholder}</span>`;
        }
    }

    // width logic handles w-full or specific
    const widthClass = width === 'auto' ? '' : width;

    return `
        <div id="${elementId}-trigger" 
             class="select-trigger relative flex items-center justify-between gap-2 px-2 py-1.5 
                    bg-base-100 hover:bg-base-200/50 
                    border border-base-300/50 hover:border-base-300 
                    rounded-md cursor-pointer transition-all duration-200 min-h-[32px] ${widthClass}"
             tabindex="0">
            <div class="flex flex-wrap gap-1 items-center overflow-hidden max-w-full">
                ${displayLabel}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-base-content/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>
        </div>
    `;
}

/**
 * 初始化下拉逻辑
 * @param {string} elementId - 元素唯一ID
 * @param {Array} options - 选项列表 [{value, label} | string]
 * @param {string|Array} currentValue - 当前值
 * @param {Function} onChange - 变更回调 (value) => {}
 * @param {Object} config - 配置项 { isMulti, zIndex }
 */
export function setupSelect(elementId, options, currentValue, onChange, config = {}) {
    const { isMulti = false, zIndex = 7000 } = config;
    const trigger = document.getElementById(`${elementId}-trigger`);

    if (!trigger) return;

    let isOpen = false;
    let menuElement = null;
    let backdropElement = null;

    // 标准化选项数据
    const normalizedOptions = options.map(opt => {
        if (typeof opt === 'object') return opt;
        return { value: opt, label: opt };
    });

    const closeMenu = () => {
        if (menuElement) {
            const el = menuElement; // Capture reference
            el.classList.remove('opacity-100', 'scale-100');
            el.classList.add('opacity-0', 'scale-95');
            setTimeout(() => el.remove(), 150);
            menuElement = null;
        }
        if (backdropElement) {
            backdropElement.remove();
            backdropElement = null;
        }
        isOpen = false;
        trigger.classList.remove('ring-2', 'ring-primary/20', 'border-primary/50');
    };

    const toggleMenu = () => {
        if (isOpen) {
            closeMenu();
        } else {
            openMenu();
        }
    };

    const openMenu = () => {
        if (isOpen) return;
        isOpen = true;

        // Visual feedback on trigger
        trigger.classList.add('ring-2', 'ring-primary/20', 'border-primary/50');

        // Create transparent backdrop to handle clicks outside
        backdropElement = document.createElement('div');
        backdropElement.className = 'fixed inset-0 z-[${zIndex}] cursor-default';
        backdropElement.style.zIndex = zIndex;
        backdropElement.addEventListener('click', (e) => {
            e.stopPropagation();
            closeMenu();
        });
        document.body.appendChild(backdropElement);

        // Position calculation
        const rect = trigger.getBoundingClientRect();

        // Render Menu
        menuElement = document.createElement('div');
        menuElement.className = `fixed bg-base-100 rounded-lg shadow-xl border border-base-200 overflow-hidden flex flex-col transition-all duration-150 ease-out opacity-0 scale-95 origin-top`;
        menuElement.style.zIndex = zIndex + 1;
        menuElement.style.width = scrollY ? `${rect.width}px` : 'auto';
        menuElement.style.minWidth = `${Math.max(rect.width, 180)}px`;
        menuElement.style.maxWidth = '300px';
        menuElement.style.maxHeight = '300px';

        // Decide position (top or bottom)
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (spaceBelow < 200 && spaceAbove > spaceBelow) {
            // Show above
            menuElement.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            menuElement.style.left = `${rect.left}px`;
            menuElement.classList.remove('origin-top');
            menuElement.classList.add('origin-bottom');
        } else {
            // Show below
            menuElement.style.top = `${rect.bottom + 4}px`;
            menuElement.style.left = `${rect.left}px`;
        }

        // Render Search (Optional, maybe later)

        // Render Options
        let contentHTML = `<div class="overflow-y-auto py-1">`;

        if (normalizedOptions.length === 0) {
            contentHTML += `<div class="px-3 py-2 text-sm text-base-content/40 text-center">无选项</div>`;
        } else {
            normalizedOptions.forEach(opt => {
                const isSelected = isMulti
                    ? (Array.isArray(currentValue) && currentValue.includes(opt.value))
                    : currentValue == opt.value;

                contentHTML += `
                    <div class="dropdown-item px-3 py-2 text-sm cursor-pointer hover:bg-base-200 flex items-center justify-between gap-2 group ${isSelected ? 'bg-primary/5' : ''}" 
                         data-value="${escapeSafe(opt.value)}">
                        <span class="${isSelected ? 'text-primary font-medium' : 'text-base-content'} truncate">${escapeSafe(opt.label)}</span>
                        ${isSelected ? `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>` : ''}
                    </div>
                `;
            });
        }
        contentHTML += `</div>`;

        menuElement.innerHTML = contentHTML;
        document.body.appendChild(menuElement);

        // Bind Option Clicks
        menuElement.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent focus loss issues
                e.stopPropagation();

                const val = item.dataset.value;

                if (isMulti) {
                    let newValues = Array.isArray(currentValue) ? [...currentValue] : [];
                    if (newValues.includes(val)) {
                        newValues = newValues.filter(v => v !== val);
                    } else {
                        newValues.push(val);
                    }
                    currentValue = newValues;
                    onChange(currentValue);

                    // Re-render menu content to update checks (simplified: close and reopen or just update DOM)
                    // For better UX in multi-select, we often keep menu open. 
                    // Let's just toggle the UI state manually here for responsiveness.
                    const isNowSelected = newValues.includes(val);
                    const icon = item.querySelector('svg');
                    const textSpan = item.querySelector('span');

                    if (isNowSelected) {
                        item.classList.add('bg-primary/5');
                        textSpan.classList.remove('text-base-content');
                        textSpan.classList.add('text-primary', 'font-medium');
                        if (!icon) {
                            const iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
                            item.insertAdjacentHTML('beforeend', iconHtml);
                        }
                    } else {
                        item.classList.remove('bg-primary/5');
                        textSpan.classList.remove('text-primary', 'font-medium');
                        textSpan.classList.add('text-base-content');
                        if (icon) icon.remove();
                    }

                    // Update Trigger HTML as well
                    // Re-render only inner part? Or just leave it until closed? 
                    // Ideally we update trigger immediately.
                    // But we can't easily replace outer HTML because we lose listeners.
                    // We can update innerHTML of trigger first child.
                    const triggerContent = trigger.querySelector('.flex-wrap'); // Found in renderSelectHTML
                    if (triggerContent) {
                        // We need to DRY this logic, but for now simple patch
                        let displayLabel = '';
                        const values = newValues;
                        if (values.length === 0) {
                            displayLabel = `<span class="text-base-content/40 text-sm">${config.placeholder || '请选择'}</span>`;
                        } else {
                            if (values.length <= 2) {
                                displayLabel = values.map(v => `<span class="badge badge-xs badge-neutral mr-1">${escapeSafe(v)}</span>`).join('');
                            } else {
                                displayLabel = `
                                     <span class="badge badge-xs badge-neutral mr-1">${escapeSafe(values[0])}</span>
                                     <span class="text-xs text-base-content/60">+${values.length - 1}</span>
                                 `;
                            }
                        }
                        triggerContent.innerHTML = displayLabel;
                    }

                } else {
                    if (currentValue !== val) {
                        currentValue = val;
                        onChange(currentValue);

                        // Update Trigger UI
                        const displayLabel = normalizedOptions.find(o => o.value == val)?.label || val;
                        const triggerContent = trigger.querySelector('.flex-wrap');
                        if (triggerContent) {
                            triggerContent.innerHTML = `<span class="text-sm text-base-content truncate">${escapeSafe(displayLabel)}</span>`;
                        }
                    }
                    closeMenu();
                }
            });
        });

        // Intro animation
        requestAnimationFrame(() => {
            menuElement.classList.remove('opacity-0', 'scale-95');
            menuElement.classList.add('opacity-100', 'scale-100');
        });
    };

    trigger.addEventListener('click', (e) => {
        // e.stopPropagation(); // Handled by backdrop usually, but good to be safe if backdrop fails
        toggleMenu();
    });

    // Handle initial value display if needed? 
    // Already handled by renderSelectHTML
}
