import { SCOUT_BUTTONS } from './buttons.js';
import { SYNCPAIR_SCOUT, TEMPLATE_SCOUT, TICKET_SCOUT } from './banners.js';
import { SYNCPAIR_SCOUT2 } from './banners2.js';


// ===== CONFIGURATION =====
const CONFIG = {
	ANIMATION_DELAY: 300,
	FLASH_DELAY: 800,
	MINDSCAPE_DELAY: 1000,
	MOVE_LEVEL_IMG: "css/level1.png",
	MINDSCAPE_PATH: "https://pokemon.brybry.ch/masters/data/actor/mindscape/"
};

const CURRENCIES = {
	gems: { label: "Gems", icon: "css/icon_gem.png", initial: 100000, max: 999999 },
	tickets: { label: "Tickets", icon: "css/icon_tickets.png", initial: 1000, max: 9999 }
};

const RARITIES = ["5", "4", "3"];

const STATE = {
	processedBanners: {},
	unprocessedBanners: {},
	currentBanner: null,
	scoutPoints: {},
	currencies: {},
	isPulling: false,
	skipAnimationFlag: false,
	syncPairIndex: null,
	collection: {},
	basePools: {},
	poolCache: new Map(),
	lastInteraction: {}
};


// ===== DATA =====
function processSyncPairs(syncPairs) {
	const ACQUISITION_MAP = {
		"Spotlight Scout / General Pool": "SPOTLIGHT",
		"Poké Fair Scout": "POKEFAIR",
		"Master Fair Scout": "MASTERFAIR",
		"Seasonal Scout": "SEASONAL",
		"Variety Scout": "VARIETY",
		"Special Costume Scout": "SPECIALCOSTUME",
		"Arc Suit Fair Scout": "ARCFAIR",
		"Mix Scout": "MIX",
		"EX Fair Scout": "EXFAIR",
		"EX Master Fair Scout": "EXMASTERFAIR",
	};

	const index = new Map();
	const pools = {};

	syncPairs.forEach(p => {
		const indexKey = `${p.trainerName}_${p.pokemonNumber}`;
		index.set(indexKey, p);

		const keyPrefix = ACQUISITION_MAP[p.syncPairAcquisition];
		if(keyPrefix) {
			const poolKey = `${keyPrefix}_${p.syncPairRarity}`;
			if(!pools[poolKey]) pools[poolKey] = [];
			pools[poolKey].push(p);
		}
	});

	return { index, pools };
}


function processBanners(banners) {
	const processed = {};

	for(const [key, banner] of Object.entries(banners)) {
		const processedBanner = processSingleBanner(key, banner);
		if(processedBanner) {
			processed[key] = processedBanner;
		}
	}

	return processed;
}

function processSingleBanner(key, banner) {
	if(!banner) { return; }

	const { scoutId, name, image, scoutPoints, startDate, endDate, rarities, guaranteed, exclude, pullButtons } = banner;

	const formattedStartDate = formatToUserTimezone(startDate,0);
	const formattedEndDate = formatToUserTimezone(endDate,1);

	const excludeSet = new Set();
	let excludeFromDate = null;

	exclude.forEach(item => {
		if(item.startsWith("FROM_")) {
			excludeFromDate = item.substring(5);
		} else {
			excludeSet.add(item);
		}
	});

	const guaranteedPool = buildSubcategoryPool(guaranteed, excludeSet, excludeFromDate);

	const processedRarities = {};
	const rates = {};
	let totalRate = 0;
	let hasEmptyPool = false;

	for(const rarity of RARITIES) {
		const subcategoryList = rarities[rarity] || [];

		rates[rarity] = subcategoryList.reduce((sum, s) => sum + s.rate, 0);
		totalRate += rates[rarity];

		const usedInRarity = new Set();

		processedRarities[rarity] = subcategoryList.map(subcategory => {
			const pool = buildSubcategoryPool(subcategory.pool, excludeSet, excludeFromDate);

			const filteredPool = pool.filter(syncPair => {
				const pairKey = `${syncPair.trainerName}_${syncPair.pokemonNumber}`;
				if(usedInRarity.has(pairKey)) { return false; }
				usedInRarity.add(pairKey);
				return true;
			});

			if(filteredPool.length === 0 && subcategory.rate > 0) {
				hasEmptyPool = true;
			}

			return { rate: subcategory.rate, pool: filteredPool };
		});
	}

	if(hasEmptyPool) {
		console.log(`Ignored: ${key} (${name}), Reason: empty item pools`);
		return null;
	}

	if(Math.abs(totalRate - 1.0) >= 0.0001) {
		console.log(`Invalid total rate (${totalRate}) for banner "${key} (${name})"`);
		return null;
	}

	return {
		scoutId, name, image, rates,
		scoutPoints,
		startDate: formattedStartDate,
		endDate: formattedEndDate,
		pullButtons,
		rarities: processedRarities,
		guaranteedPool
	};
}

