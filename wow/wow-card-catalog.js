/**
 * Shared WoW card catalog — one JSON file for the whole site (published from admin Drive).
 * Browsers cannot read your personal Google Drive for other users; host this file instead.
 */
(function (global) {
    'use strict';

    function catalogUrl() {
        var cfg = global.WowAuthConfig || {};
        return String(cfg.sharedCardCatalogUrl || 'catalog/wow-card-catalog.json').trim();
    }

    function accountCardsSource() {
        var cfg = global.WowAuthConfig || {};
        return cfg.accountCardsSource || 'catalog';
    }

    function fieldOf(state, key) {
        var f = state && state.fields;
        return f && f[key] != null ? String(f[key]).trim() : '';
    }

    function titleOf(state) {
        return fieldOf(state, 'Title') || '(untitled)';
    }

    function normalizeCatalogEntry(raw) {
        if (!raw) return null;

        function resolveImageUrl(entry) {
            var url = entry.imageUrl || entry.thumbUrl || '';
            if (url) return url;
            var cfg = global.WowAuthConfig || {};
            var id = String(entry.id || entry.driveFileId || entry.itemId || '').trim();
            if (id && cfg.catalogThumbBasePath) {
                var base = String(cfg.catalogThumbBasePath);
                if (base.slice(-1) !== '/') base += '/';
                return base + id + '.jpg';
            }
            return '';
        }

        if (raw.state && raw.state.fields) {
            var state = raw.state;
            return {
                itemId: String(raw.id || raw.driveFileId || ''),
                questlineItemId: raw.questlineItemId != null ? String(raw.questlineItemId) : '',
                quantity: 1,
                name: titleOf(state),
                description: fieldOf(state, 'MainDisciption'),
                rarity: fieldOf(state, 'CardRarity') || fieldOf(state, 'Rarity'),
                type: fieldOf(state, 'Type'),
                categories: [],
                imageUrl: resolveImageUrl(raw)
            };
        }
        return {
            itemId: String(raw.id || raw.itemId || ''),
            questlineItemId: raw.questlineItemId != null ? String(raw.questlineItemId) : '',
            quantity: raw.quantity != null ? raw.quantity : 1,
            name: raw.name ? String(raw.name) : '(untitled)',
            description: raw.description ? String(raw.description) : '',
            rarity: raw.rarity != null ? raw.rarity : '',
            type: raw.type ? String(raw.type) : '',
            categories: Array.isArray(raw.categories) ? raw.categories : [],
            imageUrl: resolveImageUrl(raw)
        };
    }

    var catalogCache = null;
    var catalogCachePromise = null;

    function loadSharedCatalog(options) {
        options = options || {};
        if (!options.force && catalogCache) {
            return Promise.resolve(catalogCache);
        }
        if (!options.force && catalogCachePromise) {
            return catalogCachePromise;
        }
        var url = catalogUrl();
        if (!url) return Promise.resolve({ cards: [], updatedAt: null, source: 'none' });
        catalogCachePromise = fetch(url, { cache: 'force-cache' }).then(function (res) {
            if (!res.ok) throw new Error('Could not load card catalog (' + res.status + ').');
            return res.json();
        }).then(function (data) {
            var list = Array.isArray(data) ? data : (data && data.cards ? data.cards : []);
            var cards = list.map(normalizeCatalogEntry).filter(function (c) { return c && c.name; });
            cards.sort(function (a, b) { return a.name.localeCompare(b.name); });
            catalogCache = {
                cards: cards,
                updatedAt: data && data.updatedAt ? data.updatedAt : null,
                source: 'catalog'
            };
            catalogCachePromise = null;
            return catalogCache;
        }).catch(function (err) {
            catalogCachePromise = null;
            throw err;
        });
        return catalogCachePromise;
    }

    function mergeWithOwnership(catalogCards, ownedItems) {
        var ownedMap = Object.create(null);
        (ownedItems || []).forEach(function (entry) {
            var id = String(entry.itemId || '').trim();
            if (!id) return;
            var q = parseInt(entry.quantity, 10);
            if (!isFinite(q) || q < 1) q = 1;
            ownedMap[id] = (ownedMap[id] || 0) + q;
        });

        return (catalogCards || []).map(function (card) {
            var qlId = card.questlineItemId != null ? String(card.questlineItemId).trim() : '';
            var driveId = String(card.itemId || card.id || '').trim();
            var qty = 0;
            if (qlId && ownedMap[qlId]) qty = ownedMap[qlId];
            else if (driveId && ownedMap[driveId]) qty = ownedMap[driveId];
            return {
                itemId: driveId || qlId,
                questlineItemId: qlId,
                quantity: qty,
                owned: qty > 0,
                name: card.name,
                description: card.description,
                rarity: card.rarity,
                type: card.type,
                categories: card.categories,
                imageUrl: card.imageUrl
            };
        });
    }

    global.WowCardCatalog = {
        accountCardsSource: accountCardsSource,
        catalogUrl: catalogUrl,
        loadSharedCatalog: loadSharedCatalog,
        mergeWithOwnership: mergeWithOwnership
    };
})(window);
