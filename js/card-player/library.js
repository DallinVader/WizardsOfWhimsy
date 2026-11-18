/**
 * Card Player — library load (IndexedDB SPM + import) and face URL cache.
 */
(function (global) {
    'use strict';

    var SPM_IDB_NAME = 'cardmaker-spm-saves';
    var SPM_IDB_STORE = 'byFileId';
    var PLAY_DECK_STORAGE_KEY = 'cardmaker_play_deck_v1';
    var DECK_NAME_STORAGE_KEY = 'cardmaker_cp_deck_name_v1';
    var COMMANDER_ID_STORAGE_KEY = 'cardmaker_cp_commander_id_v1';
    var FACE_CACHE_MAX = 64;
    var CARD_BACK = 'assets/cards/Card%20Back.png';

    function createLibrary() {
        var library = [];
        var imported = [];
        var byId = Object.create(null);
        var ownershipIndex = { byDriveId: Object.create(null), byQuestlineId: Object.create(null), cards: [] };
        var isAdmin = false;
        var faceCache = new Map();

        function isGuestPlay() {
            try {
                return !!(global.WowAuth && WowAuth.isCardPlayerGuest && WowAuth.isCardPlayerGuest());
            } catch (e) {
                return false;
            }
        }

        function rebuildIndex() {
            byId = Object.create(null);
            library.forEach(function (c) { byId[c.id] = c; });
            imported.forEach(function (c) { byId[c.id] = c; });
        }

        function allCards() {
            return library.concat(imported);
        }

        function getById(id) {
            return byId[id] || null;
        }

        function openIdb() {
            return new Promise(function (resolve, reject) {
                var req = indexedDB.open(SPM_IDB_NAME, 2);
                req.onupgradeneeded = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains(SPM_IDB_STORE)) {
                        db.createObjectStore(SPM_IDB_STORE);
                    }
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        }

        function readAllStates() {
            return openIdb().then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction(SPM_IDB_STORE, 'readonly');
                    var out = [];
                    var req = tx.objectStore(SPM_IDB_STORE).openCursor();
                    req.onsuccess = function () {
                        var cur = req.result;
                        if (!cur) {
                            resolve(out);
                            return;
                        }
                        var v = cur.value;
                        if (v && v.state) {
                            out.push({
                                id: String(cur.key),
                                state: v.state,
                                source: 'drive',
                                name: (v.state.fields && (v.state.fields.CardName || v.state.fields.name)) || String(cur.key)
                            });
                        }
                        cur.continue();
                    };
                    req.onerror = function () { reject(req.error); };
                });
            });
        }

        function fieldVal(state, key) {
            if (!state || !state.fields) return '';
            var v = state.fields[key];
            return v == null ? '' : String(v);
        }

        function refreshOwnership() {
            ownershipIndex = { byDriveId: Object.create(null), byQuestlineId: Object.create(null), cards: [] };
            isAdmin = false;
            try {
                if (global.WowAuth && typeof WowAuth.getSession === 'function') {
                    var session = WowAuth.getSession();
                    isAdmin = !!(session && session.user && WowAuth.isAdmin && WowAuth.isAdmin(session.user));
                    var ownedItems = session && session.user && Array.isArray(session.user.ownedItems)
                        ? session.user.ownedItems
                        : [];
                    if (global.WowCardCatalog && WowCardCatalog.loadSharedCatalog && WowCardCatalog.buildOwnershipIndex) {
                        return WowCardCatalog.loadSharedCatalog().then(function (catalog) {
                            ownershipIndex = WowCardCatalog.buildOwnershipIndex(
                                (catalog && catalog.cards) || [],
                                ownedItems
                            );
                            return ownershipIndex;
                        }).catch(function () {
                            return ownershipIndex;
                        });
                    }
                }
            } catch (e) { /* ignore */ }
            return Promise.resolve(ownershipIndex);
        }

        function owns(libId) {
            if (isAdmin || isGuestPlay()) return true;
            if (!libId) return false;
            if (String(libId).indexOf('import:') === 0) return true;
            if (global.WowCardCatalog && WowCardCatalog.ownedQtyFromIndex) {
                return WowCardCatalog.ownedQtyFromIndex(ownershipIndex, libId) > 0;
            }
            return !!(ownershipIndex.byDriveId && ownershipIndex.byDriveId[String(libId)]);
        }

        function ownedQty(libId) {
            if (isAdmin) return 99;
            if (isGuestPlay()) return 4;
            if (String(libId || '').indexOf('import:') === 0) return 4;
            if (global.WowCardCatalog && WowCardCatalog.ownedQtyFromIndex) {
                return WowCardCatalog.ownedQtyFromIndex(ownershipIndex, libId);
            }
            return owns(libId) ? 1 : 0;
        }

        /** Guests have no Questline inventory — load the shared catalog so they can play. */
        function mergeCatalogForGuest() {
            if (!isGuestPlay()) return Promise.resolve();
            if (!global.WowCardCatalog || !WowCardCatalog.loadSharedCatalog) {
                return Promise.resolve();
            }
            return WowCardCatalog.loadSharedCatalog().then(function (catalog) {
                var existing = Object.create(null);
                library.forEach(function (c) { existing[String(c.id)] = true; });
                (catalog.cards || []).forEach(function (c) {
                    var id = String(c.itemId || '').trim();
                    if (!id || existing[id]) return;
                    existing[id] = true;
                    library.push({
                        id: id,
                        state: null,
                        source: 'catalog',
                        name: c.name || id,
                        imageUrl: c.imageUrl || '',
                        rarity: c.rarity || '',
                        type: c.type || ''
                    });
                });
            }).catch(function () { /* keep SPM / import only */ });
        }

        function refresh() {
            return refreshOwnership().then(function () {
                return readAllStates().then(function (rows) {
                    library = rows.map(function (r) {
                        return {
                            id: r.id,
                            state: r.state,
                            source: r.source,
                            name: r.name || fieldVal(r.state, 'CardName') || r.id
                        };
                    });
                    return mergeCatalogForGuest().then(function () {
                        rebuildIndex();
                        return allCards();
                    });
                });
            }).catch(function () {
                library = [];
                return mergeCatalogForGuest().then(function () {
                    rebuildIndex();
                    return allCards();
                });
            });
        }

        function importJsonFiles(fileList) {
            var files = Array.prototype.slice.call(fileList || []);
            return Promise.all(files.map(function (file) {
                return file.text().then(function (text) {
                    var data = JSON.parse(text);
                    var state = data.state || data;
                    var id = 'import:' + file.name + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 6);
                    imported.push({
                        id: id,
                        state: state,
                        source: 'import',
                        name: fieldVal(state, 'CardName') || file.name
                    });
                });
            })).then(function () {
                rebuildIndex();
                return allCards();
            });
        }

        function touchFaceCache(key, url) {
            if (faceCache.has(key)) faceCache.delete(key);
            faceCache.set(key, url);
            while (faceCache.size > FACE_CACHE_MAX) {
                var first = faceCache.keys().next().value;
                faceCache.delete(first);
            }
        }

        var inflight = Object.create(null);

        function renderFace(libId, maxSide, cacheKey) {
            var card = getById(libId);
            if (!card) return Promise.resolve(CARD_BACK);
            var key = cacheKey || String(libId);
            if (faceCache.has(key)) return Promise.resolve(faceCache.get(key));
            if (!card.state) {
                var img = card.imageUrl || '';
                if (img) {
                    touchFaceCache(key, img);
                    return Promise.resolve(img);
                }
                return Promise.resolve(CARD_BACK);
            }
            if (inflight[key]) return inflight[key];
            if (typeof global.renderCardMakerProjectToDataUrl !== 'function') {
                return Promise.resolve(CARD_BACK);
            }
            inflight[key] = Promise.resolve(global.renderCardMakerProjectToDataUrl(card.state, {
                maxOutputSide: maxSide,
                outputMime: 'image/jpeg',
                outputQuality: 0.78
            })).then(function (url) {
                touchFaceCache(key, url || CARD_BACK);
                delete inflight[key];
                return faceCache.get(key);
            }).catch(function () {
                delete inflight[key];
                return CARD_BACK;
            });
            return inflight[key];
        }

        /** Board / hand faces — sharp enough to read at hand size. */
        function getFaceUrl(libId) {
            return renderFace(libId, 520, String(libId));
        }

        /** Hover/tap preview — sharper but still capped. */
        function getPreviewUrl(libId) {
            return renderFace(libId, 720, 'pv:' + libId);
        }

        function getThumbUrl(libId) {
            return renderFace(libId, 220, 'th:' + libId);
        }

        /** Warm cache for upcoming draws (deck top). */
        function prefetchIds(ids, limit) {
            var list = (ids || []).slice(0, limit == null ? 12 : limit);
            list.forEach(function (id) {
                getFaceUrl(id);
            });
        }

        function loadPersistedDeckIds() {
            try {
                var raw = localStorage.getItem(PLAY_DECK_STORAGE_KEY);
                if (!raw) return [];
                var data = JSON.parse(raw);
                return Array.isArray(data) ? data.map(String) : [];
            } catch (e) {
                return [];
            }
        }

        function saveDeckIds(ids) {
            try {
                localStorage.setItem(PLAY_DECK_STORAGE_KEY, JSON.stringify(ids || []));
            } catch (e) { /* ignore */ }
        }

        function getDeckName() {
            try { return localStorage.getItem(DECK_NAME_STORAGE_KEY) || ''; } catch (e) { return ''; }
        }

        function setDeckName(name) {
            try {
                if (name) localStorage.setItem(DECK_NAME_STORAGE_KEY, name);
                else localStorage.removeItem(DECK_NAME_STORAGE_KEY);
            } catch (e) { /* ignore */ }
        }

        function getCommanderId() {
            try { return localStorage.getItem(COMMANDER_ID_STORAGE_KEY) || ''; } catch (e) { return ''; }
        }

        function setCommanderId(id) {
            try {
                if (id) localStorage.setItem(COMMANDER_ID_STORAGE_KEY, id);
                else localStorage.removeItem(COMMANDER_ID_STORAGE_KEY);
            } catch (e) { /* ignore */ }
        }

        function ownedLibrary() {
            return allCards().filter(function (c) { return owns(c.id); });
        }

        function displayName(libId) {
            var c = getById(libId);
            if (!c) return libId || '—';
            return c.name || fieldVal(c.state, 'CardName') || libId;
        }

        function rarityOf(libId) {
            var c = getById(libId);
            if (!c) return '';
            return fieldVal(c.state, 'CardRarity') || fieldVal(c.state, 'Rarity') || c.rarity || '';
        }

        return {
            CARD_BACK: CARD_BACK,
            refresh: refresh,
            importJsonFiles: importJsonFiles,
            allCards: allCards,
            getById: getById,
            owns: owns,
            ownedQty: ownedQty,
            isAdmin: function () { return isAdmin; },
            isGuestPlay: isGuestPlay,
            ownedLibrary: ownedLibrary,
            getFaceUrl: getFaceUrl,
            getPreviewUrl: getPreviewUrl,
            getThumbUrl: getThumbUrl,
            prefetchIds: prefetchIds,
            loadPersistedDeckIds: loadPersistedDeckIds,
            saveDeckIds: saveDeckIds,
            getDeckName: getDeckName,
            setDeckName: setDeckName,
            getCommanderId: getCommanderId,
            setCommanderId: setCommanderId,
            displayName: displayName,
            rarityOf: rarityOf,
            refreshOwnership: refreshOwnership
        };
    }

    global.CardPlayerLibrary = { create: createLibrary };
})(typeof window !== 'undefined' ? window : globalThis);