function buildSubcategoryPool(subcategoryPool, excludeSet, excludeFromDate = null) {
	const cacheKey = `${subcategoryPool.join('|')}::${[...excludeSet].sort().join(',')}::${excludeFromDate || ''}`;

	if(STATE.poolCache.has(cacheKey)) {
		return STATE.poolCache.get(cacheKey);
	}

	const seenPairs = new Set();
	const filteredPairs = [];

	function shouldExclude(pair, key) {
		return excludeSet.has(key) || (excludeFromDate && pair.releaseDate > excludeFromDate);
	}

	for(const poolKey of subcategoryPool) {
		const syncPairs = STATE.basePools[poolKey] || 
		(STATE.syncPairIndex.get(poolKey) ? [STATE.syncPairIndex.get(poolKey)] : []);

		for(const pair of syncPairs) {
			const pairKey = `${pair.trainerName}_${pair.pokemonNumber}`;

			if(!seenPairs.has(pairKey) && !shouldExclude(pair, pairKey)) {
				seenPairs.add(pairKey);
				filteredPairs.push(pair);
			}
		}
	}

	STATE.poolCache.set(cacheKey, filteredPairs);

	return filteredPairs;
}

function ensureBannerProcessed(bannerKey) {
	if(STATE.processedBanners[bannerKey]) {
		return true;
	}

	if(STATE.unprocessedBanners[bannerKey]) {
		const bannerSelector = document.getElementById("banner-selector");
		bannerSelector.disabled = true;
		bannerSelector.style.opacity = "0.6";

		const rawBanner = STATE.unprocessedBanners[bannerKey];
		const processed = processSingleBanner(bannerKey, rawBanner);

		bannerSelector.disabled = false;
		bannerSelector.style.opacity = "1";

		if(processed) {
			STATE.processedBanners[bannerKey] = processed;
			delete STATE.unprocessedBanners[bannerKey];
			console.log(`Banner loaded: ${processed.name}`);
			return true;
		} else {
			console.log(`Failed to process banner: ${bannerKey}`);
			return false;
		}
	}

	console.log(`Banner not found: ${bannerKey}`);
	return false;
}

