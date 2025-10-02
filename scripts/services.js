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

function extractFulfillment(doc, asin) {
	let prime = 0, amz = 0, fba = 0, fbm = 0;
	
	console.log(`=== Starting fulfillment extraction for ASIN: ${asin} ===`);
	
	// Step 1: Check main seller and their dispatch type
	const mainSellerInfo = getMainSellerInfo(doc, asin);
	console.log(`[${asin}] Main seller info:`, mainSellerInfo);
	
	// Add main seller to counts
	if (mainSellerInfo.type === 'AMZ') {
		amz = 1;
	} else if (mainSellerInfo.type === 'FBA') {
		fba = 1;
	} else if (mainSellerInfo.type === 'FBM') {
		fbm = 1;
	}
	
	// Step 2: Check other sellers and their dispatch types
	const otherSellersInfo = getOtherSellersInfo(doc, asin);
	console.log(`[${asin}] Other sellers info:`, otherSellersInfo);
	
	// Sum up all sellers (main + other sellers)
	amz += otherSellersInfo.amz;
	fba += otherSellersInfo.fba;
	fbm += otherSellersInfo.fbm;
	
	// Step 3: Check for Prime badge (separate from fulfillment types)
	// Prime can appear with FBA, eligible FBM (Seller Fulfilled Prime), or AMZ
	const primeIndicators = [
		'.a-icon-prime',
		'i.a-prime', 
		'.prime-logo',
		'.prime-badge',
		'[data-prime]',
		'.a-icon-prime-delivery',
		'.prime-delivery-badge'
	];
	
	let primeFound = false;
	for (const selector of primeIndicators) {
		if (doc.querySelector(selector)) {
			primeFound = true;
			console.log(`[${asin}] Prime badge found using selector: ${selector}`);
			break;
		}
	}
	
	// Also check for Prime text indicators
	if (!primeFound) {
		const primeTextIndicators = [
			'#merchant-info',
			'#buybox',
			'#buybox_feature_div',
			'.buybox'
		];
		
		for (const selector of primeTextIndicators) {
			const element = doc.querySelector(selector);
			if (element) {
				const text = textContent(element).toLowerCase();
				if (text.includes('prime') && 
					(text.includes('delivery') || text.includes('shipping') || text.includes('free'))) {
					primeFound = true;
					console.log(`[${asin}] Prime indicator found in text: ${selector}`);
					break;
				}
			}
		}
	}
	
	if (primeFound) {
		prime = 1;
		console.log(`[${asin}] Prime eligibility confirmed`);
	}
	
	console.log(`[${asin}] Total fulfillment counts - AMZ: ${amz}, PRIME: ${prime}, FBA: ${fba}, FBM: ${fbm}`);
	
	return { fulfillment_breakdown: { amz, prime, fba, fbm } };
}

