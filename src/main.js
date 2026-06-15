// Google Calendar
let googleEvents = [];
let googleConnected = false;
let googleSyncTimer = null;

// Outlook Calendar
let outlookEvents = [];
let outlookConnected = false;

// Root
let events = [];
let notes = {};
let todos = {};
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let currentView = 'month';
let weekStartDate = null;
let dayViewDate = null;
let editingId = null;
let expandedEventId = null;
let pendingExpandEventId = null;
let rangeSelectStart = null;
const contextMenuState = {}; // tracks which sections are expanded within a session
let clockSettings = JSON.parse(localStorage.getItem('clock_settings') || '{"format": "24h"}');

// Recurring
let monthRecurringEvents = [];

// Holidays
let holidayEvents = [];
let selectedCountries = JSON.parse(localStorage.getItem('selected_countries') || '[]');

async function initStorage() {
  try {
    const rawEvents = localStorage.getItem('calendar_events');
    const rawNotes = localStorage.getItem('calendar_notes');
    const rawTodos = localStorage.getItem('calendar_todos');
    events = rawEvents ? JSON.parse(rawEvents) : [];
    notes = rawNotes ? JSON.parse(rawNotes) : {};
    todos = rawTodos ? JSON.parse(rawTodos) : {};
  } catch {
    events = [];
    notes = {};
    todos = {};
  }
}

function syncHolidays() {
  if (selectedCountries.length === 0) {
    holidayEvents = [];
    return;
  }
  holidayEvents = getHolidaysForMonth(viewYear, viewMonth, selectedCountries);
  renderCalendar();
}

async function saveEvents() {
  localStorage.setItem('calendar_events', JSON.stringify(events));
}

async function saveNotes() {
  localStorage.setItem('calendar_notes', JSON.stringify(notes));
}

async function saveTodos() {
  localStorage.setItem('calendar_todos', JSON.stringify(todos));
}

function updateClock() {
  const now = new Date();
  let hours, minutes;
  minutes = String(now.getMinutes()).padStart(2, '0');
  
  if (clockSettings.format === '12h') {
    hours = now.getHours() % 12 || 12;
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    document.getElementById('clock').textContent = `${hours}:${minutes} ${ampm}`;
  } else {
    hours = String(now.getHours()).padStart(2, '0');
    document.getElementById('clock').textContent = `${hours}:${minutes}`;
  }

  document.getElementById('clock-date').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

// ── Weather ───────────────────────────────────────────────────────────────────
let weatherData = null;
let weatherSettings = JSON.parse(localStorage.getItem('weather_settings') || '{"enabled": false, "location": "", "units": "F"}');

async function fetchWeather() {
  if (!weatherSettings.enabled || !weatherSettings.location) return;

  const cached = localStorage.getItem('weather_cache');
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < 30 * 60 * 1000) {
      weatherData = data;
      updateWeatherDisplay();
      return;
    }
  }

  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(weatherSettings.location)}?format=j1`);
    if (!response.ok) return;
    const data = await response.json();
    weatherData = data;
    localStorage.setItem('weather_cache', JSON.stringify({ data, timestamp: Date.now() }));
    updateWeatherDisplay();
  } catch (e) {
    console.error('Weather fetch error:', e);
  }
}

function saveWeatherSettings() {
  localStorage.setItem('weather_settings', JSON.stringify(weatherSettings));
}

// ── Recurrence ────────────────────────────────────────────────────────────────

function getRecurringOccurrences(event, year, month) {
  if (!event.recurrence) return [];
  
  const occurrences = [];
  const startDate = new Date(event.date + 'T00:00:00');
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  
  const { frequency, interval = 1, endType, endDate, endCount } = event.recurrence;
  
  let current = new Date(startDate);
  let count = 0;
  const maxIterations = 3650; // 10 years safety limit
  let iterations = 0;

  while (current <= monthEnd && iterations < maxIterations) {
    iterations++;
    
    // Check end conditions
    if (endType === 'date' && endDate && current > new Date(endDate + 'T00:00:00')) break;
    if (endType === 'count' && count >= endCount) break;

    if (current >= monthStart && current <= monthEnd) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${d}`;

      // Check if this occurrence has been deleted or modified
      const exceptions = event.recurrence.exceptions || {};
      if (!exceptions[key]) {
        occurrences.push({
          ...event,
          id: `${event.id}_${key}`,
          date: key,
          isRecurring: true,
          recurringParentId: event.id,
          originalDate: key
        });
      } else if (exceptions[key] !== 'deleted') {
        // Modified occurrence
        occurrences.push({
          ...event,
          ...exceptions[key],
          id: `${event.id}_${key}`,
          date: key,
          isRecurring: true,
          recurringParentId: event.id,
          originalDate: key
        });
      }
    }

    // Advance to next occurrence
    const next = new Date(current);
    switch (frequency) {
      case 'daily':
        next.setDate(next.getDate() + interval);
        break;
      case 'weekly':
        next.setDate(next.getDate() + (7 * interval));
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + interval);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + interval);
        break;
      case 'custom':
        next.setDate(next.getDate() + interval);
        break;
    }

    if (next <= current) break; // Safety check
    current = next;
    if (current >= monthStart) count++;
  }

  return occurrences;
}

function dateKey(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function getEventsForDate(y, m, d) {
  const key = dateKey(y, m, d);
  const local = events.filter(e => {
    if (e.recurrence) return false;
    if (e.date === key) return true;
    if (e.endDate && e.endDate >= key && e.date < key) return true;
    return false;
  });
  const recurring = monthRecurringEvents.filter(e => e.date === key);
  const google = googleEvents.filter(e => e.date === key);
  const outlook = outlookEvents.filter(e => {
    if (e.date === key) return true;
    if (e.endDate && e.endDate >= key && e.date < key) return true;
    return false;
  });
  const holidays = holidayEvents.filter(e => e.date === key);
  const multiDay = local.filter(e => e.endDate);
  const outlookMultiDay = outlook.filter(e => e.endDate);
  const regular = [...local.filter(e => !e.endDate), ...recurring, ...google, ...outlook.filter(e => !e.endDate)];
  return [...multiDay, ...outlookMultiDay, ...regular, ...holidays];
}

function getAllEventsForMonth(year, month) {
  const recurringOccurrences = [];
  events.forEach(event => {
    if (event.recurrence) {
      recurringOccurrences.push(...getRecurringOccurrences(event, year, month));
    }
  });
  return recurringOccurrences;
}

// ── Month view ────────────────────────────────────────────────────────────────

function renderCalendar() {
  monthRecurringEvents = getAllEventsForMonth(viewYear, viewMonth);
  const grid = document.getElementById('cal-grid');
  document.getElementById('month-label').textContent = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  grid.innerHTML = '';

  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();
  const today = new Date();

  let cells = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: daysInPrev - i, month: viewMonth - 1, year: viewMonth === 0 ? viewYear - 1 : viewYear, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, other: false });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - firstDay - daysInMonth + 1, month: viewMonth + 1, year: viewMonth === 11 ? viewYear + 1 : viewYear, other: true });
  }

  cells.forEach(c => {
    const cell = document.createElement('div');
    cell.className = 'day-cell' + (c.other ? ' other-month' : '');
    const isToday = !c.other && c.day === today.getDate() && c.month === today.getMonth() && c.year === today.getFullYear();
    if (isToday) cell.classList.add('today');

    const numDiv = document.createElement('div');
    numDiv.className = 'day-num';
    numDiv.textContent = c.day;
    cell.appendChild(numDiv);

    if (!c.other) {
      const cellKey = dateKey(c.year, c.month, c.day);
      cell.dataset.date = cellKey;
      const evs = getEventsForDate(c.year, c.month, c.day);
      evs.slice(0, 2).forEach(ev => {
        const pill = document.createElement('div');
        pill.className = 'event-pill ' + (ev.type || 'personal');
        pill.textContent = (!ev.endDate || ev.date === cellKey) ? ev.title : ' ';
        applyEventColor(pill, ev);
        cell.appendChild(pill);
      });
      if (evs.length > 2) {
        const more = document.createElement('div');
        more.className = 'more-pill';
        more.textContent = '+' + (evs.length - 2) + ' more';
        cell.appendChild(more);
      }
      cell.onclick = (e) => {
        const cellKey = dateKey(c.year, c.month, c.day);
        if (e.shiftKey) {
          if (!rangeSelectStart) {
            rangeSelectStart = cellKey;
            updateRangeHighlight(cellKey, cellKey);
          } else {
            const start = rangeSelectStart <= cellKey ? rangeSelectStart : cellKey;
            const end   = rangeSelectStart <= cellKey ? cellKey : rangeSelectStart;
            rangeSelectStart = null;
            clearRangeHighlight();
            openRangeEventModal(start, end);
          }
        } else {
          rangeSelectStart = null;
          clearRangeHighlight();
          weekStartDate = new Date(c.year, c.month, c.day);
          const dayOfWeek = weekStartDate.getDay();
          weekStartDate.setDate(weekStartDate.getDate() - dayOfWeek);
          switchToWeek();
        }
      };
      cell.onmouseover = () => {
        if (rangeSelectStart) updateRangeHighlight(rangeSelectStart, dateKey(c.year, c.month, c.day));
      };
    }

    grid.appendChild(cell);
  });
}

// ── Month view range selection ────────────────────────────────────────────────

function updateRangeHighlight(startKey, hoverKey) {
  const lo = startKey <= hoverKey ? startKey : hoverKey;
  const hi = startKey <= hoverKey ? hoverKey : startKey;
  document.querySelectorAll('.day-cell[data-date]').forEach(cell => {
    const d = cell.dataset.date;
    cell.classList.toggle('range-start', d === rangeSelectStart);
    cell.classList.toggle('in-range', d !== rangeSelectStart && d >= lo && d <= hi);
  });
}

