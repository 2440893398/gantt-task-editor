/**
 * Lightbox 自定义
 */

import { state } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { validateField } from '../../utils/dom.js';
import { FIELD_ICONS } from '../../config/constants.js';
import { openFieldManagementPanel } from '../customFields/manager.js';
import { i18n } from '../../utils/i18n.js';

/**
 * 计算自定义字段区域高度
 */
export function calculateCustomFieldsHeight() {
    const fieldCount = state.customFields.length;
    let height;

    if (fieldCount <= 3) {
        height = fieldCount * 80 + 90;
    } else if (fieldCount <= 6) {
        const rows = Math.ceil(fieldCount / 2);
        height = rows * 86 + 80;
    } else {
        height = Math.min(window.innerHeight * 0.4, 400);
    }

    return Math.max(height, 200);
}

/**
 * 注册自定义字段表单块
 */
export function registerCustomFieldsBlock() {
    gantt.form_blocks["custom_fields"] = {
        render: function (sns) {
            const height = calculateCustomFieldsHeight();
            return "<div class='gantt_cal_ltext gantt_custom_fields_container' style='height:" + height + "px;'></div>";
        },
        set_value: function (node, value, task, section) {
            const fieldCount = state.customFields.length;
            let layoutClass = 'single-column';

            if (fieldCount > 3 && fieldCount <= 6) {
                layoutClass = 'two-column';
            } else if (fieldCount > 6) {
                layoutClass = 'two-column scrollable';
            }

            let html = '<div class="custom-fields-section" style="padding: 16px; height: 100%; box-sizing: border-box;">';

            // 标题和管理字段按钮
            html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">';
            html += `<h4 style="margin: 0; color: #1F2937; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px;">${i18n.t('lightbox.customFields')}</h4>`;
            html += `<button id="manage-fields-btn" type="button" style="padding: 6px 12px; background: transparent; color: #9810FA; border: 1px solid #9810FA; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s;">⚙ ${i18n.t('lightbox.manageFields')}</button>`;
            html += '</div>';

            html += `<div class="fields-grid ${layoutClass}" style="max-height: ${fieldCount > 6 ? 'calc(100% - 60px)' : 'auto'}; overflow-y: ${fieldCount > 6 ? 'auto' : 'visible'};">`;

            state.customFields.forEach(field => {
                const fieldValue = task[field.name] || '';
                const requiredMark = field.required ? '<span style="color: #EF4444; margin-left: 4px;">*</span>' : '';
                const fieldIcon = FIELD_ICONS[field.name] || FIELD_ICONS['default'];

                html += `<div class="custom-field-item" style="margin-bottom: 16px;">`;
                html += `<label style="display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-weight: 500; color: #374151; font-size: 13px;"><span style="color: #9810FA;">${fieldIcon}</span> ${field.label}${requiredMark}:</label>`;

                const inputStyle = 'width: 100%; padding: 10px 12px; border: 1px solid #D1D5DB; border-radius: 8px; font-size: 13px; box-sizing: border-box; transition: border-color 0.2s;';
                const focusEvents = 'onfocus="this.style.borderColor=\'#4A90E2\'; this.style.borderWidth=\'2px\'" onblur="this.style.borderColor=\'#D1D5DB\'; this.style.borderWidth=\'1px\'"';

                if (field.type === 'text') {
                    html += `<input type="text" name="${field.name}" value="${fieldValue}" ${field.required ? 'required' : ''} style="${inputStyle}" ${focusEvents}>`;
                } else if (field.type === 'number') {
                    html += `<input type="number" name="${field.name}" value="${fieldValue}" ${field.required ? 'required' : ''} style="${inputStyle}" ${focusEvents}>`;
                } else if (field.type === 'select') {
                    html += `<select name="${field.name}" ${field.required ? 'required' : ''} style="${inputStyle}" ${focusEvents}>`;
                    html += `<option value="">${i18n.t('lightbox.pleaseSelect')}</option>`;
                    field.options.forEach(option => {
                        const selected = fieldValue === option ? 'selected' : '';
                        // 如果字段有 i18nKey，则翻译选项值
                        let displayValue = option;
                        if (field.i18nKey) {
                            const translated = i18n.t(`${field.i18nKey}.${option}`);
                            if (translated !== `${field.i18nKey}.${option}`) {
                                displayValue = translated;
                            }
                        }
                        html += `<option value="${option}" ${selected}>${displayValue}</option>`;
                    });
                    html += `</select>`;
                } else if (field.type === 'multiselect') {
                    const selectedValues = Array.isArray(fieldValue) ? fieldValue : (fieldValue ? fieldValue.split(',') : []);
                    html += `<select name="${field.name}" multiple ${field.required ? 'required' : ''} style="${inputStyle} min-height: 80px;" ${focusEvents}>`;
                    field.options.forEach(option => {
                        const selected = selectedValues.includes(option) ? 'selected' : '';
                        // 如果字段有 i18nKey，则翻译选项值
                        let displayValue = option;
                        if (field.i18nKey) {
                            const translated = i18n.t(`${field.i18nKey}.${option}`);
                            if (translated !== `${field.i18nKey}.${option}`) {
                                displayValue = translated;
                            }
                        }
                        html += `<option value="${option}" ${selected}>${displayValue}</option>`;
                    });
                    html += `</select>`;
                }

                html += `<div class="field-error" data-field="${field.name}" style="color: #EF4444; font-size: 12px; margin-top: 4px; display: none;"></div>`;
                html += `</div>`;
            });

            html += '</div></div>';
            node.innerHTML = html;

            setTimeout(() => {
                const manageBtn = node.querySelector('#manage-fields-btn');
                if (manageBtn) {
                    manageBtn.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        openFieldManagementPanel();
                    });
                }
            }, 100);
        },
        get_value: function (node, task, section) {
            let isValid = true;
            const errors = [];

            state.customFields.forEach(field => {
                const input = node.querySelector(`input[name="${field.name}"], select[name="${field.name}"]`);
                const errorDiv = node.querySelector(`.field-error[data-field="${field.name}"]`);

                if (input) {
                    let value = '';

                    if (field.type === 'multiselect') {
                        const selectedOptions = Array.from(input.selectedOptions).map(option => option.value);
                        value = selectedOptions.join(',');
                        task[field.name] = value;
                    } else {
                        value = input.value;
                        task[field.name] = value;
                    }

                    const validation = validateField(field, value);
                    if (!validation.valid) {
                        isValid = false;
                        errors.push({ field: field.name, message: validation.message });

                        input.style.borderColor = '#EF4444';
                        input.style.borderWidth = '2px';
                        if (errorDiv) {
                            errorDiv.textContent = validation.message;
                            errorDiv.style.display = 'block';
                        }
                    } else {
                        input.style.borderColor = '#D1D5DB';
                        input.style.borderWidth = '1px';
                        if (errorDiv) {
                            errorDiv.style.display = 'none';
                        }
                    }
                }
            });

            if (!isValid) {
                setTimeout(() => {
                    showToast(errors[0].message, 'error', 3000);
                }, 100);

                const firstErrorField = node.querySelector(`input[name="${errors[0].field}"], select[name="${errors[0].field}"]`);
                if (firstErrorField) {
                    firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstErrorField.focus();
                }
            }

            task._validation_passed = isValid;
            return task.custom_fields;
        },
        focus: function (node) {
            const firstInput = node.querySelector('input, select');
            if (firstInput) firstInput.focus();
        }
    };
}

/**
 * 配置 Lightbox sections
 */
export function configureLightbox() {
    gantt.config.lightbox.sections = [
        { name: "description", height: 70, map_to: "text", type: "textarea", focus: true },
        { name: "time", height: 72, type: "duration", map_to: "auto" },
        { name: "custom_fields", height: calculateCustomFieldsHeight(), type: "custom_fields", map_to: "custom_fields" }
    ];
}

/**
 * 刷新 Lightbox
 */
export function refreshLightbox() {
    if (gantt.getLightbox()) {
        gantt.hideLightbox();
    }

    const existingLightbox = document.querySelector('.gantt_cal_light');
    if (existingLightbox) {
        existingLightbox.remove();
    }

    configureLightbox();
    gantt._lightbox = null;
}
