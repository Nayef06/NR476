const samples = [
    { n: "James", s: "09:00", e: "18:00" }, { n: "Mary", s: "09:00", e: "14:00" },
    { n: "Sue", s: "10:00", e: "16:00" }, { n: "Bob", s: "12:00", e: "21:00" },
    { n: "Andres", s: "13:00", e: "22:00" }, { n: "Patricia", s: "14:00", e: "22:00" },
    { n: "Michael", s: "16:00", e: "22:00" }, { n: "Barbara", s: "17:00", e: "22:00" }
];
const WORKERS_STORAGE_KEY = 'nordy-workers';

let currentSchedule = null;
let moveInProgress = false;

function timeToMins(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minsToTime(m) {
    let h = Math.floor(m / 60) % 24;
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${(m % 60).toString().padStart(2, '0')}${ampm}`;
}

function minsToHour(m) {
    let hour = Math.floor(m / 60) % 24;
    const ampm = hour >= 12 ? 'pm' : 'am';
    hour = hour % 12 || 12;
    return `${hour}${ampm}`;
}

function setupHourPicker(id, selectedValue) {
    const picker = document.getElementById(id);
    picker.innerHTML = Array.from({ length: 24 }, (_, hour) => {
        const value = `${hour.toString().padStart(2, '0')}:00`;
        return `<option value="${value}">${minsToHour(hour * 60)}</option>`;
    }).join('');
    picker.value = selectedValue;
}

function minsToCompactTime(m) {
    return m % 60 === 0 ? minsToHour(m) : minsToTime(m);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
}

function capitalizeFirstLetter(value) {
    const text = String(value);
    const firstCharacterIndex = text.search(/\S/);
    if (firstCharacterIndex === -1) return text;

    return text.slice(0, firstCharacterIndex)
        + text[firstCharacterIndex].toLocaleUpperCase()
        + text.slice(firstCharacterIndex + 1);
}

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours ? `${hours}h` : ''}${hours && mins ? ' ' : ''}${mins ? `${mins}m` : ''}` || '0m';
}

function minsToCopyTime(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hour = Math.floor(normalized / 60) % 12 || 12;
    const mins = normalized % 60;
    return mins === 0 ? `${hour}` : `${hour}:${mins.toString().padStart(2, '0')}`;
}

function formatCopyTimeRange(start, end) {
    return `${minsToCopyTime(start)}-${minsToCopyTime(end)}`;
}

function formatCopyDuration(minutes) {
    return minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
}

function toggleTimelineVisualizer() {
    const section = document.querySelector('.timeline-section');
    const content = document.getElementById('timelineVisualizerContent');
    const button = document.getElementById('timelineToggleButton');
    const shouldCollapse = !section.classList.contains('collapsed');

    section.classList.toggle('collapsed', shouldCollapse);
    content.inert = shouldCollapse;
    content.setAttribute('aria-hidden', String(shouldCollapse));
    button.setAttribute('aria-expanded', String(!shouldCollapse));
    button.setAttribute('aria-label', shouldCollapse ? 'Expand visualizer' : 'Collapse visualizer');
    button.title = shouldCollapse ? 'Expand visualizer' : 'Collapse visualizer';
}

async function copyScheduleText(text, buttonId, defaultLabel) {
    const button = document.getElementById(buttonId);

    try {
        const copyWithTextArea = () => {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.setAttribute('readonly', '');
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            const copied = document.execCommand('copy');
            textArea.remove();
            if (!copied) throw new Error('Copy command was rejected.');
        };

        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
            } catch (error) {
                copyWithTextArea();
            }
        } else {
            copyWithTextArea();
        }

        button.textContent = 'Copied!';
    } catch (error) {
        console.warn('Unable to copy schedule.', error);
        button.textContent = 'Copy failed';
    }

    window.setTimeout(() => {
        button.textContent = defaultLabel;
    }, 1600);
}

function copyFloorBreaks() {
    if (!currentSchedule) return;

    const text = currentSchedule.workers.map(worker => {
        const break1 = worker.tasks.find(task => task.type === 'B1');
        const lunch = worker.tasks.find(task => task.type === 'Lunch');
        const break2 = worker.tasks.find(task => task.type === 'B2');

        return [
            worker.name,
            formatCopyTimeRange(worker.start, worker.end),
            break1 ? minsToCopyTime(break1.s) : 'x',
            lunch ? formatCopyTimeRange(lunch.s, lunch.e) : 'x',
            lunch ? formatCopyDuration(lunch.e - lunch.s) : 'x',
            break2 ? minsToCopyTime(break2.s) : 'x'
        ].join('\t');
    }).join('\n');

    copyScheduleText(text, 'copyBreaksButton', 'Copy Schedule');
}

function copyFittingRoomRotation() {
    if (!currentSchedule) return;

    const blocks = currentSchedule.fittingRoomBlocks;
    const mergeRoleAssignments = role => {
        const assignments = Array(blocks.length).fill('');
        let index = 0;

        while (index < blocks.length) {
            const firstBlock = blocks[index];
            const name = firstBlock[role];

            if (!name || name === '\u2014') {
                index += 1;
                continue;
            }

            let end = firstBlock.end;
            let nextIndex = index + 1;
            while (
                role === 's'
                && firstBlock.isClosing
                && nextIndex < blocks.length
                && blocks[nextIndex].isClosing
                && blocks[nextIndex][role] === name
                && blocks[nextIndex].start === end
            ) {
                end = blocks[nextIndex].end;
                nextIndex += 1;
            }

            assignments[index] = `${name} ${formatCopyTimeRange(firstBlock.start, end)}`;
            index = nextIndex;
        }

        return assignments;
    };

    const greeters = mergeRoleAssignments('g');
    const sorters = mergeRoleAssignments('s');
    const text = blocks
        .map((block, index) => [greeters[index], sorters[index]])
        .filter(assignments => assignments.some(Boolean))
        .map(assignments => assignments.join('\t'))
        .join('\n');

    copyScheduleText(text, 'copyFittingRoomButton', 'Copy Rotation');
}

function getWorkerEntries() {
    return Array.from(document.querySelectorAll('.worker-row:not([data-new-worker="true"])'))
        .map(row => ({
            n: capitalizeFirstLetter(row.querySelector('.w-name').value),
            s: row.querySelector('.w-start').value,
            e: row.querySelector('.w-end').value
        }));
}

function saveWorkers() {
    try {
        localStorage.setItem(WORKERS_STORAGE_KEY, JSON.stringify(getWorkerEntries()));
    } catch (error) {
        console.warn('Unable to save workers.', error);
    }
}

function loadSavedWorkers() {
    try {
        const saved = localStorage.getItem(WORKERS_STORAGE_KEY);
        if (saved === null) return null;

        const workers = JSON.parse(saved);
        if (!Array.isArray(workers)) return null;

        return workers.filter(worker => (
            worker
            && typeof worker.n === 'string'
            && typeof worker.s === 'string'
            && typeof worker.e === 'string'
        ));
    } catch (error) {
        console.warn('Unable to load saved workers.', error);
        return null;
    }
}

