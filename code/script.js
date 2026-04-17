
let groupsData = [];
const days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const MAX_PAIRS_PER_DAY_LIMIT = 7;

let activeDayIndices = [0, 1, 2, 3, 4, 5];
let teacherAvailability = {};

const groupsContainer = document.getElementById("groupsContainer");
const applyGroupsBtn = document.getElementById("applyGroupsBtn");
const generateBtn = document.getElementById("generateScheduleBtn");
const exportBtn = document.getElementById("exportExcelBtn");
const scheduleOutput = document.getElementById("scheduleOutput");
const updateTeachersBtn = document.getElementById("updateTeachersBtn");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const loadConfigBtn = document.getElementById("loadConfigBtn");

function parseAvailability(str) {
    if (!str) return [];
    const nums = new Set();
    const parts = str.split(/[,;]/).map(p => p.trim()).filter(Boolean);
    for (let part of parts) {
        if (part.includes("-")) {
            const [s, e] = part.split("-").map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let i = Math.max(1,s); i <= Math.min(7,e); i++) nums.add(i-1);
            }
        } else {
            const n = parseInt(part);
            if (n >= 1 && n <= 7) nums.add(n-1);
        }
    }
    return Array.from(nums).sort((a,b)=>a-b);
}

function isTeacherAvailable(teacher, dayIndex, pairIdx) {
    if (!teacherAvailability[teacher]) return true;
    const avail = teacherAvailability[teacher][dayIndex];
    return avail ? avail.includes(pairIdx) : false;
}

function escapeHtml(str) {
    return (str || '').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]);
}

// ==================== ПОИСК КОНФЛИКТОВ ====================
function findTeacherConflicts(schedule) {
    const conflicts = new Map(); // ключ: "teacher|day|pair"
    
    // Сначала отмечаем все занятия
    for (let g = 0; g < schedule.length; g++) {
        for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
            for (let pairIdx = 0; pairIdx < 7; pairIdx++) {
                const lesson = schedule[g][dayIdx][pairIdx];
                if (lesson && lesson.teacher) {
                    const key = `${lesson.teacher}|${dayIdx}|${pairIdx}`;
                    if (!conflicts.has(key)) {
                        conflicts.set(key, []);
                    }
                    conflicts.get(key).push({ group: g, day: dayIdx, pair: pairIdx });
                }
            }
        }
    }
    
    // Отмечаем конфликтующие (где больше одного занятия)
    const conflictSet = new Set();
    for (const [key, positions] of conflicts.entries()) {
        if (positions.length > 1) {
            positions.forEach(pos => {
                conflictSet.add(`${pos.group}|${pos.day}|${pos.pair}`);
            });
        }
    }
    
    return conflictSet;
}

// ==================== СОХРАНЕНИЕ / ЗАГРУЗКА ====================
function saveConfig() {
    const config = { groupsData, activeDayIndices, teacherAvailability };
    localStorage.setItem('scheduleConfig', JSON.stringify(config));
}

function loadConfig() {
    const saved = localStorage.getItem('scheduleConfig');
    if (!saved) return false;
    try {
        const config = JSON.parse(saved);
        groupsData = config.groupsData || [];
        activeDayIndices = config.activeDayIndices || [0,1,2,3,4,5];
        teacherAvailability = config.teacherAvailability || {};
        document.getElementById("groupCount").value = groupsData.length || 2;
        return true;
    } catch(e) { return false; }
}

function autoLoadConfig() {
    if (loadConfig()) {
        renderGroups();
        renderActiveDays();
        renderTeachersAvailability();
    }
}

// ==================== DRAG & DROP ====================
let draggedGroup = null, draggedDay = null, draggedPair = null;

function makeScheduleDraggable() {
    const cells = scheduleOutput.querySelectorAll('td[draggable="true"]');
    cells.forEach(cell => {
        cell.addEventListener('dragstart', e => {
            draggedGroup = +cell.dataset.group;
            draggedDay = +cell.dataset.day;
            draggedPair = +cell.dataset.pair;
            cell.classList.add('dragging');
        });

        cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
    });

    const allCells = scheduleOutput.querySelectorAll('td');
    allCells.forEach(cell => {
        cell.addEventListener('dragover', e => e.preventDefault());
        cell.addEventListener('drop', e => {
            e.preventDefault();
            const targetGroup = +cell.dataset.group;
            const targetDay = +cell.dataset.day;
            const targetPair = +cell.dataset.pair;

            if (targetGroup !== draggedGroup) return;

            const schedule = window.currentSchedule;
            const temp = schedule[draggedGroup][draggedDay][draggedPair];
            schedule[draggedGroup][draggedDay][draggedPair] = schedule[targetGroup][targetDay][targetPair];
            schedule[targetGroup][targetDay][targetPair] = temp;

            displaySchedule(schedule);
        });
    });
}

