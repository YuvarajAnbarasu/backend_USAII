let currentAudio = null;
let queue = [];
let playing = false;
let fallbackText = '';
let onCompleteCallback = null;
let stopped = false;

function stopAudio() {
  stopped = true;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (typeof chrome !== 'undefined' && chrome.tts) {
    chrome.tts.stop();
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  queue = [];
  playing = false;
  fallbackText = '';
  onCompleteCallback = null;
}

function speakText(text, onComplete) {
  if (stopped) return;

  const done = () => {
    if (!stopped && onComplete) onComplete();
  };

  if (!text) {
    done();
    return;
  }

  if (typeof chrome !== 'undefined' && chrome.tts) {
    chrome.tts.speak(text, { rate: 1.0, enqueue: false }, () => {
      if (stopped) return;
      if (chrome.runtime.lastError) {
        speakWithBrowserTTS(text).then(done);
      } else {
        done();
      }
    });
    return;
  }

  speakWithBrowserTTS(text).then(done);
}

function speakWithBrowserTTS(text) {
  return new Promise((resolve) => {
    if (stopped || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

function playNext(onComplete) {
  if (stopped || queue.length === 0) {
    playing = false;
    if (!stopped && onComplete) onComplete();
    return;
  }

  playing = true;
  const url = queue.shift();
  currentAudio = new Audio(url);

  currentAudio.onended = () => playNext(onComplete);
  currentAudio.onerror = () => {
    queue = [];
    speakText(fallbackText, onComplete);
  };
  currentAudio.play().catch(() => {
    queue = [];
    speakText(fallbackText, onComplete);
  });
}

function playAudioUrls(urls, textFallback, onComplete) {
  stopAudio();
  stopped = false;
  onCompleteCallback = onComplete;
  fallbackText = textFallback || '';

  const normalized = (urls || [])
    .map((item) => (typeof item === 'string' ? item : item?.url))
    .filter(Boolean);

  if (normalized.length > 0) {
    queue = normalized;
    playNext(onCompleteCallback);
    return;
  }

  speakText(fallbackText, onComplete);
}

function isPlaying() {
  return playing;
}
