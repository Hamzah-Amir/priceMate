/*
	Content script for Amazon UK pages. Injects live product info cards.
*/

const CARD_ATTR = "data-amuk-card";
const ASIN_ATTR = "data-asin";
const REFRESH_MS_DEFAULT = 5 * 60 * 1000;

function selectProductNodes(root) {
	// Search common Amazon UK listing containers with data-asin
	const allNodes = Array.from(root.querySelectorAll(`[${ASIN_ATTR}]`))
		.filter(node => !!node.getAttribute(ASIN_ATTR))
		.filter(node => !node.querySelector(`div[${CARD_ATTR}]`));
	
	// Apply Grabley method: identify main products vs variations
	return categorizeProducts(allNodes);
}

function categorizeProducts(nodes) {
	const mainProducts = [];
	const variations = [];
	
	for (const node of nodes) {
		const asin = node.getAttribute(ASIN_ATTR);
		const isVariation = isProductVariation(node);
		
		if (isVariation) {
			variations.push({ node, asin, type: 'variation' });
			console.log(`[Grabley] Identified variation: ${asin} - ${node.textContent?.substring(0, 50)}...`);
		} else {
			mainProducts.push({ node, asin, type: 'main' });
			console.log(`[Grabley] Identified main product: ${asin}`);
		}
	}
	
	// Group variations with their parent products
	const groupedProducts = groupVariationsWithParents(mainProducts, variations);
	
	console.log(`[Grabley] Categorized ${mainProducts.length} main products and ${variations.length} variations into ${groupedProducts.length} groups`);
	
	return groupedProducts;
}

function isProductVariation(node) {
	// Check if this is a variation/option selector
	if (node.closest('#variation_style_name, #variation_size_name, #variation_pattern_name, .a-section.a-spacing-small')) {
		return true;
	}
	
	// Skip dropdown option elements
	if (node.tagName === 'OPTION' || node.closest('select')) {
		return true;
	}
	
	// Skip elements that are clearly variant selectors
	if (node.closest('.a-section[data-cel-widget*="variation"], .a-section[data-cel-widget*="style"], .a-section[data-cel-widget*="size"]')) {
		return true;
	}
	
	// Skip elements within variation containers
	if (node.closest('[id*="variation"], [class*="variation"]')) {
		return true;
	}
	
	// Check for pack size indicators (pack of 6, pack of 24, etc.)
	const nodeText = node.textContent?.toLowerCase() || '';
	const packSizePatterns = [
		/pack of \d+/i,
		/\d+ pack/i,
		/\d+ x \d+/i,
		/multipack/i,
		/bulk pack/i,
		/family pack/i,
		/value pack/i,
		/\d+\s*count/i,
		/\d+\s*pieces/i,
		/\d+\s*units/i,
		/\d+\s*items/i,
		/set of \d+/i,
		/\d+\s*set/i,
		/bundle of \d+/i,
		/\d+\s*bundle/i
	];
	
	if (packSizePatterns.some(pattern => pattern.test(nodeText))) {
		return true;
	}
	
	// Check if it's part of product option selectors
	if (node.closest('.a-section.a-spacing-small, .a-section.a-spacing-medium')) {
		const parentText = node.closest('.a-section')?.textContent?.toLowerCase() || '';
		if (parentText.includes('style') || parentText.includes('size') || parentText.includes('pattern') || 
			parentText.includes('color') || parentText.includes('option') || parentText.includes('pack')) {
			return true;
		}
	}
	
	return false;
}

function groupVariationsWithParents(mainProducts, variations) {
	const grouped = [];
	
	for (const mainProduct of mainProducts) {
		const mainAsin = mainProduct.asin;
		const relatedVariations = findRelatedVariations(mainProduct.node, variations);
		
		grouped.push({
			...mainProduct,
			variations: relatedVariations
		});
	}
	
	// Add standalone variations that couldn't be grouped
	const usedVariations = new Set();
	grouped.forEach(group => {
		group.variations.forEach(variation => usedVariations.add(variation.asin));
	});
	
	variations.forEach(variation => {
		if (!usedVariations.has(variation.asin)) {
			grouped.push({
				...variation,
				variations: []
			});
		}
	});
	
	return grouped;
}