function formatToUserTimezone(utcString, end) {
	if(!utcString) return "";

	try {
		const isoString = utcString.replace(' ', 'T').replace(' UTC', '') + 'Z';
		const date = new Date(isoString);
		if(end) {
			date.setSeconds(date.getSeconds() - 1)
		}

		if(isNaN(date.getTime())) return;

		return date.toLocaleString(navigator.language, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
	} catch (e) {
		return "Date format incorrect";
	}
}


// ===== GACHA LOGIC =====
function weightedRandom(items, weightFn) {
	const totalWeight = items.reduce((sum, item) => sum + weightFn(item), 0);
	if(totalWeight <= 0 || totalWeight > 1) return null;

	let rand = Math.random() * totalWeight;
	for(const item of items) {
		const weight = weightFn(item);
		if(rand < weight) return item;
		rand -= weight;
	}
	return null;
}

function pullCharacter(banner) {
	const rarityChoices = [
		{ key: "5", rate: banner.rates["5"] },
		{ key: "4", rate: banner.rates["4"] },
		{ key: "3", rate: banner.rates["3"] }
	];

	const selectedRarity = weightedRandom(rarityChoices, r => r.rate).key;

	const subcategories = banner.rarities[selectedRarity];
	const chosenSubcategory = weightedRandom(subcategories, s => s.rate);

	if(!chosenSubcategory || !chosenSubcategory.pool.length) return null;

	const randomNum = Math.floor(Math.random() * chosenSubcategory.pool.length);

	return chosenSubcategory.pool[randomNum];
}

function pullGuaranteedCharacter(banner) {
	const pool = banner.guaranteedPool;

	if(!pool || pool.length === 0) return null;

	const randomIndex = Math.floor(Math.random() * pool.length);

	return pool[randomIndex];
}

function performPull(banner, btn) {
	if(STATE.isPulling) return;

	for(const [currency, amount] of Object.entries(btn.costs)) {
		if(STATE.currencies[currency] < amount) {
			alert(`Not enough ${CURRENCIES[currency].label}`);
			return;
		}
		STATE.currencies[currency] -= amount;
	}

	setPullingState(true);

	STATE.lastInteraction[STATE.currentBanner] = Date.now();

	const results = [];

	const hasGuaranteed = banner.guaranteedPool && banner.guaranteedPool.length > 0;
	const guaranteedPosition = hasGuaranteed ? Math.floor(Math.random() * btn.quantity) : -1;

	for(let i = 0; i < btn.quantity; i++) {
		let syncPair;

		if(i === guaranteedPosition) {
			syncPair = pullGuaranteedCharacter(banner);
		} else {
			syncPair = pullCharacter(banner);
		}

		if(syncPair) {
			results.push(syncPair);
			updateCollection(syncPair);
		}
	}

	const currentPity = STATE.scoutPoints[STATE.currentBanner] || 0;
	STATE.scoutPoints[STATE.currentBanner] = currentPity + btn.points;

	updateStats();
	displayResults(results);

	saveToLocalStorage();

	if(STATE.scoutPoints[STATE.currentBanner] >= banner.scoutPoints) {
		initializePityButton();
	}
}

function finishPull() {
	setPullingState(false);

	const skipButton = document.getElementById("skip-animation-btn");
	if(skipButton) skipButton.classList.add("hide");

	displayCollection();
}

function setPullingState(isPulling) {
	STATE.isPulling = isPulling;

	const pullControls = document.getElementById("pull-controls");
	const bannerSelector = document.getElementById("banner-selector");
	const leftPanel = document.getElementById("left-panel");

	if(isPulling) {
		pullControls.classList.add("is-pulling");
		bannerSelector.classList.add("is-pulling");
		leftPanel.removeAttribute("class");
	} else {
		pullControls.classList.remove("is-pulling");
		bannerSelector.classList.remove("is-pulling");
	}

	updatePullButtonStates();
}


// ===== PITY =====
function initializePityButton() {
	const btn = SCOUT_BUTTONS["PITY"];
	const pityBtn = document.createElement("button");
	pityBtn.classList.add("pull-btn", `pull-${btn.type}`);
	pityBtn.id = "PITY";
	pityBtn.textContent = btn.label;
	pityBtn.addEventListener("click", showPitySelectionUI);

	document.getElementById("pull-controls").replaceChildren(pityBtn);
}

function showPitySelectionUI() {
	const banner = STATE.processedBanners[STATE.currentBanner];
	if(!banner) return;

	const typeOrder = ["Normal","Fire","Water","Grass","Electric","Ice","Fighting","Poison","Ground","Flying","Psychic","Bug","Rock","Ghost","Dragon","Steel","Fairy"];

	const availablePairs = Object.values(banner.rarities).reverse()
	.flatMap(rarity => {
		return rarity.flatMap(sub => {
			return [...sub.pool].sort((a, b) => {
				const indexA = typeOrder.indexOf(a.pokemonType);
				const indexB = typeOrder.indexOf(b.pokemonType);
				return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
			});
		});
	});

	let selectedSyncPair = null;

	const okPityBtn = document.createElement("button");
	okPityBtn.classList.add("pull-btn", "ok-btn2");
	okPityBtn.textContent = "OK";
	okPityBtn.addEventListener("click", () => handleOkPity(selectedSyncPair, banner));

	document.getElementById("pull-controls").replaceChildren(okPityBtn);
	document.getElementById("banner-visual").classList.add("hide");
	document.getElementById("left-panel").removeAttribute("class");
	document.getElementById("left-panel-bottom").classList.add("left-panel-bottom-gradient");

	const scoutResults = document.getElementById("scout-results");
	scoutResults.classList.remove("hide");
	scoutResults.innerHTML = `<div class="result-title">Sync Pairs</div>`;

	const fragment = document.createDocumentFragment();
	availablePairs.forEach(syncPair => {
		const result = createResultDiv(syncPair);

		result.classList.add("result-choose");

		result.addEventListener('click', () => {
			scoutResults.querySelectorAll('.result-selected').forEach(el => {
				el.classList.remove('result-selected');
			});
			result.classList.add('result-selected');
			selectedSyncPair = syncPair;
			okPityBtn.classList.replace("ok-btn2", "ok-btn1");
		});

		fragment.appendChild(result);
	});

	scoutResults.appendChild(fragment);
}

async function handleOkPity(selectedSyncPair, banner) {
	if(!selectedSyncPair) {
		alert("Please select a Sync Pair first!");
		return;
	}

	setPullingState(true);

	STATE.lastInteraction[STATE.currentBanner] = Date.now();

	updateCollection(selectedSyncPair);
	STATE.scoutPoints[STATE.currentBanner] -= banner.scoutPoints;
	updateStats();

	const scoutResults = document.getElementById("scout-results");
	scoutResults.innerHTML = `<div class="result-title">Pity Scout Result</div>`;

	STATE.skipAnimationFlag = document.getElementById("skip-animation-flag").checked;

	if(STATE.skipAnimationFlag) {
		scoutResults.appendChild(createResultDiv(selectedSyncPair));
		finishPull();
	} else {
		setupSkipButton();
		scoutResults.appendChild(createPlaceholderDiv());
		await animateResults(scoutResults, [selectedSyncPair]);
	}

	saveToLocalStorage();

	initializePullButtons();
}


// ===== COLLECTION =====
function updateCollection(syncPair) {
	const { trainerName, pokemonNumber, pokemonName, syncPairRarity, images } = syncPair;
	const key = `${trainerName}_${pokemonNumber}`;
	const banner = STATE.currentBanner;

	STATE.collection[banner] ??= {};

	STATE.collection[banner][key] ??= {
		name: `${trainerName} & ${pokemonName}`,
		quantity: 0,
		rarity: syncPairRarity,
		image: images[0]
	};

	STATE.collection[banner][key].quantity++;
}

function displayCollection() {
	const container = document.getElementById("collection-list");
	const collection = STATE.collection[STATE.currentBanner] || {};
	const items = Object.values(collection);

	if(items.length === 0) {
		container.replaceChildren();
		document.getElementById("results-count").textContent = "";
		return;
	}

	const totalPulls = items.reduce((sum, item) => sum + item.quantity, 0);

	document.getElementById("results-count").textContent = `(${totalPulls})`;

	items.sort((a, b) => b.rarity - a.rarity || b.quantity - a.quantity);

	const fragment = document.createDocumentFragment();

	items.forEach(item => {
		const div = document.createElement("div");
		div.className = "collection-item";
		div.innerHTML = `
				<img src="${item.image}" loading="lazy">
				<span><strong>×${item.quantity}</strong></span>
		`;

		fragment.appendChild(div);
	});

	container.replaceChildren(fragment);
}


// ===== STATS =====
function initializeCurrencies() {
	loadFromLocalStorage();

	Object.entries(CURRENCIES).forEach(([key, config]) => {
		if(STATE.currencies[key] === undefined) {
			STATE.currencies[key] = config.initial;
		}
	});

	saveToLocalStorage();
}

function initializeInitialStats() {
	const scoutStats = document.getElementById("scout-stats");
	const fragment = document.createDocumentFragment();

	Object.entries(CURRENCIES).forEach(([key, config]) => {
		const div = document.createElement("div");
		div.id = `stat-${key}`;
		div.className = `stat-currency`;
		div.innerHTML = `
			<img src="${config.icon}">
			<input type="number" id="input-${key}" value="${STATE.currencies[key] ?? 0}" min="0" max="${config.max}" step="3000">`;

			div.querySelector('input').addEventListener('change', (e) => {
				STATE.currencies[key] = Math.max(0, parseInt(e.target.value, 10) || 0);
				updatePullButtonStates();
				updateStats();
				saveToLocalStorage();
			});
			fragment.appendChild(div);
		});

	const statPoints = document.createElement("div");
	statPoints.id = "stat-scoutpoints";
	statPoints.innerHTML = `<img src="css/icon_pity.png"><p id="scout-points"></p>`;

	fragment.appendChild(statPoints);
	scoutStats.appendChild(fragment);
}

function updateStats() {
	Object.entries(CURRENCIES).forEach(([key, config]) => {
		if(STATE.currencies[key] > config.max) {
			STATE.currencies[key] = config.max;
		}
		const input = document.getElementById(`input-${key}`);
		if(input) {
			input.value = STATE.currencies[key];
		}
	});

	const bannerScoutPoints = STATE.processedBanners[STATE.currentBanner].scoutPoints;
	const currentUserPoints = STATE.scoutPoints[STATE.currentBanner] || 0;

	const scoutPoints = document.getElementById("scout-points");
	if(scoutPoints) {
		scoutPoints.textContent = `${currentUserPoints}/${bannerScoutPoints}`;
	}

	const scoutPointsDiv = document.getElementById("stat-scoutpoints");
	if(scoutPointsDiv) {
		scoutPointsDiv.classList.toggle("transparent", bannerScoutPoints < 3);

		const isTicketMode = (bannerScoutPoints === 2);
		document.getElementById("stat-gems")?.classList.toggle("hide", isTicketMode);
		document.getElementById("stat-tickets")?.classList.toggle("hide", !isTicketMode);
	}
}


// ===== PULL BUTTONS =====
function updatePullButtonStates() {
	const pullControls = document.getElementById("pull-controls");

	const buttons = pullControls.querySelectorAll(".pull-btn");
	buttons.forEach(button => {
		try {
			const costs = JSON.parse(button.dataset.costs || "{}");
			const canAfford = Object.entries(costs).every(([currency, amount]) => {
				return STATE.currencies[currency] >= amount;
			});

			button.disabled = !canAfford;

		} catch (e) {
			console.error("Error parsing button costs:", e);
		}
	});
}

function initializePullButtons() {
	const banner = STATE.processedBanners[STATE.currentBanner];
	if(!banner) return;

	const pullControls = document.getElementById("pull-controls");
	pullControls.replaceChildren();

	if((STATE.scoutPoints[STATE.currentBanner] ?? 0) >= banner.scoutPoints) {
		initializePityButton();
		return;
	}

	banner.pullButtons.forEach(btnId => {
		const btn = SCOUT_BUTTONS[btnId];
		if(!btn) return;

		const button = createPullButton(btnId, btn, banner);
		pullControls.appendChild(button);
	});

	updatePullButtonStates();
}

function createPullButton(btnId, btn, banner) {
	const costParts = Object.entries(btn.costs).map(([curr, amt]) => {
		const icon = CURRENCIES[curr] ? `<img src="${CURRENCIES[curr].icon}">` : "";
		return `${icon} ${amt}`;
	});

	const costLabel = costParts.length > 0 ? costParts.join("&nbsp;") : "0";
	const costSpan = costLabel === "0" ? "" : `<span class="pull-cost">${costLabel}</span>`;

	const button = document.createElement("button");
	button.classList.add("pull-btn", `pull-${btn.type}`);
	button.id = btnId;
	button.innerHTML = `${btn.label}${costSpan}`;
	button.addEventListener("click", () => performPull(banner, btn));

	button.dataset.costs = JSON.stringify(btn.costs);

	return button;
}


// ===== RESULTS DISPLAY =====
function createResultDiv(syncPair) {
	const { trainerName, pokemonName, pokemonNumber, internalTrainerName, images } = syncPair;

	const imgSrc = images[0];

	const fullName = `${trainerName} & ${pokemonName}`;

	const result = document.createElement("div");
	result.className = "result result-pulled";

	result.dataset.trainerName = trainerName;
	result.dataset.pokemonName = pokemonName;
	result.dataset.pokemonNum = pokemonNumber;
	result.dataset.internalTrainerName = internalTrainerName;

	result.innerHTML = `
		<img src="${imgSrc}" alt="${fullName}" title="${fullName}" class="pair-image" loading="lazy">
		<img src="${CONFIG.MOVE_LEVEL_IMG}" class="move-level" alt="Move Level">
	`;

	return result;
}

function createPlaceholderDiv() {
	const placeholder = document.createElement("div");

	placeholder.className = "result result-placeholder";
	placeholder.innerHTML = `<img src="css/icon_scout.png">`;

	return placeholder;
}

function createPlaceholderDivs(container, quantity) {
	const fragment = document.createDocumentFragment();
	for(let i = 0; i < quantity; i++) {
		fragment.appendChild(createPlaceholderDiv());
	}
	container.appendChild(fragment);
}

function displayResults(results) {
	const scoutResults = document.getElementById("scout-results");

	document.getElementById("banner-visual").classList.add("hide");
	document.getElementById("left-panel-bottom").classList.add("left-panel-bottom-gradient");

	scoutResults.classList.remove("hide");
	scoutResults.innerHTML = `<div class="result-title">Sync Pair Scout Result</div>`;
	STATE.skipAnimationFlag = document.getElementById("skip-animation-flag").checked;

	if(STATE.skipAnimationFlag) {
		showAllResultsImmediately(scoutResults, results);
		finishPull();
		return;
	}

	setupSkipButton();

	createPlaceholderDivs(scoutResults, results.length);

	animateResults(scoutResults, results);
}

function showAllResultsImmediately(container, results) {
	const fragment = document.createDocumentFragment();
	results.forEach(syncPair => {
		fragment.appendChild(createResultDiv(syncPair));
	});
	container.appendChild(fragment);
}

function preloadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}


