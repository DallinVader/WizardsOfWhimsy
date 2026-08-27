/**
 * Booster pack opening — random pulls from published catalog, grant via Questline inventory API.
 */
(function (global) {
    'use strict';

    var RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'fantastical'];

    function config() {
        return global.WowAuthConfig || {};
    }

    function authedFetch(path, options) {
        if (!global.WowAuth || typeof global.WowAuth.authedFetch !== 'function') {
            return Promise.reject(new Error('Not signed in'));
        }
        return global.WowAuth.authedFetch(path, options);
    }

    function normalizeRarity(value) {
        return String(value || '').trim().toLowerCase();
    }

    function getPackDef(packId) {
        var cfg = config();
        var packs = cfg.packs || {};
        var def = packs[packId];
        if (!def) throw new Error('Unknown pack: ' + packId);
        return def;
    }

    function listPacks() {
        var cfg = config();
        return Object.keys(cfg.packs || {}).map(function (id) {
            return Object.assign({ id: id }, cfg.packs[id]);
        });
    }

    function cardHasQuestlineId(card) {
        return !!(card && card.questlineItemId && String(card.questlineItemId).trim());
    }

    function cardInPool(card, packDef) {
        if (!cardHasQuestlineId(card)) return false;
        var rarity = normalizeRarity(card.rarity);
        if (!rarity) return false;

        if (Array.isArray(packDef.rarityPool) && packDef.rarityPool.length) {
            var allowed = packDef.rarityPool.map(normalizeRarity);
            return allowed.indexOf(rarity) !== -1;
        }

        if (packDef.minRarity) {
            var minIdx = RARITY_ORDER.indexOf(normalizeRarity(packDef.minRarity));
            var cardIdx = RARITY_ORDER.indexOf(rarity);
            if (minIdx < 0 || cardIdx < 0) return false;
            return cardIdx >= minIdx;
        }

        return true;
    }

    function buildPool(catalogCards, packDef) {
        return (catalogCards || []).filter(function (card) {
            return cardInPool(card, packDef);
        });
    }

    function poolByRarity(pool) {
        var map = Object.create(null);
        (pool || []).forEach(function (card) {
            var r = normalizeRarity(card.rarity);
            if (!r) return;
            if (!map[r]) map[r] = [];
            map[r].push(card);
        });
        return map;
    }

    function pickOneFromList(list) {
        if (!list || !list.length) return null;
        return list[Math.floor(Math.random() * list.length)];
    }

    /** Pick one card matching exact rarity; falls back to nearest available if empty. */
    function pickExactRarity(byRarity, rarity) {
        var want = normalizeRarity(rarity);
        var hit = pickOneFromList(byRarity[want]);
        if (hit) return hit;
        var i;
        var idx = RARITY_ORDER.indexOf(want);
        for (i = 0; i < RARITY_ORDER.length; i++) {
            var down = idx - i;
            var up = idx + i;
            if (down >= 0 && byRarity[RARITY_ORDER[down]] && byRarity[RARITY_ORDER[down]].length) {
                return pickOneFromList(byRarity[RARITY_ORDER[down]]);
            }
            if (up < RARITY_ORDER.length && byRarity[RARITY_ORDER[up]] && byRarity[RARITY_ORDER[up]].length) {
                return pickOneFromList(byRarity[RARITY_ORDER[up]]);
            }
        }
        return null;
    }

    /** Roll a rarity from weights, then pick a random card of that rarity. */
    function pickByRarityWeights(byRarity, weights) {
        weights = weights || {};
        var entries = [];
        var total = 0;
        Object.keys(weights).forEach(function (key) {
            var r = normalizeRarity(key);
            var w = parseFloat(weights[key]);
            if (!r || !isFinite(w) || w <= 0) return;
            if (!byRarity[r] || !byRarity[r].length) return;
            entries.push({ rarity: r, weight: w });
            total += w;
        });
        if (!entries.length || total <= 0) {
            var any = [];
            Object.keys(byRarity).forEach(function (r) {
                any = any.concat(byRarity[r] || []);
            });
            return pickOneFromList(any);
        }
        var roll = Math.random() * total;
        var acc = 0;
        var i;
        for (i = 0; i < entries.length; i++) {
            acc += entries[i].weight;
            if (roll <= acc) {
                return pickOneFromList(byRarity[entries[i].rarity]);
            }
        }
        return pickOneFromList(byRarity[entries[entries.length - 1].rarity]);
    }

    function pickWeightedRandom(pool, weights, count) {
        if (!pool.length) return [];
        var byRarity = poolByRarity(pool);
        var results = [];
        var i;
        for (i = 0; i < count; i++) {
            var card = pickByRarityWeights(byRarity, weights);
            if (card) results.push(card);
        }
        return results;
    }

    /**
     * Pull one pack using pullSlots when present, else flat rarityWeights × cardCount.
     * Each slot: { rarity, count } or { weights, count }.
     */
    function pullPackCards(pool, packDef) {
        var byRarity = poolByRarity(pool);
        var slots = Array.isArray(packDef.pullSlots) ? packDef.pullSlots : null;
        var results = [];

        if (slots && slots.length) {
            slots.forEach(function (slot) {
                var n = parseInt(slot && slot.count, 10);
                if (!isFinite(n) || n < 1) n = 1;
                var i;
                for (i = 0; i < n; i++) {
                    var card = null;
                    if (slot.weights) {
                        card = pickByRarityWeights(byRarity, slot.weights);
                    } else if (slot.rarity) {
                        card = pickExactRarity(byRarity, slot.rarity);
                    }
                    if (card) results.push(card);
                }
            });
            return results;
        }

        var count = parseInt(packDef.cardCount, 10);
        if (!isFinite(count) || count < 1) count = 1;
        return pickWeightedRandom(pool, packDef.rarityWeights, count);
    }

    function aggregateByItemId(cards) {
        var map = Object.create(null);
        (cards || []).forEach(function (card) {
            var id = String(card.questlineItemId || '').trim();
            if (!id) return;
            map[id] = (map[id] || 0) + 1;
        });
        return map;
    }

    function aggregateOwnedItems(ownedItems) {
        var map = Object.create(null);
        (ownedItems || []).forEach(function (entry) {
            var id = entry && entry.itemId != null ? String(entry.itemId).trim() : '';
            if (!id) return;
            var q = parseInt(entry.quantity, 10);
            if (!isFinite(q) || q < 1) q = 1;
            map[id] = (map[id] || 0) + q;
        });
        return map;
    }

    function addItemOnce(itemId) {
        return authedFetch('/user/add-item/' + encodeURIComponent(itemId), {
            method: 'POST',
            body: { quantity: 1 }
        });
    }

    /** Sequential adds — Questline inventory updates race when parallelized. */
    function addItemsSequential(itemIds) {
        var chain = Promise.resolve();
        (itemIds || []).forEach(function (itemId) {
            chain = chain.then(function () {
                return addItemOnce(itemId);
            });
        });
        return chain;
    }

    function flattenCardItemIds(cards) {
        var ids = [];
        (cards || []).forEach(function (card) {
            var id = String(card.questlineItemId || '').trim();
            if (id) ids.push(id);
        });
        return ids;
    }

    function grantCardsToUser(cards, options) {
        options = options || {};
        var ids = flattenCardItemIds(cards);
        if (!ids.length) {
            return Promise.reject(new Error('No grantable cards (missing questlineItemId in catalog).'));
        }

        var ownedBefore = options.ownedBefore || null;
        var expected = aggregateByItemId(cards);

        return addItemsSequential(ids).then(function () {
            if (!global.WowAuth || typeof global.WowAuth.refreshSessionUser !== 'function') {
                return null;
            }
            return global.WowAuth.refreshSessionUser().then(function (session) {
                if (!ownedBefore) return session;

                var after = aggregateOwnedItems(session && session.user && session.user.ownedItems);
                var missing = [];
                Object.keys(expected).forEach(function (id) {
                    var want = (ownedBefore[id] || 0) + expected[id];
                    var have = after[id] || 0;
                    var shortfall = want - have;
                    var i;
                    for (i = 0; i < shortfall; i++) missing.push(id);
                });

                if (!missing.length) return session;

                return addItemsSequential(missing).then(function () {
                    return global.WowAuth.refreshSessionUser();
                });
            });
        });
    }

    function sortCardsForReveal(cards) {
        return (cards || []).slice().sort(function (a, b) {
            var ra = RARITY_ORDER.indexOf(normalizeRarity(a && a.rarity));
            var rb = RARITY_ORDER.indexOf(normalizeRarity(b && b.rarity));
            if (ra < 0) ra = 0;
            if (rb < 0) rb = 0;
            if (ra !== rb) return ra - rb;
            var na = a && a.name ? String(a.name) : '';
            var nb = b && b.name ? String(b.name) : '';
            return na.localeCompare(nb);
        });
    }

    function maxAffordablePacks(packId, questCoins) {
        var packDef = getPackDef(packId);
        var price = parseInt(packDef.priceQuestCoins, 10);
        if (!isFinite(price) || price < 1) price = 1;
        var coins = parseInt(questCoins, 10);
        if (!isFinite(coins) || coins < 0) coins = 0;
        var max = Math.floor(coins / price);
        if (!isFinite(max) || max < 1) max = 1;
        if (max > 100) max = 100;
        return max;
    }

    function openPack(packId, options) {
        options = options || {};
        var testMode = !!options.testMode;
        var skipGrant = !!options.skipGrant;
        var packDef = getPackDef(packId);
        var packCount = parseInt(options.packCount, 10);
        if (!isFinite(packCount) || packCount < 1) packCount = 1;
        if (packCount > 100) packCount = 100;

        if (!testMode) {
            return Promise.reject(new Error('Pack opening is not live yet. Use Test open pack (admin) or wait for the Questline pack API.'));
        }

        if (!global.WowCardCatalog || typeof global.WowCardCatalog.loadSharedCatalog !== 'function') {
            return Promise.reject(new Error('Card catalog module not loaded.'));
        }

        return global.WowCardCatalog.loadSharedCatalog().then(function (catalog) {
            var pool = buildPool(catalog.cards || [], packDef);
            if (!pool.length) {
                throw new Error(
                    'No cards in the catalog match this pack pool. Publish the catalog and sync Questline items first.'
                );
            }
            var pulled = [];
            var p;
            for (p = 0; p < packCount; p++) {
                pulled = pulled.concat(pullPackCards(pool, packDef));
            }
            /* Multi-pack: keep pull order (pack1 slots → pack2 slots…). Single pack: rarity sort for reveal. */
            var preservePullOrder = packCount > 1;
            var result = {
                packId: packId,
                packName: packDef.name || packId,
                testMode: true,
                skipGrant: skipGrant,
                packCount: packCount,
                preservePullOrder: preservePullOrder,
                cards: preservePullOrder ? pulled : sortCardsForReveal(pulled)
            };

            var grantPromise = skipGrant
                ? Promise.resolve(null)
                : grantCardsToUser(pulled, {
                    ownedBefore: options.ownedBefore || null
                });

            if (options.waitForGrant) {
                return grantPromise.then(function () { return result; });
            }

            result.grantPromise = grantPromise;
            return result;
        });
    }

    global.WowPackOpen = {
        listPacks: listPacks,
        getPackDef: getPackDef,
        buildPool: buildPool,
        pickWeightedRandom: pickWeightedRandom,
        pullPackCards: pullPackCards,
        openPack: openPack,
        maxAffordablePacks: maxAffordablePacks,
        grantCardsToUser: grantCardsToUser,
        sortCardsForReveal: sortCardsForReveal,
        normalizeRarity: normalizeRarity,
        RARITY_ORDER: RARITY_ORDER
    };
})(window);