// ==================== ГЕНЕРАЦИЯ И ОТОБРАЖЕНИЕ ====================
function generateSchedule() {
    groupsData.forEach(group => {
        group.subjects.forEach(s => {
            if (!s.name?.trim()) s.name = "Без названия";
            if (!s.teacher?.trim()) s.teacher = "Неизвестный";
        });
    });

    if (activeDayIndices.length === 0) {
        scheduleOutput.innerHTML = `<div class="warning">⚠️ Нет рабочих дней!</div>`;
        exportBtn.style.display = 'none';
        return;
    }

    const MAX_ATTEMPTS = 800;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let schedule = groupsData.map(() => days.map(() => new Array(7).fill(null)));
        let teacherBusy = new Map();

        let remaining = groupsData.map(group => {
            let lessons = [];
            group.subjects.forEach(subj => {
                for (let i = 0; i < subj.hoursPerWeek; i++) {
                    lessons.push({ name: subj.name, teacher: subj.teacher });
                }
            });
            return lessons.sort(() => Math.random() - 0.5);
        });

        let placed = 0;
        const total = remaining.reduce((a,b) => a + b.length, 0);
        let progress = true;

        while (placed < total && progress) {
            progress = false;
            let groupOrder = [...Array(groupsData.length).keys()].sort(() => Math.random() - 0.5);

            for (let gi of groupOrder) {
                if (remaining[gi].length === 0) continue;
                const lesson = remaining[gi][0];
                const group = groupsData[gi];
                let possibleSlots = [];

                for (let day of activeDayIndices) {
                    if (schedule[gi][day].filter(l => l !== null).length >= group.maxPairsPerDay) continue;
                    if (schedule[gi][day].filter(l => l && l.name === lesson.name).length >= group.maxSamePerDay) continue;

                    for (let pairIdx = 0; pairIdx < 7; pairIdx++) {
                        if (schedule[gi][day][pairIdx] !== null) continue;
                        if (teacherBusy.has(lesson.teacher) && teacherBusy.get(lesson.teacher).has(`${day}-${pairIdx}`)) continue;
                        if (!isTeacherAvailable(lesson.teacher, day, pairIdx)) continue;

                        possibleSlots.push({ day, pairIdx });
                    }
                }

                if (possibleSlots.length > 0) {
                    possibleSlots.sort((a, b) => a.pairIdx - b.pairIdx);
                    const best = possibleSlots[0];

                    schedule[gi][best.day][best.pairIdx] = lesson;
                    if (!teacherBusy.has(lesson.teacher)) teacherBusy.set(lesson.teacher, new Set());
                    teacherBusy.get(lesson.teacher).add(`${best.day}-${best.pairIdx}`);

                    remaining[gi].shift();
                    placed++;
                    progress = true;
                }
            }
        }

        if (placed === total) {
            displaySchedule(schedule);
            return;
        }
    }

    scheduleOutput.innerHTML = `<div class="warning">❌ Не удалось составить расписание.</div>`;
    exportBtn.style.display = 'none';
}