function clearRangeHighlight() {
  document.querySelectorAll('.day-cell[data-date]').forEach(cell => {
    cell.classList.remove('range-start', 'in-range');
  });
}

function openRangeEventModal(startKey, endKey) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.onclick = e => e.stopPropagation();

  const heading = document.createElement('h3');
  heading.textContent = 'New Event';
  modal.appendChild(heading);

  const dateInfo = document.createElement('div');
  dateInfo.style.cssText = 'font-size:11px;color:var(--text-secondary);margin-bottom:10px;';
  const sDate = new Date(startKey + 'T00:00:00');
  const eDate = new Date(endKey + 'T00:00:00');
  const fmt = { month: 'short', day: 'numeric' };
  dateInfo.textContent = startKey === endKey
    ? sDate.toLocaleDateString('en-US', { ...fmt, year: 'numeric' })
    : `${sDate.toLocaleDateString('en-US', fmt)} – ${eDate.toLocaleDateString('en-US', { ...fmt, year: 'numeric' })}`;
  modal.appendChild(dateInfo);

  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Title';
  modal.appendChild(titleLabel);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Event title';
  titleInput.onmousedown = e => e.stopPropagation();
  modal.appendChild(titleInput);

  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'Type';
  modal.appendChild(typeLabel);

  const typeSelect = document.createElement('select');
  typeSelect.onmousedown = e => e.stopPropagation();
  ['personal', 'work', 'reminder'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    typeSelect.appendChild(opt);
  });
  modal.appendChild(typeSelect);

  let selectedColor = null;
  const colorSwatchesRange = makeColorSwatches(null, (col) => { selectedColor = col; });
  modal.appendChild(colorSwatchesRange);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onmousedown = e => e.stopPropagation();
  cancelBtn.onclick = () => overlay.remove();

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.onmousedown = e => e.stopPropagation();
  saveBtn.onclick = async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    events.push({
      id: Date.now().toString(),
      title,
      date: startKey,
      endDate: startKey === endKey ? null : endKey,
      type: typeSelect.value,
      color: selectedColor || undefined
    });
    await saveEvents();
    overlay.remove();
    renderCalendar();
    syncHolidays();
  };

  titleInput.onkeydown = (e) => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') overlay.remove();
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  document.getElementById('widget').appendChild(overlay);
  setTimeout(() => titleInput.focus(), 50);
}

// ── Week view ─────────────────────────────────────────────────────────────────

function renderWeekView() {
  const container = document.getElementById('week-view');
  container.innerHTML = '';
  const today = new Date();

  const wrapper = document.createElement('div');
  wrapper.className = 'week-view-wrapper';

  // Build date array for the week
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStartDate);
    date.setDate(weekStartDate.getDate() + i);
    weekDates.push(date);
  }

  const weekStartKey = dateKey(weekDates[0].getFullYear(), weekDates[0].getMonth(), weekDates[0].getDate());
  const weekEndKey = dateKey(weekDates[6].getFullYear(), weekDates[6].getMonth(), weekDates[6].getDate());

  // Collect every event this week as a column span.
  // Single-day events span 1 column; multi-day events span their range.
  const allSpans = [];
  const seen = new Set();
  weekDates.forEach((date, colIndex) => {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    getEventsForDate(y, m, d).forEach(ev => {
      if (seen.has(ev.id)) return;
      seen.add(ev.id);

      if (ev.endDate) {
        let startCol = 0;
        for (let i = 0; i < 7; i++) {
          if (dateKey(weekDates[i].getFullYear(), weekDates[i].getMonth(), weekDates[i].getDate()) >= ev.date) {
            startCol = i; break;
          }
        }
        let endCol = 6;
        for (let i = 6; i >= 0; i--) {
          if (dateKey(weekDates[i].getFullYear(), weekDates[i].getMonth(), weekDates[i].getDate()) <= ev.endDate) {
            endCol = i; break;
          }
        }
        allSpans.push({ ev, startCol, endCol,
          continuesLeft: ev.date < weekStartKey,
          continuesRight: ev.endDate > weekEndKey
        });
      } else {
        allSpans.push({ ev, startCol: colIndex, endCol: colIndex,
          continuesLeft: false, continuesRight: false
        });
      }
    });
  });

  // Longest-spanning events first so they claim top rows in the banner
  allSpans.sort((a, b) => (b.endCol - b.startCol) - (a.endCol - a.startCol));

  // Main week grid
  const grid = document.createElement('div');
  grid.className = 'week-view-grid';

  // Row 1: day name headers
  weekDates.forEach(date => {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
    const el = document.createElement('div');
    el.className = 'week-day-header' + (isToday ? ' today' : '');
    el.textContent = date.toLocaleDateString('en-US', { weekday: 'short' });
    grid.appendChild(el);
  });

  // Row 2: day numbers
  weekDates.forEach(date => {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
    const el = document.createElement('div');
    el.className = 'week-day-num' + (isToday ? ' today' : '');
    el.textContent = d;
    el.style.cursor = 'pointer';
    el.title = 'Click to open day view';
    el.onclick = (e) => {
      if (!e.shiftKey) { dayViewDate = new Date(y, m, d); switchToDay(); }
    };
    grid.appendChild(el);
  });

  // Row 3 (conditional): unified event banner — all events as column-spanning bars
  if (allSpans.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'week-multiday-banner';
    allSpans.forEach(({ ev, startCol, endCol, continuesLeft, continuesRight }) => {
      const bar = document.createElement('div');
      bar.className = 'week-multiday-bar ' + (ev.type || 'personal');
      bar.style.gridColumn = `${startCol + 1} / ${endCol + 2}`;
      bar.textContent = ev.title;
      if (continuesLeft) bar.classList.add('continues-left');
      if (continuesRight) bar.classList.add('continues-right');
      applyEventColor(bar, ev);
      bar.onclick = () => {
        dayViewDate = new Date(ev.date + 'T00:00:00');
        pendingExpandEventId = ev.id;
        switchToDay();
      };
      banner.appendChild(bar);
    });
    grid.appendChild(banner);
  }

  // Next row: notes textareas per day
  weekDates.forEach(date => {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const key = dateKey(y, m, d);
    const textarea = document.createElement('textarea');
    textarea.className = 'week-notes';
    textarea.placeholder = 'Notes...';
    textarea.value = notes[key] || '';
    textarea.oninput = () => { notes[key] = textarea.value; saveNotes(); };
    textarea.onmousedown = e => e.stopPropagation();
    grid.appendChild(textarea);
  });

  wrapper.appendChild(grid);
  container.appendChild(wrapper);

  const endDate = new Date(weekStartDate);
  endDate.setDate(weekStartDate.getDate() + 6);
  document.getElementById('month-label').textContent =
    weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' – ' + endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Day view ──────────────────────────────────────────────────────────────────

function renderDayView() {
  monthRecurringEvents = getAllEventsForMonth(dayViewDate.getFullYear(), dayViewDate.getMonth());
  const container = document.getElementById('day-view');
  container.innerHTML = '';
  const y = dayViewDate.getFullYear();
  const m = dayViewDate.getMonth();
  const d = dayViewDate.getDate();
  const key = dateKey(y, m, d);

  // Header
  const header = document.createElement('div');
  header.className = 'day-view-header';

  const titleBlock = document.createElement('div');
  const dayName = document.createElement('div');
  dayName.className = 'day-view-title';
  dayName.textContent = dayViewDate.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = document.createElement('div');
  dateStr.className = 'day-view-subtitle';
  dateStr.textContent = dayViewDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  titleBlock.appendChild(dayName);
  titleBlock.appendChild(dateStr);

  const addBtn = document.createElement('button');
  addBtn.className = 'day-view-add-btn';
  addBtn.textContent = '+ event';
  addBtn.onmousedown = e => e.stopPropagation();
  addBtn.onclick = () => openInlineEventForm(key, container);

  header.appendChild(titleBlock);
  header.appendChild(addBtn);
  container.appendChild(header);

  // Body grid
  const body = document.createElement('div');
  body.className = 'day-view-body';

  // Todo section
  const todoSection = document.createElement('div');
  todoSection.className = 'day-todo-section';

  const todoHeader = document.createElement('div');
  todoHeader.className = 'day-todo-header';
  const todoLabel = document.createElement('div');
  todoLabel.className = 'day-todo-label';
  todoLabel.textContent = 'To Do';
  const todoAddBtn = document.createElement('button');
  todoAddBtn.className = 'day-todo-add';
  todoAddBtn.textContent = '+';
  todoAddBtn.onmousedown = e => e.stopPropagation();
  todoAddBtn.onclick = () => addTodoInput(todoList, key);
  todoHeader.appendChild(todoLabel);
  todoHeader.appendChild(todoAddBtn);
  todoSection.appendChild(todoHeader);

  const todoList = document.createElement('div');
  todoList.className = 'day-todo-list';
  const dayTodos = todos[key] || [];
  dayTodos.forEach((todo, idx) => {
    todoList.appendChild(createTodoItem(todo, idx, key, todoList));
  });
  todoSection.appendChild(todoList);
  body.appendChild(todoSection);

  // Events section
  const eventsSection = document.createElement('div');
  eventsSection.className = 'day-events-section';
  const dayEvents = getEventsForDate(y, m, d);
  dayEvents.forEach(ev => {
    eventsSection.appendChild(createDayEventPill(ev, key));
  });
  body.appendChild(eventsSection);
  container.appendChild(body);

  // Notes section
  const notesSection = document.createElement('div');
  notesSection.className = 'day-notes-section';
  const notesLabel = document.createElement('div');
  notesLabel.className = 'day-notes-label';
  notesLabel.textContent = 'Notes';
  const notesArea = document.createElement('textarea');
  notesArea.className = 'day-notes-textarea';
  notesArea.placeholder = 'Notes...';
  notesArea.value = notes[key] || '';
  notesArea.oninput = () => { notes[key] = notesArea.value; saveNotes(); };
  notesArea.onmousedown = e => e.stopPropagation();
  notesSection.appendChild(notesLabel);
  notesSection.appendChild(notesArea);
  container.appendChild(notesSection);

  document.getElementById('month-label').textContent =
    dayViewDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  if (pendingExpandEventId) {
    const pill = container.querySelector(`.day-event-pill[data-id="${pendingExpandEventId}"]`);
    if (pill) pill.click();
    pendingExpandEventId = null;
  }
}

