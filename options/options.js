async function restore() {
	const { baseUrl, apiKey, refreshMs } = await window.amukStorage.getSettings();
	document.getElementById("baseUrl").value = baseUrl || "";
	document.getElementById("apiKey").value = apiKey || "";
	document.getElementById("refreshMs").value = Number(refreshMs || 300000);
}

async function save() {
	const baseUrl = document.getElementById("baseUrl").value.trim();
	const apiKey = document.getElementById("apiKey").value.trim();
	const refreshMs = Number(document.getElementById("refreshMs").value || 300000);
	await window.amukStorage.setSettings({ baseUrl, apiKey, refreshMs });
	const status = document.getElementById("status");
	status.textContent = "Saved";
	setTimeout(() => (status.textContent = ""), 1200);
}

document.getElementById("save").addEventListener("click", save);
restore();


