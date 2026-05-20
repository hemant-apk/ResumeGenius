// ============================================================
// ResumeGenius – Background Service Worker
// All PII stays in chrome.storage.local on the user's device.
// Gemini API calls use the user's own API key.
// ============================================================

// ─── Gemini helper ───────────────────────────────────────────
async function callGemini(apiKey, prompt, model = 'gemini-3.1-flash-lite', temperature = 0.1, isJson = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: 2048 }
  };
  if (isJson) {
    body.generationConfig.responseMimeType = 'application/json';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function extractJSON(text, isArray = false) {
  let cleaned = text.trim();
  // Strip Markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // If direct parse fails, try regex extraction
    const match = isArray
      ? cleaned.match(/\[[\s\S]*\]/)
      : cleaned.match(/\{[\s\S]*\}/);
      
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (parseErr) {
        // Try parsing after sanitizing common trailing commas and smart quotes
        try {
          const sanitized = match[0]
            .replace(/,\s*([\]}])/g, '$1') // remove trailing commas before closing brackets
            .replace(/[\u201C\u201D]/g, '"'); // normalize smart quotes
          return JSON.parse(sanitized);
        } catch (e3) {
          throw new Error('Gemini returned invalid JSON structure: ' + parseErr.message);
        }
      }
    }
    
    // Check if it looks like a conversational refusal/message instead of JSON
    if (cleaned.toLowerCase().includes('sorry') || 
        cleaned.toLowerCase().includes('cannot') || 
        cleaned.toLowerCase().includes('as an ai') || 
        cleaned.toLowerCase().includes('please provide')) {
      throw new Error(`AI Refusal: "${cleaned.slice(0, 150)}..."`);
    }
    
    throw new Error('No JSON found in response. The model may have returned plain text.');
  }
}

// ─── PII Automatic Redaction Helpers ───────────────────────────
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactPII(text) {
  // 1. Redact email
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  text = text.replace(emailRegex, '[Email - Stored Locally Only]');

  // 2. Redact phone number
  const phoneRegex = /(\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4})/g;
  const phoneMatches = text.match(phoneRegex) || [];
  for (const match of phoneMatches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      text = text.replaceAll(match, '[Phone - Stored Locally Only]');
    }
  }

  // 3. Redact LinkedIn URL
  const linkedinRegex = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi;
  text = text.replace(linkedinRegex, '[LinkedIn - Stored Locally Only]');

  // 4. Redact GitHub URL
  const githubRegex = /(https?:\/\/)?(www\.)?github\.com\/[a-zA-Z0-9_-]+/gi;
  text = text.replace(githubRegex, '[GitHub - Stored Locally Only]');

  // 5. Redact Name (usually the first non-empty line of the resume text)
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

// ─── Resume parsing ──────────────────────────────────────────
async function parseResume(rawText, apiKey, model) {
  // Automatically redact PII on the client side before sending to Gemini API
  const redactedText = redactPII(rawText);

  const prompt = `You are a resume parser. Extract all information from this resume text and return ONLY valid JSON.

Resume:
"""
${redactedText.slice(0, 8000)}
"""

Return this exact JSON structure (fill all fields you can find, use null for missing):
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "+1-xxx-xxx-xxxx",
  "location": "City, State, Country",
  "linkedin": "https://linkedin.com/in/...",
  "github": "https://github.com/...",
  "portfolio": "https://...",
  "currentTitle": "Current Job Title",
  "summary": "Professional summary 2-3 sentences",
  "yearsExperience": 5,
  "skills": ["skill1", "skill2"],
  "languages": ["English", "Hindi"],
  "education": [
    { "degree": "Bachelor of Science", "field": "Computer Science", "school": "University Name", "year": "2020", "gpa": "3.8" }
  ],
  "experience": [
    {
      "title": "Software Engineer",
      "company": "Company Name",
      "location": "City, State",
      "startDate": "Jan 2021",
      "endDate": "Present",
      "highlights": ["Built X achieving Y", "Led team of Z"]
    }
  ],
  "certifications": ["Cert Name – Issuer, 2023"],
  "projects": [
    { "name": "Project Name", "description": "What it does", "tech": ["React", "Node"] }
  ]
}`;

  const text = await callGemini(apiKey, prompt, model, 0, true);
  return extractJSON(text);
}