function addWorkerRow(data = { n: '', s: '', e: '' }, shouldSave = true, isNewWorker = false) {
    const id = Math.random().toString(36).substring(2, 9);
    const name = capitalizeFirstLetter(data.n);
    const start = formatShiftTimeInput(data.s);
    const end = formatShiftTimeInput(data.e);
    document.getElementById('workersContainer').insertAdjacentHTML('beforeend', `
    <div class="worker-row${isNewWorker ? ' new-worker-row' : ''}" id="${id}"${isNewWorker ? ' data-new-worker="true"' : ''}>
        <div class="input-group"><label>Name</label><input type="text" class="w-name" value="${escapeHTML(name)}"></div>
        <div class="input-group"><label>Start</label><input type="text" class="w-start" value="${escapeHTML(start)}" placeholder="4am" autocomplete="off" spellcheck="false" aria-describedby="shiftTimeHint"></div>
        <div class="input-group"><label>End</label><input type="text" class="w-end" value="${escapeHTML(end)}" placeholder="4pm" autocomplete="off" spellcheck="false" aria-describedby="shiftTimeHint"></div>
        <button class="btn-remove" aria-label="Remove worker" onclick="removeWorkerRow('${id}')"${isNewWorker ? ' hidden' : ''}>&times;</button>
    </div>`);
    if (shouldSave) saveWorkers();
}

function ensureNewWorkerRow() {
    if (!document.querySelector('.worker-row[data-new-worker="true"]')) {
        addWorkerRow({ n: '', s: '', e: '' }, false, true);
    }
}

function activateNewWorkerRow(row) {
    row.removeAttribute('data-new-worker');
    row.classList.remove('new-worker-row');
    row.querySelector('.btn-remove').hidden = false;
    ensureNewWorkerRow();
    saveWorkers();
}

function removeWorkerRow(id) {
    document.getElementById(id)?.remove();
    ensureNewWorkerRow();
    saveWorkers();
}

function clearWorkers() {
    // remove all worker rows from the DOM
    document.getElementById('workersContainer').innerHTML = '';
    currentSchedule = null;
    document.getElementById('results').style.display = 'none';
    ensureNewWorkerRow();
    saveWorkers();
}

function useSampleWorkers() {
    const container = document.getElementById('workersContainer');
    container.innerHTML = '';
    samples.forEach(sample => addWorkerRow(sample, false));
    ensureNewWorkerRow();
    currentSchedule = null;
    document.getElementById('results').style.display = 'none';
    saveWorkers();
}

function getPreferredFittingRoomCloser(workers, close) {
    const closingEnd = close + 60;
    const closingStart = closingEnd - 120;
    const coversClosingWindow = worker => (
        worker.start <= closingStart && worker.end >= closingEnd
    );
    const nayef = workers.find(worker => (
        worker.name.trim().toLowerCase() === 'nayef' && coversClosingWindow(worker)
    ));

    return nayef
        || workers.find(worker => worker.end === closingEnd && coversClosingWindow(worker))
        || workers.find(coversClosingWindow)
        || workers[workers.length - 1];
}

function isNayefName(name) {
    return String(name).trim().toLowerCase() === 'nayef';
}

function keepNayefInSorterRole(block) {
    if (!isNayefName(block.g)) return;

    const previousSorter = block.s;
    block.s = block.g;
    block.g = isNayefName(previousSorter) ? 'Manager' : previousSorter;
}

function createFittingRoomRotation(workers, open, close) {
    const closingTimeMins = close + 60;
    const closingStart = closingTimeMins - 120;
    const closer = getPreferredFittingRoomCloser(workers, close);
    const blocks = [];
    const consecutiveMap = {};
    const chooseWorker = options => (
        options.find(worker => worker.name.trim().toLowerCase() !== 'nayef')
        || options[0]
    );

    for (let start = open; start < closingTimeMins; start += 60) {
        const end = start + 60;
        const isClosing = start >= closingStart;
        const block = {
            time: `${minsToHour(start)} - ${minsToHour(end)}`,
            start,
            end,
            g: '—',
            s: '—',
            isClosing
        };

        const isOnBreak = worker => worker.tasks.some(task => task.s < end && task.e > start);
        const coversBlock = worker => worker.start <= start && worker.end >= end;

        const isAvailable = (worker, excludedNames = []) => {
            const atCap = (consecutiveMap[worker.name] || 0) >= 2;
            return coversBlock(worker)
                && !isOnBreak(worker)
                && !atCap
                && !excludedNames.includes(worker.name);
        };

        if (isClosing && closer && coversBlock(closer) && !isOnBreak(closer)) {
            block.s = closer.name;
        } else {
            const options = workers.filter(worker => isAvailable(worker));
            const fallbackOptions = workers.filter(worker => (
                coversBlock(worker) && !isOnBreak(worker)
            ));
            const choice = chooseWorker(options) || chooseWorker(fallbackOptions);
            block.s = choice ? choice.name : 'Manager';
        }

        if (start >= open + 180 && start < close - 120) {
            const options = workers.filter(worker => isAvailable(worker, [block.s]));
            const fallbackOptions = workers.filter(worker => (
                worker.name !== block.s
                && coversBlock(worker)
                && !isOnBreak(worker)
            ));
            const choice = chooseWorker(options) || chooseWorker(fallbackOptions);
            block.g = choice ? choice.name : 'Manager';
        }

        keepNayefInSorterRole(block);

        workers.forEach(worker => {
            if (worker.name === block.s || worker.name === block.g) {
                consecutiveMap[worker.name] = (consecutiveMap[worker.name] || 0) + 1;
            } else {
                consecutiveMap[worker.name] = 0;
            }
        });
        blocks.push(block);
    }

    return blocks;
}

function getBreakPlan(durationHours) {
    if (durationHours > 8) {
        return [{ d: 15, n: 'B1' }, { d: 60, n: 'Lunch' }, { d: 15, n: 'B2' }];
    }
    if (durationHours > 6) {
        return [{ d: 15, n: 'B1' }, { d: 45, n: 'Lunch' }, { d: 15, n: 'B2' }];
    }
    if (durationHours > 5) {
        return [{ d: 15, n: 'B1' }, { d: 45, n: 'Lunch' }];
    }
    if (durationHours >= 4) return [{ d: 15, n: 'B1' }];
    return [];
}

function createEvenBreakSchedule(worker, plan, occupied, isCloser, closingStart) {
    if (!plan.length) return [];

    const minWorkGap = 30;
    const scheduled = [];
    let bestSchedule = null;
    let bestScore = Infinity;

    const evaluate = () => {
        const workGaps = [];
        let cursor = worker.start;

        scheduled.forEach(task => {
            workGaps.push(task.s - cursor);
            cursor = task.e;
        });
        workGaps.push(worker.end - cursor);

        const targetGap = workGaps.reduce((sum, gap) => sum + gap, 0) / workGaps.length;
        const spacingPenalty = workGaps.reduce((sum, gap) => (
            sum + Math.pow(gap - targetGap, 2)
        ), 0);
        const overlapMinutes = scheduled.reduce((sum, task) => (
            sum + occupied.reduce((taskSum, existing) => (
                taskSum + Math.max(0, Math.min(task.e, existing.e) - Math.max(task.s, existing.s))
            ), 0)
        ), 0);
        const score = spacingPenalty + overlapMinutes * 20;

        if (score < bestScore) {
            bestScore = score;
            bestSchedule = scheduled.map(task => ({ ...task }));
        }
    };

    const search = (index, previousEnd) => {
        if (index === plan.length) {
            if (worker.end - previousEnd >= minWorkGap) evaluate();
            return;
        }

        const item = plan[index];
        const remainingItems = plan.slice(index + 1);
        const remainingBreakMinutes = remainingItems.reduce((sum, remaining) => sum + remaining.d, 0);
        const remainingRequiredGaps = minWorkGap * (remainingItems.length + 1);
        const earliest = Math.ceil(Math.max(worker.start + minWorkGap, previousEnd + minWorkGap) / 15) * 15;
        let latest = Math.floor((worker.end - item.d - remainingBreakMinutes - remainingRequiredGaps) / 15) * 15;

        if (isCloser) latest = Math.min(latest, closingStart - item.d);

        for (let start = earliest; start <= latest; start += 15) {
            const task = { s: start, e: start + item.d, type: item.n };
            scheduled.push(task);
            search(index + 1, task.e);
            scheduled.pop();
        }
    };

    search(0, worker.start - minWorkGap);
    return bestSchedule || [];
}

