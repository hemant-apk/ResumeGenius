// ============================================================
// ResumeGenius – Options Page Script
// ============================================================

// ─── Init ────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['apiKey', 'resumeData', 'resumeRaw', 'apiModel', 'fetchedModels', 'resumeFile']);

  // Load API key
  if (stored.apiKey) {
    document.getElementById('api-key-input').value = stored.apiKey;
    setKeyStatus('✓ Key saved', true);
  }

  // Load models list (dynamically fetched or fallbacks)
  if (stored.fetchedModels && stored.fetchedModels.length > 0) {
    populateModelsDropdown(stored.fetchedModels, stored.apiModel);
  } else {
    // If not fetched but we have an API key, fetch them in the background
    if (stored.apiKey) {
      fetchAvailableModels(stored.apiKey, stored.apiModel).catch(console.error);
    } else {
      if (stored.apiModel) {
        document.getElementById('model-select').value = stored.apiModel;
      }
    }
  }

  // Load resume
  if (stored.resumeData) {
    showParsedPreview(stored.resumeData);
    let badgeText = '✓ Resume Loaded';
    if (stored.resumeFile && stored.resumeFile.name) {
      badgeText += ` (${stored.resumeFile.name})`;
    }
    document.getElementById('resume-loaded-badge').textContent = badgeText;
    document.getElementById('resume-loaded-badge').className = 'badge badge-success';
    document.getElementById('resume-loaded-badge').classList.remove('hidden');
  }

  if (stored.resumeRaw) {
    document.getElementById('resume-text').value = stored.resumeRaw;
  }

  updateStatusChip(!!stored.apiKey, !!stored.resumeData);
}

function updateStatusChip(hasKey, hasResume) {
  const chip = document.getElementById('status-chip');
  if (hasKey && hasResume) {
    chip.textContent = '✓ Ready to apply';
    chip.className = 'status-chip ready';
  } else {
    chip.textContent = hasKey ? 'Upload resume' : 'Add API key';
    chip.className = 'status-chip partial';
  }
}

// ─── Models Dropdown Management ────────────────────────────────
function populateModelsDropdown(models, selectedModel = 'gemini-3.1-flash-lite') {
  const select = document.getElementById('model-select');
  if (!select) return;

  select.innerHTML = '';

  const nameMapping = {
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite (Recommended — Free Tier, extremely fast & highly efficient)',
    'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash Lite Preview (Free Tier, early preview of ultra-lightweight model)',
    'gemini-2.5-flash': 'Gemini 2.5 Flash (Free Tier, fast & highly intelligent)',
    'gemini-2.5-pro': 'Gemini 2.5 Pro (Pay-as-you-go, high-reasoning complex tasks)',
    'gemini-2.0-flash': 'Gemini 2.0 Flash (Free Tier, highly responsive & fast)',
    'gemini-2.0-flash-lite': 'Gemini 2.0 Flash-Lite (Free Tier, low latency & efficient)',
    'gemini-1.5-flash': 'Gemini 1.5 Flash (Free Tier, legacy fast model)',
    'gemini-1.5-flash-8b': 'Gemini 1.5 Flash-8B (Free Tier, legacy ultra-lightweight)',
    'gemini-1.5-pro': 'Gemini 1.5 Pro (Legacy, high reasoning model)'
  };

  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    const isFree = m.id.includes('flash') || m.id.includes('8b');
    const freeText = isFree ? 'Free Tier' : 'Pay-as-you-go';
    
    let label = nameMapping[m.id] || `${m.displayName || m.id} (${freeText})`;
    opt.textContent = label;
    if (m.id === selectedModel) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

async function fetchAvailableModels(apiKey, currentSelectedModel) {
  const fetchBtn = document.getElementById('fetch-models-btn');
  if (fetchBtn) {
    fetchBtn.classList.add('loading');
    fetchBtn.textContent = 'Fetching…';
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`API status ${res.status}`);
    
    const data = await res.json();
    if (!data.models || data.models.length === 0) throw new Error('No models found');

    const filteredModels = data.models
      .filter(m => {
        const hasGenerate = m.supportedGenerationMethods?.includes('generateContent');
        const isGemini = m.name?.includes('models/gemini-');
        const isTuned = m.name?.includes('-tuned') || m.name?.includes('/tunedModels/');
        return hasGenerate && isGemini && !isTuned;
      })
      .map(m => {
        const id = m.name.replace('models/', '');
        return {
          id: id,
          displayName: m.displayName || id,
          description: m.description || ''
        };
      });

    if (filteredModels.length > 0) {
      const modelOrder = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'];
      filteredModels.sort((a, b) => {
        const indexA = modelOrder.indexOf(a.id);
        const indexB = modelOrder.indexOf(b.id);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.id.localeCompare(b.id);
      });

      await chrome.storage.local.set({ fetchedModels: filteredModels });
      
      let selected = currentSelectedModel;
      if (!selected || !filteredModels.some(m => m.id === selected)) {
        selected = filteredModels.some(m => m.id === 'gemini-3.1-flash-lite') ? 'gemini-3.1-flash-lite' : filteredModels[0].id;
        await chrome.storage.local.set({ apiModel: selected });
      }

      populateModelsDropdown(filteredModels, selected);
      
      if (fetchBtn) {
        fetchBtn.textContent = '✓ Updated';
        fetchBtn.style.color = 'var(--success)';
        fetchBtn.style.borderColor = 'rgba(16,185,129,0.3)';
        setTimeout(() => {
          fetchBtn.textContent = 'Fetch Latest Models';
          fetchBtn.style.color = '';
          fetchBtn.style.borderColor = '';
        }, 3000);
      }
    }
  } catch (err) {
    console.error('Failed to fetch Gemini models:', err);
    if (fetchBtn) {
      fetchBtn.textContent = '⚠ Fetch Failed';
      fetchBtn.style.color = 'var(--danger)';
      fetchBtn.style.borderColor = 'rgba(239,68,68,0.3)';
      setTimeout(() => {
        fetchBtn.textContent = 'Fetch Latest Models';
        fetchBtn.style.color = '';
        fetchBtn.style.borderColor = '';
      }, 3000);
    }
  } finally {
    if (fetchBtn) fetchBtn.classList.remove('loading');
  }
}