// ─── Form filling ────────────────────────────────────────────
async function generateFormMapping(formFields, resumeData, apiKey, model, company = '', jobTitle = '') {
  // PII-aware: contact info filled via rules, not sent to Gemini
  const safeResume = {
    currentTitle: resumeData.currentTitle,
    summary: resumeData.summary,
    yearsExperience: resumeData.yearsExperience,
    skills: resumeData.skills,
    education: resumeData.education,
    experience: resumeData.experience?.map(e => ({
      title: e.title, company: e.company, startDate: e.startDate,
      endDate: e.endDate, highlights: e.highlights?.slice(0, 3)
    })),
    certifications: resumeData.certifications,
    languages: resumeData.languages
  };

  const prompt = `You are a job application form filler. Given form fields, candidate resume data, and job application context, produce the best mapping of responses.

Company: ${company || 'the company'}
Job Title/Page Context: ${jobTitle || 'the role'}

Form fields:
${JSON.stringify(formFields, null, 2)}

Candidate profile:
${JSON.stringify(safeResume, null, 2)}

Return ONLY a JSON object where keys are field IDs/names and values are what to type.
Rules:
- Skip file upload fields (return null for them)
- For text areas asking "Why do you want to work here?" or questions about alignment/interest, write a professional, highly personalized 2-sentence response explaining how the candidate's skills align with ${company || 'the company'}'s mission and the requirements of the ${jobTitle || 'role'}. Do not use generic placeholders.
- For cover letter text areas or other open-ended questions, draft a short, customized response referring specifically to ${company || 'the company'} and ${jobTitle || 'the position'}.
- For experience/salary fields use realistic values from the resume
- For dropdowns return the option VALUE (not display text) that best fits
- Skip fields you cannot confidently fill

Format: {"fieldId": "value_to_fill", ...}`;

  const text = await callGemini(apiKey, prompt, model, 0.2, true);
  const aiMapping = extractJSON(text);

  // Add PII fields locally (never sent to Gemini)
  const piiMapping = {};

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

  formFields.forEach(f => {
    const key = f.id || f.name || '';
    const label = (f.label || f.placeholder || f.name || '').toLowerCase();

    if (/^(first.?name|fname|given.?name)/i.test(label) || /first.?name/i.test(key))
      piiMapping[key] = firstName;
    else if (/^(last.?name|lname|surname|family.?name)/i.test(label) || /last.?name/i.test(key))
      piiMapping[key] = lastName;
    else if (/full.?name|your.?name/i.test(label))
      piiMapping[key] = cleanName;
    else if (/email/i.test(label))
      piiMapping[key] = cleanEmail;
    else if (/phone|mobile|tel/i.test(label))
      piiMapping[key] = cleanPhone;
    else if (/city|location|address/i.test(label) && !/company/i.test(label))
      piiMapping[key] = cleanLocation;
    else if (/linkedin/i.test(label))
      piiMapping[key] = cleanLinkedin;
    else if (/github/i.test(label))
      piiMapping[key] = cleanGithub;
    else if (/portfolio|website|url/i.test(label))
      piiMapping[key] = cleanPortfolio;
  });

  return { ...aiMapping, ...piiMapping };
}

// ─── Job finding ─────────────────────────────────────────────
async function findRelevantJobs(resumeData, apiKey, model) {
  // Only skills/title sent – no PII
  const profile = {
    title: resumeData.currentTitle,
    skills: resumeData.skills?.slice(0, 20),
    yearsExp: resumeData.yearsExperience,
    location: resumeData.location,
    education: resumeData.education?.[0]?.field
  };

  const prompt = `Based on this professional profile, recommend 8 highly relevant job search queries and categories across major job boards.

Profile: ${JSON.stringify(profile)}

Return ONLY a JSON array:
[
  {
    "title": "Job Category / Role Title",
    "company": "Target Companies or 'Various'",
    "platform": "LinkedIn|Indeed|Wellfound|RemoteOK|Y Combinator|Naukri|Glassdoor",
    "url": "https://...",
    "tags": ["Remote/Hybrid/Onsite", "Full-time/Contract", "Experience Level"],
    "match": 95,
    "reason": "One sentence explaining why this search is highly relevant to the candidate's skills and experience."
  }
]

CRITICAL URL RULES (Construct real, working URLs. Do NOT hallucinate specific job ID links like /view/12345):
- LinkedIn: Use search URLs like https://www.linkedin.com/jobs/search/?keywords=[urlencoded_keywords]&location=[urlencoded_location]
- Indeed: Use search URLs like https://www.indeed.com/jobs?q=[urlencoded_keywords]&l=[urlencoded_location]
- Wellfound: Use search URLs like https://wellfound.com/jobs?q=[urlencoded_keywords]
- Y Combinator: Use search URLs like https://www.workatastartup.com/jobs?query=[urlencoded_keywords]
- RemoteOK: Use search URLs like https://remoteok.com/remote-[keywords]-jobs
- Naukri: Use search URLs like https://www.naukri.com/[keywords]-jobs-in-[location]

Vary the platforms and search queries. Customise keywords based on candidate's core skills and title. Include at least 2 remote-focused search categories. If candidate location is specified, target that location in the search queries where applicable.`;

  const text = await callGemini(apiKey, prompt, model, 0.3, true);
  return extractJSON(text, true);
}