function getBreakSchedulePenalty(workers) {
    const spacingPenalty = workers.reduce((total, worker) => {
        const workGaps = [];
        let cursor = worker.start;

        worker.tasks.forEach(task => {
            workGaps.push(task.s - cursor);
            cursor = task.e;
        });
        workGaps.push(worker.end - cursor);

        const targetGap = workGaps.reduce((sum, gap) => sum + gap, 0) / workGaps.length;
        return total + workGaps.reduce((sum, gap) => (
            sum + Math.pow(gap - targetGap, 2)
        ), 0);
    }, 0);
    const tasks = workers.flatMap(worker => worker.tasks);
    let overlapMinutes = 0;

    for (let firstIndex = 0; firstIndex < tasks.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < tasks.length; secondIndex++) {
            overlapMinutes += Math.max(
                0,
                Math.min(tasks[firstIndex].e, tasks[secondIndex].e)
                    - Math.max(tasks[firstIndex].s, tasks[secondIndex].s)
            );
        }
    }

    return spacingPenalty + overlapMinutes * 20;
}

function getCoverageGapMinutes(workers, fittingRoomBlocks, open, close) {
    return getCoverageSegments(workers, fittingRoomBlocks, open, close)
        .filter(segment => segment.count === 0)
        .reduce((total, segment) => total + segment.end - segment.start, 0);
}

function getManagerAssignmentCount(fittingRoomBlocks) {
    return fittingRoomBlocks.reduce((total, block) => (
        total + Number(block.g === 'Manager') + Number(block.s === 'Manager')
    ), 0);
}

function getScheduleQuality(workers, fittingRoomBlocks, open, close) {
    return {
        managerAssignments: getManagerAssignmentCount(fittingRoomBlocks),
        gapMinutes: getCoverageGapMinutes(workers, fittingRoomBlocks, open, close),
        breakPenalty: getBreakSchedulePenalty(workers)
    };
}

function compareScheduleQuality(first, second) {
    // Fitting-room staffing is the hard priority, followed by floor coverage and spacing.
    return first.managerAssignments - second.managerAssignments
        || first.gapMinutes - second.gapMinutes
        || first.breakPenalty - second.breakPenalty;
}

function optimizeBreakCoverage(workers, open, close) {
    const closer = getPreferredFittingRoomCloser(workers, close);
    const closingStart = close - 60;
    let fittingRoomBlocks = createFittingRoomRotation(workers, open, close);
    let scheduleQuality = getScheduleQuality(workers, fittingRoomBlocks, open, close);

    while (true) {
        let bestMove = null;

        workers.forEach(worker => {
            worker.tasks.forEach((task, taskIndex) => {
                const duration = task.e - task.s;
                const originalStart = task.s;
                const previousEnd = taskIndex === 0
                    ? worker.start
                    : worker.tasks[taskIndex - 1].e;
                const nextStart = taskIndex === worker.tasks.length - 1
                    ? worker.end
                    : worker.tasks[taskIndex + 1].s;
                const earliest = Math.ceil((previousEnd + 30) / 15) * 15;
                let latest = Math.floor((nextStart - duration - 30) / 15) * 15;

                if (worker === closer) latest = Math.min(latest, closingStart - duration);

                for (let start = earliest; start <= latest; start += 15) {
                    if (start === originalStart) continue;

                    task.s = start;
                    task.e = start + duration;
                    const candidateBlocks = createFittingRoomRotation(workers, open, close);
                    const candidateQuality = getScheduleQuality(
                        workers,
                        candidateBlocks,
                        open,
                        close
                    );

                    if (compareScheduleQuality(candidateQuality, scheduleQuality) < 0) {
                        const candidate = {
                            worker,
                            task,
                            start,
                            blocks: candidateBlocks,
                            quality: candidateQuality,
                            distance: Math.abs(start - originalStart)
                        };

                        if (
                            !bestMove
                            || compareScheduleQuality(candidate.quality, bestMove.quality) < 0
                            || (
                                compareScheduleQuality(candidate.quality, bestMove.quality) === 0
                                && candidate.distance < bestMove.distance
                            )
                        ) {
                            bestMove = candidate;
                        }
                    }

                    task.s = originalStart;
                    task.e = originalStart + duration;
                }
            });
        });

        if (!bestMove) break;

        const duration = bestMove.task.e - bestMove.task.s;
        bestMove.task.s = bestMove.start;
        bestMove.task.e = bestMove.start + duration;
        fittingRoomBlocks = bestMove.blocks;
        scheduleQuality = bestMove.quality;
    }

    return fittingRoomBlocks;
}

function scheduleAllWorkerBreaks(workers, open, close) {
    const closingTimeMins = close + 60;
    const closingStart = closingTimeMins - 120;
    const closer = getPreferredFittingRoomCloser(workers, close);
    const occupied = [];

    workers.forEach(worker => {
        worker.tasks = createEvenBreakSchedule(
            worker,
            getBreakPlan(worker.dur),
            occupied,
            worker === closer,
            closingStart
        );
        occupied.push(...worker.tasks.map(task => ({ s: task.s, e: task.e })));
    });

    return optimizeBreakCoverage(workers, open, close);
}

function generate() {
    const open = timeToMins(document.getElementById('storeOpen').value);
    let close = timeToMins(document.getElementById('storeClose').value);
    if (close < open) close += 1440;
    const workers = [];
    document.querySelectorAll('.worker-row').forEach(row => {
        const name = capitalizeFirstLetter(row.querySelector('.w-name').value.trim());
        const startValue = row.querySelector('.w-start').value;
        const endValue = row.querySelector('.w-end').value;
        let s = parseShiftTimeInput(startValue);
        let e = parseShiftTimeInput(endValue);
        if (!name || s === null || e === null) return;
        if (e < s) e += 1440;
        workers.push({
            name,
            start: s,
            end: e,
            dur: (e - s) / 60,
            tasks: [],
            editorId: row.id
        });
    });

    // Start with evenly spaced breaks, then adjust them in 15-minute steps. Prioritize
    // fitting-room staffing first, floor coverage second, and even spacing third.
    const fittingRoomBlocks = scheduleAllWorkerBreaks(workers, open, close);
    currentSchedule = { workers, fittingRoomBlocks, open, close };
    render(workers, fittingRoomBlocks, open, close);
}

