// the intensity chart, as drawn in pdf:89: a small dot per detection over
// time on the family's own scale, five short dim ticks spanning the data and
// a rule 13px under the lowest; flux adds a line and an 11px label, in that
// band, at each new year. a dot click selects that date. drawn at the card's
// content width, so 11px is 11px

import { chartNorm } from '../flaring/render.js';

const W = 210, H = 67.5, TOP = 0.5, BOT = 47.5, BASE = 60.5, L = 9, R = 2;
const TICKS = 5;

export function renderChart(container, detections, cfg, onSelect) {
    if (!detections?.length) { container.innerHTML = ''; return; }
    const sorted = [...detections]
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    const times = sorted.map(d => +new Date(d.date));
    const t0 = Math.min(...times), t1 = Math.max(...times), span = t1 - t0 || 1;
    const x = t => L + (t - t0) / span * (W - L - R);

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <line x1="0" y1="${BASE}" x2="${W}" y2="${BASE}"
            stroke="#808080" stroke-width="1"/>`;
    for (let i = 0; i < TICKS; i++) {
        const at = TOP + i * (BOT - TOP) / (TICKS - 1);
        svg += `<line x1="0" y1="${at}" x2="5.5" y2="${at}" stroke="#4D4D4D"
            stroke-width="1"/>`;
    }
    for (let y = new Date(t0).getFullYear() + 1;
         y <= new Date(t1).getFullYear(); y++) {
        const at = x(new Date(y, 0, 1).getTime());
        svg += `<line x1="${at}" y1="${TOP}" x2="${at}" y2="${BOT}"
            stroke="#4D4D4D" stroke-width="0.5"/>
            <text x="${at}" y="${BASE - 3}" fill="#808080" font-size="11"
            text-anchor="middle">${y}</text>`;
    }
    sorted.forEach((det, i) => {
        const val = cfg.yVal(det);
        if (cfg.sentinel && val >= cfg.sentinel) return;
        const t = Math.max(0, Math.min(1, chartNorm(cfg, val)));
        svg += `<circle class="chart-dot" cx="${x(times[i])}" r="1.25"
            stroke="transparent" stroke-width="7"
            cy="${BOT - t * (BOT - TOP)}" fill="#FFFFFF" data-idx="${i}"/>`;
    });
    container.innerHTML = svg + '</svg>';
    for (const dot of container.querySelectorAll('.chart-dot'))
        dot.addEventListener('click', () => onSelect(sorted[+dot.dataset.idx]));
}