function findRelatedVariations(mainNode, variations) {
	const related = [];
	const mainAsin = mainNode.getAttribute(ASIN_ATTR);
	
	// Find variations that are likely related to this main product
	// This could be based on proximity, similar product structure, etc.
	variations.forEach(variation => {
		if (isRelatedToMain(mainNode, variation.node)) {
			related.push(variation);
		}
	});
	
	return related;
}

function isRelatedToMain(mainNode, variationNode) {
	// Check if variation is in the same product container
	const mainContainer = mainNode.closest('[data-asin], .s-result-item, .s-search-result');
	const variationContainer = variationNode.closest('[data-asin], .s-result-item, .s-search-result');
	
	if (mainContainer && variationContainer && mainContainer === variationContainer) {
		return true;
	}
	
	// Check if they're siblings in the same parent container
	const mainParent = mainNode.parentElement;
	const variationParent = variationNode.parentElement;
	
	if (mainParent && variationParent && mainParent === variationParent) {
		return true;
	}
	
	// Check if variation is within a reasonable distance of main product
	const mainRect = mainNode.getBoundingClientRect();
	const variationRect = variationNode.getBoundingClientRect();
	
	// If they're within 200px vertically, consider them related
	const verticalDistance = Math.abs(mainRect.top - variationRect.top);
	if (verticalDistance < 200) {
		return true;
	}
	
	return false;
}

