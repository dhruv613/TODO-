/* ===== State ===== */
const state = {
  todos: [],
  stats: {},
  filter: { cat: 'all', priority: 'all', search: '', sort: 'newest' },
  editId: null,
  selectedPriority: 'medium',
};

/* ===== DOM refs ===== */
const $ = id => document.getElementById(id);
const todoList       = $('todo-list');
const pinnedList     = $('pinned-list');
const pinnedSection  = $('pinned-section');
const emptyState     = $('empty-state');
const modalOverlay   = $('modal-overlay');
const searchInput    = $('search-input');
const priorityFilter = $('priority-filter');
const sortSelect     = $('sort-select');
const toast          = $('toast');

/* ===== API helpers ===== */
const api = {
  async get(url)        { const r = await fetch(url); return r.json(); },
  async post(url, body) { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); },
  async patch(url, body){ const r = await fetch(url, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); },
  async del(url)        { return fetch(url, { method:'DELETE' }); },
};

/* ===== Toast ===== */
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

/* ===== Date helpers ===== */
function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso) < new Date().setHours(0,0,0,0);
}

/* ===== Today date ===== */
function setTodayDate() {
  $('today-date').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
}

/* ===== Stats ===== */
async function loadStats() {
  const s = await api.get('/api/stats');
  state.stats = s;

  $('stat-total').textContent   = s.total;
  $('stat-pending').textContent = s.pending;
  $('stat-done').textContent    = s.completed;
  $('ring-pct').textContent     = s.completion_rate + '%';

  const circle    = $('ring-progress');
  const circ      = 2 * Math.PI * 48;
  const offset    = circ - (s.completion_rate / 100) * circ;
  circle.style.strokeDashoffset = offset;

  // Update category counts
  const cats = ['all','personal','work','shopping','health'];
  cats.forEach(cat => {
    const el = $('cat-count-' + cat);
    if (!el) return;
    if (cat === 'all') { el.textContent = s.total; return; }
    el.textContent = (s.by_category && s.by_category[cat]) || 0;
  });
}

/* ===== Load & Render todos ===== */
async function loadTodos() {
  const params = new URLSearchParams();
  if (state.filter.cat !== 'all') params.set('category', state.filter.cat);
  if (state.filter.priority !== 'all') params.set('priority', state.filter.priority);
  if (state.filter.search) params.set('search', state.filter.search);

  state.todos = await api.get('/api/todos?' + params.toString());
  renderTodos();
  await loadStats();
}

function sortTodos(list) {
  const s = state.filter.sort;
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return [...list].sort((a, b) => {
    if (s === 'priority') return (priorityOrder[a.priority]||1) - (priorityOrder[b.priority]||1);
    if (s === 'due') {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date) - new Date(b.due_date);
    }
    const ta = new Date(a.created_at), tb = new Date(b.created_at);
    return s === 'oldest' ? ta - tb : tb - ta;
  });
}

function renderTodos() {
  const pinned   = sortTodos(state.todos.filter(t => t.pinned));
  const unpinned = sortTodos(state.todos.filter(t => !t.pinned));

  pinnedSection.style.display = pinned.length ? 'block' : 'none';
  pinnedList.innerHTML = pinned.map(buildCard).join('');

  if (unpinned.length === 0) {
    todoList.innerHTML = '';
    todoList.appendChild(emptyState);
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    todoList.innerHTML = unpinned.map(buildCard).join('');
  }

  attachCardEvents();
}

