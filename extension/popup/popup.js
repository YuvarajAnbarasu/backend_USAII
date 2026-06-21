let pageContext = null;
let lastImages = [];

const els = {};

function initElements() {
  return {
    status: document.getElementById('status'),
    backendStatus: document.getElementById('backend-status'),
    btnSummarize: document.getElementById('btn-summarize'),
    btnAsk: document.getElementById('btn-ask'),
    btnStop: document.getElementById('btn-stop'),
    confirmationPanel: document.getElementById('confirmation-panel'),
    confirmMessage: document.getElementById('confirm-message'),
    btnConfirm: document.getElementById('btn-confirm'),
    btnCancel: document.getElementById('btn-cancel'),
    resultsPanel: document.getElementById('results-panel'),
    pageType: document.getElementById('page-type'),
    pageTitle: document.getElementById('page-title'),
    summaryText: document.getElementById('summary-text'),
    sectionsBlock: document.getElementById('sections-block'),
    sectionsList: document.getElementById('sections-list'),
    imagesBlock: document.getElementById('images-block'),
    imagesList: document.getElementById('images-list'),
    btnDescribeAll: document.getElementById('btn-describe-all'),
    qaPanel: document.getElementById('qa-panel'),
    btnMic: document.getElementById('btn-mic'),
    questionInput: document.getElementById('question-input'),
    btnSubmitQuestion: document.getElementById('btn-submit-question'),
    answerText: document.getElementById('answer-text'),
    linkOptions: document.getElementById('link-options'),
  };
}

function setStatus(text) {
  if (els.status) els.status.textContent = text;
}

function setLoading(isLoading) {
  if (els.btnSummarize) els.btnSummarize.disabled = isLoading;
  if (els.btnAsk) els.btnAsk.disabled = isLoading || !pageContext;
}

function showPanel(panel) {
  if (panel) panel.classList.remove('hidden');
}

function hidePanel(panel) {
  if (panel) panel.classList.add('hidden');
}

async function checkBackendOnLoad() {
  if (!els.backendStatus) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const base = await getBackendUrl();
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('Backend unavailable');
    const health = await res.json();
    els.backendStatus.textContent = health.aiEnabled
      ? 'Backend connected — AI enabled'
      : 'Backend connected — AI not configured (mock mode)';
    els.backendStatus.className = 'backend-status ok';
  } catch {
    els.backendStatus.textContent = 'Backend offline — run: npm run dev (localhost:3001)';
    els.backendStatus.className = 'backend-status error';
  }
}

function renderResults(data) {
  if (els.pageType) els.pageType.textContent = data.pageType || 'Unknown';
  if (els.pageTitle) els.pageTitle.textContent = data.pageTitle || data.originalUrl || '—';
  if (els.summaryText) els.summaryText.textContent = data.summaryText || data.fullSummary || '';

  if (els.sectionsList) {
    els.sectionsList.innerHTML = '';
    if (data.sections && data.sections.length > 0) {
      showPanel(els.sectionsBlock);
      data.sections.forEach((section) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = section;
        btn.addEventListener('click', () => jumpToSection(section));
        li.appendChild(btn);
        els.sectionsList.appendChild(li);
      });
    } else {
      hidePanel(els.sectionsBlock);
    }
  }

  if (els.imagesList) {
    els.imagesList.innerHTML = '';
    const images = data.imagesToProcess || [];
    lastImages = images;
    const describable = images.filter((img) => img.description && img.descriptionSource !== 'skipped');

    if (images.length > 0) {
      showPanel(els.imagesBlock);
      if (els.btnDescribeAll) {
        els.btnDescribeAll.disabled = describable.length === 0;
        els.btnDescribeAll.textContent =
          describable.length > 0
            ? `Read all descriptions (${describable.length})`
            : 'No descriptions available';
      }

      images.forEach((img) => {
        const li = document.createElement('li');
        li.className = 'image-item';

        const text = document.createElement('span');
        text.className = 'image-text';
        text.textContent = img.description || img.alt || 'Image on page';

        const listenBtn = document.createElement('button');
        listenBtn.type = 'button';
        listenBtn.className = 'btn-image-listen';
        listenBtn.textContent = 'Listen';
        listenBtn.disabled = !img.description || img.descriptionSource === 'skipped';
        listenBtn.addEventListener('click', () => playImageDescription(img));

        li.appendChild(text);
        li.appendChild(listenBtn);
        els.imagesList.appendChild(li);
      });
    } else {
      hidePanel(els.imagesBlock);
    }
  }

  showPanel(els.resultsPanel);
  showPanel(els.qaPanel);
}

