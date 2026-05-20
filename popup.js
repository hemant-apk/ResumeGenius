// ============================================================
// ResumeGenius – Popup Script
// ============================================================

// ─── State ──────────────────────────────────────────────────
let currentTab = null;
let pageInfo = null;
let detectedFields = [];
let currentMapping = {};
let resumeData = null;

// ─── Tab switching ───────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

    if (tab.dataset.tab === 'log') loadLog();
    if (tab.dataset.tab === 'resume') loadResumePreview();
    if (tab.dataset.tab === 'apply') refreshApplyTab();
  });
});

// ─── Helpers ─────────────────────────────────────────────────
function sendBg(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, resp => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp?.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

function sendContent(tabId, type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, ...data }, resp => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp || {});
    });
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function setDot(state) {
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + state;
}

function showResult(msg, type = 'success') {
  const el = document.getElementById('fill-result');
  el.className = `result-box ${type}`;
  el.innerHTML = msg;
  el.classList.remove('hidden');
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  // Load resume
  const stored = await chrome.storage.local.get(['resumeData', 'apiKey', 'resumeFile']);
  resumeData = stored.resumeData || null;
  const resumeFile = stored.resumeFile || null;

  // Update badge
  const badge = document.getElementById('resume-badge');
  if (resumeData) {
    let badgeText = '✓ Resume';
    if (resumeFile && resumeFile.name) {
      badgeText += ` (${resumeFile.name})`;
    }
    badge.textContent = badgeText;
    badge.className = 'badge badge-success';
  } else {
    badge.textContent = 'No Resume';
    badge.className = 'badge badge-warn';
  }
  badge.classList.remove('hidden');

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  await refreshApplyTab();
}

// ─── Apply Tab ───────────────────────────────────────────────
async function refreshApplyTab() {
  if (!currentTab) return;

  const titleEl = document.getElementById('status-title');
  const subEl = document.getElementById('status-sub');
  const applyForm = document.getElementById('apply-form');
  const applyEmpty = document.getElementById('apply-empty');

  titleEl.textContent = 'Scanning page…';
  subEl.textContent = '';
  setDot('loading');

  try {
    const info = await sendContent(currentTab.id, 'GET_FORM_FIELDS');
    pageInfo = info;
    detectedFields = info.fields || [];

    if (detectedFields.length > 0) {
      setDot('active');
      titleEl.textContent = info.company || 'Job application found';
      subEl.textContent = `${detectedFields.length} field${detectedFields.length > 1 ? 's' : ''} detected · ${info.isJobPage ? 'Job page' : 'Form'}`;
      applyForm.classList.remove('hidden');
      applyEmpty.classList.add('hidden');
      renderFields(detectedFields);
    } else if (info.isJobPage) {
      setDot('active');
      titleEl.textContent = info.company || 'Job page';
      subEl.textContent = 'No form fields detected yet';
      applyForm.classList.add('hidden');
      applyEmpty.classList.remove('hidden');
      document.querySelector('.empty-desc').textContent =
        'This looks like a job listing. Look for an Apply button on the page.';
    } else {
      setDot('');
      titleEl.textContent = 'No job form detected';
      subEl.textContent = window.location.host || '';
      applyForm.classList.add('hidden');
      applyEmpty.classList.remove('hidden');
    }
  } catch (e) {
    setDot('error');
    titleEl.textContent = 'Cannot scan this page';
    subEl.textContent = e.message || '';
    applyForm.classList.add('hidden');
    applyEmpty.classList.remove('hidden');
  }
}

function renderFields(fields) {
  const list = document.getElementById('fields-list');
  list.innerHTML = '';
  fields.slice(0, 30).forEach(f => {
    const item = document.createElement('div');
    item.className = 'field-item';
    const label = f.label || f.placeholder || f.name || f.id || 'Field';
    item.innerHTML = `
      <span class="field-label" title="${label}">${label.slice(0, 30)}</span>
      <span class="field-type">${f.type || f.tagName}</span>
      ${f.required ? '<span class="field-req">*</span>' : ''}
    `;
    list.appendChild(item);
  });
}

