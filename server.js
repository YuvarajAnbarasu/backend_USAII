require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const googleTTS = require('google-tts-api');
const ai = require('./ai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// HELPERS
// ==========================================

const domainBlocklist = [
    'bankofamerica.com',
    'chase.com',
    'wellsfargo.com',
    'citi.com',
    'capitalone.com',
    'usbank.com',
    'paypal.com',
    'venmo.com',
    'mint.com',
    'healthcare.gov',
    'mychart.com',
    'login.gov',
    'accounts.google.com',
    'signin.aws.amazon.com',
];

function isBlockedDomain(hostname) {
    const host = hostname.toLowerCase();
    return domainBlocklist.some((domain) => host === domain || host.endsWith('.' + domain));
}

function resolveImageUrl(src, pageUrl) {
    if (!src || src.startsWith('data:')) return src;
    try {
        return new URL(src, pageUrl).href;
    } catch {
        return src;
    }
}

function generateTTS(text) {
    try {
        const chunks = googleTTS.getAllAudioUrls(text, {
            lang: 'en',
            slow: false,
            host: 'https://translate.google.com',
            splitPunct: ',.?',
        });
        return chunks.map((chunk) => (typeof chunk === 'string' ? chunk : chunk.url)).filter(Boolean);
    } catch (err) {
        console.error('TTS generation failed:', err.message);
        return [];
    }
}

function isTrackingImage($, element) {
    const width = parseInt($(element).attr('width'), 10);
    const height = parseInt($(element).attr('height'), 10);
    if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) return true;
    const src = ($(element).attr('src') || '').toLowerCase();
    if (src.includes('pixel') || src.includes('tracker') || src.includes('1x1')) return true;
    return false;
}

// ==========================================
// MIDDLEWARE
// ==========================================

const verifySafeDomain = (req, res, next) => {
    const { url } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required for validation.' });

    try {
        const parsedUrl = new URL(url);
        if (isBlockedDomain(parsedUrl.hostname)) {
            return res.status(403).json({
                error: 'Access Denied: Confidential or financial domain detected.',
                isBlocked: true,
            });
        }
        next();
    } catch {
        return res.status(400).json({ error: 'Invalid URL provided.' });
    }
};

// ==========================================
// ROUTES
// ==========================================

app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        aiEnabled: ai.aiEnabled(),
        provider: ai.getProvider(),
        version: '1.0.0',
    });
});

app.post('/api/process-page', verifySafeDomain, async (req, res) => {
    const { html, url, userConfirmed } = req.body;

    if (!html) {
        return res.status(400).json({ error: 'HTML content is required.' });
    }

    try {
        const $ = cheerio.load(html);

        const extractedImages = [];
        $('img').each((_index, element) => {
            const rawSrc = $(element).attr('src');
            if (!rawSrc || isTrackingImage($, element)) return;
            const src = resolveImageUrl(rawSrc, url);
            const alt = $(element).attr('alt') || 'No alt text provided';
            extractedImages.push({ src, alt });
        });

        $('header, nav, button, footer, script, style, noscript, iframe, svg, form').remove();
        const pageTitle = $('title').first().text().trim();
        const cleanedText = $('body').text().replace(/\s+/g, ' ').trim();

        const sensitivity = ai.classifySensitiveContent(cleanedText);
        if (sensitivity.isSensitive && !userConfirmed) {
            const warning =
                'I detected what looks like confidential information on this page ' +
                `(${sensitivity.categories.join(', ')}). For your safety I will not read or ` +
                'summarize it unless you explicitly confirm. You stay in control of this content.';
            return res.status(200).json({
                success: true,
                blockedForSafety: true,
                requiresConfirmation: true,
                sensitiveCategories: sensitivity.categories,
                originalUrl: url,
                pageTitle,
                summaryText: warning,
                audioUrls: generateTTS(warning),
                imagesToProcess: [],
                metadata: { extractedTextLength: cleanedText.length, imagesFound: 0 },
            });
        }

        const [summary, describedImages] = await Promise.all([
            ai.summarizePage(cleanedText, { url, title: pageTitle }),
            ai.describeImages(extractedImages),
        ]);

        const aiSummaryText = summary.readAloud || summary.summary;
        const audioUrls = generateTTS(aiSummaryText);

        return res.status(200).json({
            success: true,
            originalUrl: url,
            pageTitle,
            pageType: summary.pageType,
            sections: summary.sections,
            summaryText: aiSummaryText,
            fullSummary: summary.summary,
            audioUrls,
            imagesToProcess: describedImages,
            contextForQA: {
                url,
                title: pageTitle,
                summary: summary.summary,
                text: cleanedText.slice(0, 8000),
            },
            metadata: {
                aiEnabled: ai.aiEnabled(),
                model: summary.model,
                extractedTextLength: cleanedText.length,
                imagesFound: extractedImages.length,
                imagesDescribed: describedImages.filter((i) => i.descriptionSource === 'vision').length,
            },
        });
    } catch (error) {
        console.error('Processing Error:', error);
        res.status(500).json({ error: 'Failed to process the page content.' });
    }
});

app.post('/api/ask-question', verifySafeDomain, async (req, res) => {
    const { question, pageContext } = req.body;

    if (!question || !question.trim()) {
        return res.status(400).json({ error: 'A question is required.' });
    }

    if (!pageContext || !pageContext.text) {
        return res.status(400).json({ error: 'Page context is required. Summarize the page first.' });
    }

    try {
        const sensitivity = ai.classifySensitiveContent(pageContext.text);
        if (sensitivity.isSensitive) {
            const warning =
                'I cannot answer questions about this page because it may contain confidential information.';
            return res.status(200).json({
                success: true,
                blockedForSafety: true,
                answer: warning,
                audioUrls: generateTTS(warning),
            });
        }

        const result = await ai.answerQuestion(question, pageContext);
        const audioUrls = generateTTS(result.answer);

        return res.status(200).json({
            success: true,
            answer: result.answer,
            audioUrls,
            metadata: { model: result.model, aiEnabled: ai.aiEnabled() },
        });
    } catch (error) {
        console.error('Question Error:', error);
        res.status(500).json({ error: 'Failed to answer the question.' });
    }
});

app.listen(PORT, () => {
    console.log(`Vision Assist Backend running on http://localhost:${PORT}`);
});