function createTodoItem(todo, idx, key, todoList) {
  const item = document.createElement('div');
  item.className = 'day-todo-item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = todo.done;
  checkbox.onmousedown = e => e.stopPropagation();
  checkbox.onchange = () => {
    todos[key][idx].done = checkbox.checked;
    label.className = checkbox.checked ? 'done' : '';
    saveTodos();
  };

  const label = document.createElement('span');
  label.textContent = todo.text;
  if (todo.done) label.className = 'done';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'todo-delete';
  deleteBtn.textContent = '×';
  deleteBtn.onmousedown = e => e.stopPropagation();
  deleteBtn.onclick = () => {
    todos[key].splice(idx, 1);
    saveTodos();
    item.remove();
  };

  item.appendChild(checkbox);
  item.appendChild(label);
  item.appendChild(deleteBtn);
  return item;
}

function addTodoInput(todoList, key) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'day-todo-input';
  input.placeholder = 'Add item...';
  input.onmousedown = e => e.stopPropagation();
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      if (!todos[key]) todos[key] = [];
      const newTodo = { text: input.value.trim(), done: false };
      todos[key].push(newTodo);
      saveTodos();
      const idx = todos[key].length - 1;
      todoList.insertBefore(createTodoItem(newTodo, idx, key, todoList), input);
      input.value = '';
    }
    if (e.key === 'Escape') input.remove();
  };
  input.onblur = () => { if (!input.value.trim()) input.remove(); };
  todoList.appendChild(input);
  setTimeout(() => input.focus(), 50);
}

function createDayEventPill(ev, key) {
  const pill = document.createElement('div');
  pill.className = 'day-event-pill ' + (ev.type || 'personal');
  pill.dataset.id = ev.id;

  const pillHeader = document.createElement('div');
  pillHeader.className = 'day-event-pill-header';

  const title = document.createElement('div');
  title.className = 'day-event-title';
  title.textContent = ev.title;

  const time = document.createElement('div');
  time.className = 'day-event-time';
  time.textContent = ev.time || '';

  pillHeader.appendChild(title);
  pillHeader.appendChild(time);
  pill.appendChild(pillHeader);

  if (ev.color) {
    pill.style.backgroundColor = ev.color;
    pill.style.borderColor = ev.color;
    const tc = getContrastColor(ev.color);
    title.style.color = tc;
    time.style.color = tc;
  }

  pill.onmousedown = e => e.stopPropagation();
  pill.onclick = () => toggleEventExpand(pill, ev, key);

  return pill;
}

function toggleEventExpand(pill, ev, key) {
  const existing = pill.querySelector('.day-event-expanded');
  if (existing) {
    existing.remove();
    expandedEventId = null;
    return;
  }

  // Collapse any other expanded events
  document.querySelectorAll('.day-event-expanded').forEach(el => el.remove());
  expandedEventId = ev.id;

  const expanded = document.createElement('div');
  expanded.className = 'day-event-expanded';
  expanded.onclick = e => e.stopPropagation();

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = ev.title;
  titleInput.placeholder = 'Title';
  titleInput.onmousedown = e => e.stopPropagation();

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = ev.time || '';
  timeInput.onmousedown = e => e.stopPropagation();

  const endDateExpandInput = document.createElement('input');
  endDateExpandInput.type = 'date';
  endDateExpandInput.value = ev.endDate || '';
  endDateExpandInput.onmousedown = e => e.stopPropagation();

  const typeSelect = document.createElement('select');
  ['personal', 'work', 'reminder'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    if (ev.type === t) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.onmousedown = e => e.stopPropagation();

  let selectedColor = ev.color || null;
  const colorSwatches = makeColorSwatches(selectedColor, (c) => {
    selectedColor = c;
    pill.style.backgroundColor = c || '';
    pill.style.borderColor = c || '';
    if (c) {
      const tc = getContrastColor(c);
      title.style.color = tc;
      time.style.color = tc;
    } else {
      title.style.color = '';
      time.style.color = '';
    }
  });

  const notesInput = document.createElement('input');
  notesInput.type = 'text';
  notesInput.value = ev.notes || '';
  notesInput.placeholder = 'Notes...';
  notesInput.onmousedown = e => e.stopPropagation();

  const actions = document.createElement('div');
  actions.className = 'day-event-actions';

  const delBtn = document.createElement('button');
  delBtn.className = 'del-btn';
  delBtn.textContent = 'Delete';
  delBtn.onmousedown = e => e.stopPropagation();
  delBtn.onclick = async () => {
    if (ev.isRecurring) {
      // Ask user - delete just this or all future
      const choice = confirm('Delete all future occurrences? Click Cancel to delete just this one.');
      const parentEvent = events.find(e => e.id === ev.recurringParentId);
      if (parentEvent) {
        if (choice) {
          // Delete all future - set end date to day before this occurrence
          const prevDay = new Date(ev.date + 'T00:00:00');
          prevDay.setDate(prevDay.getDate() - 1);
          const y = prevDay.getFullYear();
          const m = String(prevDay.getMonth() + 1).padStart(2, '0');
          const d = String(prevDay.getDate()).padStart(2, '0');
          parentEvent.recurrence.endType = 'date';
          parentEvent.recurrence.endDate = `${y}-${m}-${d}`;
        } else {
          // Delete just this occurrence
          if (!parentEvent.recurrence.exceptions) parentEvent.recurrence.exceptions = {};
          parentEvent.recurrence.exceptions[ev.date] = 'deleted';
        }
        await saveEvents();
      }
    } else {
      if (googleConnected && ev.googleId) {
        await deleteGoogleEvent(ev.googleId);
      }
      events = events.filter(e => e.id !== ev.id);
      await saveEvents();
    }
    renderDayView();
  };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.onmousedown = e => e.stopPropagation();
  saveBtn.onclick = async () => {
    if (ev.isRecurring) {
      const choice = confirm('Edit all future occurrences? Click Cancel to edit just this one.');
      const parentEvent = events.find(e => e.id === ev.recurringParentId);
      if (parentEvent) {
        if (choice) {
          // Edit all future - update parent event
          parentEvent.title = titleInput.value.trim();
          parentEvent.time = timeInput.value;
          parentEvent.type = typeSelect.value;
          parentEvent.color = selectedColor || undefined;
          parentEvent.notes = notesInput.value.trim();
        } else {
          // Edit just this occurrence - store as exception
          if (!parentEvent.recurrence.exceptions) parentEvent.recurrence.exceptions = {};
          parentEvent.recurrence.exceptions[ev.date] = {
            title: titleInput.value.trim(),
            time: timeInput.value,
            type: typeSelect.value,
            color: selectedColor || undefined,
            notes: notesInput.value.trim()
          };
        }
        await saveEvents();
      }
    } else {
      const idx = events.findIndex(e => e.id === ev.id);
      if (idx !== -1) {
        events[idx] = {
          ...events[idx],
          title: titleInput.value.trim(),
          time: timeInput.value,
          endDate: endDateExpandInput.value || null,
          type: typeSelect.value,
          color: selectedColor || undefined,
          notes: notesInput.value.trim()
        };
        await saveEvents();
        if (googleConnected && events[idx].googleId) {
          await updateGoogleEvent(events[idx].googleId, events[idx]);
        }
      }
    }
    renderDayView();
  };

  actions.appendChild(delBtn);
  actions.appendChild(saveBtn);
  expanded.appendChild(titleInput);
  expanded.appendChild(timeInput);
  expanded.appendChild(endDateExpandInput);
  expanded.appendChild(typeSelect);
  expanded.appendChild(colorSwatches);
  expanded.appendChild(notesInput);
  expanded.appendChild(actions);
  pill.appendChild(expanded);
}

function openInlineEventForm(key, container) {
  const existing = document.getElementById('inline-event-form');
  if (existing) existing.remove();

  const form = document.createElement('div');
  form.id = 'inline-event-form';
  form.className = 'day-event-pill personal';
  form.style.marginTop = '8px';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Event title';
  titleInput.className = 'day-todo-input';
  titleInput.onmousedown = e => e.stopPropagation();

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.className = 'day-todo-input';
  timeInput.onmousedown = e => e.stopPropagation();

  const multiDayEndInput = document.createElement('input');
  multiDayEndInput.type = 'date';
  multiDayEndInput.className = 'day-todo-input';
  multiDayEndInput.placeholder = 'End date (optional)';
  multiDayEndInput.onmousedown = e => e.stopPropagation();

  const typeSelect = document.createElement('select');
  typeSelect.className = 'day-todo-input';
  ['personal', 'work', 'reminder'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    typeSelect.appendChild(opt);
  });
  typeSelect.onmousedown = e => e.stopPropagation();
  typeSelect.onchange = () => {
    form.className = 'day-event-pill ' + typeSelect.value;
    form.style.marginTop = '8px';
  };

  const notesInput = document.createElement('input');
  notesInput.type = 'text';
  notesInput.placeholder = 'Notes (optional)';
  notesInput.className = 'day-todo-input';
  notesInput.onmousedown = e => e.stopPropagation();

  let selectedColor = null;
  const colorSwatchesInline = makeColorSwatches(null, (col) => {
    selectedColor = col;
    form.style.backgroundColor = col || '';
    form.style.borderColor = col || '';
  });

  // Recurrence section
  const repeatSelect = document.createElement('select');
  repeatSelect.className = 'day-todo-input';
  repeatSelect.onmousedown = e => e.stopPropagation();
  [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'custom', label: 'Custom interval' },
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    repeatSelect.appendChild(o);
  });

  // Custom interval input (hidden by default)
  const customInterval = document.createElement('input');
  customInterval.type = 'number';
  customInterval.min = '1';
  customInterval.value = '1';
  customInterval.placeholder = 'Every X days';
  customInterval.className = 'day-todo-input';
  customInterval.style.display = 'none';
  customInterval.onmousedown = e => e.stopPropagation();

  repeatSelect.onchange = () => {
    customInterval.style.display = repeatSelect.value === 'custom' ? 'block' : 'none';
    endSection.style.display = repeatSelect.value !== 'none' ? 'block' : 'none';
  };

  // End condition section (hidden by default)
  const endSection = document.createElement('div');
  endSection.style.display = 'none';

  const endSelect = document.createElement('select');
  endSelect.className = 'day-todo-input';
  endSelect.onmousedown = e => e.stopPropagation();
  [
    { value: 'forever', label: 'Repeat forever' },
    { value: 'date', label: 'End on date' },
    { value: 'count', label: 'End after X times' },
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    endSelect.appendChild(o);
  });

  const endDateInput = document.createElement('input');
  endDateInput.type = 'date';
  endDateInput.className = 'day-todo-input';
  endDateInput.style.display = 'none';
  endDateInput.onmousedown = e => e.stopPropagation();

  const endCountInput = document.createElement('input');
  endCountInput.type = 'number';
  endCountInput.min = '1';
  endCountInput.value = '10';
  endCountInput.placeholder = 'Number of times';
  endCountInput.className = 'day-todo-input';
  endCountInput.style.display = 'none';
  endCountInput.onmousedown = e => e.stopPropagation();

  endSelect.onchange = () => {
    endDateInput.style.display = endSelect.value === 'date' ? 'block' : 'none';
    endCountInput.style.display = endSelect.value === 'count' ? 'block' : 'none';
  };

  endSection.appendChild(endSelect);
  endSection.appendChild(endDateInput);
  endSection.appendChild(endCountInput);

  const actions = document.createElement('div');
  actions.className = 'day-event-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onmousedown = e => e.stopPropagation();
  cancelBtn.onclick = () => form.remove();

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.onmousedown = e => e.stopPropagation();
  saveBtn.onclick = async () => {
    const title = titleInput.value.trim();
    if (!title) return;

    const newEvent = {
      id: Date.now().toString(),
      title,
      date: key,
      endDate: multiDayEndInput.value || null,
      time: timeInput.value,
      type: typeSelect.value,
      color: selectedColor || undefined,
      notes: notesInput.value.trim()
    };

    // Add recurrence if set
    if (repeatSelect.value !== 'none') {
      newEvent.recurrence = {
        frequency: repeatSelect.value,
        interval: repeatSelect.value === 'custom' ? parseInt(customInterval.value) || 1 : 1,
        endType: endSelect.value,
        endDate: endSelect.value === 'date' ? endDateInput.value : null,
        endCount: endSelect.value === 'count' ? parseInt(endCountInput.value) || 10 : null,
        exceptions: {}
      };
    }

    events.push(newEvent);
    await saveEvents();

    if (googleConnected && !newEvent.recurrence) {
      const googleResult = await createGoogleEvent(newEvent);
      if (googleResult) {
        newEvent.googleId = googleResult.id;
        await saveEvents();
      }
    }

    renderDayView();
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  form.appendChild(titleInput);
  form.appendChild(timeInput);
  form.appendChild(multiDayEndInput);
  form.appendChild(typeSelect);
  form.appendChild(colorSwatchesInline);
  form.appendChild(notesInput);
  form.appendChild(repeatSelect);
  form.appendChild(customInterval);
  form.appendChild(endSection);
  form.appendChild(actions);

  const eventsSection = container.querySelector('.day-events-section');
  eventsSection.appendChild(form);
  setTimeout(() => titleInput.focus(), 50);
}

