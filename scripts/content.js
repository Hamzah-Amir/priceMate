/*
	Content script for Amazon UK pages. Injects live product info cards.
*/

const CARD_ATTR = "data-amuk-card";
const ASIN_ATTR = "data-asin";
const REFRESH_MS_DEFAULT = 5 * 60 * 1000;

function selectProductNodes(root) {
	// Search common Amazon UK listing containers with data-asin
	return Array.from(root.querySelectorAll(`[${ASIN_ATTR}]`))
		.filter(node => !!node.getAttribute(ASIN_ATTR))
		.filter(node => !node.querySelector(`div[${CARD_ATTR}]`));
}

function createCardSkeleton() {
	const container = document.createElement("div");
	container.setAttribute(CARD_ATTR, "1");
	container.className = "amuk-card";
	container.innerHTML = `
			<div class="amuk-row amuk-top">
			<div class="asin"
				<span class="amuk-label">ASIN:</span>
				<span class="amuk-value amuk-copy" data-action="copy-asin">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
					<span data-field="asin">—</span>
				</span>
				</div>
				<a class="amuk-link" target="_blank" rel="noopener" data-field="details">Details</a>
			</div>
			<div class="amuk-row">
				<span class="amuk-label">Rank:</span>
				<span class="amuk-value" data-field="rank">—</span>
			</div>
			<div class="amuk-row">
				<span class="amuk-label">Fulfillment:</span>
				<span class="amuk-value" data-field="fulfillment">—</span>
			</div>
			<div class="amuk-row">
				<span class="amuk-label">Brand:</span>
				<span class="amuk-value" data-field="brand">—</span>
			</div>
		`;
	return container;
}

function findAnchorWithin(node) {
	// Try to find primary product anchor to build details URL fallback
	const anchor = node.querySelector("a[href*='/dp/'], a[href*='/gp/product/']");
	return anchor ? anchor : null;
}

function getAsinFromNode(node) {
	const asin = node.getAttribute(ASIN_ATTR);
	if (asin) return asin;
	const href = findAnchorWithin(node)?.getAttribute("href") || "";
	const dp = href.match(/\/dp\/([A-Z0-9]{8,10})/i);
	if (dp) return dp[1].toUpperCase();
	const gp = href.match(/gp\/product\/([A-Z0-9]{8,10})/i);
	if (gp) return gp[1].toUpperCase();
	return null;
}

function getAsinFromLocation() {
	const href = location.pathname + location.search;
	const dp = href.match(/\/dp\/([A-Z0-9]{8,10})/i);
	if (dp) return dp[1].toUpperCase();
	const gp = href.match(/gp\/product\/([A-Z0-9]{8,10})/i);
	if (gp) return gp[1].toUpperCase();
	return null;
}

function mountCard(targetNode, asin) {
	const card = createCardSkeleton();
	const insertionPoint = targetNode.querySelector("h2, h5, .a-size-mini, .a-spacing-none") || targetNode;
	insertionPoint.prepend(card);
	updateCard(card, { asin, rank: "—", fulfillment: "—", brand: "—", detailsUrl: buildDetailsUrl(asin) });
	return card;
}

function buildDetailsUrl(asin) {
	return `https://www.amazon.co.uk/dp/${asin}`;
}

function updateCard(card, data) {
	const { asin, rank, fulfillment, brand, detailsUrl } = data;
	const setText = (selector, value) => {
		const el = card.querySelector(`[data-field="${selector}"]`);
		if (el) el.textContent = value ?? "—";
	};
	const setHtml = (selector, value) => {
		const el = card.querySelector(`[data-field="${selector}"]`);
		if (el) el.innerHTML = value ?? "—";
	};
	setText("asin", asin || "—");
	setText("rank", rank || "—");
	setHtml("fulfillment", fulfillment || "—");
	setText("brand", brand || "—");
	const link = card.querySelector('[data-field="details"]');
	if (link) link.setAttribute("href", detailsUrl || "#");
}

async function hydrateCard(card, asin, settings) {
	try {
		const result = await window.amukServices.fetchListingInfo(asin);
		const rankText = result?.rank_text ?? formatRank(result?.rank, result?.category);
		const fulfillmentText = formatFulfillment(result?.fulfillment_breakdown);
		const brandText = result?.brand || "—";
		updateCard(card, {
			asin,
			rank: rankText,
			fulfillment: fulfillmentText,
			brand: brandText,
			detailsUrl: buildDetailsUrl(asin)
		});
		window.amukStorage.saveSeenAsinTimestamp(asin);
	} catch (err) {
		updateCard(card, { asin, rank: "—", fulfillment: "—", brand: "—", detailsUrl: buildDetailsUrl(asin) });
	}
}

function formatRank(rank, category) {
	if (!rank) return "—";
	const cat = category ? ` in ${category}` : "";
	return `#${Number(rank).toLocaleString()}${cat}`;
}

function formatFulfillment(fb) {
	if (!fb) return "—";

	const amz = fb.amz ?? 0;
	const prime = fb.prime ?? 0;
	const fba = fb.fba ?? 0;
	const fbm = fb.fbm ?? 0;

	const tags = [];

	if (amz > 0) tags.push(`<span class="amuk-fulfillment amuk-amz">AMZ</span>`);
	if (prime > 0) tags.push(`<span class="amuk-fulfillment amuk-prime">PRIME</span>`);

	if (fba > 0) tags.push(`<span class="amuk-fulfillment amuk-fba">${fba > 1 ? `FBA ${fba}+` : "FBA"}</span>`);
	if (fbm > 0) tags.push(`<span class="amuk-fulfillment amuk-fbm">${fbm > 1 ? `FBM ${fbm}+` : "FBM"}</span>`);

	return tags.length > 0 ? tags.join(" / ") : "—";
}


async function processRoot(root) {
	const settings = await window.amukStorage.getSettings();
	const nodes = selectProductNodes(root);
	for (const node of nodes) {
		const asin = getAsinFromNode(node);
		if (!asin) continue;
		const card = mountCard(node, asin);
		hydrateCard(card, asin, settings);
	}

	// Fallback for product detail pages (no listing nodes)
	if (nodes.length === 0 && !document.querySelector(`div[${CARD_ATTR}]`)) {
		const asinFromUrl = getAsinFromLocation();
		if (asinFromUrl) {
			const dpMount = document.querySelector("#ppd, #centerCol, #titleSection, #title");
			const target = dpMount || document.body;
			const wrapper = document.createElement("div");
			wrapper.setAttribute(ASIN_ATTR, asinFromUrl);
			target.prepend(wrapper);
			const card = mountCard(wrapper, asinFromUrl);
			hydrateCard(card, asinFromUrl, settings);
		}
	}
}

function startObserver() {
	const observer = new MutationObserver(mutations => {
		for (const m of mutations) {
			for (const n of m.addedNodes) {
				if (!(n instanceof HTMLElement)) continue;
				processRoot(n);
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

async function init() {
	await processRoot(document);
	startObserver();
	const { refreshMs } = await window.amukStorage.getSettings();
	const interval = Math.max(REFRESH_MS_DEFAULT, Number(refreshMs) || 0);
	setInterval(() => processRoot(document), interval);
}

init().catch(() => { });