function countPeopleOnFloor(workers, fittingRoomBlocks, start, end) {
    const midpoint = start + (end - start) / 2;
    const fittingRoomBlock = fittingRoomBlocks.find(block => (
        block.start <= midpoint && block.end > midpoint
    ));
    const fittingRoomNames = fittingRoomBlock
        ? new Set([fittingRoomBlock.g, fittingRoomBlock.s])
        : new Set();

    return workers.filter(worker => {
        const working = worker.start <= midpoint && worker.end >= midpoint;
        const onBreak = worker.tasks.some(task => task.s < end && task.e > start);
        return working && !onBreak && !fittingRoomNames.has(worker.name);
    }).length;
}

function getCoverageSegments(workers, fittingRoomBlocks, open, close) {
    const boundaries = new Set([open, close]);

    workers.forEach(worker => {
        if (worker.end > open && worker.start < close) {
            boundaries.add(Math.max(open, worker.start));
            boundaries.add(Math.min(close, worker.end));
        }
        worker.tasks.forEach(task => {
            if (task.e > open && task.s < close) {
                boundaries.add(Math.max(open, task.s));
                boundaries.add(Math.min(close, task.e));
            }
        });
    });

    fittingRoomBlocks.forEach(block => {
        if (block.end > open && block.start < close) {
            boundaries.add(Math.max(open, block.start));
            boundaries.add(Math.min(close, block.end));
        }
    });

    const points = Array.from(boundaries).sort((a, b) => a - b);
    const segments = [];

    for (let index = 0; index < points.length - 1; index++) {
        const start = points[index];
        const end = points[index + 1];
        const count = countPeopleOnFloor(workers, fittingRoomBlocks, start, end);
        const previous = segments[segments.length - 1];

        if (previous && previous.count === count && previous.end === start) previous.end = end;
        else segments.push({ start, end, count });
    }

    return segments;
}

function taskDisplayName(task) {
    if (task.type === 'Lunch') return 'Lunch';
    return task.type === 'B2' ? 'Break 2' : 'Break 1';
}

function taskConflicts(worker, taskIndex, start) {
    const task = worker.tasks[taskIndex];
    const end = start + (task.e - task.s);
    return worker.tasks.some((otherTask, otherIndex) => (
        otherIndex !== taskIndex && start < otherTask.e && end > otherTask.s
    ));
}

function getTaskSchedulingEnd(worker) {
    if (!currentSchedule) return worker.end;
    const closer = getPreferredFittingRoomCloser(
        currentSchedule.workers,
        currentSchedule.close
    );
    return worker === closer ? Math.min(worker.end, currentSchedule.close - 60) : worker.end;
}

function getWorkIntervals(worker) {
    const sortedTasks = [...worker.tasks].sort((first, second) => first.s - second.s);
    const intervals = [];
    let cursor = worker.start;

    sortedTasks.forEach(task => {
        if (task.s > cursor) intervals.push({ start: cursor, end: task.s });
        cursor = Math.max(cursor, task.e);
    });

    if (cursor < worker.end) intervals.push({ start: cursor, end: worker.end });
    return intervals;
}

function getFittingRoomIntervals(worker, fittingRoomBlocks) {
    const intervals = [];

    fittingRoomBlocks.forEach(block => {
        let role = null;
        if (block.g === worker.name) role = 'Greeter';
        if (block.s === worker.name) role = 'Sorter';
        if (!role) return;

        const previous = intervals[intervals.length - 1];
        if (previous && previous.end === block.start && previous.role === role) {
            previous.end = block.end;
        } else {
            intervals.push({ start: block.start, end: block.end, role });
        }
    });

    return intervals;
}

function minsToInputTime(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const hours = hour24 % 12 || 12;
    const mins = (normalized % 60).toString().padStart(2, '0');
    return `${hours}:${mins} ${hour24 >= 12 ? 'pm' : 'am'}`;
}

function parseTimeOfDay(value) {
    const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const period = match[3];
    if (minutes > 59) return null;

    if (period) {
        if (hours < 1 || hours > 12) return null;
        hours = hours % 12 + (period === 'pm' ? 12 : 0);
    } else if (hours > 23) {
        return null;
    }

    return hours * 60 + minutes;
}

function parseShiftTimeInput(value) {
    const trimmed = value.trim();
    const bareHour = trimmed.match(/^\d{1,2}$/);

    if (bareHour) {
        const hours = Number(bareHour[0]);
        if (hours >= 1 && hours <= 12) return hours % 12 * 60 + 720;
    }

    return parseTimeOfDay(trimmed);
}

function formatShiftTimeInput(value) {
    if (!value) return '';
    const minutes = parseShiftTimeInput(value);
    return minutes === null ? value : minsToInputTime(minutes);
}

function normalizeShiftTimeInput(input) {
    const minutes = parseShiftTimeInput(input.value);

    if (minutes === null) {
        input.toggleAttribute('aria-invalid', input.value.trim() !== '');
        return false;
    }

    input.value = minsToInputTime(minutes);
    input.removeAttribute('aria-invalid');
    return true;
}

function parseClockValue(value, referenceMinutes) {
    let result = parseTimeOfDay(value);
    if (result === null) return null;
    while (result - referenceMinutes > 720) result -= 1440;
    while (referenceMinutes - result > 720) result += 1440;
    return result;
}

function parseTimeRange(value, startReference, endReference) {
    const parts = value.split(/\s*[-–—]\s*/);
    if (parts.length !== 2) return null;

    const start = parseClockValue(parts[0], startReference);
    let end = parseClockValue(parts[1], endReference);
    if (start === null || end === null) return null;
    while (end <= start) end += 1440;
    return { start, end };
}

function autoUpdatesEnabled() {
    return document.getElementById('autoUpdateToggle')?.checked ?? true;
}

function renderCurrentSchedule() {
    if (!currentSchedule) return;
    render(
        currentSchedule.workers,
        currentSchedule.fittingRoomBlocks,
        currentSchedule.open,
        currentSchedule.close
    );
}

function refreshCurrentSchedule() {
    if (!currentSchedule) return;
    if (autoUpdatesEnabled()) {
        currentSchedule.fittingRoomBlocks = createFittingRoomRotation(
            currentSchedule.workers,
            currentSchedule.open,
            currentSchedule.close
        );
    }
    renderCurrentSchedule();
}

function syncWorkerEditor(worker) {
    const row = document.getElementById(worker.editorId);
    if (!row) return;
    row.querySelector('.w-start').value = minsToInputTime(worker.start);
    row.querySelector('.w-end').value = minsToInputTime(worker.end);
    saveWorkers();
}

