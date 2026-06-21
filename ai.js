// ==========================================
// AI LAYER — Vision Assist
// Supports Google Gemini and OpenAI.
// ==========================================

const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 12000);
const MAX_IMAGES = Number(process.env.MAX_IMAGES || 5);

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || OPENAI_MODEL;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function getProvider() {
    if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER.toLowerCase();
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.OPENAI_API_KEY) return 'openai';
    return null;
}

const aiEnabled = () => Boolean(getProvider());

function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) return null;
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getGeminiModel(systemInstruction) {
    if (!process.env.GEMINI_API_KEY) return null;
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    return genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction,
        generationConfig: { temperature: 0.3 },
    });
}

async function fetchImageAsBase64(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'VisionAssist/1.0' },
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { data: buffer.toString('base64'), mimeType };
}

// ------------------------------------------------------------------
// SAFEGUARD: content-level sensitive-data classifier
// ------------------------------------------------------------------
const SENSITIVE_PATTERNS = [
    { label: 'Social Security Number', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
    { label: 'Credit/Debit Card Number', regex: /\b(?:\d[ -]*?){13,16}\b/ },
    { label: 'CVV / Security Code', regex: /\b(?:cvv|cvc|security code)\b[:\s]*\d{3,4}\b/i },
    { label: 'Bank Routing/Account', regex: /\b(?:routing|account)\s*(?:number|no\.?|#)?[:\s]*\d{6,17}\b/i },
    { label: 'Account Balance', regex: /\b(?:balance|available funds)\b[:\s]*\$?\d[\d,]*\.?\d*/i },
    { label: 'API Key / Secret', regex: /\b(?:sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]\s*\S+)\b/i },
];

function classifySensitiveContent(text) {
    const matches = [];
    for (const { label, regex } of SENSITIVE_PATTERNS) {
        if (regex.test(text)) matches.push(label);
    }
    return { isSensitive: matches.length > 0, categories: matches };
}

// ------------------------------------------------------------------
// Shared prompts
// ------------------------------------------------------------------
const SUMMARY_SYSTEM = [
    'You are an assistive screen-reader AI for blind and visually impaired users.',
    'Goal: help the user understand a web page quickly WITHOUT reading every line.',
    'Be concise, neutral, and spoken-word friendly (no markdown, no emojis).',
    'Identify the page type, list the main navigable sections, and write a short',
    'spoken overview the user can listen to first. End by offering next actions.',
].join(' ');

const QA_SYSTEM = [
    'You are an assistive screen-reader assistant for blind and visually impaired users.',
    'Answer questions about the web page using ONLY the provided page context.',
    'Be concise and spoken-word friendly (no markdown, no emojis).',
    'If the answer is not in the context, say you cannot find that information on this page.',
    'Never invent facts, prices, or personal data.',
].join(' ');

const VISION_SYSTEM =
    'You write concise alt text for blind users. One sentence, describe what is shown plainly. No "image of"/"picture of" prefixes.';

function buildPageContextBlock(text, context = {}) {
    return [
        context.url ? `URL: ${context.url}` : '',
        context.title ? `Title: ${context.title}` : '',
        '',
        'Page text:',
        text || '(no readable text found)',
    ].filter(Boolean).join('\n');
}

function parseSummaryJson(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = { summary: raw, pageType: 'unknown', sections: [], readAloud: raw };
    }
    return {
        pageType: parsed.pageType || 'unknown',
        sections: Array.isArray(parsed.sections) ? parsed.sections : [],
        summary: parsed.summary || '',
        readAloud: parsed.readAloud || parsed.summary || '',
    };
}

const SUMMARY_JSON_INSTRUCTION =
    '\n\nReturn ONLY JSON with this shape: ' +
    '{"pageType": string, "sections": string[], "summary": string, "readAloud": string}. ' +
    '"summary" is 1-2 sentences. "readAloud" is what the screen reader should say first ' +
    '(<= 60 words) and must end with a question offering the next step.';

// ------------------------------------------------------------------
// Provider: OpenAI
// ------------------------------------------------------------------
async function openaiSummarize(text, context) {
    const response = await getOpenAIClient().chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SUMMARY_SYSTEM },
            { role: 'user', content: buildPageContextBlock(text, context) + SUMMARY_JSON_INSTRUCTION },
        ],
    });
    const parsed = parseSummaryJson(response.choices?.[0]?.message?.content || '{}');
    return { ...parsed, model: OPENAI_MODEL };
}

async function openaiAnswerQuestion(question, pageContext) {
    const user = [
        pageContext.url ? `URL: ${pageContext.url}` : '',
        pageContext.title ? `Title: ${pageContext.title}` : '',
        pageContext.summary ? `Summary: ${pageContext.summary}` : '',
        '',
        'Page content:',
        pageContext.text || '(no page text available)',
        '',
        `User question: ${question}`,
    ].join('\n');

    const response = await getOpenAIClient().chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 250,
        messages: [
            { role: 'system', content: QA_SYSTEM },
            { role: 'user', content: user },
        ],
    });
    return {
        answer: (response.choices?.[0]?.message?.content || '').trim(),
        model: OPENAI_MODEL,
    };
}

