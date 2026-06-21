function scoreSectionMatch(headingText, sectionName) {
  const heading = headingText.toLowerCase().trim();
  const section = sectionName.toLowerCase().trim();
  if (!heading || !section) return 0;
  if (heading === section) return 100;
  if (heading.includes(section) || section.includes(heading)) return 85;

  const headingWords = heading.split(/\s+/).filter(Boolean);
  const sectionWords = section.split(/\s+/).filter(Boolean);
  let overlap = 0;
  for (const word of sectionWords) {
    if (word.length < 3) continue;
    if (headingWords.some((hw) => hw.includes(word) || word.includes(hw))) overlap += 1;
  }
  if (overlap > 0) return 50 + overlap * 10;

  return 0;
}

function findSectionHeading(sectionName) {
  const candidates = document.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, [role="heading"], main article h1, main article h2, section h2, section h3'
  );

  let best = null;
  let bestScore = 0;

  for (const el of candidates) {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const score = scoreSectionMatch(text, sectionName);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return bestScore >= 50 ? best : null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_HTML') {
    sendResponse({
      url: window.location.href,
      html: document.documentElement.outerHTML,
      title: document.title,
    });
    return false;
  }

  if (message.type === 'JUMP_TO_SECTION') {
    const target = findSectionHeading(message.section || '');

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.style.outline = '3px solid #4f8cff';
      target.style.outlineOffset = '2px';
      setTimeout(() => {
        target.style.outline = '';
        target.style.outlineOffset = '';
      }, 2500);
      sendResponse({ success: true, found: target.textContent.replace(/\s+/g, ' ').trim() });
    } else {
      sendResponse({
        success: false,
        error: `Could not find a heading matching "${message.section}". Try refreshing the page.`,
      });
    }
    return false;
  }

  return false;
});
