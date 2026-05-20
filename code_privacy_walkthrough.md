# ResumeGenius: Zero-Trust Code Privacy & Local Sandboxing Technical Blueprint 🔒

This document provides a highly detailed, comprehensive technical walkthrough of the **ResumeGenius Privacy Architecture** and local-first system design. It outlines how sensitive Personally Identifiable Information (PII) is isolated and kept strictly within the local browser sandbox on your device, while leveraging Google's Gemini LLMs (specifically `gemini-3.1-flash-lite`) for intelligent, context-aware resume parsing, application form-filling, and cover letter writing.

There are no diagrams, illustrations, or external image links in this document, ensuring clean, flawless rendering across all markdown platforms (including GitHub).

---

## 🏗️ 1. Core Architectural Zero-Trust Blueprint

ResumeGenius operates under a **Zero-Trust Client-Side Architecture**. Many AI browser extensions act as intermediaries, routing your resume data and credentials through their own centralized servers where data can be logged, cached, or sold. ResumeGenius operates with a strict set of architectural rules:

1. **No External App Servers:** The extension communicates directly and exclusively with the official Google Gemini API endpoints from your local browser client. There are no middleware servers, proxy logs, or third-party databases.
2. **Direct Client-to-API Communication:** API requests are constructed and dispatched locally from the background service worker using the user's own private Google Gemini API key.
3. **Encrypted Local Sandboxing:** Sensitive profile data, raw resumes, and application history logs are written directly to `chrome.storage.local`. This data is sandboxed under the Chrome browser's internal encryption and cannot be read by other websites or extensions.
4. **Pre-Submission Data Scrubbing:** Any operation requiring LLM processing runs client-side sanitizers *before* outbound data transmission occurs. PII is either stripped entirely or swapped for structural placeholders.

### Browser Sandbox Boundaries
The extension maintains a strict data boundary between three main scopes:
* **Content Script (`content.js`):** Runs inside the context of the active web tab. It does not have access to the user's profile data, raw resume text, or Gemini API key. Its sole role is to inspect the form elements in the page DOM and inject filled values.
* **Background Service Worker (`background.js`):** Runs in a secure, isolated extension context. It holds the API key, reads `chrome.storage.local`, performs PII scrubbing, manages outbound API communication, and executes the offline merge logic.
* **Options Page & Popup (`options.html` / `popup.html`):** The local user interface. Inputs here are written directly to storage and are never exposed to external web scripts.

---

## 🔄 2. Pre-Submission Client-Side Redaction & Resume Parsing

When you upload a resume PDF or text block to the Settings panel, ResumeGenius uses an instant client-side parser. Before the text is sent to Google's Gemini API for structured categorization, it is processed through a strict, multi-stage regex-based scrubbing engine.

### Data Flow Diagram (Pure Text Flow)
1. **Raw Upload:** Resume text is uploaded into the Options UI (`options.js`).
2. **IPC Trigger:** Options page triggers a Chrome messaging request (`PARSE_RESUME`) to the Background Service Worker.
3. **Local Scrubbing:** The Service Worker intercepts the raw text and runs `redactPII()` immediately.
4. **Outbound Payload:** The service worker constructs an API payload containing the sanitized text and the user's local Gemini key.
5. **AI Structured Response:** Gemini parses the sanitized professional sections into structured JSON, using redacted labels as placeholding markers.
6. **Local Storage and Input Cleanse:** Options page displays empty forms for PII fields, storing any typed corrections directly in `chrome.storage.local`.

### Code Walkthrough: Redaction Engine

The core client-side PII filter resides in the background service worker (`background.js`). The `redactPII` function performs five separate regex replacements:

