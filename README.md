
# ResumeGenius ⚡

ResumeGenius is an advanced Chrome Extension that automates job applications, resume parsing, cover letter generation, and application tracking using the Google Gemini API. 

Unlike conventional tools that send your raw resume and full personal contact details directly to cloud AI servers, ResumeGenius utilizes a secure, client-side **Local PII Redaction and Offline Mapping Architecture**. This ensures that your highly sensitive personal details—such as your Full Name, Email Address, Phone Number, and Social Media handles—**never leave your device**.

---

> [!WARNING]  
> **EXPERIMENTAL PROJECT:** ResumeGenius is an experimental developer utility designed to demonstrate client-side PII redaction and local-only form-filling using Google Gemini. It should be used with care, and all auto-filled fields should be manually verified before submitting job applications.

---

## 🔒 The Privacy Architecture (How It Works)

ResumeGenius runs entirely on your device and communicates directly with the Google Gemini API using your own API key. The privacy safeguard operates via two key principles:

1. **Local PII Redaction:** The moment you click *"Parse with Gemini AI"*, the extension scans the document client-side inside a sandboxed service worker. It replaces all occurrences of your name, email, phone number, LinkedIn, and GitHub links with standardized placeholders (e.g. `[Email - Stored Locally Only]`) before transmitting the text to Google Gemini.
2. **Offline Mapping & Merging:** When filling out a job application on a webpage:
   * The extension whitelists and sends only your professional coordinates (skills, education, and experience details) to Gemini to map them against form fields.
   * Your contact coordinates (Name, Email, etc.) are injected **completely offline** by your local browser script (`background.js` and `content.js`) matching field labels against local storage. Your real PII is never sent in the AI API payload.
3. **Offline Cover Letter Merging:** Gemini drafts your cover letter using a generic `[Candidate Name]` placeholder. The extension's background script replaces this placeholder with your real name locally after receiving the AI response, so your real name never touches the remote model.

*For a detailed architectural breakdown and code-level file/line mappings, see [code_privacy_walkthrough.md](./code_privacy_walkthrough.md).*

---

## ✨ Core Features

* **🛡️ 100% Client-Side PII Redaction:** Automatically strips contact coordinates locally before sending prompts to external APIs.
* **📄 AI Resume Parsing & Secure File Storage:** Fast extraction of structured work experience, skills, and education from PDFs, TXT, or DOCX files. The original resume file is stored locally as a Base64 data URL.
* **📤 Auto-Attach Resume File:** Programmatically detects resume/CV file upload inputs on job pages and attaches the saved resume file locally using the `DataTransfer` API during form filling.
* **🏢 Personalized Form Responses:** Detects the company name and role title from the job application webpage to automatically generate highly tailored and personalized responses to open-ended questions (such as *"Why do you want to work here?"*).
* **⚡ Pre-configured Gemini 3.1 Flash Lite:** Pre-selected and optimized for the latest **Gemini 3.1 Flash Lite (Free Tier)** model in Google AI Studio to guarantee lightning-fast form-filling and completely free execution.
* **📋 Smart Form Auto-Filling:** Seamless application filling on job boards. If specific details are missing, fields are kept clean and empty rather than writing placeholder texts.
* **🔍 Live Job Finder:** Recommends relevant job search categories and query links tailored to your skills, current role, and geographic location across boards like LinkedIn, Indeed, Wellfound, RemoteOK, and Naukri.
* **✍️ Private Cover Letter Writer:** Generates highly tailored, professional 3-paragraph cover letters matching job descriptions while keeping your identity private.
* **📊 Offline Application Log:** Tracks your applications locally in a simple log where you can update statuses, edit notes, and export logs as CSV at any time.
* **🔗 Manifest V3 CSP Compliant:** Fully local PDF extraction library parsing using a local bundle of `pdf.js` to comply with the tightest browser security protocols.

---

## 🚀 How to Set Up & Use

### 1. Install the Extension in Chrome
1. Clone or download this repository to your computer.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. In the top-right corner, toggle the **"Developer mode"** switch to **ON**.
4. In the top-left, click the **"Load unpacked"** button.
5. Select the `resume-genius` directory (containing `manifest.json`).

### 2. Configure Your API Key & Model
1. Visit [Google AI Studio](https://aistudio.google.com/) and click **"Get API key"** to create a free individual API key.
2. Click the ResumeGenius extension icon in your Chrome toolbar and open **Settings** (or open the settings page directly).
3. Paste your API key in the field and click **Save Key**.
4. Select **Gemini 3.1 Flash Lite (Recommended)** from the dropdown list.

### 3. Upload & Parse Your Resume
1. Drag and drop your resume (PDF/TXT) or paste your resume text in the Settings text area.
2. Click **Parse with Gemini AI**.
3. Once completed, your redacted professional details will show in the preview.
4. **Complete your profile:** Type your real name, email, phone, location, and social links in the empty input fields. These are saved **100% locally** in `chrome.storage.local`.

### 4. Apply to Jobs Automatically
1. Navigate to any job application form.
2. Open the ResumeGenius popup inside your tab.
3. Click **"Autofill Form"** — the extension will automatically match the fields and populate your details in the webpage!

---

## 🛠️ Technology Stack

* **Extension Framework:** Manifest V3
* **Scripting & Business Logic:** Vanilla JavaScript (ES6+, Service Workers, Content Scripts)
* **User Interface & Design:** Modern CSS Variables, harmonic dark-mode palettes, and custom glassmorphism assets.
* **PDF Extraction Engine:** Bundled local `pdf.js` v3.11.174
* **AI Model Pipeline:** Google Gemini REST API (`generativelanguage.googleapis.com`)

---

## ⚖️ Credits & Licenses

* **PDF.js:** Distributed under the Apache License 2.0. Copyright © Mozilla and individual contributors.


