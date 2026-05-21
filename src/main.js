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

function getEventsForDate(y, m, d) {
  const key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return events.filter(e => e.date === key);
}

function dateKey(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// ── Month view ────────────────────────────────────────────────────────────────

function renderCalendar() {
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
        pill.textContent = ev.title;
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

  const grid = document.createElement('div');
  grid.className = 'week-view-grid';

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStartDate);
    date.setDate(weekStartDate.getDate() + i);
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
    }
    col.appendChild(dayNum);

    const eventsDiv = document.createElement('div');
    eventsDiv.className = 'week-events';
    getEventsForDate(y, m, d).forEach(ev => {
      const pill = document.createElement('div');
      pill.className = 'event-pill ' + (ev.type || 'personal');
      pill.textContent = ev.title;
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

  container.appendChild(grid);

  const endDate = new Date(weekStartDate);
  endDate.setDate(weekStartDate.getDate() + 6);
  document.getElementById('month-label').textContent =
    weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' – ' + endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Day view ──────────────────────────────────────────────────────────────────

function renderDayView() {
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

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = ev.title;
  titleInput.placeholder = 'Title';
  titleInput.onmousedown = e => e.stopPropagation();

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = ev.time || '';
  timeInput.onmousedown = e => e.stopPropagation();

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
    events = events.filter(e => e.id !== ev.id);
    await saveEvents();
    renderDayView();
  };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.onmousedown = e => e.stopPropagation();
  saveBtn.onclick = async () => {
    const idx = events.findIndex(e => e.id === ev.id);
    if (idx !== -1) {
      events[idx] = {
        ...events[idx],
        title: titleInput.value.trim(),
        time: timeInput.value,
        type: typeSelect.value,
        notes: notesInput.value.trim()
      };
    }
    await saveEvents();
    renderDayView();
  };

  actions.appendChild(delBtn);
  actions.appendChild(saveBtn);
  expanded.appendChild(titleInput);
  expanded.appendChild(timeInput);
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
    events.push({
      id: Date.now().toString(),
      title,
      date: key,
      time: timeInput.value,
      type: typeSelect.value,
      notes: notesInput.value.trim()
    });
    await saveEvents();
    renderDayView();
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  form.appendChild(titleInput);
  form.appendChild(timeInput);
  form.appendChild(typeSelect);
  form.appendChild(notesInput);
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
  if (window.__TAURI__) {
    const size = await window.__TAURI__.window.getCurrentWindow().innerSize();
    currentHeight = size.height;
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
      window.__TAURI__.window.getCurrentWindow().setSize(
        new window.__TAURI__.window.LogicalSize(Math.round(currentW), Math.round(currentH))
      );
    }
    if (step >= steps) clearInterval(interval);
  }, stepTime);
}

// ── Window position ───────────────────────────────────────────────────────────

async function saveWindowPosition() {
  if (window.__TAURI__) {
    const position = await window.__TAURI__.window.getCurrentWindow().outerPosition();
    console.log('full position object:', JSON.stringify(position));
    localStorage.setItem('window_position', JSON.stringify({ x: position.x, y: position.y }));
  }
}

async function restoreWindowPosition() {
  if (window.__TAURI__) {
    const saved = localStorage.getItem('window_position');
    if (saved) {
      const { x, y } = JSON.parse(saved);
      await window.__TAURI__.window.getCurrentWindow().setPosition(
        new window.__TAURI__.window.PhysicalPosition(x, y)
      );
    }
    await window.__TAURI__.window.getCurrentWindow().show();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prev').onclick = () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  };

  document.getElementById('next').onclick = () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
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
  initStorage().then(() => renderCalendar());
  loadTheme();
  setTimeout(() => restoreWindowPosition(), 100);
});

// ── Autostart ─────────────────────────────────────────────────────────────────

async function enableAutostart() {
  if (window.__TAURI__) {
    await window.__TAURI__.core.invoke('plugin:autostart|enable');
    console.log('Autostart enabled');
  }
}

async function disableAutostart() {
  if (window.__TAURI__) {
    await window.__TAURI__.core.invoke('plugin:autostart|disable');
    console.log('Autostart disabled');
  }
}

async function isAutostartEnabled() {
  if (window.__TAURI__) {
    return await window.__TAURI__.core.invoke('plugin:autostart|is_enabled');
  }
  return false;
}

// ── Always on top ───────────────────────────────────────────────────────────────── 

async function setAlwaysOnTop(enabled) {
  if (window.__TAURI__) {
    await window.__TAURI__.window.getCurrentWindow().setAlwaysOnTop(enabled);
    localStorage.setItem('always_on_top', enabled ? 'true' : 'false');
  }
}

async function isAlwaysOnTop() {
  if (window.__TAURI__) {
    return await window.__TAURI__.window.getCurrentWindow().isAlwaysOnTop();
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
  // Remove any existing menu
  closeContextMenu();

  const autostartOn = await isAutostartEnabled();
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
    { id: 'dark', label: 'Dark', color: '#1e1e2e', border: '#444' },
    { id: 'warm', label: 'Warm', color: '#FDF4E7', border: '#d4a96a' },
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

  // Autostart toggle
  const autostartItem = document.createElement('div');
  autostartItem.className = 'context-menu-item';
  autostartItem.innerHTML = `
    <span>Launch on startup</span>
    ${autostartOn ? '<span class="check">✓</span>' : ''}
  `;
  autostartItem.onclick = async () => {
    if (autostartOn) {
      await disableAutostart();
    } else {
      await enableAutostart();
    }
    closeContextMenu();
  };
  menu.appendChild(autostartItem);

  // Always on top toggle
  const alwaysOnTopOn = await isAlwaysOnTop();
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

  // About
  const aboutItem = document.createElement('div');
  aboutItem.className = 'context-menu-item';
  aboutItem.innerHTML = '<span>About</span><span style="font-size:10px;color:var(--text-tertiary)">v0.1.0</span>';
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

  document.body.appendChild(menu);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 50);
}

function closeContextMenu() {
  const existing = document.getElementById('context-menu');
  if (existing) existing.remove();
}