/**
 * Build and publish the shared WoW card catalog from Saved cards / IndexedDB cache.
 * Optional Questline item sync (one Item per card) and Firestore push.
 */
(function (global) {
    'use strict';

    var DEFAULT_ITEM_MAP_KEY = 'wow_ql_item_map_v1';

    function config() {
        return global.WowAuthConfig || {};
    }

    function normalizeId(value) {
        if (global.WowAuth && typeof global.WowAuth.normalizeId === 'function') {
            return global.WowAuth.normalizeId(value);
        }
        if (value == null) return '';
        if (typeof value === 'object' && value.$oid) return String(value.$oid);
        if (typeof value === 'object' && value._id != null) return normalizeId(value._id);
        return String(value);
    }

    function authedFetch(path, options) {
        if (!global.WowAuth || typeof global.WowAuth.authedFetch !== 'function') {
            return Promise.reject(new Error('Questline sign-in required.'));
        }
        return global.WowAuth.authedFetch(path, options);
    }

    function fieldOf(state, key) {
        var f = state && state.fields;
        return f && f[key] != null ? String(f[key]).trim() : '';
    }

    function titleOf(state, fallbackName) {
        var t = fieldOf(state, 'Title');
        if (t) return t;
        return fallbackName ? String(fallbackName).trim() : '';
    }

    function catalogThumbRenderOpts() {
        if (global.CardMakerPerf && global.CardMakerPerf.CATALOG_THUMB_RENDER_OPTS) {
            return global.CardMakerPerf.CATALOG_THUMB_RENDER_OPTS;
        }
        if (global.CardMakerPerf && global.CardMakerPerf.THUMB_RENDER_OPTS) {
            return global.CardMakerPerf.THUMB_RENDER_OPTS;
        }
        return { maxOutputSide: 400, outputMime: 'image/jpeg', outputQuality: 0.78 };
    }

    function catalogThumbVariant() {
        if (global.CardMakerPerf && global.CardMakerPerf.CATALOG_THUMB_VARIANT) {
            return global.CardMakerPerf.CATALOG_THUMB_VARIANT;
        }
        return 'c400';
    }

    function catalogImageUrlMode() {
        var cfg = config();
        return cfg.catalogImageUrlMode || 'file';
    }

    function catalogThumbBasePath() {
        var cfg = config();
        var base = cfg.catalogThumbBasePath || 'catalog/thumbs/';
        if (base.slice(-1) !== '/') base += '/';
        return base;
    }

    function catalogThumbFileUrl(driveId) {
        return catalogThumbBasePath() + String(driveId) + '.jpg';
    }

    function dataUrlToBlob(dataUrl) {
        if (!dataUrl || String(dataUrl).indexOf('data:') !== 0) return null;
        try {
            var parts = String(dataUrl).split(',');
            var mimeMatch = parts[0].match(/:(.*?);/);
            var mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            var bin = atob(parts[1]);
            var len = bin.length;
            var arr = new Uint8Array(len);
            var i;
            for (i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
            return new Blob([arr], { type: mime });
        } catch (e) {
            return null;
        }
    }

    function indexExistingImages(existingDoc) {
        var byDriveId = Object.create(null);
        var list = Array.isArray(existingDoc)
            ? existingDoc
            : (existingDoc && existingDoc.cards ? existingDoc.cards : []);
        list.forEach(function (raw) {
            if (!raw) return;
            var driveId = String(raw.id || raw.driveFileId || raw.itemId || '').trim();
            var imageUrl = raw.imageUrl || raw.thumbUrl || '';
            if (driveId && imageUrl) byDriveId[driveId] = String(imageUrl);
        });
        return byDriveId;
    }

    function buildSourceMap(projects, cacheRows) {
        var map = Object.create(null);
        (projects || []).forEach(function (project) {
            if (!project || !project.file || !project.file.id || !project.state) return;
            map[project.file.id] = {
                state: project.state,
                modifiedTime: project.file.modifiedTime
            };
        });
        (cacheRows || []).forEach(function (row) {
            if (!row || !row.id || !row.state || map[row.id]) return;
            map[row.id] = {
                state: row.state,
                modifiedTime: row.modifiedTime
            };
        });
        return map;
    }

    function readCachedThumbDataUrl(fileId, modifiedTime) {
        if (!global.CardMakerPerf || !global.CardMakerPerf.readThumbCache) {
            return Promise.resolve(null);
        }
        var variants = [
            catalogThumbVariant(),
            global.CardMakerPerf.GRID_THUMB_VARIANT || 'g640',
            global.CardMakerPerf.EDITOR_PREVIEW_VARIANT || 'e1750',
            null
        ];
        var chain = Promise.resolve(null);
        variants.forEach(function (variant) {
            chain = chain.then(function (hit) {
                if (hit) return hit;
                return global.CardMakerPerf.readThumbCache(fileId, modifiedTime, variant).then(function (rec) {
                    return rec && rec.dataUrl ? rec.dataUrl : null;
                });
            });
        });
        return chain;
    }

    function renderThumbDataUrl(state) {
        if (!state || typeof global.renderCardMakerProjectToDataUrl !== 'function') {
            return Promise.resolve(null);
        }
        return global.renderCardMakerProjectToDataUrl(state, catalogThumbRenderOpts()).then(function (url) {
            return url || null;
        }).catch(function () {
            return null;
        });
    }

    function resolveThumbDataUrl(card, source, existingImageUrl) {
        if (existingImageUrl) return Promise.resolve(existingImageUrl);
        var driveId = String(card.id || '').trim();
        if (!driveId) return Promise.resolve(null);

        if (card.questlineItemId && global.WowAuth && typeof global.WowAuth.fetchItemImageUrl === 'function') {
            return global.WowAuth.fetchItemImageUrl(card.questlineItemId).then(function (qlUrl) {
                if (qlUrl) return qlUrl;
                return readCachedThumbDataUrl(driveId, source && source.modifiedTime).then(function (cached) {
                    if (cached) return cached;
                    if (source && source.state) return renderThumbDataUrl(source.state);
                    return null;
                });
            }).catch(function () {
                return readCachedThumbDataUrl(driveId, source && source.modifiedTime).then(function (cached) {
                    if (cached) return cached;
                    if (source && source.state) return renderThumbDataUrl(source.state);
                    return null;
                });
            });
        }

        return readCachedThumbDataUrl(driveId, source && source.modifiedTime).then(function (cached) {
            if (cached) return cached;
            if (source && source.state) return renderThumbDataUrl(source.state);
            return null;
        });
    }

    function shouldKeepExistingImageUrl(url) {
        if (!url) return false;
        if (String(url).indexOf('data:') === 0) return true;
        if (String(url).indexOf('http://') === 0 || String(url).indexOf('https://') === 0) return true;
        return false;
    }

    function enrichCatalogWithImages(cards, sourceMap, options) {
        options = options || {};
        var onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        var existingImages = options.existingImages || Object.create(null);
        var mode = options.imageUrlMode || catalogImageUrlMode();
        var list = (cards || []).slice();
        var thumbBlobs = Object.create(null);
        var i = 0;

        function step() {
            if (i >= list.length) {
                return Promise.resolve({ cards: list, thumbBlobs: thumbBlobs });
            }
            var card = list[i];
            var driveId = String(card.id || '').trim();
            var source = sourceMap[driveId] || null;
            var preservedUrl = shouldKeepExistingImageUrl(existingImages[driveId]) ? existingImages[driveId] : '';
            if (onProgress) onProgress(i + 1, list.length, card.name || driveId);
            return resolveThumbDataUrl(card, source, preservedUrl).then(function (dataUrlOrHttp) {
                var next = Object.assign({}, card);
                if (!dataUrlOrHttp) {
                    list[i] = next;
                    i += 1;
                    return step();
                }
                if (mode === 'dataUrl' && String(dataUrlOrHttp).indexOf('data:') === 0) {
                    next.imageUrl = dataUrlOrHttp;
                } else if (String(dataUrlOrHttp).indexOf('http://') === 0 || String(dataUrlOrHttp).indexOf('https://') === 0) {
                    next.imageUrl = dataUrlOrHttp;
                } else if (String(dataUrlOrHttp).indexOf('data:') === 0) {
                    var blob = dataUrlToBlob(dataUrlOrHttp);
                    if (blob) thumbBlobs[driveId] = blob;
                    next.imageUrl = catalogThumbFileUrl(driveId);
                    if (global.CardMakerPerf && global.CardMakerPerf.writeThumbCache) {
                        global.CardMakerPerf.writeThumbCache(
                            driveId,
                            source && source.modifiedTime,
                            dataUrlOrHttp,
                            catalogThumbVariant()
                        );
                    }
                } else {
                    next.imageUrl = dataUrlOrHttp;
                }
                list[i] = next;
                i += 1;
                return step();
            }).catch(function () {
                list[i] = Object.assign({}, card);
                i += 1;
                return step();
            });
        }

        return step();
    }

    function loadJsZip() {
        if (global.JSZip) return Promise.resolve(global.JSZip);
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            s.async = true;
            s.onload = function () {
                if (global.JSZip) resolve(global.JSZip);
                else reject(new Error('JSZip failed to load.'));
            };
            s.onerror = function () { reject(new Error('Could not load JSZip.')); };
            document.head.appendChild(s);
        });
    }

    function downloadCatalogZip(doc, thumbBlobs) {
        return loadJsZip().then(function (JSZip) {
            var zip = new JSZip();
            zip.file('catalog/wow-card-catalog.json', JSON.stringify(doc, null, 2));
            var folder = zip.folder('catalog/thumbs');
            Object.keys(thumbBlobs || {}).forEach(function (id) {
                var blob = thumbBlobs[id];
                if (blob) folder.file(String(id) + '.jpg', blob);
            });
            return zip.generateAsync({ type: 'blob' });
        }).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'wow-catalog-publish.zip';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                URL.revokeObjectURL(url);
                a.remove();
            }, 0);
        });
    }

    function mapQuestlineRarity(rarity) {
        var s = String(rarity || '').trim().toLowerCase();
        if (!s) return 'common';
        var known = {
            common: true,
            uncommon: true,
            rare: true,
            epic: true,
            legendary: true,
            mythic: true,
            fantastical: true
        };
        return known[s] ? s : 'common';
    }

    function itemMapKey() {
        var cfg = config();
        return cfg.questlineItemMapStorageKey || DEFAULT_ITEM_MAP_KEY;
    }

    function readItemMap() {
        try {
            var raw = localStorage.getItem(itemMapKey());
            if (!raw) return {};
            var data = JSON.parse(raw);
            return data && typeof data === 'object' ? data : {};
        } catch (e) {
            return {};
        }
    }

    function writeItemMap(map) {
        try {
            localStorage.setItem(itemMapKey(), JSON.stringify(map || {}));
        } catch (e) { /* ignore quota */ }
    }

    function setItemMapEntry(driveId, questlineItemId) {
        if (!driveId || !questlineItemId) return;
        var map = readItemMap();
        map[String(driveId)] = String(questlineItemId);
        writeItemMap(map);
    }

    function loadExistingCatalog() {
        var url = config().sharedCardCatalogUrl || 'catalog/wow-card-catalog.json';
        return fetch(url, { cache: 'no-cache' }).then(function (res) {
            if (!res.ok) return { cards: [] };
            return res.json();
        }).catch(function () {
            return { cards: [] };
        });
    }

    function indexExistingIds(existingDoc, itemMap) {
        var byDriveId = Object.create(null);
        var byQlId = Object.create(null);
        var list = Array.isArray(existingDoc)
            ? existingDoc
            : (existingDoc && existingDoc.cards ? existingDoc.cards : []);
        list.forEach(function (raw) {
            if (!raw) return;
            var driveId = String(raw.id || raw.driveFileId || raw.itemId || '').trim();
            var qlId = raw.questlineItemId != null ? String(raw.questlineItemId).trim() : '';
            if (driveId && qlId) byDriveId[driveId] = qlId;
            if (qlId) byQlId[qlId] = qlId;
        });
        Object.keys(itemMap || {}).forEach(function (driveId) {
            var qlId = String(itemMap[driveId] || '').trim();
            if (driveId && qlId) byDriveId[driveId] = qlId;
        });
        return { byDriveId: byDriveId, byQlId: byQlId };
    }

    function buildCatalogEntryFromRow(row) {
        if (!row || !row.id || !row.state || !row.state.fields) return null;
        if (row.state.kind === 'cardmaker-deck') return null;
        var state = row.state;
        var name = titleOf(state, row.fileName);
        if (!name) return null;
        return {
            id: String(row.id),
            questlineItemId: row.questlineItemId != null ? String(row.questlineItemId) : '',
            name: name,
            description: fieldOf(state, 'MainDisciption') || fieldOf(state, 'Description'),
            rarity: fieldOf(state, 'Rarity') || fieldOf(state, 'CardRarity'),
            type: fieldOf(state, 'Type'),
            subtype: fieldOf(state, 'Subtype'),
            setId: fieldOf(state, 'CardMakerSetId'),
            setName: fieldOf(state, 'CardMakerSetName'),
            setNumber: fieldOf(state, 'CardSetNumber'),
            setTotal: fieldOf(state, 'CardSetTotal'),
            treasureCost: fieldOf(state, 'TreasureCost'),
            modifiedTime: row.modifiedTime != null ? String(row.modifiedTime) : null,
            imageUrl: row.imageUrl || row.thumbUrl || ''
        };
    }

    function buildCatalogEntryFromProject(project) {
        if (!project || !project.file || !project.file.id) return null;
        if (!project.state || project.state.kind === 'cardmaker-deck') return null;
        return buildCatalogEntryFromRow({
            id: project.file.id,
            state: project.state,
            modifiedTime: project.file.modifiedTime,
            fileName: project.file.name,
            questlineItemId: project.questlineItemId
        });
    }

    function buildCatalogFromProjects(projects) {
        var cards = [];
        (projects || []).forEach(function (p) {
            var entry = buildCatalogEntryFromProject(p);
            if (entry) cards.push(entry);
        });
        cards.sort(function (a, b) { return a.name.localeCompare(b.name); });
        return cards;
    }

    function buildCatalogFromCacheRows(rows) {
        var cards = [];
        (rows || []).forEach(function (row) {
            var entry = buildCatalogEntryFromRow(row);
            if (entry) cards.push(entry);
        });
        cards.sort(function (a, b) { return a.name.localeCompare(b.name); });
        return cards;
    }

    function applyStoredQuestlineIds(cards, existingDoc, itemMap) {
        var index = indexExistingIds(existingDoc, itemMap);
        return (cards || []).map(function (card) {
            var driveId = String(card.id || '').trim();
            var qlId = card.questlineItemId ? String(card.questlineItemId).trim() : '';
            if (!qlId && driveId && index.byDriveId[driveId]) {
                qlId = index.byDriveId[driveId];
            }
            return Object.assign({}, card, { questlineItemId: qlId || '' });
        });
    }

    function buildCatalogDocument(cards, meta) {
        meta = meta || {};
        return {
            version: 1,
            updatedAt: meta.updatedAt || new Date().toISOString(),
            source: meta.source || 'google-drive',
            cardCount: (cards || []).length,
            cards: cards || []
        };
    }

    function downloadCatalogJson(doc, filename) {
        filename = filename || 'wow-card-catalog.json';
        var blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            URL.revokeObjectURL(url);
            a.remove();
        }, 0);
    }

    function questlineItemPayload(card) {
        var cfg = config();
        var categories = Array.isArray(cfg.questlineItemCategoryIds)
            ? cfg.questlineItemCategoryIds.map(normalizeId).filter(Boolean)
            : [];
        return {
            name: card.name,
            description: card.description || '',
            type: cfg.questlineItemType || 'card',
            rarity: mapQuestlineRarity(card.rarity),
            categories: categories
        };
    }

    function extractCreatedItemId(response) {
        if (response == null) return '';
        if (typeof response === 'string') return response.trim();
        if (response._id != null) return normalizeId(response._id);
        if (response.id != null) return normalizeId(response.id);
        if (response.itemId != null) return normalizeId(response.itemId);
        return '';
    }

    function createQuestlineItemForCard(card) {
        return authedFetch('/item/create', {
            method: 'POST',
            body: questlineItemPayload(card)
        }).then(function (res) {
            var id = extractCreatedItemId(res);
            if (!id) throw new Error('Questline did not return an item id for "' + card.name + '".');
            setItemMapEntry(card.id, id);
            return id;
        });
    }

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function syncQuestlineItems(cards, options) {
        options = options || {};
        var delayMs = options.delayMs != null ? options.delayMs : 250;
        var skipExisting = options.skipExisting !== false;
        var onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        var list = (cards || []).slice();
        var created = 0;
        var skipped = 0;
        var errors = [];

        function step(i) {
            if (i >= list.length) {
                return Promise.resolve({ cards: list, created: created, skipped: skipped, errors: errors });
            }
            var card = list[i];
            if (skipExisting && card.questlineItemId) {
                skipped += 1;
                if (onProgress) onProgress(i + 1, list.length, card, 'skipped');
                return delay(delayMs).then(function () { return step(i + 1); });
            }
            if (onProgress) onProgress(i + 1, list.length, card, 'creating');
            return createQuestlineItemForCard(card).then(function (itemId) {
                list[i] = Object.assign({}, card, { questlineItemId: itemId });
                created += 1;
                return delay(delayMs);
            }).then(function () {
                return step(i + 1);
            }).catch(function (err) {
                errors.push({ card: card, error: err && err.message ? err.message : String(err) });
                if (onProgress) onProgress(i + 1, list.length, card, 'error');
                return delay(delayMs).then(function () { return step(i + 1); });
            });
        }

        return step(0);
    }

    function loadFirebaseCompat() {
        if (global.firebase && global.firebase.firestore) {
            return Promise.resolve(global.firebase);
        }
        var version = '10.14.1';
        var scripts = [
            'https://www.gstatic.com/firebasejs/' + version + '/firebase-app-compat.js',
            'https://www.gstatic.com/firebasejs/' + version + '/firebase-auth-compat.js',
            'https://www.gstatic.com/firebasejs/' + version + '/firebase-firestore-compat.js'
        ];
        function loadScript(src) {
            return new Promise(function (resolve, reject) {
                var existing = document.querySelector('script[src="' + src + '"]');
                if (existing) {
                    existing.addEventListener('load', function () { resolve(); });
                    if (existing.dataset.loaded === '1') resolve();
                    return;
                }
                var s = document.createElement('script');
                s.src = src;
                s.async = false;
                s.onload = function () {
                    s.dataset.loaded = '1';
                    resolve();
                };
                s.onerror = function () { reject(new Error('Could not load ' + src)); };
                document.head.appendChild(s);
            });
        }
        var chain = Promise.resolve();
        scripts.forEach(function (src) {
            chain = chain.then(function () { return loadScript(src); });
        });
        return chain.then(function () {
            if (!global.firebase) throw new Error('Firebase scripts failed to load.');
            return global.firebase;
        });
    }

    function publishCatalogToFirestore(doc) {
        var cfg = global.CardMakerFirebaseConfig;
        if (!cfg || !cfg.projectId) {
            return Promise.reject(new Error('Firebase is not configured (firebase-config.js).'));
        }
        var collection = config().firestoreCatalogCollection || 'wowCardCatalog';
        var docId = config().firestoreCatalogDocId || 'current';
        return loadFirebaseCompat().then(function () {
            var app;
            try {
                app = global.firebase.apps && global.firebase.apps.length
                    ? global.firebase.app()
                    : global.firebase.initializeApp(cfg);
            } catch (e) {
                app = global.firebase.app();
            }
            var auth = app.auth();
            var db = app.firestore();
            return auth.signInAnonymously().then(function () {
                return db.collection(collection).doc(docId).set(doc);
            });
        });
    }

    function runPublish(options) {
        options = options || {};
        var projects = options.projects || [];
        var cacheRows = options.cacheRows || null;
        var syncQuestline = !!options.syncQuestline;
        var pushFirestore = !!options.pushFirestore;
        var onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;

        function status(msg) {
            if (onStatus) onStatus(msg);
        }

        var cards = cacheRows && cacheRows.length
            ? buildCatalogFromCacheRows(cacheRows)
            : buildCatalogFromProjects(projects);

        if (!cards.length) {
            return Promise.reject(new Error('No card saves found to publish.'));
        }

        status('Loading existing catalog…');
        return loadExistingCatalog().then(function (existingDoc) {
            var itemMap = readItemMap();
            cards = applyStoredQuestlineIds(cards, existingDoc, itemMap);

            var syncPromise = syncQuestline
                ? (function () {
                    status('Syncing Questline items…');
                    return syncQuestlineItems(cards, {
                        onProgress: function (n, total, card, phase) {
                            status('Questline ' + phase + ' (' + n + '/' + total + '): ' + card.name);
                        }
                    }).then(function (result) {
                        cards = result.cards;
                        return result;
                    });
                })()
                : Promise.resolve({ created: 0, skipped: cards.filter(function (c) { return c.questlineItemId; }).length, errors: [] });

            return syncPromise.then(function (syncResult) {
                var sourceMap = buildSourceMap(projects, cacheRows);
                var existingImages = indexExistingImages(existingDoc);
                status('Building card images…');
                return enrichCatalogWithImages(cards, sourceMap, {
                    existingImages: existingImages,
                    onProgress: function (n, total, name) {
                        status('Card images (' + n + '/' + total + '): ' + name);
                    }
                }).then(function (enriched) {
                    cards = enriched.cards;
                    var doc = buildCatalogDocument(cards, { source: 'google-drive' });
                    var mode = catalogImageUrlMode();
                    var thumbCount = Object.keys(enriched.thumbBlobs || {}).length;
                    var withImages = cards.filter(function (c) { return c.imageUrl; }).length;

                    if (mode === 'file' && thumbCount > 0) {
                        status('Downloading catalog zip (JSON + ' + thumbCount + ' images)…');
                        return downloadCatalogZip(doc, enriched.thumbBlobs).then(function () {
                            return {
                                document: doc,
                                sync: syncResult,
                                imageCount: withImages,
                                thumbFileCount: thumbCount,
                                deliveredAs: 'zip'
                            };
                        });
                    }

                    status('Downloading catalog/wow-card-catalog.json…');
                    downloadCatalogJson(doc);
                    return {
                        document: doc,
                        sync: syncResult,
                        imageCount: withImages,
                        thumbFileCount: thumbCount,
                        deliveredAs: 'json'
                    };
                }).then(function (publishResult) {
                    var firestorePromise = pushFirestore
                        ? publishCatalogToFirestore(publishResult.document).then(function () {
                            status('Firestore catalog updated.');
                            return true;
                        }).catch(function (err) {
                            return { firestoreError: err && err.message ? err.message : String(err) };
                        })
                        : Promise.resolve(false);

                    return firestorePromise.then(function (firestoreResult) {
                        return Object.assign({}, publishResult, {
                            firestore: firestoreResult,
                            cardCount: cards.length
                        });
                    });
                });
            });
        });
    }

    global.WowCatalogPublish = {
        buildCatalogFromProjects: buildCatalogFromProjects,
        buildCatalogFromCacheRows: buildCatalogFromCacheRows,
        buildCatalogDocument: buildCatalogDocument,
        applyStoredQuestlineIds: applyStoredQuestlineIds,
        enrichCatalogWithImages: enrichCatalogWithImages,
        downloadCatalogJson: downloadCatalogJson,
        downloadCatalogZip: downloadCatalogZip,
        syncQuestlineItems: syncQuestlineItems,
        publishCatalogToFirestore: publishCatalogToFirestore,
        runPublish: runPublish,
        readItemMap: readItemMap,
        mapQuestlineRarity: mapQuestlineRarity,
        catalogThumbFileUrl: catalogThumbFileUrl
    };
})(window);
