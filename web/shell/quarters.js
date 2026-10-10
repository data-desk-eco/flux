// the dd dot-grid quarter picker (pdf:81, 83): a Q1–Q4 column per quarter, a
// row per year. it owns the selection; callers grey a quarter by toggling
// `unavailable` on buttons(), which still ticks.

import { quarterRange } from './util.js';

const ACTIVE = 'dd-dot[active]';

export function initQuarters(el, onChange, years = 4) {
    const now = new Date();
    const yr = now.getFullYear(), curQ = Math.floor(now.getMonth() / 3) + 1;
    const cells = [1, 2, 3, 4].map(q => `<span>Q${q}</span>`)
        .concat('<span></span>');
    for (let y = yr - years + 1; y <= yr; y++) {
        for (let q = 1; q <= 4; q++)
            cells.push(y === yr && q > curQ ? '<span></span>'
                : `<dd-dot${y >= yr - 1 ? ' active' : ''} data-q="${y}_${q}"`
                + ` title="Q${q} ${y}"></dd-dot>`);
        cells.push(`<span>${y}</span>`);
    }
    el.innerHTML = cells.join('');

    el.addEventListener('click', e => {
        const btn = e.target.closest('dd-dot');
        if (!btn) return;
        // keep one quarter ticked
        if (btn.hasAttribute('active')
            && el.querySelectorAll(ACTIVE).length <= 1) return;
        btn.toggleAttribute('active');
        onChange?.();
    });

    const api = {
        buttons: () => el.querySelectorAll('dd-dot'),
        key: btn => btn.dataset.q,
        // the ticked keys ("2025_3"), contiguous or not
        keys: () => new Set([...el.querySelectorAll(ACTIVE)]
            .map(b => b.dataset.q)),
        // {startDate, endDate} spanning them, or null
        range: () => quarterRange(api.keys()),
        hint: text => {
            document.getElementById('quarters-hint').textContent = text;
        },
    };
    return api;
}
