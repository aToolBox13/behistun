// Behistun — popup.js
const $ = id => document.getElementById(id);
const RTL_LANGS = new Set(['ar','fa','he','ur','ps','sd','ug','yi','ku','ckb']);
const FLAGS = {af:'🇿🇦',sq:'🇦🇱',am:'🇪🇹',ar:'🇸🇦',hy:'🇦🇲',az:'🇦🇿',bn:'🇧🇩',bg:'🇧🇬',zh:'🇨🇳',hr:'🇭🇷',cs:'🇨🇿',da:'🇩🇰',nl:'🇳🇱',et:'🇪🇪',tl:'🇵🇭',fi:'🇫🇮',fr:'🇫🇷',ka:'🇬🇪',de:'🇩🇪',el:'🇬🇷',gu:'🇮🇳',ht:'🇭🇹',ha:'🇳🇬',he:'🇮🇱',hi:'🇮🇳',hu:'🇭🇺',is:'🇮🇸',ig:'🇳🇬',id:'🇮🇩',ga:'🇮🇪',it:'🇮🇹',ja:'🇯🇵',kn:'🇮🇳',kk:'🇰🇿',km:'🇰🇭',ko:'🇰🇷',lo:'🇱🇦',lv:'🇱🇻',lt:'🇱🇹',mk:'🇲🇰',ms:'🇲🇾',ml:'🇮🇳',mt:'🇲🇹',mi:'🇳🇿',mr:'🇮🇳',mn:'🇲🇳',my:'🇲🇲',ne:'🇳🇵',no:'🇳🇴',ps:'🇦🇫',fa:'🇮🇷',pl:'🇵🇱',pt:'🇵🇹',pa:'🇮🇳',ro:'🇷🇴',ru:'🇷🇺',sm:'🇼🇸',sr:'🇷🇸',si:'🇱🇰',sk:'🇸🇰',sl:'🇸🇮',so:'🇸🇴',es:'🇪🇸',sw:'🇹🇿',sv:'🇸🇪',tg:'🇹🇯',ta:'🇮🇳',te:'🇮🇳',th:'🇹🇭',tr:'🇹🇷',uk:'🇺🇦',ur:'🇵🇰',uz:'🇺🇿',vi:'🇻🇳',xh:'🇿🇦',yo:'🇳🇬',zu:'🇿🇦'};

function getFeatures() {
  const f = {};
  document.querySelectorAll('.toggle').forEach(t => { f[t.dataset.feat] = t.classList.contains('on'); });
  return f;
}

function save() {
  chrome.storage.sync.set({ targetLang: $('targetLang').value, features: getFeatures() });
}

// Load saved prefs
chrome.storage.sync.get(['targetLang','features'], p => {
  if (p.targetLang) $('targetLang').value = p.targetLang;
  if (p.features) {
    document.querySelectorAll('.toggle').forEach(t => {
      const v = p.features[t.dataset.feat];
      if (v === true)  t.classList.add('on');
      if (v === false) t.classList.remove('on');
    });
  }
});

// Check rate limit state
chrome.storage.session?.get('rateLimited', d => {
  if (d?.rateLimited) $('rate-limit-banner').style.display = 'flex';
});

$('targetLang').addEventListener('change', save);
document.querySelectorAll('.toggle').forEach(t => t.addEventListener('click', () => { t.classList.toggle('on'); save(); }));

$('btnGo').addEventListener('click', async () => {
  save();
  $('btnGo').classList.add('busy');
  try {
    const code = $('targetLang').value;
    const name = $('targetLang').selectedOptions[0]?.text || code;
    const settings = {
      targetLang: code,
      targetLangName: name,
      targetDir: RTL_LANGS.has(code.split('-')[0]) ? 'rtl' : 'ltr',
      features: getFeatures(),
    };
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content.js'],
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 80));
    await chrome.tabs.sendMessage(tab.id, { action: 'translate', settings });
    window.close();
  } catch (e) {
    console.error(e);
    $('btnGo').classList.remove('busy');
    try {
      const code = $('targetLang').value;
      const name = $('targetLang').selectedOptions[0]?.text || code;
      const settings = {
        targetLang: code, targetLangName: name,
        targetDir: RTL_LANGS.has(code.split('-')[0]) ? 'rtl' : 'ltr',
        features: getFeatures(),
      };
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: s => { window.__behistunPending = s; window.dispatchEvent(new CustomEvent('behistun:translate', { detail: s })); },
        args: [settings],
      });
      window.close();
    } catch { alert('Cannot translate this page. Try refreshing first.'); }
  }
});