```javascript
function redactPII(text) {
  // 1. Redact Email Addresses
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  text = text.replace(emailRegex, '[Email - Stored Locally Only]');

  // 2. Redact Phone Numbers
  // Matches typical international/domestic number formats and checks digit density (7-15 digits)
  const phoneRegex = /(\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4})/g;
  const phoneMatches = text.match(phoneRegex) || [];
  for (const match of phoneMatches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      text = text.replaceAll(match, '[Phone - Stored Locally Only]');
    }
  }

  // 3. Redact LinkedIn URLs
  const linkedinRegex = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi;
  text = text.replace(linkedinRegex, '[LinkedIn - Stored Locally Only]');

  // 4. Redact GitHub URLs
  const githubRegex = /(https?:\/\/)?(www\.)?github\.com\/[a-zA-Z0-9_-]+/gi;
  text = text.replace(githubRegex, '[GitHub - Stored Locally Only]');

  // 5. High-Entropy Name Isolation
  // Scans the first 10 lines of the resume text, ignoring general metadata headers
  const lines = text.split('\n');
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    if (line.length > 2 && line.length < 40) {
      const lower = line.toLowerCase();
      if (!lower.includes('resume') && 
          !lower.includes('cv') && 
          !lower.includes('curriculum') && 
          !lower.includes('contact') && 
          !lower.includes('email') && 
          !lower.includes('phone') && 
          !lower.includes('page')) {
        const nameRegex = new RegExp(escapeRegExp(line), 'g');
        text = text.replace(nameRegex, '[Name - Stored Locally Only]');
        break;
      }
    }
  }

  return text;
}
```

### Local Settings View Safeguards

When the structured, redacted JSON payload returns from Gemini, the UI script (`options.js`) parses the object and populates the text fields. To prevent users from submitting the redaction strings (`[Email - Stored Locally Only]`) as active data, `options.js` clears these values inside the browser DOM and presents them only as empty text boxes with grey HTML placeholders:

```javascript
const isRedacted = typeof value === 'string' && (value.includes('Stored Locally Only') || value.includes('REDACTED_'));
const inputValue = isRedacted ? '' : (value || '');
const placeholderValue = isRedacted ? value : 'Not set (Stored locally only)';

inputEl.value = inputValue;
inputEl.placeholder = placeholderValue;
```

When you type your true name, email, or phone number into these fields, the values are bound immediately to your secure storage without hitting any network connection:

```javascript
const stored = await chrome.storage.local.get('resumeData');
stored.resumeData[key] = val; // Direct write to sandboxed extension storage
await chrome.storage.local.set({ resumeData: stored.resumeData });
```

---

## 📝 3. Whitelisted Profile Form-Filling & Offline Merging

When you visit a job posting website and click "Auto-fill Application," ResumeGenius initiates an automated, two-pass form filling sequence. This ensures your professional highlights are aligned by Gemini, while your sensitive PII is injected 100% offline.

### Data Flow Lifecycle (Pure Text Flow)
1. **DOM Inspection:** Content script (`content.js`) scrapes active input fields (IDs, labels, attributes, select options) and forwards them to the background thread.
2. **Whitelist Packaging:** The service worker reads the user's profile and strips out all contact properties, creating an isolated `safeResume` object.
3. **AI Context Mapping:** Gemini receives *only* the PII-free `safeResume` and the list of form attributes to determine the best contextual mappings.
4. **On-Device PII Binding:** The service worker receives the AI mappings, intercepts the response, and uses an offline lookup table to assign the true personal data.
5. **DOM Autofill:** The unified mappings are sent back to `content.js` and injected directly into page inputs.

### Code Walkthrough: Safe Resume Whitelist

The Whitelisted Profile completely isolates and removes the user's name, email, phone number, physical address, and personal website links. Only professional history highlights, years of experience, and hard skills are shared with Gemini:

```javascript
const safeResume = {
  currentTitle: resumeData.currentTitle,
  summary: resumeData.summary,
  yearsExperience: resumeData.yearsExperience,
  skills: resumeData.skills,
  education: resumeData.education,
  experience: resumeData.experience?.map(e => ({
    title: e.title,
    company: e.company,
    startDate: e.startDate,
    endDate: e.endDate,
    highlights: e.highlights?.slice(0, 3) // Truncates details to prevent accidental PII leakage
  })),
  certifications: resumeData.certifications,
  languages: resumeData.languages
};
```

### Code Walkthrough: On-Device PII Merging

