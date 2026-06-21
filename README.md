# Vision Reader — Backend

Backend API for an AI-powered screen-reading browser extension that helps blind
and visually impaired users understand web pages. Instead of reading every line,
it sends the page to an AI that produces a short spoken summary, lists the main
sections, and describes images.

## How the AI works

The proposal calls for two AI capabilities. Both live in `ai.js`:

### 1. Pattern Detection & Classification (`summarizePage`)

- **Input:** the page's cleaned visible text (after `server.js` strips out
  headers, nav, buttons, scripts, etc. with Cheerio) plus light context (URL, title).
- **Model:** an LLM (`gpt-4o-mini` by default) prompted as an assistive
  screen-reader.
- **Output:** JSON — `{ pageType, sections[], summary, readAloud }`.
  - `pageType` classifies the page (article, store, form, dashboard, ...).
  - `sections` are navigation hints the user can jump to.
  - `readAloud` is the short (<=60 word) line spoken first, ending with a
    question offering the next step.

This is why we use an LLM over a rules-based reader: rules can read text but
can't *classify* what a page is, decide what matters, and compress it into a
spoken overview that adapts to any unseen layout.

### 2. Computer Vision (`describeImages`)

- **Input:** image URLs extracted from the page that lack useful alt text.
- **Model:** a vision model generates one-sentence alt text per image.
- **Output:** each image gets a `description` and a `descriptionSource`
  (`alt` | `vision` | `skipped`). Inline/tracking pixels are skipped, and a
  per-request image budget caps cost.

## Safety — keeping a human in control

Two layers protect confidential data (the proposal's main risk):

1. **Domain blocklist** (`server.js`): known banking/financial domains are
   rejected before any processing.
2. **Content-level classifier** (`ai.classifySensitiveContent`): even on an
   allowed site, the extracted text is scanned for sensitive patterns (SSNs,
   card numbers, CVVs, account balances, API keys). If any are found, the page
   is **not** sent to the model and **not** read aloud — the user is told why.
   The user always decides whether to proceed.

## Setup

```bash
npm install
cp .env.example .env   # then add your OPENAI_API_KEY
npm run dev            # or: npm start
```

Without an API key the server still runs and returns deterministic mock output,
so the pipeline is demoable offline.

## Chrome Extension

The extension lives in `extension/`. Load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder
4. Pin **Vision Assist** to your toolbar

### Extension features

- **Summarize Page** — sends page HTML to the backend for AI summary + TTS
- **Ask a Question** — voice or text Q&A about the current page (after summarizing)
- **Section navigation** — jump to headings matching detected sections
- **Image descriptions** — announces computer-vision alt text after the summary
- **Safety confirmations** — human-in-the-loop prompt when sensitive content is detected
- **Keyboard shortcuts** — `Alt+Shift+S` (summarize), `Alt+Shift+Q` (ask)

Configure the backend URL in extension Settings (default: `http://localhost:3001`).

## API

### `GET /api/health`

Returns `{ status, aiEnabled, version }`.

### `POST /api/process-page`

Request body:

```json
{ "url": "https://example.com/article", "html": "<html>...</html>" }
```

Response (success):

```json
{
  "success": true,
  "pageTitle": "Example Article",
  "pageType": "news article",
  "sections": ["Headline", "Body", "Related links"],
  "summaryText": "Short spoken intro ending in a question...",
  "fullSummary": "1-2 sentence overview.",
  "audioUrls": ["https://...mp3"],
  "imagesToProcess": [
    { "src": "...", "alt": "", "description": "A red bicycle leaning on a wall.", "descriptionSource": "vision" }
  ],
  "metadata": { "aiEnabled": true, "model": "gpt-4o-mini", "imagesFound": 4, "imagesDescribed": 2 }
}
```

Response (blocked for safety — requires confirmation):

```json
{ "success": true, "blockedForSafety": true, "requiresConfirmation": true, "sensitiveCategories": ["Credit/Debit Card Number"], "summaryText": "..." }
```

### `POST /api/ask-question`

Ask a follow-up question about a page you already summarized. Send the `contextForQA` object returned by `/api/process-page`.

Request body:

```json
{
  "url": "https://example.com/article",
  "question": "What is the main topic?",
  "pageContext": { "url": "...", "title": "...", "summary": "...", "text": "..." }
}
```

Response:

```json
{ "success": true, "answer": "...", "audioUrls": ["https://..."] }
```