// ─── API Key ─────────────────────────────────────────────────
document.getElementById('save-key-btn').addEventListener('click', async () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) return showKeyError('Enter a valid API key');

  const btn = document.getElementById('save-key-btn');
  btn.disabled = true;
  btn.textContent = 'Verifying…';

  const model = document.getElementById('model-select').value || 'gemini-3.1-flash-lite';

  // Quick verify: call Gemini with a tiny prompt
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say OK' }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      }
    );

    if (res.status === 400 || res.status === 403) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Invalid API key');
    }

    await chrome.storage.local.set({ apiKey: key, apiModel: model });
    setKeyStatus('✓ Verified & saved', true);

    const hasResume = !!(await chrome.storage.local.get('resumeData')).resumeData;
    updateStatusChip(true, hasResume);

    // Dynamic update models from the API upon saving the key successfully!
    await fetchAvailableModels(key, model);
  } catch (e) {
    showKeyError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Key';
  }
});

document.getElementById('clear-key-btn').addEventListener('click', async () => {
  if (!confirm('Clear the saved API key?')) return;
  await chrome.storage.local.remove(['apiKey', 'fetchedModels']);
  document.getElementById('api-key-input').value = '';
  setKeyStatus('', false);
  const hasResume = !!(await chrome.storage.local.get('resumeData')).resumeData;
  updateStatusChip(false, hasResume);
});

document.getElementById('toggle-key').addEventListener('click', () => {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('toggle-key');
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
});

// Dropdown model selection listener
document.getElementById('model-select').addEventListener('change', async (e) => {
  const selectedModel = e.target.value;
  await chrome.storage.local.set({ apiModel: selectedModel });
  
  // Show key status feedback
  setKeyStatus('✓ Model updated: ' + selectedModel, true);
  setTimeout(async () => {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    setKeyStatus(apiKey ? '✓ Key saved' : '', !!apiKey);
  }, 2000);
});

// Fetch latest models button listener
document.getElementById('fetch-models-btn').addEventListener('click', async () => {
  const { apiKey, apiModel } = await chrome.storage.local.get(['apiKey', 'apiModel']);
  if (!apiKey) {
    setKeyStatus('✗ Save an API key first to fetch models', false);
    return;
  }
  await fetchAvailableModels(apiKey, apiModel);
});

function setKeyStatus(msg, ok) {
  const el = document.getElementById('key-status');
  el.textContent = msg;
  el.style.color = ok ? 'var(--success)' : 'var(--danger)';
}

