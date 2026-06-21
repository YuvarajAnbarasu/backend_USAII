const DEFAULT_BACKEND = 'http://localhost:3001';

const RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source):/i;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND }, (data) => {
    if (!data.backendUrl) {
      chrome.storage.sync.set({ backendUrl: DEFAULT_BACKEND });
    }
  });
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isRestrictedUrl(url) {
  return !url || RESTRICTED_URL.test(url);
}

async function capturePageFromTab(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_HTML' });
}

async function injectAndCapture(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  return capturePageFromTab(tabId);
}

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'summarize-page' || command === 'ask-question') {
      if (command === 'ask-question') {
        await chrome.storage.local.set({ pendingAction: 'ask' });
      }
      await chrome.action.openPopup();
    }
  } catch (err) {
    console.warn('Vision Assist: could not open popup from shortcut.', err.message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CAPTURE_AND_PROCESS') {
    (async () => {
      try {
        const tab = await getActiveTab();
        if (!tab?.id) throw new Error('No active tab found.');
        if (isRestrictedUrl(tab.url)) {
          sendResponse({
            success: false,
            error: 'Cannot summarize this page. Open a regular website (not Chrome settings or the Web Store).',
          });
          return;
        }

        let pageData;
        try {
          pageData = await capturePageFromTab(tab.id);
        } catch {
          try {
            pageData = await injectAndCapture(tab.id);
          } catch {
            throw new Error(
              'Could not read this page. Refresh the tab, then try again.'
            );
          }
        }

        if (!pageData?.html) {
          throw new Error('No page content was captured. Refresh the tab and try again.');
        }

        const base = await getBackendUrl();
        const res = await fetch(`${base}/api/process-page`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: pageData.url || tab.url,
            html: pageData.html,
            userConfirmed: message.userConfirmed || false,
          }),
        });

        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error('Backend returned an invalid response. Is the server running?');
        }

        if (!res.ok) {
          sendResponse({ success: false, error: data.error, status: res.status, data });
          return;
        }
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message || 'Unknown error' });
      }
    })();
    return true;
  }

  if (message.type === 'OPEN_VOICE_INPUT') {
    (async () => {
      try {
        await chrome.windows.create({
          url: chrome.runtime.getURL('voice/voice.html'),
          type: 'popup',
          width: 400,
          height: 320,
          focused: true,
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'JUMP_TO_SECTION') {
    (async () => {
      try {
        const tab = await getActiveTab();
        if (!tab?.id) {
          sendResponse({ success: false, error: 'No active tab.' });
          return;
        }

        let result;
        try {
          result = await chrome.tabs.sendMessage(tab.id, {
            type: 'JUMP_TO_SECTION',
            section: message.section,
          });
        } catch {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          result = await chrome.tabs.sendMessage(tab.id, {
            type: 'JUMP_TO_SECTION',
            section: message.section,
          });
        }
        sendResponse(result);
      } catch {
        sendResponse({ success: false, error: 'Could not jump to section. Refresh the page and try again.' });
      }
    })();
    return true;
  }

  return false;
});

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND });
  return (backendUrl || DEFAULT_BACKEND).replace(/\/$/, '');
}