// ===== ANIMATIONS =====
function initializeSkipButton() {
	const skipButton = document.getElementById("skip-animation-btn");
	if(skipButton) {
		skipButton.addEventListener("click", () => {
			STATE.skipAnimationFlag = true;
		});
	}
}

function setupSkipButton() {
	const skipButton = document.getElementById("skip-animation-btn");

	skipButton.classList.remove("hide");
	skipButton.disabled = false;
	skipButton.onclick = () => { STATE.skipAnimationFlag = true; };
}

async function animateResults(container, results) {
	try {
		const placeholders = Array.from(container.querySelectorAll(".result-placeholder"));

		const fiveStarResults = results.filter(sp => sp.syncPairRarity === "5");
		const preloadPromises = fiveStarResults.map(syncPair => {
			const mindscapeSrc = `${CONFIG.MINDSCAPE_PATH}Tx_${syncPair.internalTrainerName}_mindscape00.png`;
			return preloadImage(mindscapeSrc).catch(() => null);
		});

		await Promise.all(preloadPromises);

		for(let i = 0; i < results.length; i++) {
			if(STATE.skipAnimationFlag) {
				while (i < results.length) {
					reveal(placeholders[i], results[i], container);
					i++;
				}
				break;
			}

			const syncPair = results[i];
			const placeholder = placeholders[i];

			if(!placeholder) continue;

			const isFiveStar = syncPair.syncPairRarity === "5";

			if(isFiveStar) {
				placeholder.querySelector("img")?.classList.add("flashing");
				await delay(CONFIG.FLASH_DELAY);

				await showMindscape(syncPair.internalTrainerName);
			}

			reveal(placeholder, syncPair, container);

			await delay(CONFIG.ANIMATION_DELAY);
		}
		finishPull();

	} catch(error) {
		console.error("Animation error:", error);
		showAllResultsImmediately(container, results);
		finishPull();
	}
}