function showKeyError(msg) {
  setKeyStatus('✗ ' + msg, false);
}

// ─── File upload ─────────────────────────────────────────────
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) processFile(fileInput.files[0]);
});

function storeResumeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const dataUrl = e.target.result;
        await chrome.storage.local.set({
          resumeFile: {
            name: file.name,
            type: file.type || getMimeType(file.name),
            dataUrl: dataUrl
          }
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  return 'application/octet-stream';
}

async function processFile(file) {
  const textarea = document.getElementById('resume-text');
  const ext = file.name.split('.').pop().toLowerCase();

  // Save the original file info & base64 content to local storage
  try {
    await storeResumeFile(file);
    document.getElementById('resume-loaded-badge').textContent = `✓ Resume Loaded (${file.name})`;
    document.getElementById('resume-loaded-badge').className = 'badge badge-success';
    document.getElementById('resume-loaded-badge').classList.remove('hidden');
  } catch (err) {
    console.error('Failed to store resume file:', err);
  }

  if (ext === 'txt') {
    const text = await file.text();
    textarea.value = text;
  } else if (ext === 'pdf') {
    await extractPDF(file);
  } else if (ext === 'doc' || ext === 'docx') {
    // For DOCX, we'll try to read as text (rough extraction)
    showParseMsg('Reading file…');
    try {
      const buffer = await file.arrayBuffer();
      // Basic DOCX text extraction (reads XML content)
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(buffer);
      // Extract text between XML tags (rough but works for basic DOCX)
      const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned.length > 100) {
        textarea.value = cleaned.slice(0, 10000);
      } else {
        showParseError('Could not read DOCX. Please paste your resume text below.');
      }
    } catch (e) {
      showParseError('Please paste your resume text in the text area below.');
    }
    hideProgress();
  } else {
    showParseError('Unsupported file type. Please use PDF, TXT, or paste text.');
  }
}

async function extractPDF(file) {
  showParseMsg('Loading PDF reader…');
  try {
    // Dynamically load PDF.js locally to comply with Manifest V3 CSP
    if (!window.pdfjsLib) {
      await loadScript(chrome.runtime.getURL('lib/pdf.min.js'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        chrome.runtime.getURL('lib/pdf.worker.min.js');
    }

    showParseMsg('Extracting PDF text…');
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];

    for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      pages.push(pageText);
    }

    const fullText = pages.join('\n\n');
    document.getElementById('resume-text').value = fullText;
    hideProgress();
    showParseMsg('PDF extracted! Click "Parse with Gemini AI" to continue.', false);
  } catch (e) {
    showParseError('PDF extraction failed. Please paste your resume text below. Error: ' + (e?.message || e || 'Unknown error'));
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load local script: ' + src));
    document.head.appendChild(s);
  });
}

// ─── Resume parsing ──────────────────────────────────────────
document.getElementById('parse-btn').addEventListener('click', async () => {
  const text = document.getElementById('resume-text').value.trim();
  if (!text) return showParseError('Please paste or upload your resume first.');

  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) return showParseError('Please save your Gemini API key first.');

  showParseMsg('Parsing resume with Gemini AI…');
  document.getElementById('parse-btn').disabled = true;

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'PARSE_RESUME', text }, resp => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp?.error) return reject(new Error(resp.error));
        resolve(resp);
      });
    });

    hideProgress();
    showParsedPreview(response.data);

    // Update badge
    document.getElementById('resume-loaded-badge').textContent = '✓ Resume Loaded';
    document.getElementById('resume-loaded-badge').className = 'badge badge-success';
    document.getElementById('resume-loaded-badge').classList.remove('hidden');

    updateStatusChip(true, true);

    // Show success
    showParseMsg('✓ Resume parsed and saved successfully!', false, true);
    setTimeout(hideProgress, 3000);
  } catch (e) {
    showParseError(e.message);
  } finally {
    document.getElementById('parse-btn').disabled = false;
  }
});

document.getElementById('clear-resume-btn').addEventListener('click', async () => {
  if (!confirm('Clear the saved resume? This cannot be undone.')) return;
  await chrome.storage.local.remove(['resumeData', 'resumeRaw', 'resumeFile']);
  document.getElementById('resume-text').value = '';
  document.getElementById('parsed-preview-card').style.display = 'none';
  document.getElementById('resume-loaded-badge').classList.add('hidden');
  const hasKey = !!(await chrome.storage.local.get('apiKey')).apiKey;
  updateStatusChip(hasKey, false);
});

