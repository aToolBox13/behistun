// Behistun — content.js

// ── Always re-register listeners ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'translate') { window.__behistunSettings = msg.settings; behistunRun(msg.settings); }
  else if (msg.action === 'reset') { window.__behistunSettings = null; behistunReset(); }
});
window.addEventListener('behistun:translate', e => { window.__behistunSettings = e.detail; behistunRun(e.detail); });

if (!window.__behistunLoaded) {
  window.__behistunLoaded = true;
  window.__behistunState = {
    WORKER: 'https://behistun-translate.behistun.workers.dev',
    CONCURRENCY: 10,
    saved: new Map(),
    tip: null,
    lastUrl: location.href,
  };

  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  function onNav() {
    const st = window.__behistunState;
    if (location.href !== st.lastUrl && window.__behistunSettings) {
      st.lastUrl = location.href;
      setTimeout(() => { behistunReset(true); behistunRun(window.__behistunSettings); }, 900);
    }
  }
  history.pushState    = (...a) => { _push(...a);    onNav(); };
  history.replaceState = (...a) => { _replace(...a); onNav(); };
  window.addEventListener('popstate', onNav);

  if (window.__behistunPending) {
    window.__behistunSettings = window.__behistunPending;
    behistunRun(window.__behistunPending);
    window.__behistunPending = null;
  }
}

async function behistunRun(s) {
  const st = window.__behistunState;
  behistunShowLoader(s.targetLangName);
  try {
    const blocks = behistunGetBlocks();

    if (!blocks.length) {
      behistunHideLoader();
      behistunShowError('No translatable text found on this page.');
      return;
    }

    for (let i = 0; i < blocks.length; i += st.CONCURRENCY) {
      await behistunTranslateBatch(blocks.slice(i, i + st.CONCURRENCY), s);
    }

    if (st.saved.size === 0) {
      behistunHideLoader();
      behistunShowError('Translation returned no results. The Worker may be down or the API key invalid — check https://behistun-translate.behistun.workers.dev in your browser to confirm it responds.');
      return;
    }

    behistunInjectRestore();
    if (s.features?.vocab) behistunInitTip();
    if (s.features?.rtl && s.targetDir === 'rtl') document.body.dir = 'rtl';
  } catch (e) {
    console.error('[Behistun]', e);
    behistunShowError(`Error: ${e.message}`);
  } finally {
    behistunHideLoader();
  }
}

function behistunGetBlocks() {
  return [...document.querySelectorAll('h1,h2,h3,h4,p,li,td,th,blockquote,figcaption')]
    .filter(el => {
      const t = el.innerText?.trim();
      if (!t || t.length < 15 || t.length > 2000) return false;
      if (el.dataset.behistun) return false;
      if (el.closest('.behistun-restore,.behistun-tip,.behistun-error,script,style,code,pre,[contenteditable]')) return false;

      // Skip hidden elements
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

      // Skip elements with very small dimensions (tooltips, hidden overlays)
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 10) return false;

      // Skip elements inside known tooltip/overlay/popup patterns
      if (el.closest('[role="tooltip"],[role="dialog"],[role="menu"],[role="listbox"],[aria-hidden="true"],[data-tippy-root],[data-floating-ui-portal]')) return false;

      // Skip elements that are positioned absolutely/fixed with small size (tooltips)
      const parent = el.parentElement;
      if (parent) {
        const ps = window.getComputedStyle(parent);
        if ((ps.position === 'absolute' || ps.position === 'fixed') && rect.width < 300) return false;
      }

      return true;
    });
}

async function behistunTranslateBatch(elements, s) {
  const st = window.__behistunState;
  const texts = elements.map(el => el.innerText.trim()).filter(t => t.length > 0);

  if (!texts.length) return;

  console.log('[Behistun] Sending batch:', { count: texts.length, target: s.targetLang, sample: texts[0]?.slice(0, 50) });

  let translations;
  try {
    const payload = {
      q: texts,
      target: s.targetLang,
      source: 'en',
      format: 'text',
    };

    console.log('[Behistun] Payload:', JSON.stringify(payload).slice(0, 200));

    const res = await fetch(st.WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    console.log('[Behistun] Worker response:', res.status, responseText.slice(0, 300));

    if (!res.ok) {
      behistunShowError(`Worker error ${res.status}: ${responseText}`);
      return;
    }

    const data = JSON.parse(responseText);

    if (data.error) {
      behistunShowError(`Google API error ${data.error.code}: ${data.error.message}`);
      return;
    }

    translations = data.data?.translations?.map(t => t.translatedText) || [];
  } catch (e) {
    behistunShowError(`Network error: ${e.message}`);
    return;
  }

  // Map translations back — only use elements that had non-empty text
  let ti = 0;
  elements.forEach((el) => {
    const text = el.innerText.trim();
    if (!text.length) return;
    const translated = translations[ti++];
    if (!translated || translated === text) return;
    const origHTML = el.innerHTML;
    st.saved.set(el, origHTML);
    el.dataset.behistun = '1';

    if (s.features?.bilingual) {
      behistunRenderBi(el, origHTML, translated, s);
    } else {
      // Non-bilingual: cleanly replace just the text content, preserving tag structure
      el.innerText = translated;
    }
  });
}

function behistunRenderText(text, vocab) {
  let html = besc(text);
  if (vocab) html = html.replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ]{7,})\b/g,
    (_,w) => `<span class="bh-word" data-w="${besc(w)}">${besc(w)}</span>`);
  return html;
}