function reveal(placeholder, syncPair, container) {
	if(placeholder?.parentNode === container) {
		container.replaceChild(createResultDiv(syncPair), placeholder);
	}
}

function showMindscape(internalTrainerName) {
	return new Promise((resolve) => {
		const viewer = document.getElementById("mindscape-viewer");
		const bg = document.getElementById("mindscape-bg");
		const image = document.getElementById("mindscape-image");

		const mindscapeSrc = `${CONFIG.MINDSCAPE_PATH}Tx_${internalTrainerName}_mindscape00.png`;

		image.src = mindscapeSrc;
		viewer.classList.remove("hide");

		bg.style.backgroundImage = `url(${mindscapeSrc})`

		let timeoutId = setTimeout(() => {
			viewer.classList.add("hide");
			resolve();
		}, CONFIG.MINDSCAPE_DELAY);

		const skipSplash = () => {
			clearTimeout(timeoutId);
			viewer.classList.add("hide");
			viewer.removeEventListener("click", skipSplash);
			resolve();
		};

		viewer.addEventListener("click", skipSplash);
	});
}


// ===== BANNER =====
function initializeBannerButtons() {
	const bannerSelector = document.getElementById("banner-selector");

	bannerSelector.innerHTML = '';

	const groups = [
		{ label: "◇━━━━ SYNC PAIR SCOUTS ━━━━◇", banners: SYNCPAIR_SCOUT, processed: true },
		{ label: "", banners: SYNCPAIR_SCOUT2, processed: false },
		{ label: "◇━━━━ TICKET SCOUTS ━━━━◇", banners: TICKET_SCOUT, processed: true },
		{ label: "◇━━━━ TEMPLATE ━━━━◇", banners: TEMPLATE_SCOUT, processed: true }
	];

	groups.forEach((group, groupIndex) => {

		if(group.label != "") {
			const separator = document.createElement("option");
			separator.disabled = true;
			separator.textContent = group.label;
			bannerSelector.appendChild(separator);
		}

		Object.keys(group.banners).forEach(bannerKey => {
			if(group.processed) {
				const banner = STATE.processedBanners[bannerKey];
				if(!banner) return;
			}
			else {
				const rawBanner = group.banners[bannerKey];
				if(!rawBanner) {
					const dateSeparator = document.createElement("option");
					dateSeparator.disabled = true;
					dateSeparator.textContent = `━━ ${bannerKey} ━━`;
					bannerSelector.appendChild(dateSeparator);
					return;
				}
			}

			const option = document.createElement("option");
			option.value = bannerKey;
			option.textContent = group.processed ? STATE.processedBanners[bannerKey].name : group.banners[bannerKey].name;

			if(bannerKey === STATE.currentBanner) {
				option.selected = true;
			}
			bannerSelector.appendChild(option);
		});
	});

	bannerSelector.addEventListener("change", (e) => {
		switchBanner(e.target.value);
	});
}

