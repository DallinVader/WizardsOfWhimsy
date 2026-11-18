/**
 * Questline account sign-in for Wizards of Whimsy (JWT in localStorage).
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'wow_questline_auth_v1';
    var GUEST_PLAY_KEY = 'wow_card_player_guest_v1';
    var PLAYER_PAGES = {
        'deck-builder.html': true,
        'card-player.html': true,
        'account.html': true
    };
    var ADMIN_PAGES = {
        'editor.html': true,
        'saved-projects.html': true,
        'card-grid.html': true
    };
    var ADMIN_ONLY_NAV_IDS = {
        editor: true,
        saved: true,
        print: true
    };

    function adminPermissions() {
        var cfg = global.WowAuthConfig || {};
        return cfg.adminPermissions || ['[Permission] superAdmin'];
    }

    function isAdmin(user) {
        if (!user || !Array.isArray(user.permissions)) return false;
        var required = adminPermissions();
        var i;
        for (i = 0; i < required.length; i++) {
            if (user.permissions.indexOf(required[i]) !== -1) return true;
        }
        return false;
    }

    function isProtectedPage(page) {
        return !!(PLAYER_PAGES[page] || ADMIN_PAGES[page]);
    }

    function isPlayerPage(page) {
        return !!PLAYER_PAGES[page];
    }

    function apiBase() {
        var cfg = global.WowAuthConfig || {};
        return String(cfg.apiBase || 'https://api.questline.fun').replace(/\/$/, '');
    }

    function currentPageName() {
        return (global.location.pathname || '').split('/').pop() || '';
    }

    function readSession() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (!data || !data.token) return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    function writeSession(session) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }

    function clearSession() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* ignore */ }
    }

    function userDisplayName(user) {
        if (!user) return 'Account';
        var p = user.profile || {};
        var name = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
        if (name) return name;
        if (p.email) return p.email;
        if (user.username) return user.username;
        return 'Account';
    }

    function parseErrorMessage(errBody, fallback) {
        if (!errBody) return fallback;
        if (typeof errBody === 'string') return errBody;
        if (errBody.message) {
            if (Array.isArray(errBody.message)) return errBody.message.join(' ');
            return String(errBody.message);
        }
        return fallback;
    }

    function apiFetch(path, options) {
        options = options || {};
        var url = apiBase() + path;
        var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
        if (options.body && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
        return fetch(url, {
            method: options.method || 'GET',
            headers: headers,
            body: options.body != null ? JSON.stringify(options.body) : undefined
        }).then(function (res) {
            return res.text().then(function (text) {
                var data = null;
                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch (e) {
                        data = text;
                    }
                }
                if (!res.ok) {
                    var err = new Error(parseErrorMessage(data, res.statusText || 'Request failed'));
                    err.status = res.status;
                    err.body = data;
                    throw err;
                }
                return data;
            });
        });
    }

    function authedFetch(path, options) {
        var session = readSession();
        if (!session || !session.token) {
            return Promise.reject(new Error('Not signed in'));
        }
        options = options || {};
        options.headers = Object.assign({}, options.headers || {}, {
            Authorization: 'Bearer ' + session.token
        });
        return apiFetch(path, options);
    }

    function normalizeId(value) {
        if (value == null) return '';
        if (typeof value === 'object' && value.$oid) return String(value.$oid);
        if (typeof value === 'object' && value._id != null) return normalizeId(value._id);
        return String(value);
    }

    function fetchItemById(itemId) {
        var id = normalizeId(itemId);
        if (!id) return Promise.resolve(null);
        return authedFetch('/item/' + encodeURIComponent(id)).catch(function () {
            return null;
        });
    }

    function fetchItemImageUrl(itemId) {
        var id = normalizeId(itemId);
        if (!id) return Promise.resolve(null);
        return apiFetch('/media/public/latest', {
            method: 'POST',
            body: { collection: 'item', documentId: id }
        }).then(function (docs) {
            if (!docs || !docs.length) return null;
            return docs[0].url || null;
        }).catch(function () {
            return null;
        });
    }

    function isActiveItem(item) {
        if (!item) return false;
        if (item.status === 0 || item.status === 'InActive' || item.status === 'inactive') return false;
        return true;
    }

    function cardClassificationConfig() {
        var cfg = global.WowAuthConfig || {};
        return {
            types: (cfg.cardItemTypes || ['card']).map(function (t) {
                return String(t).toLowerCase().trim();
            }).filter(Boolean),
            categoryIds: (cfg.cardCategoryIds || []).map(normalizeId).filter(Boolean),
            categoryNamePatterns: (cfg.cardCategoryNamePatterns || ['card', 'whimsy']).map(function (p) {
                return String(p).toLowerCase().trim();
            }).filter(Boolean)
        };
    }

    function categoryNameMatchesCard(name, patterns) {
        var lower = String(name || '').toLowerCase();
        if (!lower) return false;
        var i;
        for (i = 0; i < patterns.length; i++) {
            if (lower.indexOf(patterns[i]) !== -1) return true;
        }
        return false;
    }

    function isOwnedCard(entry, categoryMap) {
        var rules = cardClassificationConfig();
        var type = entry.type ? String(entry.type).toLowerCase().trim() : '';
        if (type && rules.types.indexOf(type) !== -1) return true;

        var cats = entry.categories || [];
        var i;
        for (i = 0; i < cats.length; i++) {
            var cid = normalizeId(cats[i]);
            if (!cid) continue;
            if (rules.categoryIds.indexOf(cid) !== -1) return true;
            if (categoryMap && categoryNameMatchesCard(categoryMap[cid], rules.categoryNamePatterns)) {
                return true;
            }
        }
        return false;
    }

    function fetchCategoryMap() {
        return authedFetch('/item-category/list', {
            method: 'POST',
            body: {
                pagination: { page: 1, limit: 500, sortField: 'name', sortOrder: 1 }
            }
        }).then(function (res) {
            var map = {};
            (res && res.docs ? res.docs : []).forEach(function (cat) {
                var id = normalizeId(cat && cat._id);
                if (id) map[id] = cat.name || '';
            });
            return map;
        }).catch(function () {
            return {};
        });
    }

    function splitOwnedEntries(entries, categoryMap) {
        var cards = [];
        var items = [];
        entries.forEach(function (entry) {
            if (isOwnedCard(entry, categoryMap)) {
                cards.push(entry);
            } else {
                items.push(entry);
            }
        });
        cards.sort(function (a, b) { return a.name.localeCompare(b.name); });
        items.sort(function (a, b) { return a.name.localeCompare(b.name); });
        return { cards: cards, items: items };
    }

    function loadOwnedInventory() {
        return refreshSessionUser().then(function (session) {
            var user = session.user || {};
            var owned = Array.isArray(user.ownedItems) ? user.ownedItems : [];
            if (!owned.length) {
                return {
                    user: user,
                    questCoin: user.questCoin || 0,
                    cards: [],
                    items: []
                };
            }
            return fetchCategoryMap().then(function (categoryMap) {
                return Promise.all(owned.map(function (entry) {
                    var itemId = normalizeId(entry.itemId);
                    var quantity = entry.quantity || 1;
                    return Promise.all([
                        fetchItemById(itemId),
                        fetchItemImageUrl(itemId)
                    ]).then(function (parts) {
                        var item = parts[0];
                        if (!isActiveItem(item)) {
                            return null;
                        }
                        var imageUrl = parts[1];
                        return {
                            itemId: itemId,
                            quantity: quantity,
                            name: item.name ? item.name : ('Item #' + itemId.slice(-6)),
                            description: item.description ? item.description : '',
                            rarity: item.rarity != null ? item.rarity : '',
                            type: item.type ? item.type : '',
                            categories: Array.isArray(item.categories)
                                ? item.categories.map(normalizeId).filter(Boolean)
                                : [],
                            imageUrl: imageUrl
                        };
                    });
                })).then(function (entries) {
                    entries = entries.filter(function (entry) { return entry != null; });
                    var split = splitOwnedEntries(entries, categoryMap);
                    return {
                        user: user,
                        questCoin: user.questCoin || 0,
                        cards: split.cards,
                        items: split.items
                    };
                });
            });
        });
    }

    function fetchUser(token) {
        return apiFetch('/user', {
            headers: { Authorization: 'Bearer ' + token }
        });
    }

    function clearCardPlayerGuest() {
        try {
            sessionStorage.removeItem(GUEST_PLAY_KEY);
        } catch (e) { /* ignore */ }
    }

    function isCardPlayerGuest() {
        try {
            return sessionStorage.getItem(GUEST_PLAY_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function continueAsCardPlayerGuest() {
        try {
            sessionStorage.setItem(GUEST_PLAY_KEY, '1');
        } catch (e) { /* ignore */ }
        return 'card-player.html';
    }

    function login(email, password) {
        return apiFetch('/auth/login', {
            method: 'POST',
            body: { email: String(email || '').trim().toLowerCase(), password: password }
        }).then(function (tokens) {
            return fetchUser(tokens.token).then(function (user) {
                var session = {
                    token: tokens.token,
                    refresh: tokens.refresh,
                    user: user
                };
                clearCardPlayerGuest();
                writeSession(session);
                syncNav();
                return session;
            });
        });
    }

    function register(firstName, lastName, email, password) {
        return apiFetch('/user/register', {
            method: 'POST',
            body: {
                firstName: String(firstName || '').trim(),
                lastName: String(lastName || '').trim(),
                email: String(email || '').trim().toLowerCase(),
                password: password
            }
        }).then(function (tokens) {
            return fetchUser(tokens.token).then(function (user) {
                var session = {
                    token: tokens.token,
                    refresh: tokens.refresh,
                    user: user
                };
                clearCardPlayerGuest();
                writeSession(session);
                syncNav();
                return session;
            });
        });
    }

    function logout() {
        clearSession();
        clearCardPlayerGuest();
        syncNav();
    }

    function isSignedIn() {
        var s = readSession();
        return !!(s && s.token);
    }

    function getSession() {
        return readSession();
    }

    function refreshSessionUser() {
        var session = readSession();
        if (!session || !session.token) return Promise.resolve(null);
        return fetchUser(session.token).then(function (user) {
            session.user = user;
            writeSession(session);
            syncNav();
            return session;
        }).catch(function (err) {
            if (err && (err.status === 401 || err.status === 403)) {
                clearSession();
                syncNav();
            }
            throw err;
        });
    }

    function signInUrl(redirectPath) {
        var redir = redirectPath || currentPageName() || 'deck-builder.html';
        return 'sign-in.html?redirect=' + encodeURIComponent(redir);
    }

    function redirectToSignIn() {
        var page = currentPageName();
        if (page === 'sign-in.html') return;
        global.location.replace(signInUrl(page + (global.location.search || '')));
    }

    function redirectToPlayerHome() {
        global.location.replace('deck-builder.html');
    }

    function gatePage() {
        var page = currentPageName();
        if (!isProtectedPage(page)) return Promise.resolve(getSession());
        /* Guest play is allowed only on the card player. */
        if (page === 'card-player.html' && !isSignedIn() && isCardPlayerGuest()) {
            return Promise.resolve(null);
        }
        if (!isSignedIn()) {
            redirectToSignIn();
            return Promise.reject(new Error('auth_required'));
        }
        document.documentElement.classList.add('wow-auth-pending');
        return refreshSessionUser().then(function (session) {
            if (ADMIN_PAGES[page] && !isAdmin(session.user)) {
                document.documentElement.classList.remove('wow-auth-pending');
                redirectToPlayerHome();
                return Promise.reject(new Error('admin_required'));
            }
            document.documentElement.classList.remove('wow-auth-pending');
            return session;
        }, function (err) {
            document.documentElement.classList.remove('wow-auth-pending');
            if (err && (err.message === 'auth_required' || err.message === 'admin_required')) throw err;
            redirectToSignIn();
            return Promise.reject(err);
        });
    }

    function filterNavPages(pages) {
        if (!Array.isArray(pages)) return pages;
        var session = readSession();
        var admin = session && session.user && isAdmin(session.user);
        var signedIn = !!(session && session.token);
        return pages.filter(function (p) {
            if (p.id === 'account') return signedIn;
            if (ADMIN_ONLY_NAV_IDS[p.id]) return admin;
            return true;
        });
    }

    function updateNavAuth() {
        var slot = document.getElementById('cmAppNavAuth');
        if (!slot) return;
        var session = readSession();
        if (session && session.token) {
            slot.innerHTML =
                '<a class="cm-app-nav-user cm-app-nav-user-link" href="account.html" title="View account">' +
                    escapeHtml(userDisplayName(session.user)) +
                '</a>' +
                '<button type="button" class="cm-app-nav-auth-btn cm-app-nav-auth-btn--ghost" id="cmAppNavSignOut">Sign out</button>';
            var out = document.getElementById('cmAppNavSignOut');
            if (out) {
                out.addEventListener('click', function () {
                    logout();
                    var page = currentPageName();
                    if (isProtectedPage(page)) {
                        global.location.href = signInUrl(page);
                    }
                });
            }
        } else {
            var redir = encodeURIComponent(currentPageName() || 'deck-builder.html');
            var guestNote = isCardPlayerGuest() && currentPageName() === 'card-player.html'
                ? '<span class="cm-app-nav-user" title="Playing as guest">Guest</span>'
                : '';
            slot.innerHTML =
                guestNote +
                '<a class="cm-app-nav-auth-btn" href="sign-in.html?redirect=' + redir + '">Sign in</a>';
        }
    }

    function syncNav() {
        if (global.CardMakerNav && typeof global.CardMakerNav.refresh === 'function') {
            global.CardMakerNav.refresh();
        } else {
            updateNavAuth();
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    function removeOwnedItem(itemId, quantity) {
        var id = normalizeId(itemId);
        if (!id) return Promise.reject(new Error('Invalid item.'));
        var q = parseInt(quantity, 10);
        if (!isFinite(q) || q < 1) q = 1;
        return authedFetch('/user/remove-item/' + encodeURIComponent(id), {
            method: 'POST',
            body: { quantity: q }
        }).then(function () {
            return refreshSessionUser();
        });
    }

    function aggregateOwnedQuantities(ownedItems) {
        var map = Object.create(null);
        (ownedItems || []).forEach(function (entry) {
            var id = normalizeId(entry && entry.itemId);
            if (!id) return;
            var q = parseInt(entry.quantity, 10);
            if (!isFinite(q) || q < 1) q = 1;
            map[id] = (map[id] || 0) + q;
        });
        return map;
    }

    function removeItemQuantity(itemId, quantity) {
        var id = normalizeId(itemId);
        var q = parseInt(quantity, 10);
        if (!id || !isFinite(q) || q < 1) return Promise.resolve();

        return authedFetch('/user/remove-item/' + encodeURIComponent(id), {
            method: 'POST',
            body: { quantity: q }
        }).catch(function () {
            // Some Questline builds ignore quantity — fall back to one-at-a-time.
            var chain = Promise.resolve();
            var i;
            for (i = 0; i < q; i++) {
                chain = chain.then(function () {
                    return authedFetch('/user/remove-item/' + encodeURIComponent(id), {
                        method: 'POST',
                        body: { quantity: 1 }
                    }).catch(function () {
                        return null;
                    });
                });
            }
            return chain;
        });
    }

    function removeAllOwnedItems(entries) {
        var list = (entries || []).map(function (entry) {
            var id = normalizeId(entry && (entry.itemId || entry.questlineItemId));
            var qty = parseInt(entry && entry.quantity, 10) || 0;
            return id && qty > 0 ? { id: id, qty: qty } : null;
        }).filter(Boolean);

        if (!list.length) {
            return Promise.resolve(null);
        }

        var chain = Promise.resolve();
        list.forEach(function (item) {
            chain = chain.then(function () {
                return removeItemQuantity(item.id, item.qty);
            });
        });
        return chain.then(function () {
            return refreshSessionUser();
        });
    }

    /**
     * Admin helper: remove every owned catalog card (and Questline card-typed items)
     * from the signed-in user's inventory. Retries until none remain.
     */
    function clearOwnedCards() {
        var catalogPromise = global.WowCardCatalog && typeof global.WowCardCatalog.loadSharedCatalog === 'function'
            ? global.WowCardCatalog.loadSharedCatalog()
            : Promise.resolve({ cards: [] });

        return catalogPromise.then(function (catalog) {
            var catalogCardIds = Object.create(null);
            (catalog.cards || []).forEach(function (card) {
                var qlId = normalizeId(card && card.questlineItemId);
                if (qlId) catalogCardIds[qlId] = true;
            });

            function listCardEntriesToClear(user, inventoryCards) {
                var agg = aggregateOwnedQuantities(user && user.ownedItems);
                var ids = Object.create(null);

                Object.keys(agg).forEach(function (id) {
                    if (catalogCardIds[id]) ids[id] = agg[id];
                });

                (inventoryCards || []).forEach(function (card) {
                    var id = normalizeId(card && card.itemId);
                    if (!id) return;
                    var q = parseInt(card.quantity, 10);
                    if (!isFinite(q) || q < 1) q = 1;
                    ids[id] = Math.max(ids[id] || 0, q);
                });

                return Object.keys(ids).map(function (id) {
                    return { id: id, qty: ids[id] };
                });
            }

            function pass(attempt) {
                if (attempt > 10) {
                    return refreshSessionUser().then(function (session) {
                        var left = listCardEntriesToClear(session && session.user, []);
                        if (left.length) {
                            throw new Error(
                                'Reset stopped with ' + left.length +
                                ' card type(s) still in inventory. Try again.'
                            );
                        }
                        return session;
                    });
                }

                return loadOwnedInventory().then(function (inv) {
                    var entries = listCardEntriesToClear(inv.user, inv.cards);
                    if (!entries.length) {
                        return inv;
                    }

                    var chain = Promise.resolve();
                    entries.forEach(function (item) {
                        chain = chain.then(function () {
                            return removeItemQuantity(item.id, item.qty);
                        });
                    });

                    return chain.then(function () {
                        return refreshSessionUser();
                    }).then(function () {
                        return pass(attempt + 1);
                    });
                });
            }

            return pass(1);
        });
    }

    function loadAccountData() {
        var cfg = global.WowAuthConfig || {};
        var cardsSource = cfg.accountCardsSource || 'catalog';
        var catalogPromise = (cardsSource === 'catalog' || cardsSource === 'both') &&
            global.WowCardCatalog && typeof global.WowCardCatalog.loadSharedCatalog === 'function'
            ? global.WowCardCatalog.loadSharedCatalog()
            : Promise.resolve({ cards: [], updatedAt: null, source: 'none' });
        var inventoryPromise = (cardsSource === 'questline' || cardsSource === 'both')
            ? loadOwnedInventory()
            : refreshSessionUser().then(function (session) {
                return {
                    user: session.user,
                    questCoin: session.user ? (session.user.questCoin || 0) : 0,
                    cards: [],
                    items: []
                };
            }).then(function (base) {
                if (cardsSource !== 'both') return base;
                return loadOwnedInventory().then(function (inv) {
                    base.items = inv.items || [];
                    return base;
                });
            });

        if (cardsSource === 'catalog') {
            return Promise.all([refreshSessionUser(), catalogPromise]).then(function (parts) {
                var session = parts[0];
                var catalog = parts[1];
                var user = session && session.user ? session.user : {};
                var ownedItems = Array.isArray(user.ownedItems) ? user.ownedItems : [];
                var mergedCards = global.WowCardCatalog && typeof global.WowCardCatalog.mergeWithOwnership === 'function'
                    ? global.WowCardCatalog.mergeWithOwnership(catalog.cards || [], ownedItems)
                    : (catalog.cards || []);
                return loadOwnedInventory().then(function (inv) {
                    return {
                        user: user,
                        questCoin: user.questCoin || 0,
                        cards: mergedCards,
                        catalogTotal: (catalog.cards || []).length,
                        items: inv.items || [],
                        catalogUpdatedAt: catalog.updatedAt || null,
                        cardsSource: 'catalog'
                    };
                }).catch(function () {
                    return {
                        user: user,
                        questCoin: user.questCoin || 0,
                        cards: mergedCards,
                        catalogTotal: (catalog.cards || []).length,
                        items: [],
                        catalogUpdatedAt: catalog.updatedAt || null,
                        cardsSource: 'catalog'
                    };
                });
            });
        }

        return inventoryPromise.then(function (inv) {
            if (cardsSource !== 'both') {
                inv.cardsSource = 'questline';
                inv.catalogTotal = inv.cards ? inv.cards.length : 0;
                return inv;
            }
            return catalogPromise.then(function (catalog) {
                var ownedItems = inv.user && Array.isArray(inv.user.ownedItems) ? inv.user.ownedItems : [];
                var mergedCards = global.WowCardCatalog && typeof global.WowCardCatalog.mergeWithOwnership === 'function'
                    ? global.WowCardCatalog.mergeWithOwnership(catalog.cards || [], ownedItems)
                    : (catalog.cards || []);
                return {
                    user: inv.user,
                    questCoin: inv.questCoin,
                    cards: mergedCards,
                    catalogTotal: (catalog.cards || []).length,
                    items: inv.items || [],
                    catalogUpdatedAt: catalog.updatedAt || null,
                    cardsSource: 'both'
                };
            });
        });
    }

    global.WowAuth = {
        login: login,
        register: register,
        logout: logout,
        isSignedIn: isSignedIn,
        isAdmin: isAdmin,
        getSession: getSession,
        refreshSessionUser: refreshSessionUser,
        isOwnedCard: isOwnedCard,
        loadOwnedInventory: loadOwnedInventory,
        loadAccountData: loadAccountData,
        gatePage: gatePage,
        filterNavPages: filterNavPages,
        isPlayerPage: isPlayerPage,
        updateNavAuth: updateNavAuth,
        signInUrl: signInUrl,
        isCardPlayerGuest: isCardPlayerGuest,
        continueAsCardPlayerGuest: continueAsCardPlayerGuest,
        clearCardPlayerGuest: clearCardPlayerGuest,
        userDisplayName: userDisplayName,
        apiFetch: apiFetch,
        authedFetch: authedFetch,
        normalizeId: normalizeId,
        fetchItemImageUrl: fetchItemImageUrl,
        removeOwnedItem: removeOwnedItem,
        removeAllOwnedItems: removeAllOwnedItems,
        clearOwnedCards: clearOwnedCards
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateNavAuth);
    } else {
        setTimeout(updateNavAuth, 0);
    }
})(window);
