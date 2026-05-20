// ============================================================
// ResumeGenius – Content Script
// Detects job forms, highlights fields, fills on command
// ============================================================

(function () {
  'use strict';
  if (window.__resumeGeniusLoaded) return;
  window.__resumeGeniusLoaded = true;

  // ─── Job page detection ──────────────────────────────────
  const JOB_PATTERNS = {
    urls: /\b(jobs|careers|apply|job|hiring|recruit|talent|work-with|join-us|openings|positions)\b/i,
    titles: /\b(apply|application|job application|career|submit your|your application|job details|open position)\b/i,
    meta: /\b(job posting|job offer|career opportunity|employment)\b/i
  };

  function isJobPage() {
    const url = window.location.href;
    const title = document.title;
    const meta = Array.from(document.querySelectorAll('meta[name="description"], meta[property="og:description"]'))
      .map(m => m.content).join(' ');

    return JOB_PATTERNS.urls.test(url) ||
      JOB_PATTERNS.titles.test(title) ||
      JOB_PATTERNS.meta.test(meta) ||
      !!document.querySelector('[class*="apply"], [class*="job"], [id*="apply"], [id*="job-application"]');
  }

  // ─── Form field extraction ───────────────────────────────
  function getLabel(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.textContent.trim();
    }
    const parentLbl = el.closest('label');
    if (parentLbl) return parentLbl.textContent.replace(el.value, '').trim();

    // Look backward in DOM
    let prev = el.previousElementSibling;
    let attempts = 0;
    while (prev && attempts < 3) {
      if (['LABEL', 'SPAN', 'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'LEGEND'].includes(prev.tagName)) {
        const txt = prev.textContent.trim();
        if (txt && txt.length < 100) return txt;
      }
      prev = prev.previousElementSibling;
      attempts++;
    }

    // aria attrs
    const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (ariaLabel) {
      if (document.getElementById(ariaLabel))
        return document.getElementById(ariaLabel).textContent.trim();
      return ariaLabel;
    }

    // Check parent for label text
    const parent = el.parentElement;
    if (parent) {
      const parentText = parent.textContent.replace(el.value || '', '').trim();
      if (parentText && parentText.length < 60) return parentText;
    }

    return el.placeholder || el.name || el.id || '';
  }

  function extractFormFields() {
    const fields = [];
    const seen = new Set();

    document.querySelectorAll('input, textarea, select').forEach((el, idx) => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' ||
        el.type === 'reset' || el.type === 'image') return;

      if (el.offsetParent === null && el.type !== 'file') return; // hidden elements

      const key = el.id || el.name || `auto_${idx}`;
      if (seen.has(key)) return;
      seen.add(key);

      const label = getLabel(el);
      const field = {
        id: el.id || '',
        name: el.name || '',
        autoKey: key,
        type: el.type || el.tagName.toLowerCase(),
        label,
        placeholder: el.placeholder || '',
        required: el.required,
        tagName: el.tagName.toLowerCase(),
        value: el.value || '',
        options: el.tagName === 'SELECT'
          ? Array.from(el.options).slice(0, 30).map(o => ({ value: o.value, text: o.text.trim() }))
          : null,
        checkboxValue: el.type === 'checkbox' ? el.value : null
      };
      fields.push(field);
    });

    return fields;
  }

  // ─── Form filling ────────────────────────────────────────
  function simulateInput(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextAreaSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (el.tagName === 'TEXTAREA' && nativeTextAreaSetter) {
      nativeTextAreaSetter.call(el, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function isResumeFileInput(el) {
    if (el.type !== 'file') return false;

    const label = getLabel(el).toLowerCase();
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();

    const resumeRegex = /\b(resume|cv|curriculum|vitae|bio-data|biodata)\b/i;

    if (resumeRegex.test(label) || resumeRegex.test(name) || resumeRegex.test(id)) {
      return true;
    }

    // Check surrounding text
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 3) {
      if (resumeRegex.test(parent.textContent)) {
        return true;
      }
      parent = parent.parentElement;
      depth++;
    }

    return false;
  }

  async function fillFileInput(el, resumeFile) {
    try {
      const response = await fetch(resumeFile.dataUrl);
      const blob = await response.blob();
      const file = new File([blob], resumeFile.name, { type: resumeFile.type });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      el.files = dataTransfer.files;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      console.error('Error auto-filling file input:', e);
      return false;
    }
  }

  async function fillFields(mapping) {
    let filled = 0;
    const results = [];

    // Load stored resume file if any file inputs exist on the page
    let resumeFile = null;
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    if (fileInputs.length > 0) {
      try {
        const stored = await chrome.storage.local.get('resumeFile');
        if (stored.resumeFile && stored.resumeFile.dataUrl) {
          resumeFile = stored.resumeFile;
        }
      } catch (err) {
        console.error('Error loading resume file:', err);
      }
    }

    for (const [key, value] of Object.entries(mapping)) {
      if (!value) continue;

      const selectors = [];
      if (key) {
        selectors.push(`#${CSS.escape(key)}`);
        selectors.push(`[name="${CSS.escape(key)}"]`);
        selectors.push(`[data-field-id="${key}"]`);
      }

      let el = null;
      for (const sel of selectors) {
        try { el = document.querySelector(sel); if (el) break; } catch (e) { }
      }

      if (!el) continue;
      if (el.offsetParent === null && el.type !== 'file') continue;

      if (el.type === 'file') continue; // Handled separately below

      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options);
        const valStr = String(value).toLowerCase();
        const match = opts.find(o =>
          o.text.toLowerCase().includes(valStr) ||
          o.value.toLowerCase() === valStr ||
          valStr.includes(o.text.toLowerCase())
        );
        if (match && match.value !== el.value) {
          el.value = match.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
          results.push({ field: key, value: match.text, status: 'filled' });
        }
      } else if (el.type === 'checkbox') {
        const shouldCheck = ['yes', 'true', '1', 'agree', 'accept'].includes(String(value).toLowerCase());
        if (shouldCheck && !el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
          results.push({ field: key, value: 'checked', status: 'filled' });
        }
      } else if (el.type !== 'radio') {
        simulateInput(el, String(value));
        highlightField(el);
        filled++;
        results.push({ field: key, value: String(value).slice(0, 50), status: 'filled' });
      }
    }

    // Process file uploads if resumeFile is available
    if (resumeFile) {
      for (const el of fileInputs) {
        if (isResumeFileInput(el)) {
          const ok = await fillFileInput(el, resumeFile);
          if (ok) {
            highlightField(el);
            filled++;
            results.push({ field: el.id || el.name || 'resume_file', value: resumeFile.name, status: 'filled' });
          }
        }
      }
    }

    return { filled, results };
  }

  // ─── Visual highlights ───────────────────────────────────
  function highlightField(el) {
    el.style.transition = 'box-shadow 0.3s, border-color 0.3s';
    el.style.boxShadow = '0 0 0 2px #00d4ff66';
    el.style.borderColor = '#00d4ff';
    setTimeout(() => {
      el.style.boxShadow = '';
      el.style.borderColor = '';
    }, 2500);
  }

  // ─── Floating toast ──────────────────────────────────────
  let toastTimeout;
  function showToast(msg, type = 'info') {
    let toast = document.getElementById('rg-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'rg-toast';
      document.body.appendChild(toast);
    }
    toast.className = `rg-toast rg-toast-${type}`;
    toast.innerHTML = `<span class="rg-toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span> ${msg}`;
    toast.classList.add('rg-toast-show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('rg-toast-show'), 3500);
  }

  // ─── Company detection ───────────────────────────────────
  function detectCompany() {
    const patterns = [
      () => document.querySelector('meta[property="og:site_name"]')?.content,
      () => document.querySelector('meta[name="author"]')?.content,
      () => {
        const t = document.title;
        const m = t.match(/(?:at|@|–|-)\s*(.+?)(?:\s*[-|]|$)/i);
        return m?.[1]?.trim();
      },
      () => {
        const hostname = window.location.hostname.replace(/^www\./, '').split('.')[0];
        return hostname.charAt(0).toUpperCase() + hostname.slice(1);
      }
    ];
    for (const fn of patterns) {
      const result = fn();
      if (result && result.length < 80) return result;
    }
    return 'Unknown Company';
  }

  // ─── Message listener ────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_FORM_FIELDS') {
      const fields = extractFormFields();
      sendResponse({
        fields,
        url: window.location.href,
        title: document.title,
        company: detectCompany(),
        isJobPage: isJobPage(),
        fieldCount: fields.length
      });
      return true;
    }

    if (msg.type === 'FILL_FORM_FIELDS') {
      fillFields(msg.mapping).then(result => {
        showToast(`✓ Filled ${result.filled} fields`, 'success');
        sendResponse(result);
      }).catch(err => {
        showToast(`✗ Fill failed: ${err.message}`, 'error');
        sendResponse({ filled: 0, error: err.message });
      });
      return true;
    }

    if (msg.type === 'HIGHLIGHT_FIELDS') {
      document.querySelectorAll('input, textarea, select').forEach(el => {
        if (el.type !== 'hidden' && el.type !== 'submit') highlightField(el);
      });
      sendResponse({ done: true });
      return true;
    }

    if (msg.type === 'GET_PAGE_INFO') {
      sendResponse({
        url: window.location.href,
        title: document.title,
        company: detectCompany(),
        isJobPage: isJobPage()
      });
      return true;
    }
  });

  // ─── Auto-detect on load ─────────────────────────────────
  function init() {
    if (isJobPage()) {
      try {
        chrome.runtime.sendMessage({
          type: 'JOB_PAGE_DETECTED',
          data: { url: window.location.href, title: document.title, company: detectCompany() }
        });
      } catch (e) { /* extension context may not be ready */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }
})();
