const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const statusEl = document.getElementById('status');
const btnStart = document.getElementById('btn-start');
const btnCancel = document.getElementById('btn-cancel');
const linkSettings = document.getElementById('link-settings');

let recognition = null;
let listening = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'error' : '';
}

async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return true;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
  return true;
}

function stopListening() {
  listening = false;
  document.body.classList.remove('listening');
  if (recognition) {
    try { recognition.stop(); } catch { /* ignore */ }
    recognition = null;
  }
  btnStart.disabled = false;
  btnStart.textContent = 'Allow microphone & start listening';
}

function sendTranscript(transcript) {
  chrome.storage.local.set({ pendingVoiceTranscript: transcript });
  chrome.runtime.sendMessage({ type: 'VOICE_TRANSCRIPT', transcript });
  window.close();
}

function sendError(message) {
  chrome.runtime.sendMessage({ type: 'VOICE_ERROR', error: message });
}

async function startListening() {
  if (listening) {
    stopListening();
    return;
  }

  if (!SpeechRecognition) {
    setStatus('Speech recognition is not supported in this browser.', true);
    return;
  }

  btnStart.disabled = true;
  setStatus('Requesting microphone access…');

  try {
    await requestMicrophone();
  } catch (err) {
    const msg =
      err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
        ? 'Microphone blocked. Click the link below to open Chrome settings and allow the microphone for Chrome.'
        : `Microphone error: ${err.message}`;
    setStatus(msg, true);
    btnStart.disabled = false;
    sendError(msg);
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    document.body.classList.add('listening');
    btnStart.disabled = false;
    btnStart.textContent = 'Stop listening';
    setStatus('Listening… speak your question now.');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      setStatus(`Heard: "${transcript}"`);
      sendTranscript(transcript);
    } else {
      setStatus('No speech detected. Try again.', true);
      stopListening();
    }
  };

  recognition.onerror = (event) => {
    const code = event.error || 'unknown';
    let msg = `Speech error: ${code}`;
    if (code === 'not-allowed') {
      msg = 'Microphone permission denied. Allow microphone for Chrome in settings.';
    } else if (code === 'no-speech') {
      msg = 'No speech detected. Click the button and try again.';
    } else if (code === 'aborted') {
      return;
    }
    setStatus(msg, true);
    stopListening();
    sendError(msg);
  };

  recognition.onend = () => {
    if (listening) {
      listening = false;
      document.body.classList.remove('listening');
      btnStart.textContent = 'Allow microphone & start listening';
    }
  };

  try {
    recognition.start();
  } catch (err) {
    setStatus(`Could not start: ${err.message}`, true);
    btnStart.disabled = false;
  }
}

btnStart.addEventListener('click', startListening);
btnCancel.addEventListener('click', () => {
  stopListening();
  window.close();
});

linkSettings.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://settings/content/microphone' });
});

setStatus('Ready. Click the button to begin.');
