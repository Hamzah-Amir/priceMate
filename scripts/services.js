/*
	DOM scraping client: fetches the product DP page and extracts
	ASIN, rank text, brand, fulfillment and stock info.
*/

function buildDpUrl(asin) {
	return `https://www.amazon.co.uk/dp/${encodeURIComponent(asin)}`;
}

async function fetchDpDocument(asin) {
	// If we are already on the DP for this ASIN, reuse live DOM
	try {
		const asinInUrl = (location.pathname.match(/\/dp\/([A-Z0-9]{8,10})/i) || [])[1];
		if (asinInUrl && asinInUrl.toUpperCase() === String(asin).toUpperCase()) {
			return document;
		}
	} catch (_) { }

	const res = await fetch(buildDpUrl(asin), { credentials: "include", cache: "no-cache" });
	if (!res.ok) throw new Error(`DP fetch failed ${res.status}`);
	const html = await res.text();
	const parser = new DOMParser();
	return parser.parseFromString(html, "text/html");
}

function textContent(el) {
	return (el && (el.textContent || "").trim()) || "";
}

function extractBrand(doc) {
	// Try byline
	const byline = doc.querySelector('#bylineInfo, a#bylineInfo, #brand, a#brand');
	if (byline) {
		const t = textContent(byline).replace(/^Visit the\s+|Store$/gi, "").replace(/Brand:\s*/i, "").trim();
		if (t) return t;
	}
	// Product overview table
	const overviewRows = Array.from(doc.querySelectorAll('#productOverview_feature_div tr'));
	for (const row of overviewRows) {
		const th = textContent(row.querySelector('th, td.a-span3'));
		if (/^brand$/i.test(th)) return textContent(row.querySelector('td, td.a-span9'));
	}
	// Detail bullets
	const detailRows = Array.from(doc.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr'));
	for (const row of detailRows) {
		const th = textContent(row.querySelector('th'));
		if (/^brand/i.test(th)) return textContent(row.querySelector('td'));
	}
	return "";
}

function cleanCategory(cat) {
	let c = (cat || "").trim();
	// Stop at tokens that indicate the next field or UI block
	c = c.replace(/\s+#.*$/i, "");
	c = c.replace(/\s+(Brand:|Product|Visit|ASIN|PRO-version|ratings?|out\s+of|stars|Store|Details)\b.*$/i, "");
	return c.trim();
}

function extractBestSellerRank(doc) {
	const containers = [
		'#detailBulletsWrapper_feature_div',
		'#detailBullets_feature_div',
		'#productDetails_detailBullets_sections1',
		'#productDetails_db_sections',
		'#prodDetails',
		'#detailBulletsId'
	];
	for (const sel of containers) {
		const box = doc.querySelector(sel);
		if (!box) continue;
		const text = box.textContent.replace(/\s+/g, ' ');
		const m = text.match(/#\s*([\d,]+)\s+in\s+([^()]+?)(?:\s*\(|$)/i);
		if (m) {
			const cat = cleanCategory(m[2]);
			return { rank_text: `#${m[1]} in ${cat}` };
		}
	}
	// Fallback: search entire document
	const all = doc.body ? doc.body.textContent.replace(/\s+/g, ' ') : '';
	const fm = all.match(/#\s*([\d,]+)\s+in\s+([^()]+?)(?:\s*\(|$)/i);
	if (fm) {
		const cat = cleanCategory(fm[2]);
		return { rank_text: `#${fm[1]} in ${cat}` };
	}
	return {};
}

function extractFulfillment(doc) {
	const info = textContent(doc.querySelector('#merchant-info'));
	let prime = 0, amz = 0, fba = 0, fbm = 0;
	
	console.log('Merchant info:', info);
	
	// Check main seller fulfillment type
	if (/ships from and sold by amazon/i.test(info)) {
		amz = 1;
		prime = 1;
		console.log('Main seller: AMZ');
	} else if (/fulfilled by amazon/i.test(info)) {
		fba = 1;
		prime = 1;
		console.log('Main seller: FBA');
	} else {
		fbm = 1;
		console.log('Main seller: FBM');
	}
	
	// Check for Prime badge in buy box
	if (doc.querySelector('.a-icon-prime, i.a-prime, .prime-logo')) {
		prime = 1;
		console.log('Prime badge found');
	}
	
	// Count FBA and FBM sellers from offer listings
	const sellerCounts = countFulfillmentTypes(doc);
	fba += sellerCounts.fba;
	fbm += sellerCounts.fbm;
	
	console.log('Final counts - AMZ:', amz, 'PRIME:', prime, 'FBA:', fba, 'FBM:', fbm);
	
	return { fulfillment_breakdown: { amz, prime, fba, fbm } };
}

function countFulfillmentTypes(doc) {
	let fbaCount = 0, fbmCount = 0;
	
	// First, let's check if there are any "Other Sellers" or "More Buying Choices" links
	const otherSellersLink = doc.querySelector('a[href*="olp"], a[href*="offer-listing"], a[href*="more-buying-choices"]');
	if (otherSellersLink) {
		console.log('Found Other Sellers link:', otherSellersLink.href);
	}
	
	// Check for "Other Sellers" section that might be expanded
	const otherSellersSection = doc.querySelector('#aod-offer-list, #aod-offer, .aod-offer-list, #olp_feature_div, #moreBuyingChoices_feature_div');
	if (otherSellersSection) {
		console.log('Found Other Sellers section');
		
		// Look for seller rows in the section
		const sellerRows = otherSellersSection.querySelectorAll('.aod-offer, .aod-information-block, .olpOffer, .a-section');
		console.log('Found', sellerRows.length, 'seller rows in Other Sellers section');
		
		for (let i = 0; i < sellerRows.length; i++) {
			const row = sellerRows[i];
			const text = textContent(row).toLowerCase();
			
			console.log(`Seller row ${i + 1}:`, text.substring(0, 100) + '...');
			
			// Check for FBA indicators
			if (text.includes('fulfilled by amazon') || 
				text.includes('dispatched from and sold by amazon') ||
				text.includes('fba')) {
				fbaCount++;
				console.log(`Found FBA in seller row ${i + 1}`);
			} else if (text.includes('ships from') || 
					   text.includes('sold by') || 
					   text.includes('fulfilled by merchant') ||
					   text.includes('fbm')) {
				fbmCount++;
				console.log(`Found FBM in seller row ${i + 1}`);
			}
		}
	} else {
		console.log('No Other Sellers section found');
	}
	
	// If we still don't have any counts, try a different approach
	if (fbaCount === 0 && fbmCount === 0) {
		console.log('No fulfillment types found, trying alternative approach...');
		
		// Look for any text that mentions fulfillment
		const allText = textContent(doc.body).toLowerCase();
		
		// Count occurrences of FBA/FBM terms in the entire page
		const fbaMatches = allText.match(/fulfilled by amazon|fba/g);
		const fbmMatches = allText.match(/ships from|sold by|fulfilled by merchant|fbm/g);
		
		if (fbaMatches) {
			fbaCount = fbaMatches.length;
			console.log('Found FBA mentions in page text:', fbaCount);
		}
		if (fbmMatches) {
			fbmCount = fbmMatches.length;
			console.log('Found FBM mentions in page text:', fbmCount);
		}
	}
	
	// Debug logging
	console.log('Final FBA Count:', fbaCount, 'FBM Count:', fbmCount);
	console.log('Total Sellers for this product:', fbaCount + fbmCount);
	
	return { fba: fbaCount, fbm: fbmCount };
}






async function fetchListingInfo(asin) {
	const doc = await fetchDpDocument(asin);
	const brand = extractBrand(doc);
	const rank = extractBestSellerRank(doc);
	const fulfillment = extractFulfillment(doc);
	return {
		asin,
		brand,
		...rank,
		...fulfillment
	};
}

window.amukServices = { fetchListingInfo };