// ── View switching ────────────────────────────────────────────────────────────

function switchToWeek() {
  rangeSelectStart = null;
  const monthView = document.getElementById('month-view');
  const weekView = document.getElementById('week-view');
  const dayView = document.getElementById('day-view');
  const backBtn = document.getElementById('back-btn');
  const navBtns = document.getElementById('nav-btns');

  dayView.classList.remove('active', 'slide-left', 'slide-right');
  dayView.classList.add('slide-right');
  weekView.classList.remove('active', 'slide-left', 'slide-right');
  weekView.classList.add('slide-right');

  renderWeekView();

  monthView.classList.remove('active');
  monthView.classList.add('slide-left');
  weekView.classList.remove('active');
  weekView.classList.add('slide-right');

  backBtn.style.display = 'block';
  navBtns.style.display = 'none';
  currentView = 'week';

  setTimeout(() => {
    const viewContainer = document.querySelector('.view-container');
    viewContainer.style.height = 'auto';
    const contentHeight = document.getElementById('week-view').scrollHeight;
    const headerHeight = document.querySelector('.header').offsetHeight;
    const totalHeight = contentHeight + headerHeight + 75;
    viewContainer.style.height = '';
    animateResize(460, 1024, 80, totalHeight);
    setTimeout(() => {
      weekView.classList.remove('slide-right');
      weekView.classList.add('active');
    }, 100);
  }, 200);
}

function switchToDay() {
  const monthView = document.getElementById('month-view');
  const weekView = document.getElementById('week-view');
  const dayView = document.getElementById('day-view');
  const backBtn = document.getElementById('back-btn');
  const navBtns = document.getElementById('nav-btns');

  renderDayView();

  monthView.classList.remove('active');
  monthView.classList.add('slide-left');
  weekView.classList.remove('active');
  weekView.classList.add('slide-left');
  dayView.classList.remove('active');
  dayView.classList.add('slide-right');

  backBtn.style.display = 'block';
  navBtns.style.display = 'none';
  currentView = 'day';

  const fromWidth = weekStartDate ? 1024 : 460;

  setTimeout(() => {
    const viewContainer = document.querySelector('.view-container');
    viewContainer.style.height = 'auto';
    const contentHeight = document.getElementById('day-view').scrollHeight;
    const headerHeight = document.querySelector('.header').offsetHeight;
    const totalHeight = contentHeight + headerHeight + 85;
    viewContainer.style.height = '';
    animateResize(fromWidth, 560, 80, totalHeight);
    setTimeout(() => {
      dayView.classList.remove('slide-right');
      dayView.classList.add('active');
    }, 100);
  }, 300);
}

function switchToMonth() {
  const monthView = document.getElementById('month-view');
  const weekView = document.getElementById('week-view');
  const dayView = document.getElementById('day-view');
  const backBtn = document.getElementById('back-btn');
  const navBtns = document.getElementById('nav-btns');

  weekView.classList.remove('active');
  weekView.classList.add('slide-right');
  dayView.classList.remove('active');
  dayView.classList.add('slide-right');

  backBtn.style.display = 'none';
  navBtns.style.display = 'flex';

  const fromWidth = currentView === 'week' ? 1024 : 560;
  currentView = 'month';
  weekStartDate = null;
  dayViewDate = null;

  animateResize(fromWidth, 460, 80, 580);

  setTimeout(() => {
    renderCalendar();
    monthView.classList.remove('slide-left');
    monthView.classList.add('active');
  }, 100);
}

async function animateResize(fromWidth, toWidth, duration, toHeight) {
  let currentHeight = 580;
  try {
    if (window.__TAURI__) {
      const size = await window.__TAURI__.window.getCurrentWindow().innerSize();
      if (size && size.height) currentHeight = size.height;
    }
  } catch (e) {
    currentHeight = 580;
  }
  const targetHeight = toHeight || currentHeight;
  const steps = 5;
  const stepTime = 10;
  const stepSizeW = (toWidth - fromWidth) / steps;
  const stepSizeH = (targetHeight - currentHeight) / steps;
  let currentW = fromWidth;
  let currentH = currentHeight;
  let step = 0;

  const interval = setInterval(() => {
    currentW += stepSizeW;
    currentH += stepSizeH;
    step++;
    if (window.__TAURI__) {
      const w = Math.round(currentW);
      const h = Math.round(currentH);
      if (w > 0 && h > 0) {
        window.__TAURI__.window.getCurrentWindow().setSize(
          new window.__TAURI__.window.LogicalSize(w, h)
        );
      }
    }
    if (step >= steps) clearInterval(interval);
  }, stepTime);
}

// ── Window position ───────────────────────────────────────────────────────────

async function saveWindowPosition() {
  if (window.__TAURI__) {
    try {
      const position = await window.__TAURI__.window.getCurrentWindow().outerPosition();
      if (position && typeof position.x === 'number' && typeof position.y === 'number') {
        localStorage.setItem('window_position', JSON.stringify({ x: position.x, y: position.y }));
      }
    } catch (e) {
      console.error('Failed to save position:', e);
    }
  }
}

