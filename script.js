const samples = [
    { n: "James", s: "09:00", e: "18:00" }, { n: "Mary", s: "09:00", e: "14:00" },
    { n: "John", s: "10:00", e: "16:00" }, { n: "Linda", s: "12:00", e: "21:00" },
    { n: "Robert", s: "13:00", e: "22:00" }, { n: "Patricia", s: "14:00", e: "22:00" },
    { n: "Michael", s: "16:00", e: "22:00" }, { n: "Barbara", s: "17:00", e: "22:00" }
];

function timeToMins(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minsToTime(m) {
    let h = Math.floor(m / 60) % 24;
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${(m % 60).toString().padStart(2, '0')}${ampm}`;
}

function addWorkerRow(data = { n: '', s: '', e: '' }) {
    const id = Math.random().toString(36).substring(2, 9);
    document.getElementById('workersContainer').insertAdjacentHTML('beforeend', `
    <div class="worker-row" id="${id}">
        <div class="input-group"><label>Name</label><input type="text" class="w-name" value="${data.n}"></div>
        <div class="input-group"><label>Start</label><input type="time" class="w-start" value="${data.s}"></div>
        <div class="input-group"><label>End</label><input type="time" class="w-end" value="${data.e}"></div>
        <button class="btn-remove" onclick="document.getElementById('${id}').remove()">✕</button>
    </div>`);
}

function clearWorkers() {
    // remove all worker rows from the DOM
    document.getElementById('workersContainer').innerHTML = '';
}

function generate() {
    const open = timeToMins(document.getElementById('storeOpen').value);
    let close = timeToMins(document.getElementById('storeClose').value);
    if (close < open) close += 1440;
    const closingTimeMins = close + 60;
    const closingStart = closingTimeMins - 120;

    const workers = [];
    document.querySelectorAll('.worker-row').forEach(row => {
        const name = row.querySelector('.w-name').value;
        let s = timeToMins(row.querySelector('.w-start').value);
        let e = timeToMins(row.querySelector('.w-end').value);
        if (e < s) e += 1440;
        if (name) workers.push({ name, start: s, end: e, dur: (e - s) / 60, tasks: [] });
    });

    const closer = workers.find(w => w.end === closingTimeMins) || workers[workers.length - 1];
    const globalOccupied = [];

    // BREAK ENGINE v2 — rules:
    // 9+ hrs: B1(15m) + Lunch(60m) + B2(15m)
    // 6-8 hrs: B1(15m) + Lunch(45m) + B2(15m)
    // 5 hrs (>=5, <6): single B1(15m) near midpoint
    // <5 hrs: no breaks
    // Gaps: ideal 90-120m, tolerable up to 180m, >180m heavily penalized
    workers.forEach(w => {
        let plan;
        if (w.dur >= 9) {
            plan = [{ d: 15, n: 'B1' }, { d: 60, n: 'Lunch' }, { d: 15, n: 'B2' }];
        } else if (w.dur > 6) {
            plan = [{ d: 15, n: 'B1' }, { d: 45, n: 'Lunch' }, { d: 15, n: 'B2' }];
        } else if (w.dur >= 6) {
            plan = [{ d: 15, n: 'B1' }, { d: 45, n: 'Lunch' }];
        } else if (w.dur >= 5) {
            plan = [{ d: 15, n: 'B1' }];
        } else {
            plan = []; // no breaks for <5hr shifts
        }

        // Special case: 5hr shifts — place single break near the middle
        if (w.dur >= 5 && w.dur < 6 && plan.length === 1) {
            const midpoint = w.start + Math.round((w.end - w.start) / 2);
            // Snap to nearest 15-min mark
            const snapped = Math.round(midpoint / 15) * 15;
            let bestT = snapped;
            // Make sure it's within the shift with some buffer
            if (bestT < w.start + 60) bestT = w.start + Math.ceil(60 / 15) * 15;
            if (bestT + 15 > w.end - 30) bestT = w.end - 45;
            bestT = Math.round(bestT / 15) * 15;
            w.tasks.push({ s: bestT, e: bestT + 15, type: 'B1' });
            globalOccupied.push({ s: bestT, e: bestT + 15 });
        } else {
            // Standard scheduling for 6+ hr shifts
            let lastEventEnd = w.start;
            plan.forEach((p, index) => {
                let bestChoice = null;
                let minPenalty = Infinity;

                for (let t = w.start + 60; t < w.end - p.d; t += 15) {
                    if (w.name === closer.name && t + p.d > closingStart) continue;

                    let gap = t - lastEventEnd;

                    // Penalty curve:
                    // < 90m: strong penalty (too soon)
                    // 90-120m: ideal zone, no penalty
                    // 120-180m: mild penalty (acceptable stretch)
                    // > 180m: heavy penalty (too long without break)
                    let gapPenalty = 0;
                    if (gap < 90) {
                        gapPenalty = (90 - gap) * 50;
                    } else if (gap <= 120) {
                        gapPenalty = 0; // sweet spot
                    } else if (gap <= 180) {
                        gapPenalty = (gap - 120) * 10;
                    } else {
                        gapPenalty = 600 + (gap - 180) * 50;
                    }

                    // Also penalize if the REMAINING time after this break would be too long
                    let remainingAfter = w.end - (t + p.d);
                    // Count how many breaks are still left after this one
                    let breaksRemaining = plan.length - index - 1;
                    if (breaksRemaining === 0 && remainingAfter > 180) {
                        gapPenalty += (remainingAfter - 180) * 30;
                    }

                    let overlapPenalty = globalOccupied.filter(o => (t < o.e && t + p.d > o.s)).length * 500;
                    let totalPenalty = gapPenalty + overlapPenalty;

                    if (totalPenalty < minPenalty) {
                        minPenalty = totalPenalty;
                        bestChoice = { s: t, e: t + p.d, type: p.n };
                    }
                }

                if (bestChoice) {
                    w.tasks.push(bestChoice);
                    globalOccupied.push({ s: bestChoice.s, e: bestChoice.e });
                    lastEventEnd = bestChoice.e;
                }
            });
        }
    });

    // Fitting Room Rotation Logic
    const frBlocks = [];
    let consecutiveMap = {};

    for (let t = open; t < closingTimeMins; t += 60) {
        const bEnd = t + 60;
        const isClosing = (t >= closingStart);
        let block = { time: `${minsToTime(t)} - ${minsToTime(bEnd)}`, g: "—", s: "—", isClosing };

        const isAvailable = (w, exclude = []) => {
            const onBreak = w.tasks.some(tk => (tk.s < bEnd && tk.e > t));
            const atCap = (consecutiveMap[w.name] || 0) >= 2;
            return w.start <= t && w.end >= bEnd && !onBreak && !atCap && !exclude.includes(w.name);
        };

        if (isClosing) { block.s = closer.name; }
        else {
            let options = workers.filter(w => isAvailable(w));
            let choice = options[0] || workers.find(w => w.start <= t && w.end >= bEnd && !w.tasks.some(tk => (tk.s < bEnd && tk.e > t)));
            block.s = choice ? choice.name : "Manager/Lead";
        }

        if (t >= open + 120 && t < close - 120) {
            let options = workers.filter(w => isAvailable(w, [block.s]));
            let choice = options[0] || workers.find(w => w.name !== block.s && w.start <= t && w.end >= bEnd);
            block.g = choice ? choice.name : "Manager/Lead";
        }

        workers.forEach(w => {
            if (w.name === block.s || w.name === block.g) consecutiveMap[w.name] = (consecutiveMap[w.name] || 0) + 1;
            else consecutiveMap[w.name] = 0;
        });
        frBlocks.push(block);
    }

    // Nayef sorter override
    const nayef = workers.find(w => w.name.toLowerCase() === 'nayef');
    if (nayef) {
        console.log('nayef was here');

        // Check if Nayef is available for a full-hour block (on the hour, not on break)
        const nayefAvailable = (blockStart, blockEnd) => {
            if (nayef.start > blockStart || nayef.end < blockEnd) return false;
            // Must be on-the-hour slots
            if (blockStart % 60 !== 0) return false;
            // Not on break
            return !nayef.tasks.some(tk => tk.s < blockEnd && tk.e > blockStart);
        };

        // Find the last 2 slots that have a sorter assigned
        const sorterSlotIndices = [];
        frBlocks.forEach((b, i) => {
            if (b.s !== '—') sorterSlotIndices.push(i);
        });
        const lastTwoIndices = sorterSlotIndices.slice(-2);

        // Determine if Nayef can fill BOTH of the last 2 sorter slots
        let canFillBothLast = lastTwoIndices.length === 2;
        if (canFillBothLast) {
            for (const idx of lastTwoIndices) {
                const bStart = open + idx * 60;
                const bEnd = bStart + 60;
                if (!nayefAvailable(bStart, bEnd)) {
                    canFillBothLast = false;
                    break;
                }
            }
        }

        // Overwrite sorter for all available full-hour slots
        frBlocks.forEach((b, i) => {
            if (b.s === '—') return; // no sorter to overwrite
            // Don't overwrite if Nayef is already assigned greeter or sorter
            if (b.s === nayef.name || b.g === nayef.name) return;
            const bStart = open + i * 60;
            const bEnd = bStart + 60;
            const isLastTwo = lastTwoIndices.includes(i);

            if (isLastTwo) {
                // Only overwrite last 2 if he can fill both
                if (canFillBothLast) b.s = nayef.name;
            } else {
                if (nayefAvailable(bStart, bEnd)) b.s = nayef.name;
            }
        });
    }

    render(workers, frBlocks);
}

function render(workers, fr) {
    document.getElementById('results').style.display = 'block';
    const bBody = document.querySelector('#breaksTable tbody');
    bBody.innerHTML = '';
    workers.forEach(w => {
        const b1 = w.tasks.find(t => t.type === 'B1');
        const lunch = w.tasks.find(t => t.type === 'Lunch');
        const b2 = w.tasks.find(t => t.type === 'B2');
        bBody.insertAdjacentHTML('beforeend', `<tr>
        <td onclick="this.contentEditable=true; this.focus();" onblur="this.contentEditable=false"><strong>${w.name}</strong><br><small style="color:#64748b">${minsToTime(w.start)}-${minsToTime(w.end)}</small></td>
        <td onclick="this.contentEditable=true; this.focus();" onblur="this.contentEditable=false">${b1 ? `<span class="time-tag">${minsToTime(b1.s)}-${minsToTime(b1.e)}</span>` : '—'}</td>
        <td onclick="this.contentEditable=true; this.focus();" onblur="this.contentEditable=false">${lunch ? `<span class="time-tag">${minsToTime(lunch.s)}-${minsToTime(lunch.e)}</span>` : '—'}</td>
        <td onclick="this.contentEditable=true; this.focus();" onblur="this.contentEditable=false">${b2 ? `<span class="time-tag">${minsToTime(b2.s)}-${minsToTime(b2.e)}</span>` : '—'}</td>
    </tr>`);
    });

    const fBody = document.querySelector('#fittingRoomTable tbody');
    fBody.innerHTML = '';
    fr.forEach(b => {
        fBody.insertAdjacentHTML('beforeend', `<tr class="${b.isClosing ? 'highlight-row' : ''}">
        <td onclick="this.contentEditable=true; this.focus();" onblur="this.contentEditable=false"><strong>${b.time}</strong></td>
        <td onclick="this.contentEditable=true; this.focus();" onblur="this.contentEditable=false">${b.g}</td>
        <td onclick="this.contentEditable=true; this.focus();" onblur="this.contentEditable=false">${b.s} ${b.isClosing ? '<span class="closing-badge">CLOSING</span>' : ''}</td>
    </tr>`);
    });
}

window.onload = () => samples.forEach(s => addWorkerRow(s));