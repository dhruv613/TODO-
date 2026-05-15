const tabs   = document.querySelectorAll('.auth-tab');
const forms  = document.querySelectorAll('.auth-form');
const msgBox = document.getElementById('auth-msg');
const toast  = document.getElementById('toast');

function showMsg(text, type = 'error') {
  msgBox.textContent = text;
  msgBox.className = 'auth-msg show ' + type;
  setTimeout(() => msgBox.classList.remove('show'), 4000);
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

// Tab switch
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    forms.forEach(f => f.classList.toggle('active', f.id === `${target}-form`));
    msgBox.classList.remove('show');
    const indicator = document.querySelector('.tab-indicator');
    indicator.style.transform = target === 'register' ? 'translateX(100%)' : 'translateX(0)';
  });
});

function setLoading(form, loading) {
  const btn = form.querySelector('.auth-submit');
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

// Login
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const fd   = new FormData(form);
  setLoading(form, true);
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Login failed');
    showToast(`👋 Welcome back, ${data.username}!`);
    setTimeout(() => window.location.href = '/', 600);
  } catch (err) {
    showMsg(err.message);
    setLoading(form, false);
  }
});

// Register
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const pw   = document.getElementById('reg-password').value;
  const cf   = document.getElementById('reg-confirm').value;
  if (pw !== cf) { showMsg('Passwords do not match'); return; }

  const fd = new FormData();
  fd.append('username', document.getElementById('reg-username').value);
  fd.append('password', pw);

  setLoading(form, true);
  try {
    const res = await fetch('/api/auth/register', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Registration failed');

    // Auto-login after successful registration
    const loginFd = new FormData();
    loginFd.append('username', document.getElementById('reg-username').value);
    loginFd.append('password', pw);
    const loginRes = await fetch('/api/auth/login', { method: 'POST', body: loginFd });
    if (loginRes.ok) {
      showToast(`🎉 Account created! Welcome, ${data.username}`);
      setTimeout(() => window.location.href = '/', 700);
    } else {
      showMsg('Account created — please sign in', 'success');
      document.querySelector('[data-tab="login"]').click();
    }
  } catch (err) {
    showMsg(err.message);
    setLoading(form, false);
  }
});