async function openaiDescribeImage(src) {
    const response = await getOpenAIClient().chat.completions.create({
        model: OPENAI_VISION_MODEL,
        temperature: 0.2,
        max_tokens: 120,
        messages: [
            { role: 'system', content: VISION_SYSTEM },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe this image for a screen reader.' },
                    { type: 'image_url', image_url: { url: src } },
                ],
            },
        ],
    });
    return (response.choices?.[0]?.message?.content || '').trim();
}

// ------------------------------------------------------------------
// Provider: Gemini
// ------------------------------------------------------------------
async function geminiSummarize(text, context) {
    const model = getGeminiModel(SUMMARY_SYSTEM);
    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: buildPageContextBlock(text, context) + SUMMARY_JSON_INSTRUCTION }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    });
    const raw = result.response.text();
    const parsed = parseSummaryJson(raw);
    return { ...parsed, model: GEMINI_MODEL };
}

async function geminiAnswerQuestion(question, pageContext) {
    const model = getGeminiModel(QA_SYSTEM);
    const prompt = [
        pageContext.url ? `URL: ${pageContext.url}` : '',
        pageContext.title ? `Title: ${pageContext.title}` : '',
        pageContext.summary ? `Summary: ${pageContext.summary}` : '',
        '',
        'Page content:',
        pageContext.text || '(no page text available)',
        '',
        `User question: ${question}`,
    ].join('\n');

    const result = await model.generateContent(prompt);
    return { answer: result.response.text().trim(), model: GEMINI_MODEL };
}

async function geminiDescribeImage(src) {
    const image = await fetchImageAsBase64(src);
    const model = getGeminiModel(VISION_SYSTEM);
    const result = await model.generateContent([
        'Describe this image for a screen reader.',
        { inlineData: { mimeType: image.mimeType, data: image.data } },
    ]);
    return result.response.text().trim();
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------
async function summarizePage(cleanedText, context = {}) {
    const text = (cleanedText || '').slice(0, MAX_INPUT_CHARS);
    if (!aiEnabled()) return mockSummary(text);

    const provider = getProvider();
    try {
        if (provider === 'gemini') return await geminiSummarize(text, context);
        if (provider === 'openai') return await openaiSummarize(text, context);
        throw new Error(`Unknown AI provider: ${provider}`);
    } catch (err) {
        console.error('summarizePage fell back to mock:', err.message);
        const fallback = mockSummary(text);
        fallback.model = `mock (fallback: ${err.message})`;
        return fallback;
    }
}

async function answerQuestion(question, pageContext = {}) {
    const q = (question || '').trim();
    if (!q) return { answer: 'I did not catch a question. Please try again.', model: 'none' };

    if (!aiEnabled()) {
        return {
            answer: 'The AI is not configured. Add a GEMINI_API_KEY or OPENAI_API_KEY to the server .env file.',
            model: 'mock',
        };
    }

    const provider = getProvider();
    try {
        let result;
        if (provider === 'gemini') result = await geminiAnswerQuestion(q, pageContext);
        else if (provider === 'openai') result = await openaiAnswerQuestion(q, pageContext);
        else throw new Error(`Unknown AI provider: ${provider}`);

        return {
            answer: result.answer || 'I could not form an answer. Please try rephrasing your question.',
            model: result.model,
        };
    } catch (err) {
        console.error('answerQuestion failed:', err.message);
        return { answer: 'Sorry, I had trouble answering that question. Please try again.', model: `error (${err.message})` };
    }
}

async function describeImages(images = []) {
    if (!Array.isArray(images) || images.length === 0) return [];

    const needsVision = (img) => {
        const alt = (img.alt || '').trim().toLowerCase();
        const src = (img.src || '').trim();
        if (!src || src.startsWith('data:')) return false;
        return !alt || alt === 'no alt text provided' || alt.length < 4;
    };

    const provider = getProvider();
    let budget = MAX_IMAGES;

    const tasks = images.map(async (img) => {
        if (!needsVision(img)) {
            return { ...img, description: img.alt, descriptionSource: 'alt' };
        }
        if (!aiEnabled() || budget <= 0) {
            return {
                ...img,
                description: aiEnabled() ? 'Image not described (limit reached).' : 'Image description unavailable (AI not configured).',
                descriptionSource: 'skipped',
            };
        }
        budget -= 1;
        try {
            let description;
            if (provider === 'gemini') description = await geminiDescribeImage(img.src);
            else if (provider === 'openai') description = await openaiDescribeImage(img.src);
            else throw new Error('No AI provider configured');
            return { ...img, description, descriptionSource: 'vision' };
        } catch (err) {
            return { ...img, description: 'Could not describe this image.', descriptionSource: 'error', error: err.message };
        }
    });

    return Promise.all(tasks);
}

function mockSummary(text) {
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    return {
        pageType: 'unknown (mock)',
        sections: [],
        summary: `This page has roughly ${words} words of readable content.`,
        readAloud:
            `I found about ${words} words on this page. ` +
            'No AI API key is configured, so this is a placeholder summary. ' +
            'Would you like me to read the full text instead?',
        model: 'mock',
    };
}

module.exports = {
    summarizePage,
    describeImages,
    classifySensitiveContent,
    answerQuestion,
    aiEnabled,
    getProvider,
};
