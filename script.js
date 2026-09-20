const samples = [
    { n: "James", s: "09:00", e: "18:00" }, { n: "Mary", s: "09:00", e: "14:00" },
    { n: "John", s: "10:00", e: "16:00" }, { n: "Lauren", s: "12:00", e: "21:00" },
    { n: "Robert", s: "13:00", e: "22:00" }, { n: "Patricia", s: "14:00", e: "22:00" },
    { n: "Michael", s: "16:00", e: "22:00" }, { n: "Barbara", s: "17:00", e: "22:00" }
];

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

function minsToCompactTime(m) {
    return m % 60 === 0 ? minsToHour(m) : minsToTime(m);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
}

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours ? `${hours}h` : ''}${hours && mins ? ' ' : ''}${mins ? `${mins}m` : ''}` || '0m';
}

function addWorkerRow(data = { n: '', s: '', e: '' }) {
    const id = Math.random().toString(36).substring(2, 9);
    document.getElementById('workersContainer').insertAdjacentHTML('beforeend', `
    <div class="worker-row" id="${id}">
        <div class="input-group"><label>Name</label><input type="text" class="w-name" value="${escapeHTML(data.n)}"></div>
        <div class="input-group"><label>Start</label><input type="time" class="w-start" value="${escapeHTML(data.s)}"></div>
        <div class="input-group"><label>End</label><input type="time" class="w-end" value="${escapeHTML(data.e)}"></div>
        <button class="btn-remove" aria-label="Remove worker" onclick="document.getElementById('${id}').remove()">&times;</button>
    </div>`);
}

function clearWorkers() {
    // remove all worker rows from the DOM
    document.getElementById('workersContainer').innerHTML = '';
    currentSchedule = null;
    document.getElementById('results').style.display = 'none';
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
            block.s = choice ? choice.name : 'Manager/Lead';
        }

        if (start >= open + 120 && start < close - 120) {
            const options = workers.filter(worker => isAvailable(worker, [block.s]));
            const fallbackOptions = workers.filter(worker => (
                worker.name !== block.s
                && coversBlock(worker)
                && !isOnBreak(worker)
            ));
            const choice = chooseWorker(options) || chooseWorker(fallbackOptions);
            block.g = choice ? choice.name : 'Manager/Lead';
        }

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
    if (durationHours >= 9) {
        return [{ d: 15, n: 'B1' }, { d: 60, n: 'Lunch' }, { d: 15, n: 'B2' }];
    }
    if (durationHours > 6) {
        return [{ d: 15, n: 'B1' }, { d: 45, n: 'Lunch' }, { d: 15, n: 'B2' }];
    }
    if (durationHours >= 6) {
        return [{ d: 15, n: 'B1' }, { d: 45, n: 'Lunch' }];
    }
    if (durationHours >= 5) return [{ d: 15, n: 'B1' }];
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

function scheduleAllWorkerBreaks(workers, close) {
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
}

function generate() {
    const open = timeToMins(document.getElementById('storeOpen').value);
    let close = timeToMins(document.getElementById('storeClose').value);
    if (close < open) close += 1440;
    const workers = [];
    document.querySelectorAll('.worker-row').forEach(row => {
        const name = row.querySelector('.w-name').value.trim();
        const startValue = row.querySelector('.w-start').value;
        const endValue = row.querySelector('.w-end').value;
        if (!name || !startValue || !endValue) return;
        let s = timeToMins(startValue);
        let e = timeToMins(endValue);
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

    // Place breaks so every working interval is as even as 15-minute snapping allows.
    // Other employees' breaks are used as a light tie-breaker so spacing stays primary.
    scheduleAllWorkerBreaks(workers, close);

    const fittingRoomBlocks = createFittingRoomRotation(workers, open, close);
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
    const hours = Math.floor(normalized / 60).toString().padStart(2, '0');
    const mins = (normalized % 60).toString().padStart(2, '0');
    return `${hours}:${mins}`;
}

function parseClockValue(value, referenceMinutes) {
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

    let result = hours * 60 + minutes;
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

function refreshCurrentSchedule() {
    if (!currentSchedule) return;
    currentSchedule.fittingRoomBlocks = createFittingRoomRotation(
        currentSchedule.workers,
        currentSchedule.open,
        currentSchedule.close
    );
    render(
        currentSchedule.workers,
        currentSchedule.fittingRoomBlocks,
        currentSchedule.open,
        currentSchedule.close
    );
}

function syncWorkerEditor(worker) {
    const row = document.getElementById(worker.editorId);
    if (!row) return;
    row.querySelector('.w-start').value = minsToInputTime(worker.start);
    row.querySelector('.w-end').value = minsToInputTime(worker.end);
}

function commitScheduleTableEdit(element) {
    if (!currentSchedule) return;

    const workerIndex = Number(element.dataset.workerIndex);
    const worker = currentSchedule.workers[workerIndex];
    if (!worker) return;

    if (element.dataset.editKind === 'shift') {
        const range = parseTimeRange(element.textContent, worker.start, worker.end);
        if (!range || range.end - range.start > 1440) {
            refreshCurrentSchedule();
            return;
        }

        worker.start = range.start;
        worker.end = range.end;
        worker.dur = (worker.end - worker.start) / 60;
        scheduleAllWorkerBreaks(currentSchedule.workers, currentSchedule.close);
        syncWorkerEditor(worker);
        refreshCurrentSchedule();
        return;
    }

    const taskType = element.dataset.taskType;
    const taskIndex = worker.tasks.findIndex(task => task.type === taskType);
    const task = worker.tasks[taskIndex];
    if (!task) {
        refreshCurrentSchedule();
        return;
    }

    const range = parseTimeRange(element.textContent, task.s, task.e);
    if (!range) {
        refreshCurrentSchedule();
        return;
    }

    const start = Math.round(range.start / 15) * 15;
    const end = Math.round(range.end / 15) * 15;
    const conflicts = worker.tasks.some((otherTask, otherIndex) => (
        otherIndex !== taskIndex && start < otherTask.e && end > otherTask.s
    ));
    if (end <= start || start < worker.start || end > getTaskSchedulingEnd(worker) || conflicts) {
        refreshCurrentSchedule();
        return;
    }

    task.s = start;
    task.e = end;
    worker.tasks.sort((first, second) => first.s - second.s);
    refreshCurrentSchedule();
}

function setupScheduleTableEditing() {
    document.querySelectorAll('.schedule-edit').forEach(element => {
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
            const autoUpdate = document.getElementById('autoUpdateToggle').checked;
            const shouldCommit = autoUpdate || element.dataset.forceCommit === 'true';
            if (element.dataset.cancelEdit === 'true' || !shouldCommit) refreshCurrentSchedule();
            else commitScheduleTableEdit(element);
        }, { once: true });
    });
}

function workerCanCoverFittingBlock(worker, block) {
    const coversFullBlock = worker.start <= block.start && worker.end >= block.end;
    const onBreak = worker.tasks.some(task => task.s < block.end && task.e > block.start);
    return coversFullBlock && !onBreak;
}

function fittingRoomWorkerOptions(workers, block, role) {
    const otherRole = role === 'g' ? 's' : 'g';
    const unavailableName = block[otherRole];
    const currentName = block[role];
    const availableWorkers = workers
        .filter(worker => (
            worker.name !== unavailableName && workerCanCoverFittingBlock(worker, block)
        ))
        .sort((first, second) => (
            Number(first.name.trim().toLowerCase() === 'nayef')
            - Number(second.name.trim().toLowerCase() === 'nayef')
        ));
    const choices = ['—', 'Manager/Lead', ...availableWorkers.map(worker => worker.name)];

    if (!choices.includes(currentName)) choices.push(currentName);
    return choices.map(choice => (
        `<option value="${escapeHTML(choice)}"${choice === currentName ? ' selected' : ''}>${escapeHTML(choice)}</option>`
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
            render(
                currentSchedule.workers,
                currentSchedule.fittingRoomBlocks,
                currentSchedule.open,
                currentSchedule.close
            );
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

    message.textContent = `Move ${worker.name}'s ${label} from ${minsToTime(task.s)}–${minsToTime(task.e)} to ${minsToTime(newStart)}–${minsToTime(newStart + duration)}? Fitting-room assignments and floor coverage will update.`;
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

    document.querySelectorAll('.task-segment').forEach(segment => {
        const workerIndex = Number(segment.dataset.workerIndex);
        const taskIndex = Number(segment.dataset.taskIndex);

        segment.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !currentSchedule || moveInProgress) return;

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
            const ariaLabel = `Move ${label} for ${safeName}. Currently ${minsToTime(task.s)} to ${minsToTime(task.e)}. Drag or use left and right arrow keys.`;
            return `<div class="timeline-segment task-segment ${isLunch ? 'lunch' : ''}" data-worker-index="${workerIndex}" data-task-index="${taskIndex}" tabindex="0" role="button" aria-grabbed="false" aria-label="${ariaLabel}" style="left:${position(task.s)}%;width:${width(task.s, task.e)}%" title="Drag ${label}: ${minsToTime(task.s)}–${minsToTime(task.e)}"></div>`;
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
                <div class="timeline-label coverage-label"><strong>On the floor</strong><small>Excludes breaks &amp; fitting room</small></div>
                <div class="timeline-track coverage-track">${coverageSegments}</div>
                ${workerRows}
            </div>
        </div>`;
    setupTimelineDragging(rangeStart, range, position);
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
        <td><strong>${escapeHTML(w.name)}</strong><br><span class="schedule-edit shift-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-edit-kind="shift" title="Edit shift and press Enter">${minsToCompactTime(w.start)}-${minsToCompactTime(w.end)}</span></td>
        <td>${b1 ? `<span class="time-tag schedule-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-task-type="B1" title="Edit break and press Enter">${minsToTime(b1.s)}-${minsToTime(b1.e)}</span>` : '—'}</td>
        <td>${lunch ? `<span class="time-tag schedule-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-task-type="Lunch" title="Edit lunch and press Enter">${minsToTime(lunch.s)}-${minsToTime(lunch.e)}</span>` : '—'}</td>
        <td>${b2 ? `<span class="time-tag schedule-edit" contenteditable="true" spellcheck="false" data-worker-index="${workerIndex}" data-task-type="B2" title="Edit break and press Enter">${minsToTime(b2.s)}-${minsToTime(b2.e)}</span>` : '—'}</td>
    </tr>`);
    });
    setupScheduleTableEditing();

    const fBody = document.querySelector('#fittingRoomTable tbody');
    fBody.innerHTML = '';
    fr.forEach((b, blockIndex) => {
        fBody.insertAdjacentHTML('beforeend', `<tr class="${b.isClosing ? 'highlight-row' : ''}">
        <td><div class="fitting-time-cell"><strong>${b.time}</strong>${b.isClosing ? '<span class="closing-badge">Closing</span>' : ''}</div></td>
        <td><select class="fitting-assignment-select" data-block-index="${blockIndex}" data-role="g" aria-label="Greeter for ${b.time}">${fittingRoomWorkerOptions(workers, b, 'g')}</select></td>
        <td><select class="fitting-assignment-select" data-block-index="${blockIndex}" data-role="s" aria-label="Sorter for ${b.time}">${fittingRoomWorkerOptions(workers, b, 's')}</select></td>
    </tr>`);
    });
    setupFittingRoomAssignmentEditing();
}

window.onload = () => samples.forEach(s => addWorkerRow(s));