function buildBannerInfosHTML(banner) {
	const scoutPointsP = banner.scoutPoints >= 3 
	? `<p><strong>Scout Points:</strong> ${banner.scoutPoints}</p>` 
	: '';

	const datesP = (banner.startDate && banner.endDate) 
	? `<p><strong>Dates:</strong> ${banner.startDate} to ${banner.endDate}</p>` 
	: '';

	document.getElementById("banner-name").textContent = banner.name;

	document.getElementById("banner-infos").innerHTML = scoutPointsP + datesP;

	let guaranteedInfoP = '';
	if(banner.guaranteedPool && banner.guaranteedPool.length > 0) {
		const guaranteedItemsHTML = banner.guaranteedPool
		.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
		.map(syncPair => 
	`<li class="pool-item"><img src="${syncPair.images[0]}" alt="${syncPair.trainerName} & ${syncPair.pokemonName}"></li>`
	).join("");

		const poolLength = banner.guaranteedPool.length;
		const ratePerChar = (1 / poolLength * 100).toFixed(4);

		guaranteedInfoP = `
			<details>
				<summary class="rarity-divider">5★ Guaranteed</summary>
				<div class="pool-category">
					<p class="category-title">Total: 100% | Individual: ${ratePerChar}% | Pool: ${poolLength}</p>
					<ul class="pool-list">${guaranteedItemsHTML}</ul>
				</div>
			</details>
		`;
	}

	document.getElementById("banner-pools").innerHTML = guaranteedInfoP + RARITIES.map(rarity => {
		const rarityLabel = `<img src="css/star${rarity}.png">`;
		const bannerRarityRate = (banner.rates[rarity] * 100).toFixed(1);

		const categoriesHTML = banner.rarities[rarity]
		.filter(subcategory => subcategory.pool.length > 0)
		.map(subcategory => {
			const poolLength = subcategory.pool.length;
			const categoryRate = (subcategory.rate * 100).toFixed(2);
			const ratePerChar = (subcategory.rate / poolLength * 100).toFixed(4);

			const itemsHTML = [...subcategory.pool].sort((a, b) => a.releaseDate.toString().localeCompare(b.releaseDate.toString())).map(syncPair => 
		`<li class="pool-item"><img src="${syncPair.images[0]}" alt="${syncPair.trainerName} & ${syncPair.pokemonName}"></li>`
		).join("");

			return `<div class="pool-category">
							<p class="category-title">Total: ${categoryRate}% | Individual: ${ratePerChar}% | Pool: ${poolLength}</p>
							<ul class="pool-list">${itemsHTML}</ul>
		</div>`;

	}).join("");

		return `<details><summary class="rarity-divider">${rarityLabel} ${bannerRarityRate}%</summary>${categoriesHTML}</details>`;

	}).join("");
}

