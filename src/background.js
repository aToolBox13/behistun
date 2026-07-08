// Behistun — background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'behistun', title: 'Translate with Behistun', contexts: ['selection'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'behistun') {
    chrome.storage.sync.get(['targetLang','features'], prefs => {
      chrome.tabs.sendMessage(tab.id, { action: 'translateSelection', text: info.selectionText, settings: prefs });
    });
  }
});