function commitScheduleTableEdit(element) {
    if (!currentSchedule) return;

    const workerIndex = Number(element.dataset.workerIndex);
    const worker = currentSchedule.workers[workerIndex];
    if (!worker) return;

    if (element.dataset.editKind === 'shift') {
        const range = parseTimeRange(element.textContent, worker.start, worker.end);
        if (!range || range.end - range.start > 1440) {
            renderCurrentSchedule();
            return;
        }

        worker.start = range.start;
        worker.end = range.end;
        worker.dur = (worker.end - worker.start) / 60;
        if (autoUpdatesEnabled()) {
            scheduleAllWorkerBreaks(
                currentSchedule.workers,
                currentSchedule.open,
                currentSchedule.close
            );
        }
        syncWorkerEditor(worker);
        refreshCurrentSchedule();
        return;
    }

    const taskType = element.dataset.taskType;
    const taskIndex = worker.tasks.findIndex(task => task.type === taskType);
    const task = worker.tasks[taskIndex];
    if (!task) {
        renderCurrentSchedule();
        return;
    }

    const range = parseTimeRange(element.textContent, task.s, task.e);
    if (!range) {
        renderCurrentSchedule();
        return;
    }

    const start = Math.round(range.start / 15) * 15;
    const end = Math.round(range.end / 15) * 15;
    const conflicts = worker.tasks.some((otherTask, otherIndex) => (
        otherIndex !== taskIndex && start < otherTask.e && end > otherTask.s
    ));
    if (end <= start || start < worker.start || end > getTaskSchedulingEnd(worker) || conflicts) {
        renderCurrentSchedule();
        return;
    }

    task.s = start;
    task.e = end;
    worker.tasks.sort((first, second) => first.s - second.s);
    refreshCurrentSchedule();
}

function setupScheduleTableEditing() {
    const isSmallViewport = window.matchMedia('(max-width: 600px)').matches;

    document.querySelectorAll('.schedule-edit').forEach(element => {
        if (isSmallViewport) {
            element.setAttribute('contenteditable', 'false');
            element.removeAttribute('title');
            element.classList.add('mobile-readonly');
            return;
        }

        element.addEventListener('focus', () => {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(range);
        });

        element.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                element.dataset.forceCommit = 'true';
                element.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                element.dataset.cancelEdit = 'true';
                element.blur();
            }
        });

        element.addEventListener('blur', () => {
            const shouldCommit = autoUpdatesEnabled() || element.dataset.forceCommit === 'true';
            if (element.dataset.cancelEdit === 'true' || !shouldCommit) renderCurrentSchedule();
            else commitScheduleTableEdit(element);
        }, { once: true });
    });
}

function workerCoversFittingBlock(worker, block) {
    return worker.start <= block.start && worker.end >= block.end;
}

function fittingRoomBreakConflict(worker, block) {
    return worker.tasks.find(task => task.s < block.end && task.e > block.start);
}

function minsToWarningTime(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hour = Math.floor(normalized / 60) % 12 || 12;
    return `${hour}:${(normalized % 60).toString().padStart(2, '0')}`;
}

function fittingRoomWorkerOptions(workers, block, role) {
    const otherRole = role === 'g' ? 's' : 'g';
    const unavailableName = block[otherRole];
    const currentName = block[role];
    const eligibleWorkers = workers
        .filter(worker => (
            worker.name !== unavailableName && workerCoversFittingBlock(worker, block)
        ))
        .sort((first, second) => (
            Number(first.name.trim().toLowerCase() === 'nayef')
            - Number(second.name.trim().toLowerCase() === 'nayef')
        ));
    const workerChoices = eligibleWorkers.map(worker => {
        const conflict = fittingRoomBreakConflict(worker, block);
        const conflictType = conflict?.type === 'Lunch' ? 'Lunch' : 'Break';
        const warning = conflict && worker.name !== currentName
            ? ` (❗${conflictType} at ${minsToWarningTime(conflict.s)})`
            : '';
        return { value: worker.name, label: `${worker.name}${warning}`, conflict };
    });
    const choices = [
        { value: '—', label: '—' },
        ...workerChoices.filter(choice => !choice.conflict),
        ...workerChoices.filter(choice => choice.conflict),
        { value: 'Manager', label: 'Manager' }
    ];

    if (!choices.some(choice => choice.value === currentName)) {
        choices.push({ value: currentName, label: currentName });
    }
    return choices.map(choice => (
        `<option value="${escapeHTML(choice.value)}"${choice.value === currentName ? ' selected' : ''}>${escapeHTML(choice.label)}</option>`
    )).join('');
}

function setupFittingRoomAssignmentEditing() {
    document.querySelectorAll('.fitting-assignment-select').forEach(select => {
        select.addEventListener('change', () => {
            if (!currentSchedule) return;

            const block = currentSchedule.fittingRoomBlocks[Number(select.dataset.blockIndex)];
            const role = select.dataset.role;
            if (!block || !['g', 's'].includes(role)) return;

            block[role] = select.value;
            renderCurrentSchedule();
        });
    });
}

function moveConfirmationsDisabled() {
    try {
        return localStorage.getItem('skipBreakMoveConfirm') === 'true';
    } catch (error) {
        return false;
    }
}

function confirmTaskMove(worker, task, newStart) {
    if (moveConfirmationsDisabled()) return Promise.resolve(true);

    const dialog = document.getElementById('moveConfirmDialog');
    const message = document.getElementById('moveConfirmMessage');
    const skipCheckbox = document.getElementById('skipMoveConfirm');
    const duration = task.e - task.s;
    const label = taskDisplayName(task);

    const updateNote = autoUpdatesEnabled()
        ? 'Fitting-room assignments and floor coverage will update.'
        : 'Floor coverage will update; other breaks and fitting-room assignments will stay unchanged.';
    message.textContent = `Move ${worker.name}'s ${label} from ${minsToTime(task.s)}–${minsToTime(task.e)} to ${minsToTime(newStart)}–${minsToTime(newStart + duration)}? ${updateNote}`;
    skipCheckbox.checked = false;
    dialog.returnValue = '';
    dialog.showModal();

    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            const confirmed = dialog.returnValue === 'confirm';
            if (confirmed && skipCheckbox.checked) {
                try {
                    localStorage.setItem('skipBreakMoveConfirm', 'true');
                } catch (error) {
                    // The move still succeeds if browser storage is unavailable.
                }
            }
            resolve(confirmed);
        }, { once: true });
    });
}

async function requestTaskMove(workerIndex, taskIndex, newStart) {
    if (!currentSchedule || moveInProgress) return false;

    const worker = currentSchedule.workers[workerIndex];
    const task = worker && worker.tasks[taskIndex];
    const duration = task ? task.e - task.s : 0;
    if (
        !task
        || newStart === task.s
        || newStart + duration > getTaskSchedulingEnd(worker)
        || taskConflicts(worker, taskIndex, newStart)
    ) return false;

    moveInProgress = true;
    const confirmed = await confirmTaskMove(worker, task, newStart);

    if (confirmed) {
        task.s = newStart;
        task.e = newStart + duration;
        worker.tasks.sort((first, second) => first.s - second.s);
        refreshCurrentSchedule();
    }

    moveInProgress = false;
    return confirmed;
}

