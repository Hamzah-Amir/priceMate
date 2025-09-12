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
	} catch (_) {}

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
	let prime = 0, fba = 0, fbm = 0;
	if (/fulfilled by amazon|dispatched from and sold by amazon/i.test(info)) {
		prime = 1; fba = 1;
	} else {
		fbm = 1;
	}
	// Prime badge on buy box
	if (doc.querySelector('.a-icon-prime, i.a-prime, .prime-logo')) {
		prime = Math.max(prime, 1);
	}
	return { fulfillment_breakdown: { prime, fba, fbm } };
}

function extractStock(doc) {
	// Extract stock from all sellers and sum them up
	const totalStock = extractAllSellerStock(doc);
	
	if (totalStock.total > 0) {
		return { 
			stock: { 
				total: totalStock.total, 
				rawText: `${totalStock.total}`,
				method: "multi-seller",
				sellerCount: totalStock.sellerCount,
				sellerDetails: totalStock.sellerDetails
			} 
		};
	}
	
	// Fallback to main availability if no seller stock found
	const availability = textContent(doc.querySelector('#availability span, #availability'));
	let quantity = 0;
	let rawText = "";
	
	const patterns = [
		/only\s+(\d+)\s+left/i,
		/(\d+)\s*\+\b/i,
		/stock\s*(\d+)\+?/i,
		/available.*?(\d+)\+?/i,
		/(\d+)\s*in\s*stock/i
	];
	
	for (const pattern of patterns) {
		const m = availability.match(pattern);
		if (m) {
			quantity = parseInt(m[1], 10);
			rawText = m[1];
			if (!isNaN(quantity) && quantity > 0) break;
		}
	}
	
	return { 
		stock: { 
			total: quantity, 
			rawText,
			method: "main-availability"
		} 
	};
}

function extractAllSellerStock(doc) {
	let totalQuantity = 0;
	let sellerCount = 0;
	const sellerDetails = [];
	
	// Method 1: Check "Other Sellers" section
	const otherSellersSection = doc.querySelector('#aod-offer, #aod-offer-list, .aod-offer');
	if (otherSellersSection) {
		const sellerOffers = otherSellersSection.querySelectorAll('.aod-offer, .aod-information-block');
		for (const offer of sellerOffers) {
			const sellerStock = extractSellerStockFromOffer(offer);
			if (sellerStock.quantity > 0) {
				totalQuantity += sellerStock.quantity;
				sellerCount++;
				sellerDetails.push(sellerStock);
			}
		}
	}
	
	// Method 2: Check "Buy Box" and main seller
	const buyBox = doc.querySelector('#buybox, #buybox_feature_div, .buybox');
	if (buyBox) {
		const mainSellerStock = extractSellerStockFromOffer(buyBox);
		if (mainSellerStock.quantity > 0) {
			totalQuantity += mainSellerStock.quantity;
			sellerCount++;
			sellerDetails.push(mainSellerStock);
		}
	}
	
	// Method 3: Check "More Buying Choices" section
	const moreChoices = doc.querySelector('#moreBuyingChoices_feature_div, .more-buying-choices');
	if (moreChoices) {
		const choiceOffers = moreChoices.querySelectorAll('.a-section, .a-spacing-base');
		for (const offer of choiceOffers) {
			const sellerStock = extractSellerStockFromOffer(offer);
			if (sellerStock.quantity > 0) {
				totalQuantity += sellerStock.quantity;
				sellerCount++;
				sellerDetails.push(sellerStock);
			}
		}
	}
	
	// Method 4: Check "New & Used" offers
	const newUsedSection = doc.querySelector('#olp_feature_div, .olp-feature');
	if (newUsedSection) {
		const newUsedOffers = newUsedSection.querySelectorAll('.a-section, .olpOffer');
		for (const offer of newUsedOffers) {
			const sellerStock = extractSellerStockFromOffer(offer);
			if (sellerStock.quantity > 0) {
				totalQuantity += sellerStock.quantity;
				sellerCount++;
				sellerDetails.push(sellerStock);
			}
		}
	}
	
	// Method 5: Check "Available from these sellers" section
	const availableSellers = doc.querySelectorAll('[data-asin] .a-section, [data-asin] .a-spacing-base');
	for (const seller of availableSellers) {
		const sellerStock = extractSellerStockFromOffer(seller);
		if (sellerStock.quantity > 0) {
			totalQuantity += sellerStock.quantity;
			sellerCount++;
			sellerDetails.push(sellerStock);
		}
	}
	
	return {
		total: totalQuantity,
		sellerCount,
		sellerDetails
	};
}