async function restoreWindowPosition() {
  if (window.__TAURI__) {
    const saved = localStorage.getItem('window_position');
    if (saved) {
      const { x, y } = JSON.parse(saved);
      window.__TAURI__.window.getCurrentWindow().setPosition(
        new window.__TAURI__.window.PhysicalPosition(x, y)
      );
    }
    window.__TAURI__.window.getCurrentWindow().show();
  }
}

// ── Google Calendar ───────────────────────────────────────────────────────────

function isGoogleConnected() {
  const tokens = getGoogleTokens();
  return !!tokens?.refresh_token;
}

function getGoogleTokens() {
  const raw = localStorage.getItem('google_tokens');
  return raw ? JSON.parse(raw) : null;
}

function saveGoogleTokens(tokens) {
  if (tokens.expires_in) {
    tokens.expires_at = Date.now() + tokens.expires_in * 1000;
  }
  localStorage.setItem('google_tokens', JSON.stringify(tokens));
}

function disconnectGoogle() {
  localStorage.removeItem('google_tokens');
  localStorage.removeItem('google_code_verifier');
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function startGoogleAuth() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('google_code_verifier', codeVerifier);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  if (window.__TAURI__) {
    await window.__TAURI__.shell.open(authUrl);
  } else {
    window.open(authUrl, '_blank');
  }

  return listenForCallback();
}

function listenForCallback() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Auth timeout')), 120000);
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch('http://localhost:8642/oauth/token');
        if (response.ok) {
          const data = await response.json();
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve(data.code);
        }
      } catch (e) {
        // Server not ready yet
      }
    }, 1000);
  });
}

async function exchangeCodeForTokens(code) {
  const codeVerifier = localStorage.getItem('google_code_verifier');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  const tokens = await response.json();
  saveGoogleTokens(tokens);
  return tokens;
}

async function refreshAccessToken() {
  const tokens = getGoogleTokens();
  if (!tokens?.refresh_token) return null;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const newTokens = await response.json();
  saveGoogleTokens({ ...tokens, ...newTokens });
  return newTokens.access_token;
}

async function getValidAccessToken() {
  const tokens = getGoogleTokens();
  if (!tokens) return null;
  const expiresAt = tokens.expires_at || 0;
  if (Date.now() < expiresAt - 60000) return tokens.access_token;
  return await refreshAccessToken();
}

async function fetchGoogleEvents(year, month) {
  const token = await getValidAccessToken();
  if (!token) return [];
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
  const response = await fetch(
    `${CALENDAR_BASE}/calendars/primary/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) return [];
  const data = await response.json();
  return (data.items || []).map(item => ({
    id: item.id,
    title: item.summary || '(No title)',
    date: (item.start.date || item.start.dateTime).slice(0, 10),
    time: item.start.dateTime ? item.start.dateTime.slice(11, 16) : '',
    type: 'google',
    source: 'google',
    notes: item.description || '',
    googleId: item.id
  }));
}

async function createGoogleEvent(event) {
  const token = await getValidAccessToken();
  if (!token) return null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: event.title,
    description: event.notes || '',
    start: event.time
      ? { dateTime: `${event.date}T${event.time}:00`, timeZone: tz }
      : { date: event.date },
    end: event.time
      ? { dateTime: `${event.date}T${event.time}:00`, timeZone: tz }
      : { date: event.date }
  };
  const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.ok ? await response.json() : null;
}

async function updateGoogleEvent(googleId, event) {
  const token = await getValidAccessToken();
  if (!token) return null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: event.title,
    description: event.notes || '',
    start: event.time
      ? { dateTime: `${event.date}T${event.time}:00`, timeZone: tz }
      : { date: event.date },
    end: event.time
      ? { dateTime: `${event.date}T${event.time}:00`, timeZone: tz }
      : { date: event.date }
  };
  const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events/${googleId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.ok ? await response.json() : null;
}

async function deleteGoogleEvent(googleId) {
  const token = await getValidAccessToken();
  if (!token) return false;
  const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events/${googleId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.ok || response.status === 204;
}

async function fetchGoogleUserInfo() {
  const token = await getValidAccessToken();
  if (!token) return;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.email) localStorage.setItem('google_user_email', data.email);
    }
  } catch (e) {}
}

function startGoogleSyncTimer() {
  if (googleSyncTimer) clearInterval(googleSyncTimer);
  googleSyncTimer = setInterval(() => syncGoogleEvents(), 60 * 60 * 1000);
}

function stopGoogleSyncTimer() {
  if (googleSyncTimer) { clearInterval(googleSyncTimer); googleSyncTimer = null; }
}

async function initGoogleCalendar() {
  googleConnected = isGoogleConnected();
  if (googleConnected) {
    await fetchGoogleUserInfo();
    await syncGoogleEvents();
    startGoogleSyncTimer();
  }
}

async function syncGoogleEvents() {
  try {
    googleEvents = await fetchGoogleEvents(viewYear, viewMonth);
    renderCalendar();
  } catch (e) {
    console.error('Google sync error:', e);
  }
}

// ── ICS Import / Export ───────────────────────────────────────────────────────

function icsDateStr(dateStr) {
  return dateStr.replace(/-/g, '');
}

function icsDatetimeStr(dateStr, time) {
  const [h, m] = time.split(':');
  return `${icsDateStr(dateStr)}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
}

function addDaysToDate(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildICSContent() {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Desktop Calendar//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const ev of events) {
    if (ev.googleId) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@desktop-calendar`);

    if (ev.time) {
      lines.push(`DTSTART:${icsDatetimeStr(ev.date, ev.time)}`);
      const endH = (parseInt(ev.time.split(':')[0]) + 1) % 24;
      const endTime = `${endH.toString().padStart(2, '0')}:${ev.time.split(':')[1]}`;
      lines.push(`DTEND:${icsDatetimeStr(ev.date, endTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDateStr(ev.date)}`);
      const dtend = ev.endDate ? addDaysToDate(ev.endDate, 1) : addDaysToDate(ev.date, 1);
      lines.push(`DTEND;VALUE=DATE:${icsDateStr(dtend)}`);
    }

    lines.push(`SUMMARY:${ev.title.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')}`);
    if (ev.notes) lines.push(`DESCRIPTION:${ev.notes.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')}`);

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function exportICS() {
  const content = buildICSContent();

  if (window.__TAURI__) {
    const path = await window.__TAURI__.dialog.save({
      defaultPath: 'calendar.ics',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    });
    if (path) await window.__TAURI__.fs.writeTextFile(path, content);
  } else {
    const blob = new Blob([content], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'calendar.ics' });
    a.click();
    URL.revokeObjectURL(url);
  }
}

async function importICS() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.ics,text/calendar' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const text = await file.text();
    const imported = parseICS(text);
    if (!imported.length) { alert('No events found in file.'); return; }
    let added = 0;
    for (const ev of imported) {
      if (!events.find(e => e.icsUid && e.icsUid === ev.icsUid)) {
        events.push(ev);
        added++;
      }
    }
    await saveEvents();
    renderCalendar();
    alert(`Imported ${added} event${added !== 1 ? 's' : ''}.`);
  };
  input.click();
}

function parseICS(text) {
  const unfolded = text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n')
    .reduce((acc, line) => {
      if ((line.startsWith(' ') || line.startsWith('\t')) && acc.length) {
        acc[acc.length - 1] += line.slice(1);
      } else {
        acc.push(line);
      }
      return acc;
    }, []);

  const imported = [];
  let inEvent = false;
  let current = {};

  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (inEvent && current.date && current.title) {
        imported.push({ ...current, id: Date.now().toString() + Math.random().toString(36).slice(2) });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const rawKey = line.slice(0, colonIdx).toUpperCase();
    const val = line.slice(colonIdx + 1);

    if (rawKey === 'SUMMARY') {
      current.title = val.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    } else if (rawKey === 'DESCRIPTION') {
      current.notes = val.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    } else if (rawKey === 'UID') {
      current.icsUid = val;
    } else if (rawKey.startsWith('DTSTART')) {
      const parsed = parseICSDate(val);
      if (parsed) { current.date = parsed.date; if (parsed.time) current.time = parsed.time; }
    } else if (rawKey.startsWith('DTEND')) {
      const parsed = parseICSDate(val);
      if (parsed && !parsed.time) {
        // all-day DTEND is exclusive — subtract 1 day
        const inclusive = addDaysToDate(parsed.date, -1);
        if (inclusive !== current.date) current.endDate = inclusive;
      } else if (parsed && parsed.time) {
        if (parsed.date !== current.date) current.endDate = parsed.date;
      }
    }
  }

  return imported;
}

function parseICSDate(val) {
  const clean = val.replace('Z', '');
  if (clean.length === 8) {
    return { date: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}` };
  }
  if (clean.length >= 15 && clean[8] === 'T') {
    return {
      date: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
      time: `${clean.slice(9, 11)}:${clean.slice(11, 13)}`
    };
  }
  return null;
}

// ── Outlook Calendar ──────────────────────────────────────────────────────────

function isOutlookConnected() {
  return !!getOutlookTokens()?.refresh_token;
}

function getOutlookTokens() {
  const raw = localStorage.getItem('outlook_tokens');
  return raw ? JSON.parse(raw) : null;
}

function saveOutlookTokens(tokens) {
  if (tokens.expires_in) tokens.expires_at = Date.now() + tokens.expires_in * 1000;
  localStorage.setItem('outlook_tokens', JSON.stringify(tokens));
}

function disconnectOutlook() {
  localStorage.removeItem('outlook_tokens');
  localStorage.removeItem('outlook_code_verifier');
}

async function getValidOutlookToken() {
  const tokens = getOutlookTokens();
  if (!tokens) return null;
  if (Date.now() < (tokens.expires_at || 0) - 60000) return tokens.access_token;
  return await refreshOutlookToken();
}

async function refreshOutlookToken() {
  const tokens = getOutlookTokens();
  if (!tokens?.refresh_token) return null;
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
      scope: MICROSOFT_SCOPES
    })
  });
  const newTokens = await response.json();
  saveOutlookTokens({ ...tokens, ...newTokens });
  return newTokens.access_token;
}

async function startOutlookAuth() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Tell the Rust server to handle the token exchange when the callback arrives.
  // This avoids CORS restrictions on the Microsoft token endpoint.
  await fetch('http://localhost:8642/oauth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      code_verifier: codeVerifier,
      redirect_uri: MICROSOFT_REDIRECT_URI,
      scope: MICROSOFT_SCOPES,
    })
  });

  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    redirect_uri: MICROSOFT_REDIRECT_URI,
    response_type: 'code',
    scope: MICROSOFT_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    response_mode: 'query'
  });

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  if (window.__TAURI__) {
    await window.__TAURI__.shell.open(authUrl);
  } else {
    window.open(authUrl, '_blank');
  }

  // Poll for the tokens the Rust server exchanged server-side
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Auth timeout')), 120000);
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch('http://localhost:8642/oauth/tokens');
        if (response.ok) {
          const tokens = await response.json();
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve(tokens);
        }
      } catch (e) {}
    }, 1000);
  });
}

async function exchangeOutlookCode(code) {
  const codeVerifier = localStorage.getItem('outlook_code_verifier');
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: MICROSOFT_REDIRECT_URI,
      grant_type: 'authorization_code',
      scope: MICROSOFT_SCOPES
    })
  });
  const tokens = await response.json();
  if (tokens.error) {
    throw new Error(`Microsoft token error: ${tokens.error} — ${tokens.error_description}`);
  }
  saveOutlookTokens(tokens);
  return tokens;
}

async function fetchOutlookEvents(year, month) {
  const token = await getValidOutlookToken();
  if (!token) return [];

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  const response = await fetch(
    `${GRAPH_BASE}/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=id,subject,start,end,isAllDay&$top=100&$orderby=start/dateTime`,
    { headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${tz}"` } }
  );
  if (!response.ok) return [];

  const data = await response.json();
  return (data.value || []).map(item => {
    const startDate = (item.start.date || item.start.dateTime || '').slice(0, 10);
    let endDate = null;
    if (item.isAllDay && item.end.date) {
      // Graph all-day end dates are exclusive — subtract one day
      const d = new Date(item.end.date + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      const inclusiveEnd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (inclusiveEnd !== startDate) endDate = inclusiveEnd;
    }
    return {
      id: item.id,
      title: item.subject || '(No title)',
      date: startDate,
      endDate,
      time: !item.isAllDay && item.start.dateTime ? item.start.dateTime.slice(11, 16) : '',
      type: 'outlook',
      source: 'outlook',
      outlookId: item.id
    };
  });
}

async function syncOutlookEvents() {
  try {
    outlookEvents = await fetchOutlookEvents(viewYear, viewMonth);
    renderCalendar();
  } catch (e) {
    console.error('Outlook sync error:', e);
  }
}

async function fetchOutlookUserInfo() {
  const token = await getValidOutlookToken();
  if (!token) return;
  try {
    const res = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const email = data.mail || data.userPrincipalName;
      if (email) localStorage.setItem('outlook_user_email', email);
    }
  } catch (e) {}
}