// Auto-fill button
document.getElementById('autofill-btn').addEventListener('click', async () => {
  const btn = document.getElementById('autofill-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:1.5px"></div> Analyzing…';

  try {
    const { mapping } = await sendBg('FILL_FORM', {
      formFields: detectedFields,
      company: pageInfo?.company,
      jobTitle: pageInfo?.title
    });
    currentMapping = mapping;

    const { filled, results } = await sendContent(currentTab.id, 'FILL_FORM_FIELDS', { mapping });

    const filledFields = results?.filter(r => r.status === 'filled') || [];
    showResult(
      `<strong style="color:var(--success)">✓ Filled ${filled} fields</strong><br>` +
      filledFields.slice(0, 5).map(r =>
        `<span style="color:var(--muted);font-family:var(--mono);font-size:10.5px">
          ${r.field}: <span style="color:var(--text)">${r.value}</span>
        </span>`
      ).join('<br>'),
      'success'
    );

    // Show log prompt
    document.getElementById('log-prompt').classList.remove('hidden');
  } catch (e) {
    showResult(`<strong style="color:var(--danger)">✗ Error</strong><br>${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Auto-Fill Form`;
  }
});

// Log prompt
document.getElementById('log-yes-btn').addEventListener('click', async () => {
  try {
    await sendBg('LOG_APPLICATION', {
      company: pageInfo?.company || 'Unknown',
      title: pageInfo?.title || 'Unknown Role',
      url: pageInfo?.url || currentTab?.url || '',
    });
    document.getElementById('log-prompt').classList.add('hidden');
    showResult(`<strong style="color:var(--success)">✓ Application logged!</strong>`, 'success');
  } catch (e) { console.error(e); }
});

document.getElementById('log-no-btn').addEventListener('click', () => {
  document.getElementById('log-prompt').classList.add('hidden');
});

// Cover letter button
document.getElementById('cover-letter-btn').addEventListener('click', async () => {
  const box = document.getElementById('cover-letter-box');
  const content = document.getElementById('cl-content');

  box.classList.remove('hidden');
  content.textContent = 'Generating…';

  try {
    const { text } = await sendBg('COVER_LETTER', {
      jobInfo: {
        company: pageInfo?.company,
        title: pageInfo?.title,
        url: pageInfo?.url
      }
    });
    content.textContent = text;
  } catch (e) {
    content.textContent = '⚠ ' + e.message;
  }
});

document.getElementById('cl-close').addEventListener('click', () => {
  document.getElementById('cover-letter-box').classList.add('hidden');
});

document.getElementById('cl-copy').addEventListener('click', () => {
  const text = document.getElementById('cl-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('cl-copy').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('cl-copy').textContent = 'Copy'; }, 1500);
  });
});

document.getElementById('cl-regen').addEventListener('click', () => {
  document.getElementById('cover-letter-btn').click();
});

// ─── Find Jobs Tab ───────────────────────────────────────────
document.getElementById('find-jobs-btn').addEventListener('click', async () => {
  const btn = document.getElementById('find-jobs-btn');
  const loading = document.getElementById('jobs-loading');
  const list = document.getElementById('jobs-list');

  btn.disabled = true;
  loading.classList.remove('hidden');
  list.innerHTML = '';

  try {
    const { jobs } = await sendBg('FIND_JOBS');
    loading.classList.add('hidden');
    renderJobs(jobs);
  } catch (e) {
    loading.classList.add('hidden');
    list.innerHTML = `<div class="empty-state"><div class="empty-title" style="color:var(--danger)">⚠ ${e.message}</div></div>`;
  } finally {
    btn.disabled = false;
  }
});

function renderJobs(jobs) {
  const list = document.getElementById('jobs-list');
  list.innerHTML = '';

  if (!jobs || jobs.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-title">No jobs found</div></div>';
    return;
  }

  jobs.forEach(job => {
    const card = document.createElement('a');
    card.className = 'job-card';
    card.href = job.url || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    const tags = (job.tags || []).map(t =>
      `<span class="job-tag">${t}</span>`
    ).join('');

    card.innerHTML = `
      <div class="job-card-top">
        <div class="job-title">${job.title}</div>
        ${job.match ? `<div class="job-match">${job.match}%</div>` : ''}
      </div>
      <div class="job-company">${job.company || ''}</div>
      <div class="job-reason">${job.reason || ''}</div>
      <div class="job-tags">
        <span class="job-platform-tag">${job.platform}</span>
        ${tags}
      </div>
    `;

    // Log when opened
    card.addEventListener('click', () => {
      sendBg('LOG_APPLICATION', {
        company: job.company || job.platform,
        title: job.title,
        url: job.url || '',
        notes: 'Found via ResumeGenius job finder'
      }).catch(() => {});
    });

    list.appendChild(card);
  });
}

// ─── Log Tab ─────────────────────────────────────────────────
async function loadLog() {
  const { jobLog = [] } = await sendBg('GET_LOG');
  const list = document.getElementById('log-list');
  const empty = document.getElementById('log-empty');
  const count = document.getElementById('log-count');

  count.textContent = jobLog.length;

  if (jobLog.length === 0) {
    empty.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = '';

  jobLog.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'log-card';
    card.dataset.id = entry.id;

    const statusClass = `status-${entry.status || 'Applied'}`;
    const urlLink = entry.url
      ? `<a href="${entry.url}" target="_blank" class="log-link" rel="noopener">↗ View</a>`
      : '';

    card.innerHTML = `
      <div class="log-card-top">
        <div class="log-company">${entry.company}</div>
        <span class="log-status-badge ${statusClass}">${entry.status || 'Applied'}</span>
      </div>
      <div class="log-title">${entry.title}</div>
      <div class="log-meta">
        <div class="log-date">🗓 ${formatDate(entry.appliedAt)}</div>
        <div class="log-actions">
          ${urlLink}
          <select class="status-select" data-id="${entry.id}">
            <option ${entry.status === 'Applied' ? 'selected' : ''}>Applied</option>
            <option ${entry.status === 'Interview' ? 'selected' : ''}>Interview</option>
            <option ${entry.status === 'Offer' ? 'selected' : ''}>Offer</option>
            <option ${entry.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
          </select>
          <button class="delete-btn" data-id="${entry.id}" title="Delete">✕</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  // Status change
  list.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      await sendBg('UPDATE_LOG_STATUS', { id: Number(sel.dataset.id), status: sel.value });
      await loadLog();
    });
  });

  // Delete
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      await sendBg('DELETE_LOG', { id: Number(btn.dataset.id) });
      await loadLog();
    });
  });
}

// Export CSV
document.getElementById('export-btn').addEventListener('click', async () => {
  const { jobLog = [] } = await sendBg('GET_LOG');
  if (!jobLog.length) return;

  const headers = ['Company', 'Title', 'Status', 'Applied At', 'URL'];
  const rows = jobLog.map(e => [
    `"${e.company}"`, `"${e.title}"`, e.status,
    `"${formatDate(e.appliedAt)}"`, `"${e.url}"`
  ]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-applications-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ─── Resume Tab ──────────────────────────────────────────────
async function loadResumePreview() {
  const { resumeData: rd, resumeFile: rf } = await chrome.storage.local.get(['resumeData', 'resumeFile']);
  const preview = document.getElementById('resume-preview');
  const noResume = document.getElementById('no-resume');

  if (!rd) {
    preview.classList.add('hidden');
    noResume.classList.remove('hidden');
    return;
  }

  noResume.classList.add('hidden');
  preview.classList.remove('hidden');

  const contactChips = [rd.email, rd.phone, rd.location, rd.linkedin]
    .filter(Boolean)
    .map(c => {
      const isRedacted = typeof c === 'string' && (c.includes('Stored Locally Only') || c.includes('REDACTED_'));
      if (isRedacted) {
        return `<span class="contact-chip" style="color:var(--warn);border-color:rgba(245,158,11,0.25);background:rgba(245,158,11,0.06);font-style:italic;" title="${c}">⚠️ Redacted</span>`;
      }
      return `<span class="contact-chip">${c}</span>`;
    })
    .join('');

  const skillChips = (rd.skills || []).slice(0, 20)
    .map(s => `<span class="skill-chip">${s}</span>`)
    .join('');

  const expItems = (rd.experience || []).slice(0, 3).map(e => `
    <div class="exp-item">
      <div class="exp-header">
        <div>
          <div class="exp-title">${e.title}</div>
          <div class="exp-company">${e.company}</div>
        </div>
        <div class="exp-date">${e.startDate || ''}${e.endDate ? ` – ${e.endDate}` : ''}</div>
      </div>
    </div>
  `).join('');

  const isNameRedacted = typeof rd.name === 'string' && (rd.name.includes('Stored Locally Only') || rd.name.includes('REDACTED_'));
  const displayNameHTML = isNameRedacted 
    ? `<span style="color:var(--warn);font-size:13px;font-weight:500;font-style:italic;display:block;margin-bottom:2px;">⚠️ Add name in Settings</span>` 
    : `<div class="resume-name">${rd.name || '—'}</div>`;

  preview.innerHTML = `
    <div class="resume-section">
      <div class="resume-section-header">👤 Profile</div>
      <div class="resume-section-body">
        ${displayNameHTML}
        <div class="resume-title">${rd.currentTitle || ''}</div>
        ${rf && rf.name ? `<div style="font-size:12px;color:var(--accent);margin-bottom:6px;">📄 Attached File: ${rf.name}</div>` : ''}
        <div class="resume-contact">${contactChips}</div>
      </div>
    </div>

    ${rd.skills?.length ? `
    <div class="resume-section">
      <div class="resume-section-header">⚡ Skills</div>
      <div class="resume-section-body">
        <div class="skills-grid">${skillChips}</div>
      </div>
    </div>` : ''}

    ${rd.experience?.length ? `
    <div class="resume-section">
      <div class="resume-section-header">💼 Experience</div>
      <div class="resume-section-body">${expItems}</div>
    </div>` : ''}

    ${rd.education?.length ? `
    <div class="resume-section">
      <div class="resume-section-header">🎓 Education</div>
      <div class="resume-section-body">
        ${rd.education.slice(0, 2).map(e =>
    `<div class="exp-item">
            <div class="exp-title">${e.degree} in ${e.field}</div>
            <div class="exp-company">${e.school} · ${e.year || ''}</div>
          </div>`
  ).join('')}
      </div>
    </div>` : ''}
  `;
}

// Settings / options page
document.getElementById('settings-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('go-settings-btn')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ─── Boot ────────────────────────────────────────────────────
init().catch(console.error);