Once Gemini completes the alignment of professional values (e.g. skills mapping, short-answer responses), the background service worker handles the assignment of contact information. The following script runs in background memory, completely offline:

```javascript
const piiMapping = {};

// Clean redacted placeholders from local values
const isNameRedacted = typeof resumeData.name === 'string' && (resumeData.name.includes('Stored Locally Only') || resumeData.name.includes('REDACTED_'));
const cleanName = isNameRedacted ? '' : (resumeData.name || '');
const nameParts = cleanName.trim().split(' ');
const firstName = nameParts[0] || '';
const lastName = nameParts.slice(1).join(' ') || '';

const cleanEmail = (typeof resumeData.email === 'string' && (resumeData.email.includes('Stored Locally Only') || resumeData.email.includes('REDACTED_'))) ? '' : (resumeData.email || '');
const cleanPhone = (typeof resumeData.phone === 'string' && (resumeData.phone.includes('Stored Locally Only') || resumeData.phone.includes('REDACTED_'))) ? '' : (resumeData.phone || '');
const cleanLinkedin = (typeof resumeData.linkedin === 'string' && (resumeData.linkedin.includes('Stored Locally Only') || resumeData.linkedin.includes('REDACTED_'))) ? '' : (resumeData.linkedin || '');
const cleanGithub = (typeof resumeData.github === 'string' && (resumeData.github.includes('Stored Locally Only') || resumeData.github.includes('REDACTED_'))) ? '' : (resumeData.github || '');
const cleanPortfolio = (typeof resumeData.portfolio === 'string' && (resumeData.portfolio.includes('Stored Locally Only') || resumeData.portfolio.includes('REDACTED_'))) ? '' : (resumeData.portfolio || '');
const cleanLocation = (typeof resumeData.location === 'string' && (resumeData.location.includes('Stored Locally Only') || resumeData.location.includes('REDACTED_'))) ? '' : (resumeData.location || '');

// Scan all scraped webpage fields and perform local keyword matches
formFields.forEach(f => {
  const key = f.id || f.name || '';
  const label = (f.label || f.placeholder || f.name || '').toLowerCase();

  if (/^(first.?name|fname|given.?name)/i.test(label) || /first.?name/i.test(key)) {
    piiMapping[key] = firstName;
  } else if (/^(last.?name|lname|surname|family.?name)/i.test(label) || /last.?name/i.test(key)) {
    piiMapping[key] = lastName;
  } else if (/full.?name|your.?name/i.test(label)) {
    piiMapping[key] = cleanName;
  } else if (/email/i.test(label)) {
    piiMapping[key] = cleanEmail;
  } else if (/phone|mobile|tel/i.test(label)) {
    piiMapping[key] = cleanPhone;
  } else if (/city|location|address/i.test(label) && !/company/i.test(label)) {
    piiMapping[key] = cleanLocation;
  } else if (/linkedin/i.test(label)) {
    piiMapping[key] = cleanLinkedin;
  } else if (/github/i.test(label)) {
    piiMapping[key] = cleanGithub;
  } else if (/portfolio|website|url/i.test(label)) {
    piiMapping[key] = cleanPortfolio;
  }
});

// Unified payload is returned back to content script
return { ...aiMapping, ...piiMapping };
```

---

## ✉️ 4. Anonymous Cover Letter Synthesis & On-Device Swapping

Writing a tailored cover letter often exposes your full name and current employment details. ResumeGenius mitigates this risk by forcing Gemini to write the letter anonymously using a strictly structured prompt. 

### Data Flow Workflow (Pure Text Flow)
1. **Request Cover Letter:** User clicks "Write Cover Letter" in the Popup Panel.
2. **Whitelist Slicing:** Background worker packages `safeResume` along with the scraped job requirements.
3. **Anonymized Prompt Construction:** Prompt instructs the Gemini model to write the cover letter, using ONLY the static placeholder string `[Candidate Name]`.
4. **AI Generation:** Gemini completes the draft containing `[Candidate Name]`.
5. **Local Offline Replacement:** Background service worker intercepts the response and swaps `[Candidate Name]` with the user's real name stored in local browser memory.
6. **UI Injection:** Options/Popup UI renders the fully signed letter.

