// Google Calendar
let googleEvents = [];
let googleConnected = false;

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

let monthRecurringEvents = [];

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

async function initGoogleCalendar() {
  googleConnected = isGoogleConnected();
  if (googleConnected) {
    await syncGoogleEvents();
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
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent = h + ':' + m;
  document.getElementById('clock-date').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function updateTodayBtn() {
  const today = new Date();
  const btn = document.getElementById('today-btn');
  if (viewYear === today.getFullYear() && viewMonth === today.getMonth()) {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'block';
  }
}

function getEventsForDate(y, m, d) {
  const key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const local = events.filter(e => {
    if (e.recurrence) return false;
    if (e.date === key) return true;
    if (e.endDate && e.endDate >= key && e.date < key) return true;
    return false;
  });
  const recurring = monthRecurringEvents.filter(e => e.date === key);
  const google = googleEvents.filter(e => e.date === key);
  const holidays = holidayEvents.filter(e => e.date === key);

  // Multi-day first, then regular, then holidays last
  const multiDay = local.filter(e => e.endDate);
  const regular = [...local.filter(e => !e.endDate), ...recurring, ...google];
  return [...multiDay, ...regular, ...holidays];
}

function dateKey(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
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
      const evs = getEventsForDate(c.year, c.month, c.day);
      evs.slice(0, 2).forEach(ev => {
        const pill = document.createElement('div');
        pill.className = 'event-pill ' + (ev.type || 'personal');
  
        let label = ev.title;
        if (ev.endDate) {
          const cellKey = dateKey(c.year, c.month, c.day);
          if (ev.date === cellKey) label = ev.title + ' →';
          else if (ev.endDate === cellKey) label = '← ' + ev.title;
          else label = '— ' + ev.title + ' —';
        }
        
        pill.textContent = label;
        cell.appendChild(pill);
      });
      if (evs.length > 2) {
        const more = document.createElement('div');
        more.className = 'more-pill';
        more.textContent = '+' + (evs.length - 2) + ' more';
        cell.appendChild(more);
      }
      cell.onclick = (e) => {
        if (e.shiftKey) {
          dayViewDate = new Date(c.year, c.month, c.day);
          switchToDay();
        } else {
          weekStartDate = new Date(c.year, c.month, c.day);
          const dayOfWeek = weekStartDate.getDay();
          weekStartDate.setDate(weekStartDate.getDate() - dayOfWeek);
          switchToWeek();
        }
      };
    }

    grid.appendChild(cell);
  });
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

  // Main week grid
  const grid = document.createElement('div');
  grid.className = 'week-view-grid';

  for (let i = 0; i < 7; i++) {
    const date = weekDates[i];
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
    const key = dateKey(y, m, d);

    const col = document.createElement('div');
    col.className = 'week-day-col';

    const dayHeader = document.createElement('div');
    dayHeader.className = 'week-day-header' + (isToday ? ' today' : '');
    dayHeader.textContent = date.toLocaleDateString('en-US', { weekday: 'short' });
    col.appendChild(dayHeader);

    const dayNum = document.createElement('div');
    dayNum.className = 'week-day-num' + (isToday ? ' today' : '');
    dayNum.textContent = d;
    dayNum.style.cursor = 'pointer';
    dayNum.title = 'Shift+click to open day view';
    dayNum.onclick = (e) => {
      if (e.shiftKey) {
        dayViewDate = new Date(y, m, d);
        switchToDay();
      }
    };
    col.appendChild(dayNum);

    const eventsDiv = document.createElement('div');
    eventsDiv.className = 'week-events';
    getEventsForDate(y, m, d).forEach(ev => {
      const pill = document.createElement('div');
      pill.className = 'event-pill ' + (ev.type || 'personal');
      if (ev.endDate) {
        const cellKey = dateKey(y, m, d);
        if (ev.date === cellKey) pill.textContent = ev.title + ' →';
        else if (ev.endDate === cellKey) pill.textContent = '← ' + ev.title;
        else pill.textContent = '— ' + ev.title;
      } else {
        pill.textContent = ev.title;
      }
      eventsDiv.appendChild(pill);
    });
    col.appendChild(eventsDiv);

    const textarea = document.createElement('textarea');
    textarea.className = 'week-notes';
    textarea.placeholder = 'Notes...';
    textarea.value = notes[key] || '';
    textarea.oninput = () => {
      notes[key] = textarea.value;
      saveNotes();
    };
    textarea.onmousedown = e => e.stopPropagation();
    col.appendChild(textarea);

    grid.appendChild(col);
  }

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
          parentEvent.notes = notesInput.value.trim();
        } else {
          // Edit just this occurrence - store as exception
          if (!parentEvent.recurrence.exceptions) parentEvent.recurrence.exceptions = {};
          parentEvent.recurrence.exceptions[ev.date] = {
            title: titleInput.value.trim(),
            time: timeInput.value,
            type: typeSelect.value,
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
  console.log('switchToWeek called, currentView:', currentView, 'weekStartDate:', weekStartDate);
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
    const legendHeight = document.querySelector('.legend').offsetHeight;
    const totalHeight = contentHeight + headerHeight + legendHeight + 75;
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
    const legendHeight = document.querySelector('.legend').offsetHeight;
    const totalHeight = contentHeight + headerHeight + legendHeight + 85;
    console.log('day contentHeight:', contentHeight);
    console.log('day totalHeight:', totalHeight);
    viewContainer.style.height = '';
    animateResize(fromWidth, 560, 80, totalHeight);
    setTimeout(() => {
      dayView.classList.remove('slide-right');
      dayView.classList.add('active');
    }, 100);
  }, 300);
}

