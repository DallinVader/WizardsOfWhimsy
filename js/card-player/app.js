/**
 * Card Player — app bootstrap: store, view, interactions, modals, Drive, Firebase.
 */
(function () {
    'use strict';

    var SIDEBAR_KEY = 'cardmaker_cp_sidebar_collapsed_v1';
    var ONBOARD_KEY = 'cardmaker_cp_onboarding_dismissed_v1';

    var store = CardPlayerStore.create();
    var library = CardPlayerLibrary.create();
    var sfx = CardPlayerSfx.create();
    var root = document.querySelector('.cp-wrap') || document.body;
    var view = CardPlayerBoardView.create({ store: store, library: library, root: root });
    var sync = CardPlayerFirebaseSync.create({
        store: store,
        onStatus: setStatus
    });
    var turns = CardPlayerTurns.create({
        store: store,
        onStatus: setStatus
    });

    var Z = store.ZONES;
    var deckBuilderQty = Object.create(null);

    function $(id) { return document.getElementById(id); }

    function setStatus(msg) {
        var el = $('cpStatus');
        if (el) el.textContent = msg || '';
    }

    function setFirebaseStatus(msg) {
        var el = $('cpFirebaseStatus');
        if (el) el.textContent = msg || '';
    }

    function openModal(id) {
        var m = $(id);
        if (!m) return;
        m.classList.add('is-open');
        m.setAttribute('aria-hidden', 'false');
    }

    function closeModal(id) {
        var m = $(id);
        if (!m) return;
        m.classList.remove('is-open');
        m.setAttribute('aria-hidden', 'true');
    }

    function activeBoard() {
        return store.activeBoardId();
    }

    function refreshStats() {
        var all = library.allCards();
        var deckN = store.getDeckIds(activeBoard()).length;
        var libEl = $('cpStatLibrary');
        var deckEl = $('cpStatDeck');
        if (libEl) libEl.textContent = 'Library: ' + all.length;
        if (deckEl) deckEl.textContent = 'Deck: ' + deckN;
        var ready = $('cpReadyBanner');
        if (ready) ready.hidden = deckN === 0;
        var drawBtn = $('cpDraw');
        if (drawBtn) drawBtn.disabled = deckN === 0;
        var draw7 = $('cpDrawHand');
        if (draw7) draw7.disabled = deckN === 0;
        var onboardDraw7 = $('cpOnboardDraw7');
        if (onboardDraw7) onboardDraw7.disabled = deckN === 0;
        var nameEl = $('cpCommanderName');
        if (nameEl) {
            var cid = store.getState().commanderId;
            nameEl.textContent = cid ? library.displayName(cid) : '—';
        }
        var clearCmd = $('cpClearCommander');
        if (clearCmd) clearCmd.disabled = !store.getState().commanderId;
    }

    function persistActiveDeck() {
        library.saveDeckIds(store.getDeckIds(activeBoard()));
    }

    function applyDeckToActive(ids) {
        store.setDeck(activeBoard(), ids);
        persistActiveDeck();
        library.prefetchIds(ids, 16);
        refreshStats();
        setStatus('Deck loaded (' + ids.length + ' cards)');
    }

    function hydrateDeckFromStorage() {
        var ids = library.loadPersistedDeckIds().filter(function (id) {
            return !!library.getById(id);
        });
        store.setDeck('p1', ids);
        store.setDeck('p2', ids.slice());
        var cmd = library.getCommanderId();
        if (cmd && library.getById(cmd)) store.setCommander(cmd);
        refreshStats();
    }

    /* —— Modals: Draw N —— */
    function wireDrawN() {
        var openBtn = $('cpDrawN');
        var closeBtn = $('cpDrawNModalClose');
        var backdrop = $('cpDrawNModalBackdrop');
        var confirm = $('cpDrawNConfirm');
        if (openBtn) openBtn.addEventListener('click', function () { openModal('cpDrawNModal'); });
        if (closeBtn) closeBtn.addEventListener('click', function () { closeModal('cpDrawNModal'); });
        if (backdrop) backdrop.addEventListener('click', function () { closeModal('cpDrawNModal'); });
        if (confirm) confirm.addEventListener('click', function () {
            var n = parseInt((($('cpDrawNInput') && $('cpDrawNInput').value) || '1'), 10);
            if (isNaN(n) || n < 1) n = 1;
            var drawn = store.drawToHand(activeBoard(), n);
            sfx.draw();
            setStatus('Drew ' + drawn.length);
            closeModal('cpDrawNModal');
            refreshStats();
        });
    }

    /* —— Deck / discard / treasure search —— */
    function renderSearchList(containerId, cards, onPick) {
        var box = $(containerId);
        if (!box) return;
        box.innerHTML = '';
        if (!cards.length) {
            box.innerHTML = '<p class="cp-muted" style="padding:12px;">No cards</p>';
            return;
        }
        cards.forEach(function (c) {
            var row = document.createElement('div');
            row.className = 'cp-modal-row';
            row.innerHTML = '<span></span><button type="button" class="cp-btn">Take</button>';
            row.querySelector('span').textContent = library.displayName(c.libId);
            row.querySelector('button').addEventListener('click', function () { onPick(c); });
            box.appendChild(row);
        });
    }

    function openDeckSearch(boardId) {
        var ids = store.getDeckIds(boardId);
        var fake = ids.map(function (libId, i) {
            return { id: 'deck-' + i, libId: libId, _i: i };
        });
        openModal('cpDeckSearchModal');
        renderSearchList('cpDeckSearchList', fake, function (c) {
            var d = store.getDeckIds(boardId);
            var idx = c._i;
            if (idx < 0 || idx >= d.length) return;
            var libId = d.splice(idx, 1)[0];
            store.setDeck(boardId, d);
            store.addCard(boardId, { libId: libId, zone: Z.HAND, fromDeck: true, order: store.nextOrder(boardId, Z.HAND) });
            sfx.draw();
            closeModal('cpDeckSearchModal');
            refreshStats();
        });
    }

    function openDiscardSearch(boardId) {
        openModal('cpDiscardSearchModal');
        renderSearchList('cpDiscardSearchList', store.cardsInZone(boardId, Z.DISCARD), function (c) {
            store.moveCard(c.id, { zone: Z.HAND });
            sfx.draw();
            closeModal('cpDiscardSearchModal');
        });
    }

    function openTreasureModal(boardId) {
        openModal('cpTreasureModal');
        renderSearchList('cpTreasureList', store.cardsInZone(boardId, Z.TREASURE), function (c) {
            store.moveCard(c.id, { rot: ((c.rot || 0) + 90) % 360 });
            sfx.place();
            openTreasureModal(boardId);
        });
    }

    function wireSimpleModals() {
        ['cpDeckSearchModal', 'cpDiscardSearchModal', 'cpTreasureModal', 'cpCommanderModal', 'cpDeckModal'].forEach(function (id) {
            var close = $(id + 'Close');
            var backdrop = $(id + 'Backdrop');
            if (close) close.addEventListener('click', function () { closeModal(id); });
            if (backdrop) backdrop.addEventListener('click', function () { closeModal(id); });
        });
    }

    /* —— Commander —— */
    function openCommanderModal() {
        var box = $('cpCommanderList');
        if (!box) return;
        box.innerHTML = '';
        library.allCards().forEach(function (c) {
            var row = document.createElement('div');
            row.className = 'cp-modal-row';
            row.innerHTML = '<span></span><button type="button" class="cp-btn cp-btn-primary">Select</button>';
            row.querySelector('span').textContent = c.name || library.displayName(c.id);
            row.querySelector('button').addEventListener('click', function () {
                store.setCommander(c.id);
                library.setCommanderId(c.id);
                closeModal('cpCommanderModal');
                refreshStats();
                setStatus('Commander set');
            });
            box.appendChild(row);
        });
        openModal('cpCommanderModal');
    }

    /* —— Quick deck builder —— */
    function renderDeckBuilder() {
        var box = $('cpDeckLibList');
        var q = (($('cpDeckLibSearch') && $('cpDeckLibSearch').value) || '').toLowerCase();
        var hideZero = $('cpDeckHideZero') && $('cpDeckHideZero').checked;
        box.innerHTML = '';
        var guest = library.isGuestPlay && library.isGuestPlay();
        library.allCards().forEach(function (c) {
            if (!library.owns(c.id) && !library.isAdmin() && !guest) return;
            var qty = deckBuilderQty[c.id] | 0;
            var maxQ = library.ownedQty(c.id);
            if (hideZero && qty === 0) return;
            if (q && (c.name || '').toLowerCase().indexOf(q) === -1 && c.id.toLowerCase().indexOf(q) === -1) return;
            var row = document.createElement('div');
            row.className = 'cp-modal-row';
            row.innerHTML =
                '<span></span>' +
                '<label class="cp-qty">Qty <input type="number" min="0" max="' + maxQ + '" value="' + qty + '" /></label>';
            row.querySelector('span').textContent = c.name || c.id;
            row.querySelector('input').addEventListener('change', function (ev) {
                var v = Math.max(0, parseInt(ev.target.value, 10) || 0);
                if (!library.isAdmin()) v = Math.min(v, maxQ);
                deckBuilderQty[c.id] = v;
                ev.target.value = String(v);
                updateDeckBuilderSummary();
            });
            box.appendChild(row);
        });
        updateDeckBuilderSummary();
    }

    function updateDeckBuilderSummary() {
        var total = 0;
        Object.keys(deckBuilderQty).forEach(function (id) { total += deckBuilderQty[id] | 0; });
        var el = $('cpDeckSummary');
        if (el) el.textContent = total + ' cards in list';
    }

    function buildIdsFromQty() {
        var ids = [];
        Object.keys(deckBuilderQty).forEach(function (id) {
            var n = deckBuilderQty[id] | 0;
            var i;
            for (i = 0; i < n; i++) ids.push(id);
        });
        return ids;
    }

    function openDeckModal() {
        deckBuilderQty = Object.create(null);
        store.getDeckIds(activeBoard()).forEach(function (id) {
            deckBuilderQty[id] = (deckBuilderQty[id] | 0) + 1;
        });
        var nameInput = $('cpDeckNameInput');
        if (nameInput) nameInput.value = library.getDeckName();
        renderDeckBuilder();
        refreshDriveDeckList();
        openModal('cpDeckModal');
    }

    function deckFileName(name) {
        var base = String(name || 'play-deck').trim().replace(/[^\w\-]+/g, '-').replace(/-+/g, '-') || 'play-deck';
        var ext = (window.CPDrive && CPDrive.DECK_FILE_EXTENSION) || '.cardmaker-deck.json';
        if (base.toLowerCase().endsWith(ext.toLowerCase())) return base;
        return base + ext;
    }

    function refreshDriveDeckList() {
        var box = $('cpDriveDeckList');
        if (!box) return;
        box.innerHTML = '<p class="cp-muted" style="padding:10px;">Checking Drive…</p>';
        if (!window.CPDrive || !CPDrive.hasDriveConfig || !CPDrive.hasDriveConfig()) {
            box.innerHTML = '<p class="cp-muted" style="padding:10px;">Drive not configured.</p>';
            return;
        }
        if (!CPDrive.isSignedIn || !CPDrive.isSignedIn()) {
            box.innerHTML = '<p class="cp-muted" style="padding:10px;">Sign in to Drive from Card Maker to load decks.</p>';
            return;
        }
        CPDrive.ensureDriveTokenBeforeDriveOp().then(function (ok) {
            if (!ok) {
                box.innerHTML = '<p class="cp-muted" style="padding:10px;">Drive auth required.</p>';
                return null;
            }
            return CPDrive.listDeckFiles();
        }).then(function (files) {
            if (!files) return;
            box.innerHTML = '';
            if (!files.length) {
                box.innerHTML = '<p class="cp-muted" style="padding:10px;">No saved decks.</p>';
                return;
            }
            files.forEach(function (f) {
                var row = document.createElement('div');
                row.className = 'cp-modal-row';
                row.innerHTML = '<span></span><button type="button" class="cp-btn cp-btn-primary">Load</button>';
                row.querySelector('span').textContent = f.name || f.id;
                row.querySelector('button').addEventListener('click', function () {
                    CPDrive.fetchDriveFileMedia(f.id).then(function (text) {
                        var data = JSON.parse(text);
                        var ids = (data && data.cardIds) || (data && data.deckIds) || [];
                        ids = ids.filter(function (id) { return !!library.getById(id); });
                        applyDeckToActive(ids);
                        if (data && data.name) library.setDeckName(data.name);
                        if (data && data.commanderId && library.getById(data.commanderId)) {
                            store.setCommander(data.commanderId);
                            library.setCommanderId(data.commanderId);
                        }
                        closeModal('cpDeckModal');
                        refreshStats();
                    }).catch(function (err) {
                        setStatus('Load failed: ' + (err && err.message ? err.message : err));
                    });
                });
                box.appendChild(row);
            });
        }).catch(function (err) {
            box.innerHTML = '<p class="cp-muted" style="padding:10px;">Drive error.</p>';
            setStatus(String(err && err.message ? err.message : err));
        });
    }

    function saveDriveDeck() {
        if (!window.CPDrive || !CPDrive.saveDeckToDrive) {
            setStatus('Drive deck save unavailable');
            return;
        }
        var name = (($('cpDeckNameInput') && $('cpDeckNameInput').value) || 'Play deck').trim();
        library.setDeckName(name);
        var payload = {
            name: name,
            cardIds: buildIdsFromQty(),
            commanderId: store.getState().commanderId || ''
        };
        CPDrive.ensureDriveTokenBeforeDriveOp().then(function (ok) {
            if (!ok) throw new Error('Drive auth required');
            return CPDrive.saveDeckToDrive(deckFileName(name), JSON.stringify(payload));
        }).then(function () {
            setStatus('Deck saved to Drive');
            refreshDriveDeckList();
        }).catch(function (err) {
            setStatus('Save failed: ' + (err && err.message ? err.message : err));
        });
    }

    /* —— Sidebar —— */
    function isCompactPlay() {
        try {
            return window.matchMedia('(max-width: 900px)').matches;
        } catch (e) {
            return false;
        }
    }

    function wireSidebar() {
        var main = $('cpMain');
        var btn = $('cpSidebarToggle');
        if (!main || !btn) return;
        try {
            if (isCompactPlay()) {
                /* Phones: start with board full-screen; controls open as a drawer. */
                main.classList.add('cp-sidebar-collapsed');
            } else if (localStorage.getItem(SIDEBAR_KEY) === '1') {
                main.classList.add('cp-sidebar-collapsed');
            }
        } catch (e) { /* ignore */ }
        function sync() {
            var collapsed = main.classList.contains('cp-sidebar-collapsed');
            var compact = isCompactPlay();
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            if (compact) {
                btn.textContent = collapsed ? 'Controls ▴' : 'Close controls ▾';
                btn.title = collapsed ? 'Show play controls' : 'Hide play controls';
            } else {
                btn.textContent = collapsed ? '›' : '‹';
                btn.title = collapsed ? 'Show sidebar' : 'Hide sidebar';
            }
            if (!compact) {
                try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e2) { /* ignore */ }
            }
        }
        sync();
        btn.addEventListener('click', function () {
            main.classList.toggle('cp-sidebar-collapsed');
            sync();
        });
        var play = document.querySelector('.cp-panel-play');
        if (play) {
            play.addEventListener('pointerdown', function () {
                if (!isCompactPlay()) return;
                if (main.classList.contains('cp-sidebar-collapsed')) return;
                main.classList.add('cp-sidebar-collapsed');
                sync();
            });
        }
        try {
            window.matchMedia('(max-width: 900px)').addEventListener('change', function () {
                if (isCompactPlay()) main.classList.add('cp-sidebar-collapsed');
                sync();
            });
        } catch (e3) { /* ignore */ }
    }

    /* —— Onboarding —— */
    function wireOnboarding() {
        var panel = $('cpOnboarding');
        if (!panel) return;
        try {
            if (localStorage.getItem(ONBOARD_KEY) === '1') {
                panel.hidden = true;
                return;
            }
        } catch (e) { /* ignore */ }
        panel.hidden = false;
        function dismiss() {
            panel.hidden = true;
            try { localStorage.setItem(ONBOARD_KEY, '1'); } catch (e2) { /* ignore */ }
        }
        $('cpOnboardDismiss').addEventListener('click', dismiss);
        $('cpOnboardImport').addEventListener('click', function () { $('cpImportFile').click(); });
        $('cpOnboardQuickDeck').addEventListener('click', openDeckModal);
        $('cpOnboardUseAll').addEventListener('click', useOwnedAsDeck);
        $('cpOnboardDraw7').addEventListener('click', function () {
            store.drawToHand(activeBoard(), 7);
            sfx.draw();
            dismiss();
            refreshStats();
        });
    }

    function useOwnedAsDeck() {
        var ids = library.ownedLibrary().map(function (c) { return c.id; });
        if (!ids.length) ids = library.allCards().map(function (c) { return c.id; });
        applyDeckToActive(ids);
    }

    /* —— Main controls —— */
    function on(id, evt, fn) {
        var el = $(id);
        if (el) el.addEventListener(evt, fn);
    }

    function wireControls() {
        on('cpRefresh', 'click', function () {
            library.refresh().then(function () {
                refreshStats();
                setStatus('Library refreshed');
            });
        });
        on('cpImportBtn', 'click', function () { var f = $('cpImportFile'); if (f) f.click(); });
        on('cpImportFile', 'change', function (ev) {
            library.importJsonFiles(ev.target.files).then(function () {
                refreshStats();
                setStatus('Imported cards');
                ev.target.value = '';
            }).catch(function (err) {
                setStatus('Import failed: ' + (err && err.message ? err.message : err));
            });
        });
        on('cpOpenDeckModal', 'click', openDeckModal);
        on('cpUseAll', 'click', useOwnedAsDeck);
        on('cpShuffle', 'click', function () {
            store.shuffleDeck(activeBoard());
            persistActiveDeck();
            library.prefetchIds(store.getDeckIds(activeBoard()), 16);
            sfx.place();
            setStatus('Shuffled');
        });
        on('cpDraw', 'click', function () {
            var card = store.drawToField(
                activeBoard(),
                0.12 + Math.random() * 0.55,
                0.1 + Math.random() * 0.45
            );
            if (card) sfx.place();
            else setStatus('Deck empty');
            refreshStats();
        });
        on('cpClearField', 'click', function () {
            store.clearBoard(activeBoard(), { keepCommander: true });
            setStatus('Field cleared');
        });
        on('cpDrawHand', 'click', function () {
            var drawn = store.drawToHand(activeBoard(), 7);
            sfx.draw();
            setStatus('Drew ' + drawn.length);
            refreshStats();
            var ob = $('cpOnboarding');
            if (ob) ob.hidden = true;
        });
        on('cpUntapAll', 'click', function () {
            store.untapAll(activeBoard());
            sfx.place();
        });
        on('cpShuffleDiscard', 'click', function () {
            store.shuffleDiscardIntoDeck(activeBoard());
            persistActiveDeck();
            sfx.place();
            refreshStats();
            setStatus('Discard shuffled into deck');
        });
        on('cpMulligan', 'click', function () {
            store.mulligan(activeBoard());
            persistActiveDeck();
            sfx.draw();
            refreshStats();
            setStatus('Mulligan');
        });
        on('cpSelectCommander', 'click', openCommanderModal);
        on('cpClearCommander', 'click', function () {
            store.setCommander('');
            library.setCommanderId('');
            refreshStats();
        });
        on('cpSfxToggle', 'click', function () {
            var muted = sfx.toggle();
            var t = $('cpSfxToggle');
            if (t) {
                t.textContent = muted ? 'Sound: off' : 'Sound: on';
                t.setAttribute('aria-pressed', muted ? 'false' : 'true');
            }
        });
        var sfxBtn = $('cpSfxToggle');
        if (sfxBtn) sfxBtn.textContent = sfx.isMuted() ? 'Sound: off' : 'Sound: on';

        on('cpDeckApply', 'click', function () {
            applyDeckToActive(buildIdsFromQty());
            closeModal('cpDeckModal');
        });
        on('cpDeckSaveDrive', 'click', saveDriveDeck);
        on('cpDeckLibSearch', 'input', renderDeckBuilder);
        on('cpDeckHideZero', 'change', renderDeckBuilder);

        on('cpFirebaseConnect', 'click', function () {
            var rid = (($('cpRoomId') && $('cpRoomId').value) || '').trim();
            setFirebaseStatus('Connecting…');
            sync.connect(rid).then(function (info) {
                var disc = $('cpFirebaseDisconnect');
                var copy = $('cpCopyRoomLink');
                var room = $('cpRoomId');
                if (disc) disc.disabled = false;
                if (copy) copy.disabled = false;
                if (room) room.value = info.roomId;
                setFirebaseStatus('Player ' + info.seat + ' in “' + info.roomId + '”');
            }).catch(function (err) {
                setFirebaseStatus(err && err.message ? err.message : 'Connect failed');
            });
        });
        on('cpFirebaseDisconnect', 'click', function () {
            var disc = $('cpFirebaseDisconnect');
            var copy = $('cpCopyRoomLink');
            if (disc) disc.disabled = true;
            setFirebaseStatus('Leaving room…');
            Promise.resolve(sync.disconnect()).then(function () {
                if (copy) copy.disabled = true;
                setFirebaseStatus('Disconnected');
            }).catch(function () {
                if (copy) copy.disabled = true;
                setFirebaseStatus('Disconnected');
            });
        });
        on('cpCopyRoomLink', 'click', function () {
            var rid = sync.getRoomId() || (($('cpRoomId') && $('cpRoomId').value) || '');
            var url = sync.buildShareUrl(sync.normalizeRoomId(rid));
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(function () {
                    setFirebaseStatus('Link copied');
                });
            } else {
                setFirebaseStatus(url);
            }
        });

        on('cpEndTurnSidebar', 'click', function () {
            var turn = store.endTurn();
            if (!turn) {
                setStatus('Not your turn');
                return;
            }
            setStatus('Turn passed to Player ' + turn.activeSeat);
        });
    }

    function syncEndTurnSidebar() {
        var btn = $('cpEndTurnSidebar');
        if (!btn) return;
        var st = store.getState();
        var turn = st.turn || {};
        var show = !!st.localSeat && turn.phase === 'play';
        btn.hidden = !show;
        btn.disabled = !(show && store.isMyTurn());
    }

    function initRoomFromUrl() {
        try {
            var u = new URL(window.location.href);
            var room = u.searchParams.get('room');
            if (room) {
                $('cpRoomId').value = room;
                setFirebaseStatus('Room from link — press Connect');
            }
        } catch (e) { /* ignore */ }
    }

    var interactions = CardPlayerInteractions.create({
        store: store,
        view: view,
        library: library,
        sfx: sfx,
        root: root,
        onStatus: setStatus,
        openDeckSearch: openDeckSearch,
        openDiscardSearch: openDiscardSearch,
        openTreasureModal: openTreasureModal
    });

    store.subscribe(function () {
        refreshStats();
        syncEndTurnSidebar();
    });

    /* Localhost helper so layout tests can force a room seat without Firebase. */
    try {
        if (/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
            window.__CardPlayerDebug = {
                setSeat: function (seat) { store.setLocalSeat(seat || null); },
                startCoin: function (side) { store.startCoinFlip(side || (Math.random() < 0.5 ? 'heads' : 'tails')); },
                store: store,
                library: library
            };
        }
    } catch (eDbg) { /* ignore */ }

    function boot() {
        wireSidebar();
        wireDrawN();
        wireSimpleModals();
        wireControls();
        wireOnboarding();
        interactions.bind();
        turns.bind();
        initRoomFromUrl();
        syncEndTurnSidebar();
        view.render();
        library.refresh().then(function () {
            hydrateDeckFromStorage();
            library.prefetchIds(store.getDeckIds(activeBoard()), 16);
            view.render();
            refreshStats();
            var draw7 = $('cpOnboardDraw7');
            if (draw7) draw7.disabled = store.getDeckIds(activeBoard()).length === 0;
            var n = library.allCards().length;
            if (library.isGuestPlay && library.isGuestPlay()) {
                setStatus(n ? ('Guest ready — ' + n + ' catalog cards') : 'Guest ready — no catalog cards found');
            } else {
                setStatus('Ready');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
