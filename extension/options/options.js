const DEFAULT_BACKEND = 'http://localhost:3001';

const form = document.getElementById('settings-form');
const input = document.getElementById('backend-url');
const saved = document.getElementById('saved');

chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND }, (data) => {
  input.value = data.backendUrl || DEFAULT_BACKEND;
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const backendUrl = input.value.trim().replace(/\/$/, '');
  chrome.storage.sync.set({ backendUrl }, () => {
    saved.textContent = 'Settings saved.';
    setTimeout(() => { saved.textContent = ''; }, 2500);
  });
});
