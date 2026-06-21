const DEFAULT_BACKEND = 'http://localhost:3001';

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND });
  return (backendUrl || DEFAULT_BACKEND).replace(/\/$/, '');
}

async function checkHealth() {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/health`, { method: 'GET' });
  if (!res.ok) throw new Error('Backend unavailable');
  return res.json();
}

async function processPage({ url, html, userConfirmed = false }) {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/process-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, html, userConfirmed }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Failed to process page');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function askQuestion({ question, pageContext }) {
  const base = await getBackendUrl();
  const res = await fetch(`${base}/api/ask-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, pageContext, url: pageContext.url }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Failed to answer question');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
