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

    function pickWeightedRandom(pool, weights, count) {
        if (!pool.length) return [];
        weights = weights || {};
        var results = [];
        var i;
        for (i = 0; i < count; i++) {
            var total = 0;
            var entries = pool.map(function (card) {
                var w = weights[normalizeRarity(card.rarity)];
                if (!w || w < 0) w = 1;
                total += w;
                return { card: card, weight: w };
            });
            var roll = Math.random() * total;
            var acc = 0;
            var j;
            for (j = 0; j < entries.length; j++) {
                acc += entries[j].weight;
                if (roll <= acc) {
                    results.push(entries[j].card);
                    break;
                }
            }
        }
        return results;
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

    function openPack(packId, options) {
        options = options || {};
        var testMode = !!options.testMode;
        var packDef = getPackDef(packId);
        var count = parseInt(packDef.cardCount, 10);
        if (!isFinite(count) || count < 1) count = 1;

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
            var pulled = pickWeightedRandom(pool, packDef.rarityWeights, count);
            var result = {
                packId: packId,
                packName: packDef.name || packId,
                testMode: true,
                cards: sortCardsForReveal(pulled)
            };

            var grantPromise = grantCardsToUser(pulled, {
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
        openPack: openPack,
        grantCardsToUser: grantCardsToUser,
        sortCardsForReveal: sortCardsForReveal,
        normalizeRarity: normalizeRarity,
        RARITY_ORDER: RARITY_ORDER
    };
})(window);