function updateBanner() {
	const banner = STATE.processedBanners[STATE.currentBanner];
	if(!banner) return;

	buildBannerInfosHTML(banner);

	const bannerVisual = document.getElementById("banner-visual");
	if(bannerVisual && banner.image) {
		bannerVisual.innerHTML = `<img src="${banner.image}" alt="${banner.name}">`;
	}

	setBannerBackground(banner);

	updateStats();
	displayCollection();
}

function setBannerBackground(banner) {
	const { name, image, rarities } = banner;
	const leftPanel = document.getElementById("left-panel");
	const rightPanel = document.getElementById("right-panel");

	leftPanel.className = "";

	const classes = [];

	if(name.includes("Master Fair")) {
		if(name.includes("EX ")) {
			classes.push("ex-masterfair-bg");
		} else {
			if(name != "Master Fair Guaranteed Ticket Scout") {
				classes.push("masterfair-bg");

				const pokemonType =	name !== "Master Fair Scout" ? rarities?.["5"]?.[0]?.pool?.[0]?.pokemonType?.toLowerCase() : "fire";

				if(pokemonType) { classes.push(`bg-${pokemonType}`); }
			}
		}
	} else if(name.includes("EX Fair")) {
		classes.push("ex-fair-bg");
	} else if(name.includes("Arc Suit Fair")) {
		classes.push("arc-bg");
	}

	leftPanel.classList.add(...classes);
	rightPanel.classList.remove("show");
}

function switchBanner(bannerKey) {

	if(!ensureBannerProcessed(bannerKey)) {
		alert("This banner is no longer available or could not be loaded.");
		return;
	}

	STATE.currentBanner = bannerKey;
	updateBanner();
	initializePullButtons();

	const bannerVisual = document.getElementById("banner-visual");
	const scoutResults = document.getElementById("scout-results");
	const leftPanelBottom = document.getElementById("left-panel-bottom");
	if(bannerVisual) bannerVisual.classList.remove("hide");
	if(scoutResults) scoutResults.classList.add("hide");
	if(leftPanelBottom) leftPanelBottom.classList.remove("left-panel-bottom-gradient");

	const bannerSelector = document.getElementById("banner-selector");
	if(bannerSelector && bannerSelector.value !== bannerKey) {
		bannerSelector.value = bannerKey;
	}
}

function resetCurrentBanner() {
	if(!STATE.currentBanner) return;

	const bannerName = STATE.processedBanners[STATE.currentBanner]?.name || "this banner";

	if(confirm(`Reset banner "${bannerName}" ?`)) {
		delete STATE.collection[STATE.currentBanner];
		delete STATE.scoutPoints[STATE.currentBanner];

		saveToLocalStorage();
		switchBanner(STATE.currentBanner);
	}
}


// ===== TESTING =====
function initializeTestButtons() {
	const testButtons = document.getElementById("test-buttons");

	[100000,1000000,10000000].forEach(iterations => {
		const btn = document.createElement("button");
		btn.classList.add("test-btn");
		btn.textContent = `${iterations.toLocaleString()} pulls`;
		btn.addEventListener("click", () => testRates(iterations));
		testButtons.appendChild(btn);
	})
}

function testRates(iterations) {
	const banner = STATE.processedBanners[STATE.currentBanner];
	const stats = { "5": {}, "4": {}, "3": {} };

	const warning = `Warning: You are about to simulate ${iterations.toLocaleString()} pulls. This may cause your browser to become unresponsive or crash. Proceed with caution. Are you sure?`

	if(iterations >= 10000000 && !confirm(warning)) return;

	for(let i = 0; i < iterations; i++) {
		const syncPair = pullCharacter(banner);
		if(!syncPair) continue;

		const key = `${syncPair.trainerName}_${syncPair.pokemonNumber}`;
		const rarityKey = syncPair.syncPairRarity;

		if(!stats[rarityKey][key]) {
			stats[rarityKey][key] = {
				quantity: 0,
				trainer: syncPair.trainerName,
				pokemon: syncPair.pokemonName
			};
		}

		stats[rarityKey][key].quantity++;
	}

	document.getElementById("test-results").innerHTML = buildTestResultsHTML(stats, iterations);
}