function handleProcessResult(result) {
  if (!result || !result.success) {
    if (result?.status === 403) {
      setStatus('This domain is blocked for your safety (banking, medical, or login site).');
    } else {
      setStatus(result?.error || 'Something went wrong.');
    }
    return;
  }

  const data = result.data;

  if (data.blockedForSafety && data.requiresConfirmation) {
    hidePanel(els.resultsPanel);
    if (els.confirmMessage) els.confirmMessage.textContent = data.summaryText;
    showPanel(els.confirmationPanel);
    playAudioUrls(data.audioUrls, data.summaryText, () => {
      if (els.btnStop) els.btnStop.disabled = false;
    });
    setStatus('Sensitive content detected — confirmation required.');
    return;
  }

  hidePanel(els.confirmationPanel);
  pageContext = data.contextForQA || {
    url: data.originalUrl,
    title: data.pageTitle,
    summary: data.fullSummary,
    text: '',
  };

  chrome.storage.local.set({ pageContext });
  renderResults(data);
  if (els.btnAsk) els.btnAsk.disabled = false;

  playAudioUrls(data.audioUrls, data.summaryText, () => {
    setStatus('Summary finished. Click Listen on any image to hear its description.');
  });
  if (els.btnStop) els.btnStop.disabled = false;

  setStatus(
    data.blockedForSafety
      ? 'Page blocked for safety.'
      : 'Summary ready. Jump to a section, ask a question, or listen to image descriptions.'
  );
}

function processPage(userConfirmed = false) {
  setLoading(true);
  hidePanel(els.confirmationPanel);
  setStatus(userConfirmed ? 'Processing with your confirmation…' : 'Analyzing page content…');

  chrome.runtime.sendMessage({ type: 'CAPTURE_AND_PROCESS', userConfirmed }, (result) => {
    setLoading(false);
    if (chrome.runtime.lastError) {
      setStatus('Extension background unavailable. Reload the extension at chrome://extensions.');
      return;
    }
    handleProcessResult(result);
  });
}

function jumpToSection(section) {
  setStatus(`Jumping to section: ${section}`);
  chrome.runtime.sendMessage({ type: 'JUMP_TO_SECTION', section }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus('Could not reach the page. Refresh the tab and try again.');
      return;
    }
    if (res?.success) {
      setStatus(`Jumped to: ${res.found}`);
      playAudioUrls([], `Jumped to section: ${res.found}`);
      if (els.btnStop) els.btnStop.disabled = false;
    } else {
      setStatus(res?.error || 'Could not find that section on this page.');
    }
  });
}

function playImageDescription(img) {
  const text = img.description || img.alt;
  if (!text) return;
  if (els.btnStop) els.btnStop.disabled = false;
  setStatus('Reading image description…');
  playAudioUrls([], text, () => setStatus('Image description finished.'));
}

function playAllImageDescriptions() {
  const describable = lastImages.filter((img) => img.description && img.descriptionSource !== 'skipped');
  if (describable.length === 0) {
    setStatus('No image descriptions available.');
    return;
  }
  if (els.btnStop) els.btnStop.disabled = false;
  setStatus(`Reading ${describable.length} image description${describable.length === 1 ? '' : 's'}…`);
  const combined = describable.map((img) => img.description).join(' Next image: ');
  playAudioUrls([], combined, () => setStatus('All image descriptions finished.'));
}