// ─── Cover letter generator ──────────────────────────────────
async function generateCoverLetter(jobInfo, resumeData, apiKey, model) {
  const safeResume = {
    currentTitle: resumeData.currentTitle,
    yearsExperience: resumeData.yearsExperience,
    skills: resumeData.skills?.slice(0, 10),
    topExperience: resumeData.experience?.[0],
    education: resumeData.education?.[0]
  };

  const prompt = `Write a concise, compelling cover letter (3 paragraphs, ~200 words) for this job application.

Job: ${JSON.stringify(jobInfo)}
Candidate profile: ${JSON.stringify(safeResume)}
Candidate name: [Candidate Name]

Format: Professional letter body only (no "Dear Hiring Manager" header, no date). 
Start directly with a strong opening hook.
IMPORTANT: You MUST output the placeholder text "[Candidate Name]" exactly (including brackets) wherever the candidate's name is referenced or signed at the bottom. Do not invent a real name.`;

  const letterText = await callGemini(apiKey, prompt, model, 0.7);

  // Swap the placeholder back locally with the real name!
  const isRedacted = typeof resumeData.name === 'string' && (resumeData.name.includes('Stored Locally Only') || resumeData.name.includes('REDACTED_'));
  const realName = isRedacted ? '[Your Name]' : (resumeData.name || '[Your Name]');

  return letterText.replace(/\[Candidate Name\]/g, realName);
}

// ─── Message router ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Parse resume
  if (msg.type === 'PARSE_RESUME') {
    chrome.storage.local.get(['apiKey', 'apiModel']).then(({ apiKey, apiModel }) => {
      if (!apiKey) return sendResponse({ error: 'No Gemini API key. Open Settings.' });
      parseResume(msg.text, apiKey, apiModel || 'gemini-3.1-flash-lite')
        .then(data => {
          chrome.storage.local.set({ resumeData: data, resumeRaw: msg.text });
          sendResponse({ data });
        })
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // Fill form
  if (msg.type === 'FILL_FORM') {
    chrome.storage.local.get(['resumeData', 'apiKey', 'apiModel']).then(({ resumeData, apiKey, apiModel }) => {
      if (!resumeData) return sendResponse({ error: 'No resume found. Upload in Settings.' });
      if (!apiKey) return sendResponse({ error: 'No Gemini API key. Open Settings.' });
      generateFormMapping(msg.formFields, resumeData, apiKey, apiModel || 'gemini-3.1-flash-lite', msg.company, msg.jobTitle)
        .then(mapping => sendResponse({ mapping }))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // Find jobs
  if (msg.type === 'FIND_JOBS') {
    chrome.storage.local.get(['resumeData', 'apiKey', 'apiModel']).then(({ resumeData, apiKey, apiModel }) => {
      if (!resumeData) return sendResponse({ error: 'No resume found. Upload in Settings.' });
      if (!apiKey) return sendResponse({ error: 'No Gemini API key. Open Settings.' });
      findRelevantJobs(resumeData, apiKey, apiModel || 'gemini-3.1-flash-lite')
        .then(jobs => sendResponse({ jobs }))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // Cover letter
  if (msg.type === 'COVER_LETTER') {
    chrome.storage.local.get(['resumeData', 'apiKey', 'apiModel']).then(({ resumeData, apiKey, apiModel }) => {
      if (!resumeData || !apiKey) return sendResponse({ error: 'Setup required.' });
      generateCoverLetter(msg.jobInfo, resumeData, apiKey, apiModel || 'gemini-3.1-flash-lite')
        .then(text => sendResponse({ text }))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // Log a job application
  if (msg.type === 'LOG_APPLICATION') {
    chrome.storage.local.get({ jobLog: [] }).then(({ jobLog }) => {
      const entry = {
        id: Date.now(),
        appliedAt: new Date().toISOString(),
        company: msg.company || 'Unknown',
        title: msg.title || 'Unknown Role',
        url: msg.url || '',
        status: 'Applied',
        notes: msg.notes || ''
      };
      jobLog.unshift(entry);
      chrome.storage.local.set({ jobLog });
      sendResponse({ success: true, entry });
    });
    return true;
  }

  // Get log
  if (msg.type === 'GET_LOG') {
    chrome.storage.local.get({ jobLog: [] }).then(({ jobLog }) => {
      sendResponse({ jobLog });
    });
    return true;
  }

  // Update log entry status
  if (msg.type === 'UPDATE_LOG_STATUS') {
    chrome.storage.local.get({ jobLog: [] }).then(({ jobLog }) => {
      const idx = jobLog.findIndex(e => e.id === msg.id);
      if (idx !== -1) jobLog[idx].status = msg.status;
      chrome.storage.local.set({ jobLog });
      sendResponse({ success: true });
    });
    return true;
  }

  // Delete log entry
  if (msg.type === 'DELETE_LOG') {
    chrome.storage.local.get({ jobLog: [] }).then(({ jobLog }) => {
      const filtered = jobLog.filter(e => e.id !== msg.id);
      chrome.storage.local.set({ jobLog: filtered });
      sendResponse({ success: true });
    });
    return true;
  }

  // Get resume data
  if (msg.type === 'GET_RESUME') {
    chrome.storage.local.get(['resumeData', 'resumeRaw']).then(data => {
      sendResponse(data);
    });
    return true;
  }

  // Notify of detected job page (from content script)
  if (msg.type === 'JOB_PAGE_DETECTED') {
    // Could show a badge or notification
    chrome.action.setBadgeText({ text: '!', tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#00d4ff' });
    return false;
  }
});

// Clear badge when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