function switchToMonth() {
  console.log('switchToMonth called, currentView:', currentView);
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

async function initGoogleCalendar() {
  googleConnected = isGoogleConnected();
  if (googleConnected) await syncGoogleEvents();
}

async function syncGoogleEvents() {
  try {
    googleEvents = await fetchGoogleEvents(viewYear, viewMonth);
    console.log('Google events fetched:', googleEvents);
    renderCalendar();
  } catch (e) {
    console.error('Google sync error:', e);
  }
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
  setTimeout(() => restoreWindowPosition(), 100);
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

const themes = ['default', 'dark', 'warm', 'cool'];

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

  const autostartOn = await isAutostartEnabled();
  const alwaysOnTopOn = await isAlwaysOnTop();
  const currentTheme = localStorage.getItem('calendar_theme') || 'default';

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Theme section
  const themeLabel = document.createElement('div');
  themeLabel.className = 'context-menu-label';
  themeLabel.textContent = 'Theme';
  menu.appendChild(themeLabel);

  const themeOptions = [
    { id: 'default', label: 'Default', color: '#FAF7F2', border: '#ccc' },
    { id: 'dark', label: 'Gruvbox Dark', color: '#282828', border: '#A89984' },
    { id: 'warm', label: 'Gruvbox Light', color: '#F9F5D7', border: '#665C54' },
    { id: 'cool', label: 'Cool', color: '#F0F4FA', border: '#6a9ad4' },
  ];

  themeOptions.forEach(t => {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    item.innerHTML = `
      <span>
        <span class="theme-dot" style="background:${t.color}; border: 1px solid ${t.border}"></span>
        ${t.label}
      </span>
      ${currentTheme === t.id ? '<span class="check">✓</span>' : ''}
    `;
    item.onclick = () => {
      applyTheme(t.id);
      closeContextMenu();
    };
    menu.appendChild(item);
  });

  // Divider
  menu.appendChild(Object.assign(document.createElement('div'), { className: 'context-menu-divider' }));

  // Settings section
  const settingsLabel = document.createElement('div');
  settingsLabel.className = 'context-menu-label';
  settingsLabel.textContent = 'Settings';
  menu.appendChild(settingsLabel);

  const autostartItem = document.createElement('div');
  autostartItem.className = 'context-menu-item';
  autostartItem.innerHTML = `
    <span>Launch on startup</span>
    ${autostartOn ? '<span class="check">✓</span>' : ''}
  `;
  autostartItem.onclick = async () => {
    if (autostartOn) await disableAutostart();
    else await enableAutostart();
    closeContextMenu();
  };
  menu.appendChild(autostartItem);

  const alwaysOnTopItem = document.createElement('div');
  alwaysOnTopItem.className = 'context-menu-item';
  alwaysOnTopItem.innerHTML = `
    <span>Always on top</span>
    ${alwaysOnTopOn ? '<span class="check">✓</span>' : ''}
  `;
  alwaysOnTopItem.onclick = async () => {
    await setAlwaysOnTop(!alwaysOnTopOn);
    closeContextMenu();
  };
  menu.appendChild(alwaysOnTopItem);

  // Divider
  menu.appendChild(Object.assign(document.createElement('div'), { className: 'context-menu-divider' }));

  // Google Calendar section
  const googleLabel = document.createElement('div');
  googleLabel.className = 'context-menu-label';
  googleLabel.textContent = 'Google Calendar';
  menu.appendChild(googleLabel);

  const googleItem = document.createElement('div');
  googleItem.className = 'context-menu-item';
  googleItem.innerHTML = `
    <span>${googleConnected ? 'Disconnect Google' : 'Connect Google Calendar'}</span>
    ${googleConnected ? '<span class="check">✓</span>' : ''}
  `;
  googleItem.onclick = async () => {
    if (googleConnected) {
      disconnectGoogle();
      googleEvents = [];
      googleConnected = false;
      renderCalendar();
    } else {
      try {
        const code = await startGoogleAuth();
        await exchangeCodeForTokens(code);
        googleConnected = true;
        await syncGoogleEvents();
      } catch (e) {
        console.error('Google auth error:', e);
      }
    }
    closeContextMenu();
  };
  menu.appendChild(googleItem);

  if (googleConnected) {
    const syncItem = document.createElement('div');
    syncItem.className = 'context-menu-item';
    syncItem.innerHTML = '<span>Sync now</span>';
    syncItem.onclick = async () => {
      await syncGoogleEvents();
      closeContextMenu();
    };
    menu.appendChild(syncItem);
  }

  // Divider
  menu.appendChild(Object.assign(document.createElement('div'), { className: 'context-menu-divider' }));

  // Holidays section
  const holidayLabel = document.createElement('div');
  holidayLabel.className = 'context-menu-label';
  holidayLabel.textContent = 'Holidays';
  menu.appendChild(holidayLabel);

  const countries = [
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    { code: 'UK', name: 'United Kingdom' },
    { code: 'AU', name: 'Australia' },
  ];

  countries.forEach(country => {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    const isSelected = selectedCountries.includes(country.code);
    item.innerHTML = `
      <span>${country.name}</span>
      ${isSelected ? '<span class="check">✓</span>' : ''}
    `;
    item.onclick = () => {
      if (isSelected) {
        selectedCountries = selectedCountries.filter(c => c !== country.code);
      } else {
        selectedCountries.push(country.code);
      }
      localStorage.setItem('selected_countries', JSON.stringify(selectedCountries));
      syncHolidays();
      closeContextMenu();
    };
    menu.appendChild(item);
  });

  // Divider
  menu.appendChild(Object.assign(document.createElement('div'), { className: 'context-menu-divider' }));

  // About
  const aboutItem = document.createElement('div');
  aboutItem.className = 'context-menu-item';
  aboutItem.innerHTML = '<span>About</span><span style="font-size:10px;color:var(--text-tertiary)">v0.2.0</span>';
  aboutItem.onclick = () => closeContextMenu();
  menu.appendChild(aboutItem);

  // Close app
  const closeItem = document.createElement('div');
  closeItem.className = 'context-menu-item danger';
  closeItem.textContent = 'Close';
  closeItem.onclick = async () => {
    if (window.__TAURI__) {
      await window.__TAURI__.window.getCurrentWindow().close();
    }
  };
  menu.appendChild(closeItem);

  document.getElementById('widget').appendChild(menu);

  // Smart positioning
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const widgetRect = document.getElementById('widget').getBoundingClientRect();
    
    let newTop = y;
    let newLeft = x;

    if (menuRect.bottom > widgetRect.bottom) {
      newTop = y - menu.offsetHeight;
    }
    if (menuRect.right > widgetRect.right) {
      newLeft = x - menu.offsetWidth;
    }
    
    // Don't let it go above the top of the widget
    if (newTop < 0) newTop = 0;
    if (newLeft < 0) newLeft = 0;

    menu.style.top = newTop + 'px';
    menu.style.left = newLeft + 'px';
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 50);
}

function closeContextMenu() {
  const existing = document.getElementById('context-menu');
  if (existing) existing.remove();
}