async function initOutlookCalendar() {
  outlookConnected = isOutlookConnected();
  if (outlookConnected) {
    await fetchOutlookUserInfo();
    await syncOutlookEvents();
  }
}

function updateTodayBtn() {
  const today = new Date();
  const btn = document.getElementById('today-btn');
  if (!btn) return;
  if (viewYear === today.getFullYear() && viewMonth === today.getMonth()) {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'block';
  }
}

// ── Mini calendar ─────────────────────────────────────────────────────────────

let miniYear = new Date().getFullYear();
let miniMonth = new Date().getMonth();
let miniCalActive = false;

function renderMiniCalendar() {
  const container = document.getElementById('mini-view');
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'mini-cal-container';

  // Header
  const header = document.createElement('div');
  header.className = 'mini-cal-header';

  const title = document.createElement('div');
  title.className = 'mini-cal-title';
  title.textContent = new Date(miniYear, miniMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const nav = document.createElement('div');
  nav.className = 'mini-cal-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'mini-cal-btn';
  prevBtn.textContent = '‹';
  prevBtn.onmousedown = e => e.stopPropagation();
  prevBtn.onclick = () => {
    miniMonth--;
    if (miniMonth < 0) { miniMonth = 11; miniYear--; }
    renderMiniCalendar();
  };

  const todayBtn = document.createElement('button');
  todayBtn.className = 'mini-cal-btn';
  todayBtn.textContent = '⌃';
  todayBtn.onmousedown = e => e.stopPropagation();
  todayBtn.onclick = () => {
    miniYear = new Date().getFullYear();
    miniMonth = new Date().getMonth();
    renderMiniCalendar();
  };

  const nextBtn = document.createElement('button');
  nextBtn.className = 'mini-cal-btn';
  nextBtn.textContent = '›';
  nextBtn.onmousedown = e => e.stopPropagation();
  nextBtn.onclick = () => {
    miniMonth++;
    if (miniMonth > 11) { miniMonth = 0; miniYear++; }
    renderMiniCalendar();
  };

  nav.appendChild(prevBtn);
  nav.appendChild(todayBtn);
  nav.appendChild(nextBtn);
  header.appendChild(title);
  header.appendChild(nav);
  wrapper.appendChild(header);

  // Grid
  const grid = document.createElement('div');
  grid.className = 'mini-cal-grid';

  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'mini-cal-day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay = new Date(miniYear, miniMonth, 1).getDay();
  const daysInMonth = new Date(miniYear, miniMonth + 1, 0).getDate();
  const daysInPrev = new Date(miniYear, miniMonth, 0).getDate();
  const today = new Date();

  // Build cells
  let cells = [];

  // Previous month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({
      day: daysInPrev - i,
      month: miniMonth - 1 < 0 ? 11 : miniMonth - 1,
      year: miniMonth === 0 ? miniYear - 1 : miniYear,
      other: true
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: miniMonth, year: miniYear, other: false });
  }

  // Next month padding to complete the last row
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      day: nextDay++,
      month: miniMonth + 1 > 11 ? 0 : miniMonth + 1,
      year: miniMonth === 11 ? miniYear + 1 : miniYear,
      other: true
    });
  }

  // Remove last row if ALL cells in it are other-month
  if (cells.length === 42) {
    const lastRow = cells.slice(35);
    if (lastRow.every(c => c.other)) {
      cells = cells.slice(0, 35);
    }
  }

  // Render cells
  cells.forEach(c => {
    const cell = document.createElement('div');
    cell.className = 'mini-cal-cell' + (c.other ? ' other-month' : '');
    const isToday = !c.other &&
      c.day === today.getDate() &&
      c.month === today.getMonth() &&
      c.year === today.getFullYear();

    const numSpan = document.createElement('span');
    numSpan.textContent = c.day;
    numSpan.style.width = '28px';
    numSpan.style.height = '28px';
    numSpan.style.display = 'flex';
    numSpan.style.alignItems = 'center';
    numSpan.style.justifyContent = 'center';
    numSpan.style.borderRadius = '50%';
    if (isToday) {
      numSpan.style.background = 'var(--accent)';
      numSpan.style.color = '#fff';
      numSpan.style.fontWeight = '500';
    }
    cell.appendChild(numSpan);

    cell.onclick = () => {
      viewYear = c.year;
      viewMonth = c.month;
      switchToMiniOff();
    };

    grid.appendChild(cell);
  });

  wrapper.appendChild(grid);
  container.appendChild(wrapper);

  document.getElementById('month-label').textContent =
    new Date(miniYear, miniMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Resize window to fit content
  requestAnimationFrame(() => {
    const numRows = cells.length / 7;
    const rowHeight = 36;
    const headerHeight = 50;
    const dayHeaderHeight = 24;
    const dragHeight = 20;
    const padding = 24;
    const totalHeight = dragHeight + headerHeight + dayHeaderHeight + (numRows * rowHeight) + padding;
    if (window.__TAURI__) {
      window.__TAURI__.window.getCurrentWindow().setSize(
        new window.__TAURI__.window.LogicalSize(340, totalHeight)
      );
    }
  });
}

function switchToMini() {
  rangeSelectStart = null;
  miniYear = new Date().getFullYear();
  miniMonth = new Date().getMonth();
  miniCalActive = true;

  const monthView = document.getElementById('month-view');
  const miniView = document.getElementById('mini-view');
  const navBtns = document.getElementById('nav-btns');
  const backBtn = document.getElementById('back-btn');
  const header = document.querySelector('.header');
  renderMiniCalendar();

  monthView.classList.remove('active');
  monthView.classList.add('slide-left');
  miniView.classList.remove('slide-right');
  miniView.classList.add('active');

  navBtns.style.display = 'none';
  backBtn.style.display = 'none';
  header.style.display = 'none';
  document.querySelector('.view-container').style.height = 'calc(100vh - 20px)';

  animateResize(460, 340, 80, 400);
}

