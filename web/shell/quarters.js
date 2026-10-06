// the dd dot-grid quarter picker (pdf:81, 83): a Q1–Q4 column per quarter, a
// row per year. it owns the selection; callers grey a quarter by toggling
// 'dd-unavailable' on buttons().

import { quarterRange } from './util.js';

const ACTIVE = '.dd-dot-btn.dd-active';

export function initQuarters(el, onChange, years = 4) {
    const now = new Date();
    const yr = now.getFullYear(), curQ = Math.floor(now.getMonth() / 3) + 1;
    const cells = [1, 2, 3, 4]
        .map(q => `<span class="dd-secondary">Q${q}</span>`)
        .concat('<span></span>');
    for (let y = yr - years + 1; y <= yr; y++) {
        for (let q = 1; q <= 4; q++)
            cells.push(y === yr && q > curQ ? '<span></span>'
                : `<button class="dd-dot-btn${y >= yr - 1 ? ' dd-active' : ''}"`
                + ` data-q="${y}_${q}" title="Q${q} ${y}">`
                + '<span class="dd-dot"></span></button>');
        cells.push(`<span class="dd-secondary">${y}</span>`);
    }
    el.innerHTML = cells.join('');

    el.addEventListener('click', e => {
        const btn = e.target.closest('.dd-dot-btn');
        if (!btn) return;
        // keep one *available* quarter ticked: an unavailable one cannot be
        // unticked, so it would hold an empty map
        if (btn.classList.contains('dd-active') && el.querySelectorAll(
            `${ACTIVE}:not(.dd-unavailable)`).length <= 1) return;
        btn.classList.toggle('dd-active');
        onChange?.();
    });

    const api = {
        buttons: () => el.querySelectorAll('.dd-dot-btn'),
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