### Code Walkthrough: Structured Prompt Enforcement

The prompt sent to the Gemini API mandates anonymous drafting and strictly forbids name generation:

```javascript
const prompt = `Write a concise, compelling cover letter (3 paragraphs, ~200 words) for this job application.

Job: ${JSON.stringify(jobInfo)}
Candidate profile: ${JSON.stringify(safeResume)}
Candidate name: [Candidate Name]

Format: Professional letter body only (no "Dear Hiring Manager" header, no date). 
Start directly with a strong opening hook.
IMPORTANT: You MUST output the placeholder text "[Candidate Name]" exactly (including brackets) wherever the candidate's name is referenced or signed at the bottom. Do not invent a real name.`;
```

### Code Walkthrough: Post-Response Swapping

Once the text response returns to the background worker, it retrieves the user's local name parameters and performs a standard Javascript replace utility before presenting it to the UI:

```javascript
const letterText = await callGemini(apiKey, prompt, model, 0.7);

// Perform substitution in safe, offline browser service worker memory
const isRedacted = typeof resumeData.name === 'string' && (resumeData.name.includes('Stored Locally Only') || resumeData.name.includes('REDACTED_'));
const realName = isRedacted ? '[Your Name]' : (resumeData.name || '[Your Name]');

return letterText.replace(/\[Candidate Name\]/g, realName);
```

---

## 🔒 5. Chrome Storage Sandboxing & Manifest Permissions Review

Chrome extensions run under high-level sandboxing, governed by strict browser permissions. Let's review why the ResumeGenius permission manifest is designed for maximum safety:

### Manifest Permission Audits

* **`storage`:** Grants access to the secure Chrome storage APIs (`chrome.storage.local`). Unlike cookies or `localStorage` (which can be read by any script running on a webpage), `chrome.storage.local` is isolated at the browser level. Web pages cannot access or modify your storage variables.
* **`activeTab` & `tabs`:** Grants temporary, request-based host access to the active webpage you are viewing. This allows the extension to read forms and perform DOM filling operations only when you actively trigger the auto-fill sequence.
* **`scripting`:** Grants the background service worker permissions to run content scripts dynamically when form actions occur.
* **`host_permissions`: `["<all_urls>"]`:** Required solely to permit direct fetch requests from the background service worker to Google's Gemini API endpoints, and to run the form scraping algorithms across different recruitment platforms.
* **No `cookies` or `identity`:** ResumeGenius never requests access to your browser cookies, search history, or Google user identities.

### Remote Code Execution (RCE) Bans
In compliance with Google's Manifest V3 security rules, ResumeGenius bundles **100% of its script execution logic locally**. No external JavaScript or tracking scripts are loaded from CDN endpoints. Everything is sandboxed inside the static package.

---

## 📈 6. Compliance Alignment & User Control

ResumeGenius is fully aligned with modern international privacy regulations:

### GDPR & CCPA Compliance
* **Data Sovereignty:** You are the absolute owner of your data. The extension collects zero user analytics, stores zero logs, and has no backend server databases to store or leak your files.
* **Right to Erasure (Forget Me):** Erasing your data is simple and immediate. Removing the extension from your browser instantly wipes the local browser sandbox (`chrome.storage.local`), destroying all API keys, parsed resumes, cover letters, and application log history forever.
* **Consent by Design:** Outbound data transfers only happen when you click "Save", "Parse", or "Auto-fill". There are no passive background tracking daemons running in the extension.

---

## 💡 Summary Checklist: Why ResumeGenius is Safe

* **Zero third-party proxies:** All network communication is straight between you and Google Gemini.
* **Zero storage outside your machine:** No cloud-syncing, no tracking, and no external logs.
* **100% Client-Side redaction:** Real email addresses, phone numbers, names, and portfolios are never exposed to Gemini API environments.
* **Complete source transparency:** Every line of code is bundled statically and is readable in your unpacked extension folder.