function extractSellerStockFromOffer(offerElement) {
	const sellerName = extractSellerName(offerElement);
	let quantity = 0;
	let rawText = "";
	
	// Look for stock information in various formats
	const stockSelectors = [
		'.a-size-base', // General text
		'.a-color-price', // Price area
		'.a-color-secondary', // Secondary text
		'.a-spacing-small', // Small spacing areas
		'.a-spacing-base', // Base spacing areas
		'[data-asin]', // ASIN containers
		'.a-section' // Section containers
	];
	
	for (const selector of stockSelectors) {
		const elements = offerElement.querySelectorAll(selector);
		for (const element of elements) {
			const text = textContent(element);
			const stockInfo = parseStockFromText(text);
			if (stockInfo.quantity > quantity) {
				quantity = stockInfo.quantity;
				rawText = stockInfo.rawText;
			}
		}
	}
	
	// Extract additional seller details
	const price = extractPrice(offerElement);
	const type = extractFulfillmentType(offerElement);
	const condition = extractCondition(offerElement);
	const rating = extractRating(offerElement);
	const delivery = extractDelivery(offerElement);
	const shipsFrom = extractShipsFrom(offerElement);
	
	return {
		seller: sellerName,
		quantity,
		rawText,
		price,
		type,
		condition,
		rating,
		delivery,
		shipsFrom
	};
}

function extractPrice(offerElement) {
	// Look for price in various formats
	const priceSelectors = [
		'.a-price-whole',
		'.a-price .a-offscreen',
		'.a-color-price',
		'.a-price-range',
		'[data-asin] .a-price'
	];
	
	for (const selector of priceSelectors) {
		const priceElement = offerElement.querySelector(selector);
		if (priceElement) {
			const priceText = textContent(priceElement);
			const priceMatch = priceText.match(/[\d,]+\.?\d*/);
			if (priceMatch) {
				return parseFloat(priceMatch[0].replace(',', ''));
			}
		}
	}
	
	return null;
}

function extractFulfillmentType(offerElement) {
	const text = textContent(offerElement);
	if (/fulfilled by amazon|fba/i.test(text)) {
		return 'FBA';
	} else if (/fulfilled by merchant|fbm/i.test(text)) {
		return 'FBM';
	}
	return 'FBM'; // Default
}

function extractCondition(offerElement) {
	const text = textContent(offerElement);
	if (/new/i.test(text)) {
		return 'New';
	} else if (/used/i.test(text)) {
		return 'Used';
	} else if (/refurbished/i.test(text)) {
		return 'Refurbished';
	}
	return 'New'; // Default
}

function extractRating(offerElement) {
	// Look for star ratings
	const starElements = offerElement.querySelectorAll('.a-icon-star, .a-star-mini, .a-icon-alt');
	for (const star of starElements) {
		const title = star.getAttribute('title') || textContent(star);
		const ratingMatch = title.match(/(\d+(?:\.\d+)?)\s*out\s*of\s*5/i);
		if (ratingMatch) {
			return parseFloat(ratingMatch[1]);
		}
	}
	
	// Look for rating text
	const text = textContent(offerElement);
	const ratingMatch = text.match(/(\d+(?:\.\d+)?)\s*out\s*of\s*5/i);
	if (ratingMatch) {
		return parseFloat(ratingMatch[1]);
	}
	
	return null;
}

function extractDelivery(offerElement) {
	const text = textContent(offerElement);
	
	// Skip if text contains CSS or irrelevant content
	if (!text || text.includes('{') || text.includes('px') || text.includes('position:')) {
		return null;
	}
	
	// Look for delivery dates
	const deliveryPatterns = [
		/(\w{2},?\s*\d{1,2}\s+\w{3})/i, // "Mo, 15 Sep"
		/(\d{1,2}\s*-\s*\d{1,2}\s+\w{3})/i, // "17 - 18 Sep"
		/(\d{1,2}\s+\w{3})/i // "15 Sep"
	];
	
	for (const pattern of deliveryPatterns) {
		const match = text.match(pattern);
		if (match) {
			const datePart = match[1];
			// Validate that it looks like a real date
			if (datePart && 
				datePart.length >= 5 && 
				!datePart.includes('px') &&
				!datePart.includes('{') &&
				!datePart.includes('Det') &&
				!datePart.includes('P7')) {
				return datePart.trim();
			}
		}
	}
	
	return null;
}