function setupTimelineDragging(rangeStart, range, position) {
    const tooltip = document.getElementById('dragTimeTooltip');
    const mobileControls = document.querySelector('.mobile-timeline-controls');
    const mobileSelection = mobileControls?.querySelector('.mobile-task-selection');
    const mobileStepButtons = mobileControls
        ? Array.from(mobileControls.querySelectorAll('[data-task-step]'))
        : [];

    document.querySelectorAll('.task-segment').forEach(segment => {
        const workerIndex = Number(segment.dataset.workerIndex);
        const taskIndex = Number(segment.dataset.taskIndex);

        segment.addEventListener('pointerdown', event => {
            if (event.pointerType === 'touch' || event.button !== 0 || !currentSchedule || moveInProgress) return;

            const worker = currentSchedule.workers[workerIndex];
            const task = worker.tasks[taskIndex];
            const track = segment.parentElement;
            const trackRect = track.getBoundingClientRect();
            const duration = task.e - task.s;
            const originalStart = task.s;
            const minStart = Math.ceil(worker.start / 15) * 15;
            const maxStart = Math.floor((getTaskSchedulingEnd(worker) - duration) / 15) * 15;
            let proposedStart = originalStart;
            let hasConflict = false;

            const updatePreview = pointerEvent => {
                const deltaMinutes = Math.round(
                    ((pointerEvent.clientX - event.clientX) / trackRect.width) * range / 15
                ) * 15;
                proposedStart = Math.min(maxStart, Math.max(minStart, originalStart + deltaMinutes));
                hasConflict = taskConflicts(worker, taskIndex, proposedStart);

                segment.style.left = `${position(proposedStart)}%`;
                segment.classList.add('dragging');
                segment.classList.toggle('invalid', hasConflict);
                segment.setAttribute('aria-grabbed', 'true');

                tooltip.textContent = hasConflict
                    ? 'Conflicts with another break'
                    : `${minsToTime(proposedStart)}–${minsToTime(proposedStart + duration)}`;
                tooltip.classList.toggle('invalid', hasConflict);
                tooltip.classList.add('visible');
                tooltip.style.left = `${Math.min(window.innerWidth - 90, Math.max(90, pointerEvent.clientX))}px`;
                tooltip.style.top = `${Math.max(18, pointerEvent.clientY - 34)}px`;
            };

            const finishDrag = async pointerEvent => {
                window.removeEventListener('pointermove', updatePreview);
                window.removeEventListener('pointerup', finishDrag);
                window.removeEventListener('pointercancel', cancelDrag);
                tooltip.classList.remove('visible', 'invalid');
                segment.setAttribute('aria-grabbed', 'false');

                if (pointerEvent.type === 'pointercancel' || proposedStart === originalStart || hasConflict) {
                    segment.style.left = `${position(originalStart)}%`;
                    segment.classList.remove('dragging', 'invalid');
                    return;
                }

                const confirmed = await requestTaskMove(workerIndex, taskIndex, proposedStart);
                if (!confirmed && segment.isConnected) {
                    segment.style.left = `${position(originalStart)}%`;
                    segment.classList.remove('dragging', 'invalid');
                }
            };

            const cancelDrag = eventToCancel => finishDrag(eventToCancel);
            event.preventDefault();
            window.addEventListener('pointermove', updatePreview);
            window.addEventListener('pointerup', finishDrag);
            window.addEventListener('pointercancel', cancelDrag);
        });

        segment.addEventListener('click', () => {
            if (!window.matchMedia('(max-width: 600px)').matches || !currentSchedule || !mobileControls) return;

            const worker = currentSchedule.workers[workerIndex];
            const task = worker?.tasks[taskIndex];
            if (!task) return;

            document.querySelectorAll('.task-segment.mobile-selected').forEach(selected => {
                selected.classList.remove('mobile-selected');
                selected.setAttribute('aria-pressed', 'false');
            });
            segment.classList.add('mobile-selected');
            segment.setAttribute('aria-pressed', 'true');
            mobileControls.dataset.workerIndex = workerIndex;
            mobileControls.dataset.taskIndex = taskIndex;
            mobileSelection.textContent = `${worker.name} · ${taskDisplayName(task)} · ${minsToTime(task.s)}–${minsToTime(task.e)}`;
            mobileStepButtons.forEach(button => { button.disabled = false; });
        });

        segment.addEventListener('keydown', async event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !currentSchedule) return;
            event.preventDefault();
            const worker = currentSchedule.workers[workerIndex];
            const task = worker.tasks[taskIndex];
            const duration = task.e - task.s;
            const delta = event.key === 'ArrowLeft' ? -15 : 15;
            const minStart = Math.ceil(worker.start / 15) * 15;
            const maxStart = Math.floor((getTaskSchedulingEnd(worker) - duration) / 15) * 15;
            const newStart = Math.min(maxStart, Math.max(minStart, task.s + delta));
            await requestTaskMove(workerIndex, taskIndex, newStart);
        });
    });

    mobileStepButtons.forEach(button => {
        button.addEventListener('click', async () => {
            if (!currentSchedule || moveInProgress) return;

            const workerIndex = Number(mobileControls.dataset.workerIndex);
            const taskIndex = Number(mobileControls.dataset.taskIndex);
            const task = currentSchedule.workers[workerIndex]?.tasks[taskIndex];
            if (!task) return;

            await requestTaskMove(workerIndex, taskIndex, task.s + Number(button.dataset.taskStep));
        });
    });
}