function buildTestResultsHTML(stats, iterations) {
	const parts = [`<p><strong>Test performed on ${iterations.toLocaleString()} pulls</strong></p>`];

	const banner = STATE.processedBanners[STATE.currentBanner];

	RARITIES.forEach(rarity => {
		const totalInRarity = Object.values(stats[rarity]).reduce((sum, s) => sum + s.quantity, 0);

		const rarityImg = `<img src="css/star${rarity}.png">`;
		const expectedRate = (banner.rates[rarity] * 100).toFixed(2);
		const actualRate = (totalInRarity / iterations * 100).toFixed(2);

		parts.push(`<h4>${rarityImg} Expected: ${expectedRate}% | Obtained: ${actualRate}%</h4>`);

		banner.rarities[rarity].forEach((subcategory, index) => {
			const subcatKeys = new Set(subcategory.pool.map(p => `${p.trainerName}_${p.pokemonNumber}`));

			const subcatEntries = Object.entries(stats[rarity]).filter(([key]) => subcatKeys.has(key));

			const subcatCount = subcatEntries.reduce((sum, [, s]) => sum + s.quantity, 0);
			const expectedSubcatRate = (subcategory.rate * 100).toFixed(2);
			const actualSubcatRate = (subcatCount / iterations * 100).toFixed(4);

			parts.push(`<p><strong>Group ${index+1}:</strong> Expected: ${expectedSubcatRate}% | Obtained: ${actualSubcatRate}% (${subcategory.pool.length} sync pairs)</p>`);

			if(subcatEntries.length > 0) {
				const expectedIndividualRate = (subcategory.rate / subcategory.pool.length * 100).toFixed(4);

				parts.push('<ul>');

				subcatEntries
				.sort((a, b) => b[1].quantity - a[1].quantity)
				.forEach(([, data]) => {
					const rate = (data.quantity / iterations * 100).toFixed(4);
					parts.push(`<li>${data.trainer} & ${data.pokemon}: ${data.quantity.toLocaleString()} times (${rate}% - expected: ${expectedIndividualRate}%)</li>`);
				});

				parts.push('</ul>');
			}
		});
	});

	return parts.join("");
}


// ===== LOCAL STORAGE =====
function saveToLocalStorage() {
	cleanupInactiveBanners();

	const data = {
		currencies: STATE.currencies,
		scoutPoints: STATE.scoutPoints,
		collection: STATE.collection,
		lastInteraction: STATE.lastInteraction
	};
	localStorage.setItem('scoutSimulatorData', JSON.stringify(data));
}

function loadFromLocalStorage() {
	const saved = localStorage.getItem('scoutSimulatorData');
	if(saved) {
		try {
			const data = JSON.parse(saved);
			STATE.currencies = data.currencies || {};
			STATE.scoutPoints = data.scoutPoints || {};
			STATE.collection = data.collection || {};
			STATE.lastInteraction = data.lastInteraction || {};
		} catch(e) {
			console.error("Error loading saved data:", e);
		}
	}
}

function cleanupInactiveBanners() {
	const DAYS_TO_KEEP = 60;
	const now = Date.now();
	const cutoff = now - (DAYS_TO_KEEP * 24 * 60 * 60 * 1000);
	
	for(const bannerKey in STATE.collection) {
		const lastInteraction = STATE.lastInteraction[bannerKey];

		if(!lastInteraction || lastInteraction < cutoff) {
			delete STATE.collection[bannerKey];
			delete STATE.scoutPoints[bannerKey];
			delete STATE.lastInteraction[bannerKey];
		}
	}
}


// ===== INITIALIZATION =====
function initializeInformationsState() {
	const details = document.getElementById("informations").parentElement;
	if(!details) return;

	const savedState = localStorage.getItem("informations-open");
	if(savedState !== null) {
		details.open = savedState === "true";
	}

	details.addEventListener("toggle", () => {
		localStorage.setItem("informations-open", details.open);
	});
}

function initializeUI() {
	initializeBannerButtons();
	initializeSkipButton();
	initializeInitialStats();
	initializePullButtons();
	initializeTestButtons();
	//initializeInformationsState();
	updateBanner();

	document.getElementById("show-right-panel-btn").addEventListener("click", () => {
		document.getElementById("left-panel").classList.add("hide");
		document.getElementById("right-panel").classList.add("show");
	})
	document.getElementById("hide-right-panel-btn").addEventListener("click", () => {
		document.getElementById("left-panel").classList.remove("hide");
		document.getElementById("right-panel").classList.remove("show");
	})

	document.getElementById("reset-banner-btn").addEventListener("click", resetCurrentBanner);

	document.getElementById("scout-results").classList.add("hide");
}

function initialize() {
	import("https://pomasters.github.io/SyncPairsTracker/js/syncpairs.js")
	.then(module => {
		const processedSyncPairs = processSyncPairs(module.SYNCPAIRS)

		STATE.syncPairIndex = processedSyncPairs.index;
		STATE.basePools = processedSyncPairs.pools;

		STATE.processedBanners = Object.assign(
			{},
			processBanners(SYNCPAIR_SCOUT),
			processBanners(TICKET_SCOUT),
			processBanners(TEMPLATE_SCOUT)
		);

		STATE.unprocessedBanners = SYNCPAIR_SCOUT2;

		const firstBannerKey = Object.keys(STATE.processedBanners)[0];
		if(firstBannerKey) switchBanner(firstBannerKey);

		initializeCurrencies();
		initializeUI();
	})
	.catch(error => {
		console.error("Error loading data:", error.message);
	});
}

initialize();