/*
	Storage helpers for MV3 using chrome.storage.sync
*/

function getSettings() {
	return new Promise(resolve => {
		chrome.storage.sync.get(
			{ baseUrl: "", apiKey: "", refreshMs: 300000 },
			items => resolve(items)
		);
	});
}

function setSettings(partial) {
	return new Promise(resolve => {
		chrome.storage.sync.set(partial, () => resolve());
	});
}

function saveSeenAsinTimestamp(asin) {
	const key = `seen:${asin}`;
	const value = Date.now();
	chrome.storage.local.set({ [key]: value });
}

// Expose globally for non-module inclusion order
window.amukStorage = { getSettings, setSettings, saveSeenAsinTimestamp };