function switchToMiniOff() {
  miniCalActive = false;

  const monthView = document.getElementById('month-view');
  const miniView = document.getElementById('mini-view');
  const navBtns = document.getElementById('nav-btns');
  const header = document.querySelector('.header');
  miniView.classList.remove('active');
  miniView.classList.add('slide-right');
  monthView.classList.remove('slide-left');
  monthView.classList.add('active');

  navBtns.style.display = 'flex';
  header.style.display = 'flex';
  document.querySelector('.view-container').style.height = '';

  renderCalendar();
  syncHolidays();
  updateTodayBtn();

  animateResize(340, 460, 80, 580);
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prev').onclick = () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
    syncHolidays();
    updateTodayBtn();
  };

  document.getElementById('next').onclick = () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
    syncHolidays();
    updateTodayBtn();
  };

  document.getElementById('today-btn').onclick = () => {
    viewYear = new Date().getFullYear();
    viewMonth = new Date().getMonth();
    renderCalendar();
    syncHolidays();
    updateTodayBtn();
  };

  document.getElementById('back-btn').onclick = () => switchToMonth();

  document.getElementById('drag-handle').addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    if (window.__TAURI__) {
      window.__TAURI__.window.getCurrentWindow().startDragging();
      setTimeout(() => saveWindowPosition(), 500);
    }
  });

  document.getElementById('drag-handle').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });

  updateClock();
  setInterval(updateClock, 1000);
  initStorage().then(() => {
    renderCalendar();
    syncHolidays();
    updateTodayBtn();
  });
  loadTheme();
  initGoogleCalendar();
  initOutlookCalendar();
  fetchWeather();
  setTimeout(() => restoreWindowPosition(), 100);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && rangeSelectStart) {
    rangeSelectStart = null;
    clearRangeHighlight();
    return;
  }
  if (e.shiftKey && e.key === 'M') {
    if (miniCalActive) switchToMiniOff();
    else if (currentView === 'month') switchToMini();
  }
});

// ── Autostart ─────────────────────────────────────────────────────────────────

async function enableAutostart() {
  if (window.__TAURI__) {
    window.__TAURI__.core.invoke('plugin:autostart|enable');
    console.log('Autostart enabled');
  }
}

async function disableAutostart() {
  if (window.__TAURI__) {
    window.__TAURI__.core.invoke('plugin:autostart|disable');
    console.log('Autostart disabled');
  }
}

async function isAutostartEnabled() {
  if (window.__TAURI__) {
    return window.__TAURI__.core.invoke('plugin:autostart|is_enabled');
  }
  return false;
}

// ── Always on top ───────────────────────────────────────────────────────────────── 

async function setAlwaysOnTop(enabled) {
  if (window.__TAURI__) {
    window.__TAURI__.window.getCurrentWindow().setAlwaysOnTop(enabled);
    localStorage.setItem('always_on_top', enabled ? 'true' : 'false');
  }
}

async function isAlwaysOnTop() {
  if (window.__TAURI__) {
    return window.__TAURI__.window.getCurrentWindow().isAlwaysOnTop();
  }
  return false;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

const themes = ['default', 'dark', 'warm', 'cool', 'highcontrast', 'highcontrastdark'];

// ── Event colors ──────────────────────────────────────────────────────────────

const EVENT_COLORS = [
  { hex: '#6446DC', label: 'Purple' },
  { hex: '#1A7A52', label: 'Green' },
  { hex: '#C47A00', label: 'Amber' },
  { hex: '#D93025', label: 'Red' },
  { hex: '#C2185B', label: 'Pink' },
  { hex: '#0891B2', label: 'Teal' },
  { hex: '#1E40AF', label: 'Navy' },
  { hex: '#6B7280', label: 'Gray' },
];

function getContrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#1a1a1a' : '#ffffff';
}

function makeColorSwatches(currentColor, onChange) {
  const row = document.createElement('div');
  row.className = 'color-swatches';
  row.onmousedown = e => e.stopPropagation();

  const none = document.createElement('span');
  none.className = 'color-swatch swatch-none' + (!currentColor ? ' selected' : '');
  none.title = 'Default';
  none.onclick = () => {
    row.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    none.classList.add('selected');
    onChange(null);
  };
  row.appendChild(none);

  EVENT_COLORS.forEach(({ hex, label }) => {
    const swatch = document.createElement('span');
    swatch.className = 'color-swatch' + (currentColor === hex ? ' selected' : '');
    swatch.title = label;
    swatch.style.background = hex;
    swatch.onclick = () => {
      row.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      onChange(hex);
    };
    row.appendChild(swatch);
  });
  return row;
}

function applyEventColor(el, ev) {
  if (!ev.color) return;
  el.style.backgroundColor = ev.color;
  el.style.borderColor = ev.color;
  el.style.color = getContrastColor(ev.color);
}

function applyTheme(theme) {
  const widget = document.getElementById('widget');
  if (theme === 'default') {
    widget.removeAttribute('data-theme');
  } else {
    widget.setAttribute('data-theme', theme);
  }
  localStorage.setItem('calendar_theme', theme);
}

function loadTheme() {
  const saved = localStorage.getItem('calendar_theme') || 'default';
  applyTheme(saved);
}

// ── Context menu ──────────────────────────────────────────────────────────────