function renderTimeline(workers, fittingRoomBlocks, open, close) {
    const timeline = document.getElementById('shiftTimeline');
    const status = document.getElementById('coverageStatus');

    if (!workers.length) {
        timeline.innerHTML = '<div class="timeline-empty">Add at least one worker to see shift coverage.</div>';
        status.className = 'coverage-status warning';
        status.textContent = 'No shifts scheduled';
        return;
    }

    const rangeStart = Math.floor(Math.min(open, ...workers.map(worker => worker.start)) / 60) * 60;
    const rangeEnd = Math.ceil(Math.max(close, ...workers.map(worker => worker.end)) / 60) * 60;
    const range = Math.max(60, rangeEnd - rangeStart);
    const position = minute => ((minute - rangeStart) / range) * 100;
    const width = (start, end) => ((end - start) / range) * 100;
    const coverage = getCoverageSegments(workers, fittingRoomBlocks, open, close);
    const gaps = coverage.filter(segment => segment.count === 0);
    const gapMinutes = gaps.reduce((total, gap) => total + gap.end - gap.start, 0);

    status.className = `coverage-status ${gaps.length ? 'warning' : 'clear'}`;
    const gapTimes = gaps.map(gap => `${minsToTime(gap.start)}–${minsToTime(gap.end)}`);
    status.textContent = gaps.length
        ? gaps.length <= 2
            ? `Gap${gaps.length > 1 ? 's' : ''}: ${gapTimes.join(', ')}`
            : `${gaps.length} uncovered windows · ${formatDuration(gapMinutes)}`
        : 'No floor gaps';

    const ticks = [];
    for (let minute = rangeStart; minute <= rangeEnd; minute += 60) {
        ticks.push(`<i class="axis-tick" style="left:${position(minute)}%"><span>${minsToTime(minute).replace(':00', '')}</span></i>`);
    }

    const coverageSegments = coverage.map(segment => {
        const state = segment.count === 0 ? 'none' : segment.count === 1 ? 'low' : '';
        const title = segment.count === 0
            ? `Nobody on the floor, ${minsToTime(segment.start)}–${minsToTime(segment.end)}`
            : `${segment.count} on the floor, ${minsToTime(segment.start)}–${minsToTime(segment.end)}`;
        return `<div class="timeline-segment coverage-segment ${state}" style="left:${position(segment.start)}%;width:${width(segment.start, segment.end)}%" title="${title}"><span>${segment.count}</span></div>`;
    }).join('');

    const workerRows = workers.map((worker, workerIndex) => {
        const safeName = escapeHTML(worker.name);
        const work = `<div class="timeline-segment work-segment" style="left:${position(worker.start)}%;width:${width(worker.start, worker.end)}%" title="${safeName}: ${minsToCompactTime(worker.start)}–${minsToCompactTime(worker.end)}"></div>`;
        const fittingRoomIntervals = getFittingRoomIntervals(worker, fittingRoomBlocks).map(interval => (
            `<span class="timeline-segment fitting-segment" style="left:${position(interval.start)}%;width:${width(interval.start, interval.end)}%" aria-label="${interval.role} in fitting room from ${minsToHour(interval.start)} to ${minsToHour(interval.end)}"></span>`
        )).join('');
        const workIntervals = getWorkIntervals(worker).map(interval => {
            const duration = formatDuration(interval.end - interval.start);
            return `<span class="work-gap-label" style="left:${position(interval.start)}%;width:${width(interval.start, interval.end)}%" aria-label="${duration} working from ${minsToTime(interval.start)} to ${minsToTime(interval.end)}"><b>${duration}</b></span>`;
        }).join('');
        const tasks = worker.tasks.map((task, taskIndex) => {
            const isLunch = task.type === 'Lunch';
            const label = taskDisplayName(task);
            const ariaLabel = `Move ${label} for ${safeName}. Currently ${minsToTime(task.s)} to ${minsToTime(task.e)}. Drag, use left and right arrow keys, or select it for the mobile step controls.`;
            return `<div class="timeline-segment task-segment ${isLunch ? 'lunch' : ''}" data-worker-index="${workerIndex}" data-task-index="${taskIndex}" tabindex="0" role="button" aria-grabbed="false" aria-pressed="false" aria-label="${ariaLabel}" style="left:${position(task.s)}%;width:${width(task.s, task.e)}%" title="Drag ${label}: ${minsToTime(task.s)}–${minsToTime(task.e)}"></div>`;
        }).join('');
        return `
            <div class="timeline-label"><strong title="${safeName}">${safeName}</strong><small>${formatDuration(worker.end - worker.start)} · ${minsToCompactTime(worker.start)}–${minsToCompactTime(worker.end)}</small></div>
            <div class="timeline-track">${work}${fittingRoomIntervals}${workIntervals}${tasks}</div>`;
    }).join('');

    timeline.innerHTML = `
        <div class="timeline-scroll">
            <div class="timeline-grid" style="--hour-width:${100 / (range / 60)}%">
                <div class="timeline-axis-label">Store day</div>
                <div class="timeline-axis">${ticks.join('')}</div>
                <div class="timeline-label coverage-label"><strong>On the floor</strong><small>Excludes Managers</small></div>
                <div class="timeline-track coverage-track">${coverageSegments}</div>
                ${workerRows}
            </div>
        </div>
        <div class="mobile-timeline-controls" aria-label="Selected break controls">
            <span class="mobile-task-selection" aria-live="polite">Tap a break or lunch to adjust it.</span>
            <div>
                <button type="button" data-task-step="-15" disabled>−15 min</button>
                <button type="button" data-task-step="15" disabled>+15 min</button>
            </div>
        </div>`;
    setupTimelineDragging(rangeStart, range, position);
}

function renderProvidedShiftVisualizer() {
    const timeline = document.getElementById('providedShiftTimeline');
    if (!timeline) return;

    const rangeStart = 240;
    const rangeEnd = 1320;
    const range = rangeEnd - rangeStart;
    const position = minute => ((minute - rangeStart) / range) * 100;
    const width = (start, end) => ((end - start) / range) * 100;
    const workers = [
        { name: 'Joseph', start: 240, end: 780, tasks: [[360, 375, 'B1'], [540, 600, 'Lunch'], [660, 675, 'B2']], fitting: [] },
        { name: 'Austin', start: 255, end: 780, tasks: [[360, 375, 'B1'], [540, 600, 'Lunch'], [660, 675, 'B2']], fitting: [] },
        { name: 'Tyra', start: 255, end: 780, tasks: [[360, 375, 'B1'], [540, 600, 'Lunch'], [660, 675, 'B2']], fitting: [] },
        { name: 'Parham', start: 255, end: 780, tasks: [[360, 375, 'B1'], [540, 600, 'Lunch'], [660, 675, 'B2']], fitting: [] },
        { name: 'Maria', start: 540, end: 900, tasks: [[660, 675, 'B1'], [780, 825, 'Lunch']], fitting: [[600, 780, 'Sorter'], [840, 900, 'Sorter']] },
        { name: 'Jessica', start: 840, end: 1320, tasks: [[960, 975, 'B1'], [1080, 1125, 'Lunch'], [1200, 1215, 'B2']], fitting: [[840, 900, 'Greeter'], [900, 960, 'Greeter + Sorter'], [960, 1020, 'Sorter'], [1140, 1200, 'Sorter']] },
        { name: 'Rylee', start: 960, end: 1320, tasks: [[1080, 1095, 'B1'], [1155, 1200, 'Lunch']], fitting: [[960, 1020, 'Greeter'], [1020, 1080, 'Sorter']] },
        { name: 'Anh', start: 1020, end: 1320, tasks: [[1140, 1155, 'B1']], fitting: [[1020, 1080, 'Greeter'], [1080, 1140, 'Sorter']] },
        { name: 'Nayef', start: 1020, end: 1320, tasks: [[1155, 1170, 'B1']], fitting: [[1080, 1140, 'Greeter'], [1200, 1320, 'Sorter']] },
        { name: 'Carmen', start: 420, end: 960, tasks: [], fitting: [], manager: true },
        { name: 'Pat', start: 780, end: 1320, tasks: [], fitting: [[780, 840, 'Greeter + Sorter']], manager: true }
    ];
    const boundaries = new Set([rangeStart, rangeEnd]);

    workers.forEach(worker => {
        boundaries.add(worker.start);
        boundaries.add(worker.end);
        worker.tasks.forEach(task => {
            boundaries.add(task[0]);
            boundaries.add(task[1]);
        });
        worker.fitting.forEach(interval => {
            boundaries.add(interval[0]);
            boundaries.add(interval[1]);
        });
    });

    const points = Array.from(boundaries).sort((first, second) => first - second);
    const coverage = [];

    for (let index = 0; index < points.length - 1; index++) {
        const start = points[index];
        const end = points[index + 1];
        const midpoint = start + (end - start) / 2;
        const count = workers.filter(worker => (
            !worker.manager
            && worker.start <= midpoint
            && worker.end > midpoint
            && !worker.tasks.some(task => task[0] < end && task[1] > start)
            && !worker.fitting.some(interval => interval[0] < end && interval[1] > start)
        )).length;
        const previous = coverage[coverage.length - 1];

        if (previous && previous.count === count && previous.end === start) previous.end = end;
        else coverage.push({ start, end, count });
    }

    const ticks = [];
    for (let minute = rangeStart; minute <= rangeEnd; minute += 60) {
        ticks.push(`<i class="axis-tick" style="left:${position(minute)}%"><span>${minsToTime(minute).replace(':00', '')}</span></i>`);
    }

    const coverageSegments = coverage.map(segment => {
        const state = segment.count === 0 ? 'none' : segment.count === 1 ? 'low' : '';
        const title = segment.count === 0
            ? `Nobody on the floor, ${minsToTime(segment.start)} to ${minsToTime(segment.end)}`
            : `${segment.count} on the floor, ${minsToTime(segment.start)} to ${minsToTime(segment.end)}`;
        return `<span class="timeline-segment coverage-segment ${state}" style="left:${position(segment.start)}%;width:${width(segment.start, segment.end)}%" title="${title}"><span>${segment.count}</span></span>`;
    }).join('');

    const workerRows = workers.map(worker => {
        const safeName = escapeHTML(worker.name);
        const managerBadge = worker.manager ? '<span class="manager-badge">Manager</span>' : '';
        const work = `<span class="timeline-segment work-segment" style="left:${position(worker.start)}%;width:${width(worker.start, worker.end)}%" title="${safeName}: ${minsToCompactTime(worker.start)}&ndash;${minsToCompactTime(worker.end)}"></span>`;
        const fitting = worker.fitting.map(interval => {
            const roleLabel = interval[2] === 'Greeter + Sorter' ? 'G+S' : interval[2].charAt(0);
            return `<span class="timeline-segment fitting-segment reference-fitting-segment" style="left:${position(interval[0])}%;width:${width(interval[0], interval[1])}%" aria-label="${interval[2]} in fitting room from ${minsToTime(interval[0])} to ${minsToTime(interval[1])}">${roleLabel}</span>`;
        }).join('');
        const tasks = worker.tasks.map(task => {
            const label = taskDisplayName({ type: task[2] });
            return `<span class="timeline-segment task-segment ${task[2] === 'Lunch' ? 'lunch' : ''}" style="left:${position(task[0])}%;width:${width(task[0], task[1])}%" aria-label="${label}, ${minsToTime(task[0])} to ${minsToTime(task[1])}" title="${label}: ${minsToTime(task[0])}&ndash;${minsToTime(task[1])}"></span>`;
        }).join('');

        return `
            <div class="timeline-label"><strong title="${safeName}">${safeName}${managerBadge}</strong><small>${formatDuration(worker.end - worker.start)} &middot; ${minsToCompactTime(worker.start)}&ndash;${minsToCompactTime(worker.end)}</small></div>
            <div class="timeline-track">${work}${fitting}${tasks}</div>`;
    }).join('');

    timeline.innerHTML = `
        <div class="timeline-scroll">
            <div class="timeline-grid" style="--hour-width:${100 / (range / 60)}%">
                <div class="timeline-axis-label">Provided day</div>
                <div class="timeline-axis">${ticks.join('')}</div>
                <div class="timeline-label coverage-label"><strong>On the floor</strong><small>Excludes managers, breaks, lunch &amp; fitting room</small></div>
                <div class="timeline-track coverage-track">${coverageSegments}</div>
                ${workerRows}
            </div>
        </div>`;
}