function extractShipsFrom(offerElement) {
	const text = textContent(offerElement);
	
	// Skip if text contains CSS or irrelevant content
	if (!text || text.includes('{') || text.includes('px') || text.includes('position:')) {
		return "Unknown";
	}
	
	// Look for "ships from" information
	const shipsMatch = text.match(/ships from\s*([^,\n]+)/i);
	if (shipsMatch) {
		const shipsFrom = shipsMatch[1].trim();
		if (shipsFrom && 
			shipsFrom.length < 100 &&
			!shipsFrom.includes('{') &&
			!shipsFrom.includes('px')) {
			return shipsFrom;
		}
	}
	
	// Fallback to seller name
	const sellerName = extractSellerName(offerElement);
	return sellerName !== "Unknown Seller" ? sellerName : "Unknown";
}

function extractSellerName(offerElement) {
	// Skip elements that contain CSS or HTML code
	const elementText = textContent(offerElement);
	if (!elementText || elementText.length < 2) {
		return "Unknown Seller";
	}
	
	// Try to extract seller name from various locations
	const sellerSelectors = [
		'.a-size-base a', // Links in base size
		'.a-color-base a', // Base color links
		'.a-link-normal', // Normal links
		'[data-asin] a', // Links in ASIN containers
		'.a-section a' // Links in sections
	];
	
	for (const selector of sellerSelectors) {
		const sellerLink = offerElement.querySelector(selector);
		if (sellerLink) {
			const sellerName = textContent(sellerLink);
			if (sellerName && 
				sellerName.length > 0 && 
				sellerName.length < 100 && // Reasonable length limit
				!sellerName.includes('Amazon') &&
				!sellerName.includes('Details') &&
				!sellerName.includes('Read more') &&
				!sellerName.includes('ratings') &&
				!sellerName.includes('reviews') &&
				!sellerName.includes('{') &&
				!sellerName.includes('px') &&
				!sellerName.includes('position:')) {
				return sellerName.trim();
			}
		}
	}
	
	// Fallback: look for any text that might be a seller name
	const sellerMatch = elementText.match(/(?:sold by|from|seller:?)\s*([^,\n]+)/i);
	if (sellerMatch) {
		const sellerName = sellerMatch[1].trim();
		if (sellerName && 
			sellerName.length < 100 &&
			!sellerName.includes('{') &&
			!sellerName.includes('px')) {
			return sellerName;
		}
	}
	
	return "Unknown Seller";
}

function parseStockFromText(text) {
	// Patterns to extract stock quantities from text
	const patterns = [
		// Direct quantity patterns
		/only\s+(\d+)\s+left/i,
		/(\d+)\s*\+\s*(?:in\s+)?stock/i,
		/(\d+)\s*units?\s+available/i,
		/(\d+)\s*available/i,
		/stock:\s*(\d+)/i,
		/quantity:\s*(\d+)/i,
		// Plus patterns
		/(\d+)\s*\+\b/i,
		// In stock patterns
		/(\d+)\s*in\s*stock/i,
		// Available patterns
		/available.*?(\d+)/i,
		// Left patterns
		/(\d+)\s+left/i
	];
	
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const quantity = parseInt(match[1], 10);
			if (!isNaN(quantity) && quantity > 0) {
				const rawText = String(quantity);
				return { quantity, rawText };
			}
		}
	}
	
	return { quantity: 0, rawText: "" };
}

async function fetchListingInfo(asin) {
	const doc = await fetchDpDocument(asin);
	const brand = extractBrand(doc);
	const rank = extractBestSellerRank(doc);
	const fulfillment = extractFulfillment(doc);
	const stock = extractStock(doc);
	return {
		asin,
		brand,
		...rank,
		...fulfillment,
		...stock
	};
}

window.amukServices = { fetchListingInfo };