function buildCard(t) {
  const cats = { personal:'🏠', work:'💼', shopping:'🛒', health:'❤️' };
  const due = t.due_date ? `
    <span class="due-chip ${isOverdue(t.due_date) && !t.completed ? 'overdue' : ''}">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:11px"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>
      ${formatDate(t.due_date)}${isOverdue(t.due_date) && !t.completed ? ' · Overdue' : ''}
    </span>` : '';

  return `
  <div class="todo-card priority-${t.priority} ${t.completed ? 'completed' : ''} ${t.pinned ? 'pinned' : ''}"
       data-id="${t.id}">
    <div class="check-wrap">
      <button class="check-btn ${t.completed ? 'checked' : ''}" data-action="toggle" title="Toggle complete">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
      </button>
    </div>
    <div class="todo-body">
      <div class="todo-meta">
        <span class="badge badge-cat">${cats[t.category] || ''} ${t.category}</span>
        <span class="badge badge-${t.priority}">${t.priority}</span>
      </div>
      <div class="todo-title">${escHtml(t.title)}</div>
      ${t.description ? `<div class="todo-desc">${escHtml(t.description)}</div>` : ''}
      <div class="todo-footer">${due}</div>
    </div>
    <div class="todo-actions">
      <button class="icon-btn ${t.pinned ? 'pin-active' : ''}" data-action="pin" title="${t.pinned ? 'Unpin' : 'Pin'}">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
      </button>
      <button class="icon-btn" data-action="edit" title="Edit">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
      </button>
      <button class="icon-btn del-btn" data-action="delete" title="Delete">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
      </button>
    </div>
  </div>`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function attachCardEvents() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const card = btn.closest('.todo-card');
      const id   = card.dataset.id;
      const todo = state.todos.find(t => t.id === id);
      const act  = btn.dataset.action;

      if (act === 'toggle') {
        await api.patch(`/api/todos/${id}`, { completed: !todo.completed });
        showToast(todo.completed ? '↩️ Marked pending' : '✅ Task done!');
        await loadTodos();
      }
      if (act === 'pin') {
        await api.patch(`/api/todos/${id}/pin`, {});
        showToast(todo.pinned ? '📌 Unpinned' : '📌 Pinned!');
        await loadTodos();
      }
      if (act === 'edit') {
        openModal(todo);
      }
      if (act === 'delete') {
        card.style.transform = 'scale(0.9)';
        card.style.opacity = '0';
        setTimeout(async () => {
          await api.del(`/api/todos/${id}`);
          showToast('🗑️ Task deleted');
          await loadTodos();
        }, 250);
      }
    });
  });
}

/* ===== Modal ===== */
function openModal(todo = null) {
  state.editId = todo ? todo.id : null;
  $('modal-title').textContent = todo ? 'Edit Task' : 'New Task';
  $('submit-btn').textContent  = todo ? 'Save Changes' : 'Add Task';
  $('task-title').value        = todo ? todo.title : '';
  $('task-desc').value         = todo ? (todo.description || '') : '';
  $('task-category').value     = todo ? todo.category : 'personal';
  $('task-due').value          = todo ? (todo.due_date || '') : '';

  const p = todo ? todo.priority : 'medium';
  state.selectedPriority = p;
  document.querySelectorAll('.pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.val === p);
  });

  updateCharCount();
  modalOverlay.classList.add('open');
  setTimeout(() => $('task-title').focus(), 300);
}

function closeModal() {
  modalOverlay.classList.remove('open');
  state.editId = null;
}

function updateCharCount() {
  const len = $('task-title').value.length;
  $('char-count').textContent = `${len}/120`;
}

$('task-title').addEventListener('input', updateCharCount);

document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    state.selectedPriority = pill.dataset.val;
    document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === pill));
  });
});

$('open-modal-btn').addEventListener('click', () => openModal());
$('cancel-modal-btn').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

$('submit-btn').addEventListener('click', async () => {
  const title = $('task-title').value.trim();
  if (!title) { $('task-title').focus(); showToast('⚠️ Title is required'); return; }

  const payload = {
    title,
    description: $('task-desc').value.trim(),
    priority:    state.selectedPriority,
    category:    $('task-category').value,
    due_date:    $('task-due').value || null,
  };

  if (state.editId) {
    await api.patch(`/api/todos/${state.editId}`, payload);
    showToast('✏️ Task updated');
  } else {
    await api.post('/api/todos', payload);
    showToast('🎉 Task added!');
  }
  closeModal();
  await loadTodos();
});

// Enter to submit
$('task-title').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) $('submit-btn').click();
});

/* ===== Filters ===== */
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter.cat = btn.dataset.cat;
    loadTodos();
  });
});

priorityFilter.addEventListener('change', () => {
  state.filter.priority = priorityFilter.value;
  loadTodos();
});

sortSelect.addEventListener('change', () => {
  state.filter.sort = sortSelect.value;
  renderTodos();
});

let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.filter.search = searchInput.value.trim();
    loadTodos();
  }, 300);
});

/* ===== Clear completed ===== */
$('clear-completed-btn').addEventListener('click', async () => {
  const done = state.todos.filter(t => t.completed).length;
  if (!done) { showToast('No completed tasks'); return; }
  await api.del('/api/todos/completed/clear');
  showToast(`🗑️ Cleared ${done} completed task${done > 1 ? 's' : ''}`);
  await loadTodos();
});

/* ===== Keyboard shortcut ===== */
document.addEventListener('keydown', e => {
  if ((e.key === 'n' || e.key === 'N') && !modalOverlay.classList.contains('open')
      && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    openModal();
  }
  if (e.key === 'Escape') closeModal();
});

/* ===== Logout ===== */
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('👋 Signed out');
    setTimeout(() => window.location.href = '/login', 500);
  });
}

/* ===== Init ===== */
setTodayDate();
loadTodos();