function render(workers, fr, open, close) {
    document.getElementById('results').style.display = 'block';
    renderTimeline(workers, fr, open, close);
    const bBody = document.querySelector('#breaksTable tbody');
    bBody.innerHTML = '';
    workers.forEach((w, workerIndex) => {
        const b1 = w.tasks.find(t => t.type === 'B1');
        const lunch = w.tasks.find(t => t.type === 'Lunch');
        const b2 = w.tasks.find(t => t.type === 'B2');
        bBody.insertAdjacentHTML('beforeend', `<tr>
        <td data-label="Worker / Shift"><strong>${escapeHTML(w.name)}</strong><br><span class="schedule-edit shift-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-edit-kind="shift" title="Edit shift and press Enter">${minsToCompactTime(w.start)}-${minsToCompactTime(w.end)}</span></td>
        <td data-label="Break 1">${b1 ? `<span class="time-tag schedule-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-task-type="B1" title="Edit break and press Enter">${minsToTime(b1.s)}-${minsToTime(b1.e)}</span>` : '—'}</td>
        <td data-label="Lunch">${lunch ? `<span class="time-tag schedule-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-task-type="Lunch" title="Edit lunch and press Enter">${minsToTime(lunch.s)}-${minsToTime(lunch.e)}</span>` : '—'}</td>
        <td data-label="Break 2">${b2 ? `<span class="time-tag schedule-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-task-type="B2" title="Edit break and press Enter">${minsToTime(b2.s)}-${minsToTime(b2.e)}</span>` : '—'}</td>
    </tr>`);
    });
    setupScheduleTableEditing();

    const fBody = document.querySelector('#fittingRoomTable tbody');
    fBody.innerHTML = '';
    fr.forEach((b, blockIndex) => {
        fBody.insertAdjacentHTML('beforeend', `<tr class="${b.isClosing ? 'highlight-row' : ''}">
        <td data-label="Time"><div class="fitting-time-cell"><strong>${b.time}</strong>${b.isClosing ? '<span class="closing-badge">Closing</span>' : ''}</div></td>
        <td data-label="Greeter" class="${b.g === 'Manager' ? 'manager-assignment-cell' : ''}"><select class="fitting-assignment-select" data-block-index="${blockIndex}" data-role="g" aria-label="Greeter for ${b.time}">${fittingRoomWorkerOptions(workers, b, 'g')}</select></td>
        <td data-label="Sorter" class="${b.s === 'Manager' ? 'manager-assignment-cell' : ''}"><select class="fitting-assignment-select" data-block-index="${blockIndex}" data-role="s" aria-label="Sorter for ${b.time}">${fittingRoomWorkerOptions(workers, b, 's')}</select></td>
    </tr>`);
    });
    setupFittingRoomAssignmentEditing();
}

window.addEventListener('load', () => {
    setupHourPicker('storeOpen', '10:00');
    setupHourPicker('storeClose', '21:00');
    window.matchMedia('(max-width: 600px)').addEventListener('change', () => {
        if (currentSchedule) renderCurrentSchedule();
    });
    const workers = loadSavedWorkers();
    (workers === null ? samples : workers).forEach(worker => addWorkerRow(worker, false));
    ensureNewWorkerRow();
    generate();
    renderProvidedShiftVisualizer();
    const workersContainer = document.getElementById('workersContainer');
    workersContainer.addEventListener('input', event => {
        const row = event.target.closest('.worker-row');
        if (event.target.matches('.w-name')) {
            const selectionStart = event.target.selectionStart;
            const selectionEnd = event.target.selectionEnd;
            const capitalizedName = capitalizeFirstLetter(event.target.value);

            if (capitalizedName !== event.target.value) {
                event.target.value = capitalizedName;
                if (selectionStart !== null && selectionEnd !== null) {
                    event.target.setSelectionRange(selectionStart, selectionEnd);
                }
            }
        }
        if (event.target.matches('.w-start, .w-end')) {
            event.target.removeAttribute('aria-invalid');
        }
        if (row?.dataset.newWorker === 'true') activateNewWorkerRow(row);
        else saveWorkers();
    });
    workersContainer.addEventListener('focusout', event => {
        if (!event.target.matches('.w-start, .w-end')) return;
        normalizeShiftTimeInput(event.target);
        saveWorkers();
    });
    workersContainer.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !event.target.matches('.w-start, .w-end')) return;
        event.preventDefault();
        event.target.blur();
    });
});