function displaySchedule(schedule) {
    window.currentSchedule = schedule;
    window.currentGroupsData = groupsData;
    window.currentActiveDayIndices = [...activeDayIndices];
    
    // Находим конфликты преподавателей
    const conflicts = findTeacherConflicts(schedule);

    let html = `<h3>📋 Расписание на неделю <small style="color:#94a3b8;">(перетаскивайте уроки мышкой)</small></h3>`;

    const displayDayIndices = [...activeDayIndices];
    const displayDays = displayDayIndices.map(i => days[i]);

    for (let g = 0; g < schedule.length; g++) {
        const group = groupsData[g];
        const groupSchedule = schedule[g];

        // Подсчёт статистики конфликтов для группы
        let groupConflicts = 0;
        for (let day of displayDayIndices) {
            for (let pair = 0; pair < 7; pair++) {
                if (conflicts.has(`${g}|${day}|${pair}`)) groupConflicts++;
            }
        }

        const dayStats = displayDayIndices.map(di => 
            `${days[di]}: ${groupSchedule[di].filter(l => l !== null).length} пар`
        ).join(", ");

        html += `
            <div style="margin-top: 35px;">
                <h4>📖 ${group.name} ${groupConflicts > 0 ? `<span style="color: #ef4444; font-size: 0.9rem;">⚠️ ${groupConflicts} конфликтов</span>` : ''}</h4>
                <div class="stats">📊 ${dayStats}</div>
                <table>
                    <thead>
                        <tr>
                            <th>№ пары</th>
                            ${displayDays.map(d => `<th>${d}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>`;

        for (let pairIdx = 0; pairIdx < 7; pairIdx++) {
            html += `<tr><td class="group-title"><strong>${pairIdx + 1}</strong></td>`;

            for (let dIdx of displayDayIndices) {
                const lesson = groupSchedule[dIdx][pairIdx];
                const isOccupied = !!lesson;
                const isConflict = conflicts.has(`${g}|${dIdx}|${pairIdx}`);
                
                let cellClass = '';
                if (isConflict) cellClass = 'conflict';
                
                html += `<td 
                            data-group="${g}" 
                            data-day="${dIdx}" 
                            data-pair="${pairIdx}"
                            ${isOccupied ? 'draggable="true"' : ''}
                            class="${cellClass}"
                            style="min-height:72px; ${!isConflict && isOccupied ? 'background:#1e3a8a;' : !isConflict && !isOccupied ? 'background:#1e2937;' : ''}">
                            ${isOccupied ? `
                                <strong>${escapeHtml(lesson.name)}</strong><br>
                                <span style="font-size:0.82rem;color:#93c5fd;">${escapeHtml(lesson.teacher)}</span>
                            ` : '—'}
                            </td>`;
            }
            html += `</tr>`;
        }
        html += `</tbody></table></div>`;
    }

    scheduleOutput.innerHTML = html;
    exportBtn.style.display = "inline-block";

    setTimeout(makeScheduleDraggable, 100);
}

function exportToExcel() {
    if (!window.currentSchedule) return alert("Сначала сгенерируйте расписание!");

    const wb = XLSX.utils.book_new();
    const today = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
    
    // Находим конфликты для экспорта
    const conflicts = findTeacherConflicts(window.currentSchedule);

    window.currentSchedule.forEach((groupSchedule, g) => {
        const group = window.currentGroupsData[g];
        const displayDayIndices = window.currentActiveDayIndices;
        const displayDays = displayDayIndices.map(i => days[i]);

        let tableData = [["№ пары", ...displayDays]];
        
        // Добавляем строку с предупреждением о конфликтах
        let hasConflicts = false;
        for (let day of displayDayIndices) {
            for (let pair = 0; pair < 7; pair++) {
                if (conflicts.has(`${g}|${day}|${pair}`)) {
                    hasConflicts = true;
                    break;
                }
            }
        }
        
        if (hasConflicts) {
            tableData.push(["ВНИМАНИЕ!", ...displayDays.map(() => "Есть конфликты преподавателей!")]);
        }

        for (let p = 0; p < 7; p++) {
            let row = [p + 1];
            for (let dIdx of displayDayIndices) {
                const lesson = groupSchedule[dIdx][p];
                const isConflict = conflicts.has(`${g}|${dIdx}|${p}`);
                let cellText = lesson ? `${lesson.name}\n${lesson.teacher}` : "—";
                if (isConflict) cellText = "⚠️ КОНФЛИКТ! " + cellText;
                row.push(cellText);
            }
            tableData.push(row);
        }

        const ws = XLSX.utils.aoa_to_sheet(tableData);
        ws['!cols'] = [{wch: 8}, ...displayDays.map(() => ({wch: 35}))];

        let sheetName = group.name.replace(/[:\\\/*?[\]]/g, '_').substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const fileName = `Расписание_${window.currentGroupsData.map(g => g.name.replace(/\s+/g,'_')).join('_')}_${today}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

// ==================== Render функции ====================
function renderActiveDays() {
    const container = document.getElementById("activeDaysContainer");
    container.innerHTML = "";
    days.forEach((dayName, idx) => {
        const checked = activeDayIndices.includes(idx) ? "checked" : "";
        container.innerHTML += `
            <label style="display:inline-flex; align-items:center; margin-right:12px; cursor:pointer; color:#cbd5e1;">
                <input type="checkbox" class="day-cb" data-idx="${idx}" ${checked} style="margin-right:4px;">
                ${dayName}
            </label>`;
    });

    container.querySelectorAll(".day-cb").forEach(cb => {
        cb.addEventListener("change", () => {
            const idx = +cb.dataset.idx;
            if (cb.checked) activeDayIndices.push(idx);
            else activeDayIndices = activeDayIndices.filter(i => i !== idx);
            activeDayIndices.sort((a,b)=>a-b);
        });
    });
}

function renderTeachersAvailability() {
    const container = document.getElementById("teachersContainer");
    container.innerHTML = "";

    const uniqueTeachers = new Set();
    groupsData.forEach(g => g.subjects.forEach(s => s.teacher?.trim() && uniqueTeachers.add(s.teacher.trim())));

    if (uniqueTeachers.size === 0) {
        container.innerHTML = `<div class="warning">Добавьте предметы с преподавателями.</div>`;
        return;
    }

    Array.from(uniqueTeachers).sort().forEach(teacher => {
        if (!teacherAvailability[teacher]) {
            teacherAvailability[teacher] = Object.fromEntries(days.map((_,i) => [i, [0,1,2,3,4,5,6]]));
        }

        let html = `<div class="card teacher-card">
            <div style="padding:12px 16px; background:#334155; font-weight:bold; color:#93c5fd;">${escapeHtml(teacher)}</div>
            <div style="padding:15px;">`;

        for (let d = 0; d < days.length; d++) {
            const avail = teacherAvailability[teacher][d] || [];
            html += `
                <div style="display:flex; align-items:center; margin-bottom:12px; gap:10px;">
                    <label style="width:140px; font-weight:600;">${days[d]}:</label>
                    <input type="text" class="avail-input" 
                            data-teacher="${escapeHtml(teacher)}" data-day="${d}" 
                            value="${avail.map(p=>p+1).join(',')}" 
                            style="flex:1; min-width:220px;">
                    <span style="font-size:0.8rem;color:#94a3b8;">(1-7)</span>
                </div>`;
        }
        html += `</div></div>`;
        container.innerHTML += html;
    });

    container.querySelectorAll(".avail-input").forEach(input => {
        input.addEventListener("change", e => {
            const teacher = e.target.dataset.teacher;
            const day = +e.target.dataset.day;
            teacherAvailability[teacher][day] = parseAvailability(e.target.value);
        });
    });
}

function renderGroups() {
    const groupCount = parseInt(document.getElementById("groupCount").value) || 1;
    while (groupsData.length < groupCount) {
        groupsData.push({ name: `Группа ${groupsData.length + 1}`, subjects: [], maxPairsPerDay: 4, maxSamePerDay: 2 });
    }
    while (groupsData.length > groupCount) groupsData.pop();

    groupsContainer.innerHTML = "";

    groupsData.forEach((group, i) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "card group-card";
        groupDiv.innerHTML = `
            <div class="group-header">
                <input type="text" class="group-name-input" value="${escapeHtml(group.name)}" data-idx="${i}">
                <div>
                    <label>Макс пар/день:</label>
                    <input type="number" class="group-max-pairs" data-idx="${i}" min="1" max="${MAX_PAIRS_PER_DAY_LIMIT}" value="${group.maxPairsPerDay}" style="width:70px;">
                    <label style="margin-left:12px;">Макс одинаковых/день:</label>
                    <input type="number" class="group-max-same" data-idx="${i}" min="1" max="5" value="${group.maxSamePerDay}" style="width:70px;">
                </div>
            </div>
            <div id="subjects-list-${i}"></div>
            <button class="add-subject-btn" data-idx="${i}">+ Добавить предмет</button>
            <button class="remove-group-btn danger-btn" data-idx="${i}">Удалить группу</button>
        `;
        groupsContainer.appendChild(groupDiv);

        groupDiv.querySelector('.group-name-input').addEventListener('change', function() {
            groupsData[i].name = this.value.trim() || `Группа ${i+1}`;
        });

        const subjectsContainer = document.getElementById(`subjects-list-${i}`);

        const renderSubjects = () => {
            subjectsContainer.innerHTML = "";
            if (group.subjects.length === 0) {
                group.subjects.push({ name: "Математика", teacher: "Иванов А.А.", hoursPerWeek: 3 });
            }
            group.subjects.forEach((subj, subjIdx) => {
                const div = document.createElement("div");
                div.className = "subject-item";
                div.innerHTML = `
                    <input type="text" class="subject-name" value="${escapeHtml(subj.name)}" data-group="${i}" data-subj="${subjIdx}" data-field="name">
                    <input type="text" class="teacher-name" value="${escapeHtml(subj.teacher)}" data-group="${i}" data-subj="${subjIdx}" data-field="teacher">
                    <label>Пар в неделю:</label>
                    <input type="number" class="small-input weekly-hours" value="${subj.hoursPerWeek}" min="1" max="20" data-group="${i}" data-subj="${subjIdx}" data-field="hours" style="width:75px;">
                    <button class="remove-subj-btn" data-group="${i}" data-subj="${subjIdx}">✖</button>
                `;
                subjectsContainer.appendChild(div);
            });

            document.querySelectorAll('.subject-name, .teacher-name, .weekly-hours').forEach(el => el.onchange = handleSubjectChange);
            document.querySelectorAll('.remove-subj-btn').forEach(btn => btn.onclick = handleRemoveSubject);
        };
        renderSubjects();

        groupDiv.querySelector('.add-subject-btn').onclick = () => {
            groupsData[i].subjects.push({ name: "Новый предмет", teacher: "Преподаватель", hoursPerWeek: 2 });
            renderGroups();
        };

        const removeBtn = groupDiv.querySelector('.remove-group-btn');
        if (groupsData.length > 1) {
            removeBtn.onclick = () => {
                groupsData.splice(i, 1);
                document.getElementById("groupCount").value = groupsData.length;
                renderGroups();
            };
        } else {
            removeBtn.style.display = 'none';
        }

        groupDiv.querySelector('.group-max-pairs').onchange = e => groupsData[i].maxPairsPerDay = +e.target.value || 4;
        groupDiv.querySelector('.group-max-same').onchange = e => groupsData[i].maxSamePerDay = +e.target.value || 2;
    });
}

function handleSubjectChange(e) {
    const g = +e.target.dataset.group;
    const s = +e.target.dataset.subj;
    const field = e.target.dataset.field;
    if (field === 'hours') groupsData[g].subjects[s].hoursPerWeek = +e.target.value || 1;
    else groupsData[g].subjects[s][field] = e.target.value;
}

function handleRemoveSubject(e) {
    const g = +e.target.dataset.group;
    const s = +e.target.dataset.subj;
    groupsData[g].subjects.splice(s, 1);
    renderGroups();
}

// Инициализация
function init() {
    autoLoadConfig();

    if (groupsData.length === 0) {
        groupsData = [
            { name: "Группа П-101", subjects: [{ name: "Математика", teacher: "Иванов А.А.", hoursPerWeek: 3 }, { name: "Физика", teacher: "Петров Б.В.", hoursPerWeek: 2 }, { name: "Информатика", teacher: "Сидоров В.Г.", hoursPerWeek: 2 }], maxPairsPerDay: 4, maxSamePerDay: 2 },
            { name: "Группа П-102", subjects: [{ name: "Математика", teacher: "Иванов А.А.", hoursPerWeek: 2 }, { name: "Химия", teacher: "Козлова Д.Е.", hoursPerWeek: 3 }, { name: "Физика", teacher: "Петров Б.В.", hoursPerWeek: 2 }], maxPairsPerDay: 4, maxSamePerDay: 2 }
        ];
    }

    renderGroups();
    renderActiveDays();
    renderTeachersAvailability();

    applyGroupsBtn.addEventListener('click', renderGroups);
    updateTeachersBtn.addEventListener('click', renderTeachersAvailability);
    generateBtn.addEventListener('click', generateSchedule);
    exportBtn.addEventListener('click', exportToExcel);
    saveConfigBtn.addEventListener('click', () => { saveConfig(); alert('✅ Конфигурация сохранена!'); });
    loadConfigBtn.addEventListener('click', () => { 
        loadConfig(); 
        renderGroups(); 
        renderActiveDays(); 
        renderTeachersAvailability(); 
        alert('✅ Конфигурация загружена!'); 
    });
}

init();