function createCardSkeleton(hasVariations = false) {
	const container = document.createElement("div");
	container.setAttribute(CARD_ATTR, "1");
	container.className = "amuk-card";
	
	const variationsSection = hasVariations ? `
		<div class="amuk-variations" data-field="variations" style="display: none;">
			<div class="amuk-variations-header">
				<span class="amuk-label">Variations:</span>
			</div>
			<div class="amuk-variations-list" data-field="variations-list"></div>
		</div>
	` : '';
	
	container.innerHTML = `
		<div class="amuk-row amuk-top">
			<div class="asin">
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
		${variationsSection}
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

function mountCard(targetNode, asin, variations = []) {
	const hasVariations = variations.length > 0;
	const card = createCardSkeleton(hasVariations);
	const insertionPoint = targetNode.querySelector("h2, h5, .a-size-mini, .a-spacing-none") || targetNode;
	insertionPoint.prepend(card);
	
	// Update main card data
	updateCard(card, { asin, rank: "—", fulfillment: "—", brand: "—", detailsUrl: buildDetailsUrl(asin) });
	
	// Add variations if present
	if (hasVariations) {
		addVariationsToCard(card, variations);
	}
	
	return card;
}

function addVariationsToCard(card, variations) {
	const variationsList = card.querySelector('[data-field="variations-list"]');
	const variationsSection = card.querySelector('[data-field="variations"]');
	
	if (!variationsList || !variationsSection) return;
	
	// Create variation elements
	variations.forEach(variation => {
		const variationElement = createVariationElement(variation);
		variationsList.appendChild(variationElement);
	});
	
	// Show variations section if we have variations
	if (variations.length > 0) {
		variationsSection.style.display = 'block';
	}
}

function createVariationElement(variation) {
	const element = document.createElement('div');
	element.className = 'amuk-variation';
	element.setAttribute('data-asin', variation.asin);
	
	// Extract variation description from the node
	const variationText = extractVariationDescription(variation.node);
	
	element.innerHTML = `
		<span class="amuk-variation-asin">${variation.asin}</span>
		<span class="amuk-variation-desc">${variationText}</span>
		<a class="amuk-variation-link" href="${buildDetailsUrl(variation.asin)}" target="_blank" rel="noopener">View</a>
	`;
	
	return element;
}

function extractVariationDescription(node) {
	// Try to extract a meaningful description of the variation
	const text = node.textContent?.trim() || '';
	
	// Look for pack size indicators
	const packMatch = text.match(/(pack of \d+|\d+ pack|\d+ x \d+|multipack|bulk pack|family pack|value pack|\d+\s*count|\d+\s*pieces|\d+\s*units|\d+\s*items|set of \d+|\d+\s*set|bundle of \d+|\d+\s*bundle)/i);
	if (packMatch) {
		return packMatch[1];
	}
	
	// Look for size/color/style indicators
	const sizeMatch = text.match(/(size|color|style|pattern):\s*([^,\n]+)/i);
	if (sizeMatch) {
		return `${sizeMatch[1]}: ${sizeMatch[2]}`;
	}
	
	// Look for quantity indicators
	const quantityMatch = text.match(/(\d+)\s*(ml|g|kg|oz|lb|cm|inch|mm)/i);
	if (quantityMatch) {
		return `${quantityMatch[1]} ${quantityMatch[2]}`;
	}
	
	// Fallback to first 50 characters
	return text.substring(0, 50) + (text.length > 50 ? '...' : '');
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
		
		// Check if we have meaningful data to display
		const hasMeaningfulData = hasValidData(rankText, fulfillmentText, brandText);
		
		if (hasMeaningfulData) {
			updateCard(card, {
				asin,
				rank: rankText,
				fulfillment: fulfillmentText,
				brand: brandText,
				detailsUrl: buildDetailsUrl(asin)
			});
			window.amukStorage.saveSeenAsinTimestamp(asin);
		} else {
			// Hide the card completely if no meaningful data
			card.style.display = 'none';
		}
	} catch (err) {
		// Hide the card completely on error as well
		card.style.display = 'none';
	}
}

function hasValidData(rank, fulfillment, brand) {
	// Check if we have at least one meaningful piece of data
	const hasRank = rank && rank !== "—" && rank.trim() !== "";
	const hasFulfillment = fulfillment && fulfillment !== "—" && fulfillment.trim() !== "";
	const hasBrand = brand && brand !== "—" && brand.trim() !== "";
	
	// Show card only if we have at least one meaningful data point
	return hasRank || hasFulfillment || hasBrand;
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

	// Display fulfillment types with number capping at 4
	if (amz > 0) {
		const amzDisplay = amz > 4 ? "AMZ 4+" : amz > 1 ? `AMZ ${amz}` : "AMZ";
		tags.push(`<span class="amuk-fulfillment amuk-amz">${amzDisplay}</span>`);
	}
	if (fba > 0) {
		const fbaDisplay = fba > 4 ? "FBA 4+" : fba > 1 ? `FBA ${fba}` : "FBA";
		tags.push(`<span class="amuk-fulfillment amuk-fba">${fbaDisplay}</span>`);
	}
	if (fbm > 0) {
		const fbmDisplay = fbm > 4 ? "FBM 4+" : fbm > 1 ? `FBM ${fbm}` : "FBM";
		tags.push(`<span class="amuk-fulfillment amuk-fbm">${fbmDisplay}</span>`);
	}
	
	// Display Prime badge separately (can appear with any fulfillment type)
	if (prime > 0) tags.push(`<span class="amuk-fulfillment amuk-prime">PRIME</span>`);

	return tags.length > 0 ? tags.join(" / ") : "—";
}


async function processRoot(root) {
	const settings = await window.amukStorage.getSettings();
	const groupedProducts = selectProductNodes(root);
	
	for (const product of groupedProducts) {
		const asin = product.asin;
		if (!asin) continue;
		
		// Only show full details card for main products, not variations
		if (product.type === 'main') {
			const card = mountCard(product.node, asin, product.variations);
			hydrateCard(card, asin, settings);
		}
		// Variations are handled as part of their parent's card
	}

	// Fallback for product detail pages (no listing nodes)
	if (groupedProducts.length === 0 && !document.querySelector(`div[${CARD_ATTR}]`)) {
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