// ─── Parse progress helpers ──────────────────────────────────
function showParseMsg(msg, spinning = true, success = false) {
  const box = document.getElementById('parse-progress');
  const msgEl = document.getElementById('parse-msg');
  const spinner = box.querySelector('.spinner');

  box.classList.remove('hidden');
  document.getElementById('parse-error').classList.add('hidden');
  msgEl.textContent = msg;
  msgEl.style.color = success ? 'var(--success)' : 'var(--muted)';
  spinner.style.display = spinning ? 'block' : 'none';
}

function hideProgress() {
  document.getElementById('parse-progress').classList.add('hidden');
}

function showParseError(msg) {
  const el = document.getElementById('parse-error');
  el.textContent = '⚠ ' + msg;
  el.classList.remove('hidden');
  document.getElementById('parse-progress').classList.add('hidden');
}

// ─── Parsed preview ──────────────────────────────────────────
function showParsedPreview(data) {
  const card = document.getElementById('parsed-preview-card');
  const preview = document.getElementById('parsed-preview');
  card.style.display = 'block';

  const field = (label, key, value) => {
    const isRedacted = typeof value === 'string' && (value.includes('Stored Locally Only') || value.includes('REDACTED_'));
    const inputValue = isRedacted ? '' : (value || '');
    const placeholderValue = isRedacted ? value : 'Not set (Stored locally only)';
    return `
      <div class="parsed-group">
        <label>${label}</label>
        <input type="text" class="parsed-input" data-key="${key}" value="${inputValue}" placeholder="${placeholderValue}">
      </div>
    `;
  };

  const skillsHtml = data.skills?.length ? `
    <div class="skills-preview">
      <label>Skills (${data.skills.length})</label>
      <div class="skills-wrap">
        ${data.skills.map(s => `<span class="skill-chip">${s}</span>`).join('')}
      </div>
    </div>
  ` : '';

  const expHtml = data.experience?.length ? `
    <div class="parsed-group" style="grid-column:1/-1">
      <label>Experience (${data.experience.length} roles)</label>
      <div class="parsed-value">
        ${data.experience.slice(0, 3).map(e =>
    `<div style="margin-bottom:4px">${e.title} @ ${e.company} (${e.startDate || '?'} – ${e.endDate || '?'})</div>`
  ).join('')}
      </div>
    </div>
  ` : '';

  const bannerHtml = `
    <div class="pii-alert-banner">
      <div class="pii-alert-content">
        <span class="pii-alert-icon">🔒</span>
        <div class="pii-alert-text">
          <strong>100% Privacy Enabled:</strong> Your personal contact details (Name, Email, Phone, and Socials) were redacted on your device and <strong>never sent to Google Gemini</strong>.
          Please enter them below — they will be saved <strong>100% locally</strong> in your browser storage.
        </div>
      </div>
    </div>
  `;

  preview.innerHTML = `
    ${bannerHtml}
    ${field('Name', 'name', data.name)}
    ${field('Current Title', 'currentTitle', data.currentTitle)}
    ${field('Email', 'email', data.email)}
    ${field('Phone', 'phone', data.phone)}
    ${field('Location', 'location', data.location)}
    ${field('Years Exp.', 'yearsExperience', data.yearsExperience)}
    ${field('LinkedIn', 'linkedin', data.linkedin)}
    ${field('GitHub', 'github', data.github)}
    ${skillsHtml}
    ${expHtml}
  `;
}

// Automatically save edited parsed inputs to storage
document.getElementById('parsed-preview').addEventListener('input', async (e) => {
  if (e.target.classList.contains('parsed-input')) {
    const key = e.target.dataset.key;
    let val = e.target.value;
    
    // Parse yearsExperience to number if that's the key
    if (key === 'yearsExperience' && val !== '') {
      const parsedNum = parseInt(val, 10);
      if (!isNaN(parsedNum)) {
        val = parsedNum;
      }
    }

    const stored = await chrome.storage.local.get('resumeData');
    if (stored.resumeData) {
      stored.resumeData[key] = val;
      await chrome.storage.local.set({ resumeData: stored.resumeData });
      
      const hasKey = !!(await chrome.storage.local.get('apiKey')).apiKey;
      updateStatusChip(hasKey, true);
    }
  }
});

// ─── Boot ────────────────────────────────────────────────────
init().catch(console.error);