async function submitQuestion(question) {
  const q = (question || '').trim();
  if (!q) {
    setStatus('Please enter or speak a question.');
    return;
  }
  if (!pageContext) {
    setStatus('Summarize the page first, then ask a question.');
    return;
  }

  setLoading(true);
  setStatus('Thinking…');
  if (els.answerText) els.answerText.classList.add('hidden');

  try {
    const data = await askQuestion({ question: q, pageContext });
    if (els.answerText) {
      els.answerText.textContent = data.answer;
      els.answerText.classList.remove('hidden');
    }
    setStatus('Answer ready.');
    playAudioUrls(data.audioUrls, data.answer, () => setStatus('Answer finished.'));
    if (els.btnStop) els.btnStop.disabled = false;
  } catch (err) {
    setStatus(err.message || 'Failed to get an answer.');
  } finally {
    setLoading(false);
  }
}

function startVoiceInput() {
  if (els.btnMic) els.btnMic.classList.add('listening');
  setStatus('Opening voice input window…');

  chrome.runtime.sendMessage({ type: 'OPEN_VOICE_INPUT' }, (res) => {
    if (chrome.runtime.lastError || !res?.success) {
      if (els.btnMic) els.btnMic.classList.remove('listening');
      setStatus(res?.error || 'Could not open voice input. Reload the extension.');
    } else {
      setStatus('Voice window opened — click Allow microphone there.');
    }
  });
}

function handleVoiceTranscript(transcript) {
  if (els.btnMic) els.btnMic.classList.remove('listening');
  if (els.questionInput) els.questionInput.value = transcript;
  showPanel(els.qaPanel);
  submitQuestion(transcript);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'VOICE_TRANSCRIPT' && message.transcript) {
    handleVoiceTranscript(message.transcript);
  }
  if (message.type === 'VOICE_ERROR' && message.error) {
    if (els.btnMic) els.btnMic.classList.remove('listening');
    setStatus(message.error);
  }
});

function bindEvents() {
  els.btnSummarize?.addEventListener('click', () => processPage(false));
  els.btnConfirm?.addEventListener('click', () => processPage(true));
  els.btnCancel?.addEventListener('click', () => {
    hidePanel(els.confirmationPanel);
    setStatus('Cancelled. No content was read.');
  });
  els.btnAsk?.addEventListener('click', () => {
    showPanel(els.qaPanel);
    els.questionInput?.focus();
  });
  els.btnStop?.addEventListener('click', () => {
    stopAudio();
    if (els.btnMic) els.btnMic.classList.remove('listening');
    setStatus('Stopped.');
  });
  els.btnDescribeAll?.addEventListener('click', playAllImageDescriptions);
  els.btnMic?.addEventListener('click', startVoiceInput);
  els.btnSubmitQuestion?.addEventListener('click', () => submitQuestion(els.questionInput?.value));
  els.questionInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitQuestion(els.questionInput.value);
  });
  els.linkOptions?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

function boot() {
  try {
    Object.assign(els, initElements());
    bindEvents();

    chrome.storage.local.get(['pageContext', 'pendingAction', 'pendingVoiceTranscript'], (stored) => {
      if (stored.pageContext) {
        pageContext = stored.pageContext;
        if (els.btnAsk) els.btnAsk.disabled = false;
        showPanel(els.qaPanel);
      }
      if (stored.pendingVoiceTranscript) {
        const transcript = stored.pendingVoiceTranscript;
        chrome.storage.local.remove('pendingVoiceTranscript');
        handleVoiceTranscript(transcript);
      }
      if (stored.pendingAction === 'ask') {
        chrome.storage.local.remove('pendingAction');
        showPanel(els.qaPanel);
        if (pageContext) startVoiceInput();
      }
    });

    checkBackendOnLoad();
  } catch (err) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = `Extension error: ${err.message}. Reload at chrome://extensions.`;
    }
    console.error('Vision Assist popup failed to start:', err);
  }
}

document.addEventListener('DOMContentLoaded', boot);