function getMainSellerInfo(doc, asin) {
	console.log(`[${asin}] --- Analyzing main seller ---`);
	
	// Check merchant-info section (primary source for main seller)
	const merchantInfo = textContent(doc.querySelector('#merchant-info'));
	console.log(`[${asin}] Merchant info text:`, merchantInfo);
	
	if (!merchantInfo) {
		console.log(`[${asin}] No merchant info found, checking buy box...`);
		
		// Fallback: check buy box area for seller information
		const buyBox = doc.querySelector('#buybox, #buybox_feature_div, .buybox');
		if (buyBox) {
			const buyBoxText = textContent(buyBox).toLowerCase();
			console.log(`[${asin}] Buy box text:`, buyBoxText.substring(0, 200) + '...');
			
			// AMZ (Amazon Retail 1P): "Sold by Amazon"
			if (buyBoxText.includes('sold by amazon') || 
				buyBoxText.includes('ships from and sold by amazon') || 
				buyBoxText.includes('dispatched from and sold by amazon')) {
				return { type: 'AMZ', source: 'buybox' };
			} 
			// FBA: Fulfilled by Amazon
			else if (buyBoxText.includes('fulfilled by amazon') || 
					 buyBoxText.includes('fba') ||
					 buyBoxText.includes('fulfilled by amazon.com') ||
					 buyBoxText.includes('dispatched by amazon') ||
					 buyBoxText.includes('shipped by amazon') ||
					 buyBoxText.includes('delivered by amazon') ||
					 (buyBoxText.includes('amazon') && buyBoxText.includes('fulfill'))) {
				return { type: 'FBA', source: 'buybox' };
			} 
			// FBM: Fulfilled by Merchant
			else if (buyBoxText.includes('ships from') || 
					 buyBoxText.includes('sold by') || 
					 buyBoxText.includes('fulfilled by merchant') ||
					 buyBoxText.includes('fbm') ||
					 buyBoxText.includes('dispatched by')) {
				return { type: 'FBM', source: 'buybox' };
			}
		}
		
		return { type: 'UNKNOWN', source: 'none' };
	}
	
	// Analyze merchant info text
	const infoLower = merchantInfo.toLowerCase();
	
	// AMZ (Amazon Retail 1P): "Sold by Amazon" - Amazon buys wholesale and sells directly
	if (infoLower.includes('sold by amazon') || 
		infoLower.includes('ships from and sold by amazon') || 
		infoLower.includes('dispatched from and sold by amazon')) {
		console.log(`[${asin}] Main seller identified as AMZ (Amazon Retail 1P)`);
		return { type: 'AMZ', source: 'merchant-info' };
	} 
	// FBA: Seller stores in Amazon warehouse, Amazon handles fulfillment
	else if (infoLower.includes('fulfilled by amazon') || 
			 infoLower.includes('fba') ||
			 infoLower.includes('fulfilled by amazon.com') ||
			 infoLower.includes('dispatched by amazon') ||
			 infoLower.includes('shipped by amazon') ||
			 infoLower.includes('delivered by amazon') ||
			 (infoLower.includes('amazon') && infoLower.includes('fulfill'))) {
		console.log(`[${asin}] Main seller identified as FBA (Fulfilled by Amazon)`);
		return { type: 'FBA', source: 'merchant-info' };
	} 
	// FBM: Seller handles their own fulfillment
	else if (infoLower.includes('ships from') || 
			 infoLower.includes('sold by') || 
			 infoLower.includes('fulfilled by merchant') ||
			 infoLower.includes('fbm') ||
			 infoLower.includes('dispatched by')) {
		console.log(`[${asin}] Main seller identified as FBM (Fulfilled by Merchant)`);
		return { type: 'FBM', source: 'merchant-info' };
	}
	
	console.log(`[${asin}] Main seller type could not be determined`);
	return { type: 'UNKNOWN', source: 'merchant-info' };
}

function getOtherSellersInfo(doc, asin) {
	console.log(`[${asin}] --- Analyzing other sellers ---`);
	
	let amz = 0, fba = 0, fbm = 0;
	
	// Check for "Other Sellers" or "More Buying Choices" sections
	const otherSellersSections = [
		'#aod-offer-list',
		'#aod-offer', 
		'.aod-offer-list',
		'#olp_feature_div',
		'#moreBuyingChoices_feature_div',
		'#aod-container',
		'.aod-container'
	];
	
	let foundSection = null;
	for (const selector of otherSellersSections) {
		const section = doc.querySelector(selector);
		if (section) {
			foundSection = section;
			console.log(`[${asin}] Found other sellers section: ${selector}`);
			break;
		}
	}
	
	if (!foundSection) {
		console.log(`[${asin}] No other sellers section found`);
		return { amz, fba, fbm };
	}
	
	// Look for individual seller offers
	const sellerSelectors = [
		'.aod-offer',
		'.aod-information-block', 
		'.olpOffer',
		'.a-section',
		'.aod-offer-row',
		'.offer-row'
	];
	
	let sellerRows = [];
	for (const selector of sellerSelectors) {
		const rows = foundSection.querySelectorAll(selector);
		if (rows.length > 0) {
			sellerRows = Array.from(rows);
			console.log(`[${asin}] Found ${rows.length} seller rows using selector: ${selector}`);
			break;
		}
	}
	
	if (sellerRows.length === 0) {
		console.log(`[${asin}] No individual seller rows found in other sellers section`);
		return { amz, fba, fbm };
	}
	
	// Analyze each seller row
	for (let i = 0; i < sellerRows.length; i++) {
		const row = sellerRows[i];
		const text = textContent(row).toLowerCase();
		
		console.log(`[${asin}] Analyzing seller row ${i + 1}:`, text.substring(0, 150) + '...');
		
		// Check for AMZ (Amazon Retail 1P): "Sold by Amazon"
		if (text.includes('sold by amazon') || 
			text.includes('ships from and sold by amazon') || 
			text.includes('dispatched from and sold by amazon')) {
			amz++;
			console.log(`[${asin}] Found AMZ (Amazon Retail 1P) seller in row ${i + 1}`);
		}
		// Check for FBA (Fulfilled by Amazon)
		else if (text.includes('fulfilled by amazon') || 
				 text.includes('fba') ||
				 text.includes('fulfilled by amazon.com') ||
				 text.includes('dispatched by amazon') ||
				 text.includes('shipped by amazon') ||
				 text.includes('delivered by amazon') ||
				 (text.includes('amazon') && text.includes('fulfill'))) {
			fba++;
			console.log(`[${asin}] Found FBA (Fulfilled by Amazon) seller in row ${i + 1}`);
		}
		// Check for FBM (Fulfilled by Merchant)
		else if (text.includes('ships from') || 
				 text.includes('sold by') || 
				 text.includes('fulfilled by merchant') ||
				 text.includes('fbm') ||
				 text.includes('dispatched by')) {
			fbm++;
			console.log(`[${asin}] Found FBM (Fulfilled by Merchant) seller in row ${i + 1}`);
		}
	}
	
	console.log(`[${asin}] Other sellers summary - AMZ: ${amz}, FBA: ${fba}, FBM: ${fbm}`);
	
	// If we didn't find any other sellers, try a comprehensive fallback search
	if (amz === 0 && fba === 0 && fbm === 0) {
		console.log(`[${asin}] No other sellers found in dedicated sections, trying comprehensive fallback...`);
		const fallbackCounts = comprehensiveFulfillmentSearch(doc, asin);
		amz += fallbackCounts.amz;
		fba += fallbackCounts.fba;
		fbm += fallbackCounts.fbm;
		console.log(`[${asin}] Fallback search results - AMZ: ${fallbackCounts.amz}, FBA: ${fallbackCounts.fba}, FBM: ${fallbackCounts.fbm}`);
	}
	
	return { amz, fba, fbm };
}

