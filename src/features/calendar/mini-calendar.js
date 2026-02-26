import { i18n } from '../../utils/i18n.js';

/**
 * 可复用的迷你月历渲染器
 * @param {Object} options
 * @param {HTMLElement} options.container  - 渲染目标
 * @param {number} options.year
 * @param {number} options.month  - 0-indexed
 * @param {Map<string, {type, label, color, avatars}>} options.highlights - dateStr → highlight info
 * @param {Function} options.onDayClick(dateStr, el, event) - 点击日期回调
 * @param {Function} options.onMonthChange(year, month) - 翻月回调
 */
export function renderMiniCalendar(options) {
    const { container, year, month, highlights = new Map(), onDayClick, onMonthChange } = options;

    const toLocalDateStr = (value) => {
        const d = value instanceof Date ? value : new Date(value);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const locale = i18n.getLanguage?.() || 'zh-CN';
    const weekLabels = {
        'zh-CN': ['一', '二', '三', '四', '五', '六', '日'],
        'en-US': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        'ja-JP': ['月', '火', '水', '木', '金', '土', '日'],
        'ko-KR': ['월', '화', '수', '목', '금', '토', '일'],
    }[locale] || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const monthTitle = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
    }).format(new Date(year, month, 1));
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sunday
    // 转为周一为起始：0=Mon, 6=Sun
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let daysHtml = '';
    // 空白格
    for (let i = 0; i < startOffset; i++) {
        daysHtml += `<div class="cal-mini__day empty"></div>`;
    }
    // 日期格
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const dateStr = toLocalDateStr(date);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const hl = highlights.get(dateStr);

        let cls = 'cal-mini__day';
        if (isWeekend && !hl) cls += ' weekend';
        if (hl) cls += ` cal-mini__day--${hl.type}`;

        let inner = `<span>${d}</span>`;
        if (hl?.label) inner += `<span class="cal-mini__day-tag">${hl.label}</span>`;
        if (hl?.avatars?.length) {
            const avHtml = hl.avatars.slice(0, 3).map(av =>
                `<div class="cal-mini__avatar" style="background:${av.color}">${av.initial}</div>`
            ).join('');
            const extra = hl.avatars.length > 3
                ? `<div class="cal-mini__avatar" style="background:#94A3B8">+${hl.avatars.length - 3}</div>`
                : '';
            inner += `<div class="cal-mini__day-avatars">${avHtml}${extra}</div>`;
        }

        daysHtml += `<div class="${cls}" data-date="${dateStr}">${inner}</div>`;
    }

    container.innerHTML = `
        <div class="cal-mini">
            <div class="cal-mini__nav">
                <button class="cal-mini__nav-btn" id="cal-prev">&#8249;</button>
                <span class="cal-mini__title">${monthTitle}</span>
                <button class="cal-mini__nav-btn" id="cal-next">&#8250;</button>
            </div>
            <div class="cal-mini__weekrow">
                ${weekLabels.map(w => `<span>${w}</span>`).join('')}
            </div>
            <div class="cal-mini__grid">${daysHtml}</div>
        </div>
    `;

    // 翻月
    container.querySelector('#cal-prev').addEventListener('click', () => {
        let m = month - 1, y = year;
        if (m < 0) { m = 11; y--; }
        onMonthChange?.(y, m);
    });
    container.querySelector('#cal-next').addEventListener('click', () => {
        let m = month + 1, y = year;
        if (m > 11) { m = 0; y++; }
        onMonthChange?.(y, m);
    });

    // 日期点击
    container.querySelectorAll('.cal-mini__day:not(.empty)').forEach(el => {
        el.addEventListener('click', e => {
            onDayClick?.(el.dataset.date, el, e);
        });
    });
}
