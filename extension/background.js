// Marginalia extension background service worker.

// Clicking the toolbar action opens the side panel.
chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        chrome.sidePanel
            .setPanelBehavior({ openPanelOnActionClick: true })
            .catch(() => {});
    }
});

// Keyboard shortcut: open Marginalia in a full browser tab.
chrome.commands.onCommand.addListener((cmd) => {
    if (cmd === "open-full-tab") {
        chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
    }
});