function comprehensiveFulfillmentSearch(doc, asin) {
	let amz = 0, fba = 0, fbm = 0;
	
	console.log(`[${asin}] --- Starting comprehensive fulfillment search ---`);
	
	// Search the entire document for fulfillment indicators
	const allText = textContent(doc.body).toLowerCase();
		
	// Count AMZ indicators
	const amzPatterns = [
		/sold by amazon/g,
		/ships from and sold by amazon/g,
		/dispatched from and sold by amazon/g
	];
	
	for (const pattern of amzPatterns) {
		const matches = allText.match(pattern);
		if (matches) {
			amz += matches.length;
			console.log(`[${asin}] Found ${matches.length} AMZ matches with pattern: ${pattern}`);
		}
	}
	
	// Count FBA indicators
	const fbaPatterns = [
		/fulfilled by amazon/g,
		/fulfilled by amazon\.com/g,
		/\bfba\b/g,
		/dispatched by amazon/g,
		/shipped by amazon/g,
		/delivered by amazon/g,
		/amazon.*fulfill/g
	];
	
	for (const pattern of fbaPatterns) {
		const matches = allText.match(pattern);
		if (matches) {
			fba += matches.length;
			console.log(`[${asin}] Found ${matches.length} FBA matches with pattern: ${pattern}`);
		}
	}
	
	// Count FBM indicators
	const fbmPatterns = [
		/ships from/g,
		/sold by/g,
		/fulfilled by merchant/g,
		/\bfbm\b/g,
		/dispatched by/g
	];
	
	for (const pattern of fbmPatterns) {
		const matches = allText.match(pattern);
		if (matches) {
			fbm += matches.length;
			console.log(`[${asin}] Found ${matches.length} FBM matches with pattern: ${pattern}`);
		}
	}
	
	// Since this is a fallback search and we're already counting the main seller separately,
	// we need to subtract 1 from each count to avoid double-counting the main seller
	if (amz > 0) amz = Math.max(0, amz - 1);
	if (fba > 0) fba = Math.max(0, fba - 1);
	if (fbm > 0) fbm = Math.max(0, fbm - 1);
	
	console.log(`[${asin}] Comprehensive search final counts - AMZ: ${amz}, FBA: ${fba}, FBM: ${fbm}`);
	return { amz, fba, fbm };
}






async function fetchListingInfo(asin) {
	const doc = await fetchDpDocument(asin);
	const brand = extractBrand(doc);
	const rank = extractBestSellerRank(doc);
	const fulfillment = extractFulfillment(doc, asin);
	return {
		asin,
		brand,
		...rank,
		...fulfillment
	};
}

window.amukServices = { fetchListingInfo };