function behistunRenderBi(el, origHTML, translated, s) {
  const dir  = s.targetDir === 'rtl' ? 'dir="rtl"' : '';
  const code = s.targetLang.toUpperCase().slice(0,2);
  const w    = document.createElement('div');
  w.className = 'behistun-bi';
  w.innerHTML = `
    <div class="bh-orig"><span class="bh-badge bh-en">EN</span>${origHTML}</div>
    <div class="bh-tr" ${dir}><span class="bh-badge bh-tl">${besc(code)}</span>${behistunRenderText(translated, s.features?.vocab)}</div>`;
  el.innerHTML = ''; el.appendChild(w);
}

function behistunInjectRestore() {
  document.querySelector('.behistun-restore')?.remove();
  const btn = document.createElement('button');
  btn.className = 'behistun-restore';
  btn.textContent = 'Restore';
  btn.addEventListener('click', () => { window.__behistunSettings = null; behistunReset(); });
  document.body.appendChild(btn);
}

function behistunInitTip() {
  const st = window.__behistunState;
  if (st.tip) return;
  st.tip = document.createElement('div');
  st.tip.className = 'behistun-tip';
  document.body.appendChild(st.tip);
  document.addEventListener('mouseover', e => {
    const w = e.target.closest('.bh-word');
    if (!w) { st.tip.classList.remove('show'); return; }
    st.tip.innerHTML = `<div class="bh-tw">${besc(w.dataset.w)}</div><div class="bh-td">Key vocabulary — look this up to deepen understanding.</div>`;
    st.tip.classList.add('show'); behistunPlaceTip(e);
  });
  document.addEventListener('mousemove', e => { if (st.tip.classList.contains('show')) behistunPlaceTip(e); });
  document.addEventListener('mouseout',  e => { if (!e.target.closest('.bh-word')) st.tip.classList.remove('show'); });
}
function behistunPlaceTip(e) {
  const st = window.__behistunState;
  st.tip.style.left = Math.min(e.clientX+12, window.innerWidth-220)+'px';
  st.tip.style.top  = Math.max(e.clientY-65, 6)+'px';
}

function behistunShowError(msg) {
  document.getElementById('behistun-error')?.remove();
  const el = document.createElement('div');
  el.id = 'behistun-error';
  el.className = 'behistun-error';
  el.innerHTML = `
    <div class="be-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FCD116" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
    <div class="be-msg">${besc(msg)}</div>
    <button class="be-close" onclick="document.getElementById('behistun-error').remove()">✕</button>`;
  document.body.appendChild(el);
}

function behistunReset(keepNav = false) {
  const st = window.__behistunState;
  if (!st) return;
  for (const [el, html] of st.saved) { el.innerHTML = html; delete el.dataset.behistun; }
  st.saved.clear();
  document.querySelector('.behistun-restore')?.remove();
  document.getElementById('behistun-error')?.remove();
  document.body.dir = '';
  st.tip?.remove(); st.tip = null;
}

function behistunShowLoader(lang) {
  behistunHideLoader();
  const o = document.createElement('div');
  o.id = 'behistun-ov';
  o.innerHTML = `
    <div class="bh-loader">
      <div class="bh-ring">
        <svg viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="18" stroke="rgba(255,255,255,0.1)" stroke-width="3.5"/>
          <circle cx="22" cy="22" r="18" stroke-dasharray="30 83" stroke-dashoffset="0"   stroke-width="3.5" stroke-linecap="round" stroke="#1EB53A"/>
          <circle cx="22" cy="22" r="18" stroke-dasharray="30 83" stroke-dashoffset="-28" stroke-width="3.5" stroke-linecap="round" stroke="#FCD116"/>
          <circle cx="22" cy="22" r="18" stroke-dasharray="30 83" stroke-dashoffset="-56" stroke-width="3.5" stroke-linecap="round" stroke="#00A3DD"/>
        </svg>
      </div>
      <div class="bh-loader-title">Translating to ${besc(lang)}</div>
      <div class="bh-loader-sub">Behistun · Google Translate · 249 languages</div>
    </div>`;
  document.body.appendChild(o);
}
function behistunHideLoader() { document.getElementById('behistun-ov')?.remove(); }

function besc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