async function showContextMenu(x, y) {
  closeContextMenu();

  Object.keys(contextMenuState).forEach(k => { contextMenuState[k] = false; });
  const [autostartOn, alwaysOnTopOn] = await Promise.all([isAutostartEnabled(), isAlwaysOnTop()]);
  const currentTheme = localStorage.getItem('calendar_theme') || 'default';

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function addDivider() {
    menu.appendChild(Object.assign(document.createElement('div'), { className: 'context-menu-divider' }));
  }

  function makeItem(html, onclick, danger = false) {
    const item = document.createElement('div');
    item.className = 'context-menu-item' + (danger ? ' danger' : '');
    item.innerHTML = html;
    if (onclick) item.onclick = onclick;
    return item;
  }

  function makeSection(key, label, buildFn) {
    const wrap = document.createElement('div');
    const header = document.createElement('div');
    header.className = 'context-menu-section-header';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const arrow = document.createElement('span');
    arrow.className = 'context-menu-section-toggle';
    arrow.textContent = contextMenuState[key] ? '▾' : '▸';
    header.appendChild(lbl);
    header.appendChild(arrow);
    const body = document.createElement('div');
    body.className = 'context-menu-section-body' + (contextMenuState[key] ? ' open' : '');
    buildFn(body);
    header.onclick = (e) => {
      e.stopPropagation();
      const wasOpen = body.classList.contains('open');
      // Collapse all sections
      menu.querySelectorAll('.context-menu-section-body').forEach(b => b.classList.remove('open'));
      menu.querySelectorAll('.context-menu-section-toggle').forEach(a => a.textContent = '▸');
      Object.keys(contextMenuState).forEach(k => { contextMenuState[k] = false; });
      // Open this one unless it was already open (click again to collapse)
      if (!wasOpen) {
        body.classList.add('open');
        arrow.textContent = '▾';
        contextMenuState[key] = true;
      }
    };
    wrap.appendChild(header);
    wrap.appendChild(body);
    return wrap;
  }

  // ── Theme ─────────────────────────────────────────────────────────────────
  menu.appendChild(makeSection('theme', 'Theme', body => {
    [
      { id: 'default', label: 'Default',       color: '#FAF7F2', border: '#ccc' },
      { id: 'dark',    label: 'Gruvbox Dark',  color: '#282828', border: '#A89984' },
      { id: 'warm',    label: 'Gruvbox Light', color: '#F9F5D7', border: '#665C54' },
      { id: 'cool', label: 'Cool', color: '#F0F4FA', border: '#6a9ad4' },
    ].forEach(t => {
      body.appendChild(makeItem(`
        <span>
          <span class="theme-dot" style="background:${t.color};border:1px solid ${t.border}"></span>
          ${t.label}
        </span>
        ${currentTheme === t.id ? '<span class="check">✓</span>' : ''}
      `, () => { applyTheme(t.id); closeContextMenu(); }));
    });

    // High Contrast expandable sub-section
    const hcIsActive = currentTheme === 'highcontrast' || currentTheme === 'highcontrastdark';
    const hcHeader = document.createElement('div');
    hcHeader.className = 'context-menu-item';
    hcHeader.innerHTML = `
      <span>
        <span class="theme-dot" style="background:#ffffff;border:1px solid #000000"></span>
        High Contrast${hcIsActive ? '' : ''}
      </span>
      <span style="display:flex;align-items:center;gap:4px">
        ${hcIsActive ? '<span class="check">✓</span>' : ''}
        <span class="context-menu-section-toggle" id="hc-arrow">${contextMenuState['highcontrast'] ? '▾' : '▸'}</span>
      </span>`;
    const hcBody = document.createElement('div');
    hcBody.className = 'context-menu-section-body' + (contextMenuState['highcontrast'] ? ' open' : '');
    [{ value: 'highcontrast', label: 'Light' }, { value: 'highcontrastdark', label: 'Dark' }].forEach(({ value, label }) => {
      const sub = document.createElement('div');
      sub.className = 'context-menu-item';
      sub.style.paddingLeft = '24px';
      sub.innerHTML = `<span>${label}</span>${currentTheme === value ? '<span class="check">✓</span>' : ''}`;
      sub.onclick = () => { applyTheme(value); closeContextMenu(); };
      hcBody.appendChild(sub);
    });
    hcHeader.onclick = (e) => {
      e.stopPropagation();
      const wasOpen = hcBody.classList.contains('open');
      if (wasOpen) {
        hcBody.classList.remove('open');
        hcHeader.querySelector('#hc-arrow').textContent = '▸';
        contextMenuState['highcontrast'] = false;
      } else {
        hcBody.classList.add('open');
        hcHeader.querySelector('#hc-arrow').textContent = '▾';
        contextMenuState['highcontrast'] = true;
      }
    };
    body.appendChild(hcHeader);
    body.appendChild(hcBody);
  }));

  addDivider();

  // ── Settings ──────────────────────────────────────────────────────────────
  menu.appendChild(makeSection('settings', 'Settings', body => {
    body.appendChild(makeItem(
      `<span>Launch on startup</span>${autostartOn ? '<span class="check">✓</span>' : ''}`,
      async () => { if (autostartOn) await disableAutostart(); else await enableAutostart(); closeContextMenu(); }
    ));
    body.appendChild(makeItem(
      `<span>Always on top</span>${alwaysOnTopOn ? '<span class="check">✓</span>' : ''}`,
      async () => { await setAlwaysOnTop(!alwaysOnTopOn); closeContextMenu(); }
    ));
    body.appendChild(makeItem(
      `<span>Clock format</span><span style="color:var(--text-tertiary);font-size:11px">${clockSettings.format === '24h' ? '24h' : '12h'}</span>`,
      () => {
        clockSettings.format = clockSettings.format === '24h' ? '12h' : '24h';
        localStorage.setItem('clock_settings', JSON.stringify(clockSettings));
        updateClock();
        closeContextMenu();
      }
    ));
    body.appendChild(makeItem(
      `<span>Mini calendar</span><span style="font-size:10px;color:var(--text-tertiary)">Shift+M</span>`,
      () => { if (miniCalActive) switchToMiniOff(); else switchToMini(); closeContextMenu(); }
    ));
    body.appendChild(makeItem(
      `<span>Import .ics</span>`,
      () => { importICS(); closeContextMenu(); }
    ));
    body.appendChild(makeItem(
      `<span>Export .ics</span>`,
      async () => { await exportICS(); closeContextMenu(); }
    ));
  }));

  addDivider();

  // ── External Calendars ────────────────────────────────────────────────────
  menu.appendChild(makeSection('calendars', 'External Calendars', body => {
    const googleEmail  = localStorage.getItem('google_user_email');
    const googleName   = googleEmail  ? googleEmail.split('@')[0]  : null;
    const outlookEmail = localStorage.getItem('outlook_user_email');
    const outlookName  = outlookEmail ? outlookEmail.split('@')[0] : null;

    // Google
    const gLabel = Object.assign(document.createElement('div'), { className: 'context-menu-label' });
    gLabel.textContent = 'Google';
    body.appendChild(gLabel);

    if (googleConnected) {
      if (googleName) body.appendChild(makeItem(
        `<span style="color:var(--text-secondary);font-size:11px">${googleName}</span><span class="check">✓</span>`
      ));
      body.appendChild(makeItem(
        `<span>Sync</span><span style="color:var(--text-tertiary)">↻</span>`,
        async () => { await syncGoogleEvents(); closeContextMenu(); }
      ));
      body.appendChild(makeItem(`<span>Disconnect</span>`, () => {
        disconnectGoogle(); googleEvents = []; googleConnected = false;
        stopGoogleSyncTimer();
        localStorage.removeItem('google_user_email');
        renderCalendar(); closeContextMenu();
      }, true));
    } else {
      body.appendChild(makeItem(`<span>Connect Google Calendar</span>`, async () => {
        try {
          const code = await startGoogleAuth();
          await exchangeCodeForTokens(code);
          googleConnected = true;
          await fetchGoogleUserInfo();
          await syncGoogleEvents();
          startGoogleSyncTimer();
        } catch (e) { console.error('Google auth error:', e); }
        closeContextMenu();
      }));
    }

    // Outlook
    const oLabel = Object.assign(document.createElement('div'), { className: 'context-menu-label' });
    oLabel.textContent = 'Outlook';
    oLabel.style.marginTop = '4px';
    body.appendChild(oLabel);

    if (outlookConnected) {
      if (outlookName) body.appendChild(makeItem(
        `<span style="color:var(--text-secondary);font-size:11px">${outlookName}</span><span class="check">✓</span>`
      ));
      body.appendChild(makeItem(
        `<span>Sync</span><span style="color:var(--text-tertiary)">↻</span>`,
        async () => { await syncOutlookEvents(); closeContextMenu(); }
      ));
      body.appendChild(makeItem(`<span>Disconnect</span>`, () => {
        disconnectOutlook(); outlookEvents = []; outlookConnected = false;
        localStorage.removeItem('outlook_user_email');
        renderCalendar(); closeContextMenu();
      }, true));
    } else {
      body.appendChild(makeItem(`<span>Connect Outlook Calendar</span>`, async () => {
        if (!MICROSOFT_CLIENT_ID) { alert('Add your Azure app Client ID to config.js first.'); closeContextMenu(); return; }
        try {
          const tokens = await startOutlookAuth();
          if (tokens.error) throw new Error(`${tokens.error}: ${tokens.error_description}`);
          saveOutlookTokens(tokens);
          outlookConnected = true;
          await fetchOutlookUserInfo();
          await syncOutlookEvents();
        } catch (e) {
          console.error('Outlook auth error:', e);
          alert(`Outlook connection failed:\n${e.message}`);
        }
        closeContextMenu();
      }));
    }
  }));

  addDivider();

  // ── Holidays ──────────────────────────────────────────────────────────────
  menu.appendChild(makeSection('holidays', 'Holidays', body => {
    [
      { code: 'US', name: 'United States' },
      { code: 'CA', name: 'Canada' },
      { code: 'UK', name: 'United Kingdom' },
      { code: 'AU', name: 'Australia' },
    ].forEach(country => {
      const isSelected = selectedCountries.includes(country.code);
      body.appendChild(makeItem(
        `<span>${country.name}</span>${isSelected ? '<span class="check">✓</span>' : ''}`,
        () => {
          if (isSelected) selectedCountries = selectedCountries.filter(c => c !== country.code);
          else selectedCountries.push(country.code);
          localStorage.setItem('selected_countries', JSON.stringify(selectedCountries));
          syncHolidays(); closeContextMenu();
        }
      ));
    });
  }));

  addDivider();

  // ── Weather ───────────────────────────────────────────────────────────────
  menu.appendChild(makeSection('weather', 'Weather', body => {
    body.appendChild(makeItem(
      `<span>Show weather</span>${weatherSettings.enabled ? '<span class="check">✓</span>' : ''}`,
      () => {
        weatherSettings.enabled = !weatherSettings.enabled;
        saveWeatherSettings();
        if (weatherSettings.enabled) fetchWeather(); else updateWeatherDisplay();
        closeContextMenu();
      }
    ));
    body.appendChild(makeItem(
      `<span>Units</span><span style="color:var(--text-tertiary);font-size:11px">${weatherSettings.units === 'F' ? '°F' : '°C'}</span>`,
      () => {
        weatherSettings.units = weatherSettings.units === 'F' ? 'C' : 'F';
        saveWeatherSettings(); localStorage.removeItem('weather_cache');
        fetchWeather(); closeContextMenu();
      }
    ));

    const locLabel = Object.assign(document.createElement('div'), { className: 'context-menu-label' });
    locLabel.textContent = 'Location';
    body.appendChild(locLabel);

    const locWrapper = document.createElement('div');
    locWrapper.style.padding = '4px 10px';
    locWrapper.onclick = e => e.stopPropagation();

    const locInput = document.createElement('input');
    locInput.type = 'text';
    locInput.value = weatherSettings.location;
    locInput.placeholder = 'City or zip code';
    locInput.className = 'day-todo-input';
    locInput.style.fontSize = '11px';
    locInput.onmousedown = e => e.stopPropagation();
    locInput.onclick = e => e.stopPropagation();
    locInput.onkeydown = e => {
      if (e.key === 'Enter') {
        weatherSettings.location = locInput.value.trim();
        saveWeatherSettings(); localStorage.removeItem('weather_cache');
        fetchWeather(); closeContextMenu();
      }
    };
    locWrapper.appendChild(locInput);
    body.appendChild(locWrapper);
  }));

  addDivider();

  // ── About & Close (always visible) ───────────────────────────────────────
  menu.appendChild(makeItem(
    '<span>About</span><span style="font-size:10px;color:var(--text-tertiary)">v0.7.1</span>',
    () => closeContextMenu()
  ));
  menu.appendChild(makeItem('Close', async () => {
    if (window.__TAURI__) await window.__TAURI__.window.getCurrentWindow().close();
  }, true));

  document.getElementById('widget').appendChild(menu);

  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const widgetRect = document.getElementById('widget').getBoundingClientRect();
    let newTop = y, newLeft = x;
    if (menuRect.bottom > widgetRect.bottom) newTop = y - menu.offsetHeight;
    if (menuRect.right > widgetRect.right) newLeft = x - menu.offsetWidth;
    if (newTop < 0) newTop = 0;
    if (newLeft < 0) newLeft = 0;
    menu.style.top = newTop + 'px';
    menu.style.left = newLeft + 'px';
  });

  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 50);
}

function closeContextMenu() {
  const existing = document.getElementById('context-menu');
  if (existing) existing.remove();
}

function updateWeatherDisplay() {
  const el = document.getElementById('weather-display');
  if (!el) return;

  if (!weatherSettings.enabled || !weatherData) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }

  try {
    const current = weatherData.current_condition[0];
    const today = weatherData.weather[0];
    const code = parseInt(current.weatherCode);
    const icon = getWeatherIcon(code);

    let temp, high, low;
    if (weatherSettings.units === 'F') {
      temp = current.temp_F + '°';
      high = today.maxtempF + '°';
      low = today.mintempF + '°';
    } else {
      temp = current.temp_C + '°';
      high = today.maxtempC + '°';
      low = today.mintempC + '°';
    }

    el.innerHTML = `
      <span class="weather-icon">${icon}</span>
      <span class="weather-temp">${temp}</span>
      <span class="weather-sep">·</span>
      <span class="weather-hl">${high} | ${low}</span>
    `;
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.gap = '3px';
  } catch (e) {
    el.innerHTML = '';
    el.style.display = 'none';
  }
}

