const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function isSpeechRecognitionSupported() {
  return Boolean(SpeechRecognition);
}

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return true;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error(
        'Microphone blocked. Click the lock icon in Chrome\'s address bar, allow Microphone, then reload the page and try again.'
      );
    }
    throw new Error(`Microphone unavailable: ${err.message}`);
  }
}

async function listenForQuestion({ onResult, onError, onEnd }) {
  if (!SpeechRecognition) {
    onError(new Error('Speech recognition is not supported in this browser.'));
    return null;
  }

  try {
    await ensureMicrophonePermission();
  } catch (err) {
    onError(err);
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    onResult(transcript);
  };

  recognition.onerror = (event) => {
    const code = event.error || 'unknown';
    if (code === 'not-allowed') {
      onError(new Error('Microphone permission denied. Allow microphone access for Chrome and try again.'));
    } else if (code === 'no-speech') {
      onError(new Error('no-speech'));
    } else {
      onError(new Error(`Speech recognition error: ${code}`));
    }
  };

  recognition.onend = () => {
    if (onEnd) onEnd();
  };

  try {
    recognition.start();
  } catch (err) {
    onError(new Error(`Could not start speech recognition: ${err.message}`));
    return null;
  }

  return recognition;
}
