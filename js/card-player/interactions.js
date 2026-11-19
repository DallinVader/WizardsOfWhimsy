/**
 * Card Player — hybrid pointer controls: drag, select, action menu, preview overlay.
 */
(function (global) {
    'use strict';

    function createInteractions(opts) {
        var store = opts.store;
        var view = opts.view;
        var sfx = opts.sfx;
        var root = opts.root;
        var onStatus = opts.onStatus || function () {};
        var openDeckSearch = opts.openDeckSearch || function () {};
        var openDiscardSearch = opts.openDiscardSearch || function () {};
        var openTreasureModal = opts.openTreasureModal || function () {};
        var Z = store.ZONES;

        var drag = null;
        var longPressTimer = null;
        var longPressFired = false;
        var previewEl = null;
        var actionEl = null;
        var finePointer = true;
        var hoverCardId = null;
        var hoverLeaveTimer = null;
        var previewReq = 0;
        var previewCardId = null;
        /* Mobile: single tap → inspect, double tap → action menu. */
        var lastTapCardId = null;
        var lastTapAt = 0;
        var lastTapX = 0;
        var lastTapY = 0;
        var pendingTapTimer = null;
        /* Generous window — phones often space double-taps ~300–450ms apart. */
        var DOUBLE_TAP_MS = 450;

        function refreshPointerMode(ev) {
            try {
                finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
            } catch (e1) {
                finePointer = true;
            }
            /* Real phones / first touch: always use tap + double-tap UX. */
            if (ev && (ev.pointerType === 'touch' || ev.pointerType === 'pen')) {
                finePointer = false;
            } else {
                try {
                    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) {
                        finePointer = false;
                    }
                } catch (e2) { /* ignore */ }
            }
        }
        refreshPointerMode(null);

        function clearPendingTap() {
            if (pendingTapTimer) {
                clearTimeout(pendingTapTimer);
                pendingTapTimer = null;
            }
        }

        function ensurePreview() {
            if (previewEl) return previewEl;
            previewEl = document.createElement('div');
            previewEl.className = 'cp-preview-pop';
            previewEl.hidden = true;
            previewEl.innerHTML =
                '<button type="button" class="cp-preview-backdrop" aria-label="Close preview"></button>' +
                '<div class="cp-preview-sheet" role="dialog" aria-label="Card preview">' +
                    '<div class="cp-preview-nav">' +
                        '<button type="button" class="cp-preview-nav-btn" data-preview-act="prev" aria-label="Previous card">‹</button>' +
                        '<button type="button" class="cp-preview-nav-btn" data-preview-act="next" aria-label="Next card">›</button>' +
                    '</div>' +
                    '<img alt="" />' +
                    '<p class="cp-preview-meta" id="cpPreviewMeta"></p>' +
                    '<div class="cp-preview-actions">' +
                        '<button type="button" class="cp-btn cp-btn-primary" data-preview-act="play" hidden>Play</button>' +
                        '<button type="button" class="cp-btn" data-preview-act="actions">Actions</button>' +
                        '<button type="button" class="cp-btn" data-preview-act="close">Close</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(previewEl);
            previewEl.addEventListener('click', function (ev) {
                var actBtn = ev.target.closest('[data-preview-act]');
                if (actBtn) {
                    var act = actBtn.getAttribute('data-preview-act');
                    var id = previewCardId;
                    var found = id ? store.findCard(id) : null;
                    if (act === 'close') {
                        clearTapMemory();
                        hidePreview();
                        return;
                    }
                    if (act === 'prev' || act === 'next') {
                        stepHandPreview(act === 'next' ? 1 : -1);
                        return;
                    }
                    if (act === 'play' && found && store.canEdit(found.boardId) && found.card.zone === Z.HAND) {
                        clearTapMemory();
                        hidePreview();
                        runAction(found.card.id, 'field');
                        return;
                    }
                    if (act === 'actions') {
                        clearTapMemory();
                        hidePreview();
                        if (found && store.canEdit(found.boardId)) {
                            openCardActions(found, window.innerWidth / 2, window.innerHeight * 0.42);
                        }
                        return;
                    }
                }
                /*
                 * Double-tap's second hit often lands on the dimmer or big card
                 * (preview already covered the table card). Prefer actions over dismiss.
                 */
                if (tryConsumeDoubleTapFromPreview(ev.clientX, ev.clientY)) return;
                if (ev.target.classList.contains('cp-preview-backdrop')) {
                    clearTapMemory();
                    hidePreview();
                }
            });
            var touchX = null;
            previewEl.addEventListener('touchstart', function (ev) {
                if (!ev.touches || !ev.touches[0]) return;
                touchX = ev.touches[0].clientX;
            }, { passive: true });
            previewEl.addEventListener('touchend', function (ev) {
                if (touchX == null || !ev.changedTouches || !ev.changedTouches[0]) return;
                var dx = ev.changedTouches[0].clientX - touchX;
                touchX = null;
                if (Math.abs(dx) < 48) return;
                stepHandPreview(dx < 0 ? 1 : -1);
            }, { passive: true });
            return previewEl;
        }

        function handBrowseList(boardId) {
            return store.cardsInZone(boardId || store.activeBoardId(), Z.HAND);
        }

        function stepHandPreview(dir) {
            if (!previewCardId) return;
            var found = store.findCard(previewCardId);
            if (!found || found.card.zone !== Z.HAND) return;
            var list = handBrowseList(found.boardId);
            if (!list.length) return;
            var idx = -1;
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i].id === previewCardId) { idx = i; break; }
            }
            if (idx < 0) return;
            var next = list[(idx + dir + list.length) % list.length];
            if (next) showPreview(next, opts.library, null, null, true);
        }

        function positionPreview(clientX, clientY) {
            var el = ensurePreview();
            if (!finePointer || el.classList.contains('cp-preview-pop--sheet')) {
                el.style.left = '0';
                el.style.top = '0';
                el.style.transform = 'none';
                return;
            }
            var sheet = el.querySelector('.cp-preview-sheet') || el;
            var w = sheet.offsetWidth || 360;
            var h = sheet.offsetHeight || 504;
            var pad = 16;
            var x;
            var y;
            if (clientX == null || clientY == null) {
                el.style.left = '50%';
                el.style.top = '50%';
                el.style.transform = 'translate(-50%, -50%)';
                return;
            }
            x = clientX + 28;
            y = clientY - h * 0.55;
            if (x + w > window.innerWidth - pad) x = clientX - w - 28;
            if (x < pad) x = pad;
            if (y < pad) y = pad;
            if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
            el.style.left = Math.round(x) + 'px';
            el.style.top = Math.round(y) + 'px';
            el.style.transform = 'none';
        }

        function hidePreview() {
            clearTimeout(hoverLeaveTimer);
            hoverLeaveTimer = null;
            hoverCardId = null;
            previewCardId = null;
            clearPendingTap();
            var el = ensurePreview();
            el.hidden = true;
            el.classList.remove('is-visible', 'cp-preview-pop--sheet');
        }

        function showPreview(card, lib, clientX, clientY, asSheet) {
            if (!card) return;
            var useSheet = asSheet || !finePointer;
            var el = ensurePreview();
            var img = el.querySelector('img');
            var actions = el.querySelector('.cp-preview-actions');
            var st = store.getState();
            var found = store.findCard(card.id);
            var hideFace = !!(found && st.localSeat && !store.canEdit(found.boardId) && card.zone === Z.HAND);
            var canAct = !!(found && store.canEdit(found.boardId));
            hoverCardId = card.id;
            previewCardId = card.id;
            el.hidden = false;
            el.classList.add('is-visible');
            el.classList.toggle('cp-preview-pop--sheet', useSheet);
            if (actions) {
                actions.hidden = !useSheet;
                var actBtn = actions.querySelector('[data-preview-act="actions"]');
                var playBtn = actions.querySelector('[data-preview-act="play"]');
                if (actBtn) actBtn.hidden = !canAct;
                if (playBtn) playBtn.hidden = !(canAct && card.zone === Z.HAND);
            }
            var nav = el.querySelector('.cp-preview-nav');
            var meta = el.querySelector('#cpPreviewMeta');
            var inHand = !!(found && found.card.zone === Z.HAND);
            if (nav) nav.hidden = !(useSheet && inHand && handBrowseList(found.boardId).length > 1);
            if (meta) {
                if (useSheet && inHand) {
                    var list = handBrowseList(found.boardId);
                    var n = 0;
                    var j;
                    for (j = 0; j < list.length; j++) {
                        if (list[j].id === card.id) { n = j + 1; break; }
                    }
                    meta.textContent = 'Hand · ' + n + ' / ' + list.length;
                    meta.hidden = false;
                } else if (useSheet) {
                    meta.textContent = (card.zone || 'card').replace(/^./, function (c) { return c.toUpperCase(); });
                    meta.hidden = false;
                } else {
                    meta.hidden = true;
                }
            }
            hideActionMenu();
            positionPreview(useSheet ? null : clientX, useSheet ? null : clientY);
            if (hideFace || card.faceDown) {
                img.src = 'assets/cards/Card%20Back.png';
                return;
            }
            var req = ++previewReq;
            var previewFn = lib.getPreviewUrl || lib.getFaceUrl;
            previewFn.call(lib, card.libId).then(function (url) {
                if (req !== previewReq || hoverCardId !== card.id) return;
                img.src = url;
                positionPreview(useSheet ? null : clientX, useSheet ? null : clientY);
            });
        }

        function onCardPointerEnter(ev) {
            if (!finePointer || drag) return;
            if (ev.pointerType && ev.pointerType !== 'mouse') return;
            var cardEl = ev.target.closest && ev.target.closest('.cp-card-on-field');
            if (!cardEl) return;
            if (ev.relatedTarget && cardEl.contains(ev.relatedTarget)) return;
            var found = store.findCard(cardEl.dataset.cpInstanceId);
            if (!found) return;
            clearTimeout(hoverLeaveTimer);
            hoverLeaveTimer = null;
            showPreview(found.card, opts.library, ev.clientX, ev.clientY);
        }

        function onCardPointerMoveHover(ev) {
            if (!finePointer || drag || !hoverCardId) return;
            if (ev.pointerType && ev.pointerType !== 'mouse') return;
            var found = cardFromTarget(ev.target);
            if (!found) return;
            if (found.card.id !== hoverCardId) {
                showPreview(found.card, opts.library, ev.clientX, ev.clientY);
                return;
            }
            positionPreview(ev.clientX, ev.clientY);
        }

        function onCardPointerLeave(ev) {
            if (!finePointer) return;
            var cardEl = ev.target.closest && ev.target.closest('.cp-card-on-field');
            if (!cardEl) return;
            if (ev.relatedTarget && cardEl.contains(ev.relatedTarget)) return;
            var nextCard = ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.cp-card-on-field');
            if (nextCard) return;
            clearTimeout(hoverLeaveTimer);
            hoverLeaveTimer = setTimeout(function () {
                hoverLeaveTimer = null;
                if (!drag) hidePreview();
            }, 140);
        }

        function ensureActionMenu() {
            if (actionEl) return actionEl;
            actionEl = document.createElement('div');
            actionEl.className = 'cp-action-menu';
            actionEl.hidden = true;
            actionEl.innerHTML =
                '<button type="button" data-act="flip">Flip</button>' +
                '<button type="button" data-act="tap">Tap</button>' +
                '<button type="button" data-act="untap">Untap</button>' +
                '<button type="button" data-act="hand">To hand</button>' +
                '<button type="button" data-act="field">To field</button>' +
                '<button type="button" data-act="treasure">Treasure</button>' +
                '<button type="button" data-act="discard">Discard</button>' +
                '<button type="button" data-act="deck">To deck</button>' +
                '<button type="button" data-act="close">Close</button>';
            document.body.appendChild(actionEl);
            actionEl.addEventListener('click', function (ev) {
                var btn = ev.target.closest('[data-act]');
                if (!btn) return;
                var act = btn.getAttribute('data-act');
                var st = store.getState();
                if (act === 'close' || !st.selectedId) {
                    hideActionMenu();
                    return;
                }
                runAction(st.selectedId, act);
            });
            return actionEl;
        }

        function hideActionMenu() {
            ensureActionMenu().hidden = true;
        }

        function showActionMenu(clientX, clientY) {
            var el = ensureActionMenu();
            el.hidden = false;
            el.style.left = '0px';
            el.style.top = '0px';
            var menuW = el.offsetWidth || 200;
            var menuH = el.offsetHeight || 320;
            var pad = 10;
            var x = Math.min(window.innerWidth - menuW - pad, Math.max(pad, clientX - 12));
            var y = Math.min(window.innerHeight - menuH - pad, Math.max(pad, clientY - 12));
            el.style.left = Math.round(x) + 'px';
            el.style.top = Math.round(y) + 'px';
        }

        function runAction(instanceId, act) {
            var found = store.findCard(instanceId);
            if (!found || !store.canEdit(found.boardId)) return;
            var c = found.card;
            if (act === 'flip') {
                store.moveCard(instanceId, { faceDown: !c.faceDown });
                sfx.flip();
            } else if (act === 'tap') {
                store.moveCard(instanceId, { rot: ((c.rot || 0) + 90) % 360 });
                sfx.place();
            } else if (act === 'untap') {
                store.moveCard(instanceId, { rot: 0 });
                sfx.place();
            } else if (act === 'hand') {
                store.moveCard(instanceId, { zone: Z.HAND });
                sfx.draw();
            } else if (act === 'field') {
                var bEls = view.boardEls(found.boardId);
                var fr = bEls.field && bEls.field.getBoundingClientRect();
                var cx = fr ? fr.left + fr.width * 0.5 : window.innerWidth / 2;
                var cy = fr ? fr.top + fr.height * 0.28 : window.innerHeight / 3;
                var pt = view.fieldPointFromClient(found.boardId, cx, cy);
                var place = clampFieldPoint(found.boardId, Math.max(20, pt.x - 36), Math.max(20, pt.y - 50));
                store.moveCard(instanceId, { zone: Z.FIELD, x: place.x, y: place.y });
                sfx.place();
            } else if (act === 'treasure') {
                store.moveCard(instanceId, { zone: Z.TREASURE });
                sfx.place();
            } else if (act === 'discard') {
                store.moveCard(instanceId, { zone: Z.DISCARD });
                sfx.discard();
            } else if (act === 'deck') {
                store.returnToDeck(instanceId, true);
                sfx.place();
            }
            hideActionMenu();
        }

        function boardFromEventTarget(t) {
            var field = t && t.closest && t.closest('.cp-field');
            if (!field) return store.activeBoardId();
            return field.id === 'cpPlayingFieldP2' ? 'p2' : 'p1';
        }

        function cardFromTarget(t) {
            var el = t && t.closest && t.closest('.cp-card-on-field');
            if (!el) return null;
            return store.findCard(el.dataset.cpInstanceId);
        }

        function clearLongPress() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }

        function onPointerDown(ev) {
            refreshPointerMode(ev);
            var boardId = boardFromEventTarget(ev.target);
            if (!store.canEdit(boardId) && !ev.target.closest('.cp-card-on-field')) return;

            var drawZone = ev.target.closest('.cp-draw-zone');
            if (drawZone && store.canEdit(boardId)) {
                if (ev.button === 2) {
                    ev.preventDefault();
                    openDeckSearch(boardId);
                    return;
                }
                drag = {
                    kind: 'deck',
                    boardId: boardId,
                    startX: ev.clientX,
                    startY: ev.clientY,
                    moved: false,
                    pointerId: ev.pointerId
                };
                try { drawZone.setPointerCapture(ev.pointerId); } catch (e1) { /* ignore */ }
                return;
            }

            if (ev.target.closest('.cp-discard-zone') && !ev.target.closest('.cp-card-on-field') && store.canEdit(boardId)) {
                openDiscardSearch(boardId);
                return;
            }
            if (ev.target.closest('.cp-treasure-zone') && !ev.target.closest('.cp-card-on-field') && store.canEdit(boardId)) {
                openTreasureModal(boardId);
                return;
            }

            var found = cardFromTarget(ev.target);
            if (!found) {
                clearPendingTap();
                lastTapCardId = null;
                store.select(null, null);
                hideActionMenu();
                hidePreview();
                return;
            }
            if (!store.canEdit(found.boardId)) {
                /* Opponent / off-turn: tap handled on pointerup (inspect only). */
                drag = {
                    kind: 'inspect',
                    boardId: found.boardId,
                    cardId: found.card.id,
                    startX: ev.clientX,
                    startY: ev.clientY,
                    moved: false,
                    pointerId: ev.pointerId
                };
                if (ev.pointerType === 'touch') {
                    try { ev.preventDefault(); } catch (eInspect) { /* ignore */ }
                }
                return;
            }

            store.select(found.card.id, found.boardId);
            var el = view.getCardEl(found.card.id);
            if (view.setDraggingId) view.setDraggingId(found.card.id);
            drag = {
                kind: 'card',
                boardId: found.boardId,
                cardId: found.card.id,
                fromZone: found.card.zone,
                startX: ev.clientX,
                startY: ev.clientY,
                origX: found.card.x,
                origY: found.card.y,
                moved: false,
                pointerId: ev.pointerId,
                el: el
            };
            if (el) {
                var field = el.closest('.cp-field') || (view.boardEls(found.boardId) || {}).field;
                if (field && el.parentNode !== field) field.appendChild(el);
                el.classList.add('cp-card-dragging');
                el.style.zIndex = '5000';
                var wrap = el.closest('.cp-field-wrap');
                if (wrap) wrap.classList.add('cp-wrap-dragging');
                drag.wrap = wrap;
                try { el.setPointerCapture(ev.pointerId); } catch (e2) { /* ignore */ }
            }

            clearLongPress();
            longPressFired = false;
            /* Desktop: long-press opens actions. Mobile uses double-tap instead. */
            if (finePointer) {
                longPressTimer = setTimeout(function () {
                    longPressTimer = null;
                    if (!drag || drag.moved) return;
                    longPressFired = true;
                    hidePreview();
                    if (found.card.zone === Z.TREASURE) {
                        store.moveCard(found.card.id, { rot: ((found.card.rot || 0) + 90) % 360 });
                        sfx.place();
                        return;
                    }
                    showActionMenu(ev.clientX, ev.clientY);
                }, 480);
            }
            if (ev.pointerType === 'touch') {
                try { ev.preventDefault(); } catch (e3) { /* ignore */ }
            }
        }

        function clearTapMemory() {
            clearPendingTap();
            lastTapCardId = null;
            lastTapAt = 0;
        }

        function openCardActions(found, clientX, clientY) {
            if (!found || !store.canEdit(found.boardId)) return;
            store.select(found.card.id, found.boardId);
            if (found.card.zone === Z.TREASURE) {
                store.moveCard(found.card.id, { rot: ((found.card.rot || 0) + 90) % 360 });
                sfx.place();
                return;
            }
            showActionMenu(clientX, clientY);
        }

        function isDoubleTapFor(cardId) {
            return !!cardId && lastTapCardId === cardId && (Date.now() - lastTapAt) <= DOUBLE_TAP_MS;
        }

        function tryConsumeDoubleTapFromPreview(clientX, clientY) {
            if (finePointer || !previewCardId || !isDoubleTapFor(previewCardId)) return false;
            var found = store.findCard(previewCardId);
            clearTapMemory();
            hidePreview();
            if (!found || !store.canEdit(found.boardId)) return true;
            openCardActions(
                found,
                clientX != null ? clientX : lastTapX,
                clientY != null ? clientY : lastTapY
            );
            return true;
        }

        function handleMobileCardTap(found, clientX, clientY) {
            if (!found) return;
            clearPendingTap();
            if (isDoubleTapFor(found.card.id)) {
                clearTapMemory();
                hidePreview();
                openCardActions(found, clientX, clientY);
                return;
            }
            lastTapCardId = found.card.id;
            lastTapAt = Date.now();
            lastTapX = clientX;
            lastTapY = clientY;
            /* Show inspect right away; a quick second tap (often on the dimmer) opens actions. */
            showPreview(found.card, opts.library, clientX, clientY, true);
        }

        function onPointerMove(ev) {
            if (!drag) return;
            var dx = ev.clientX - drag.startX;
            var dy = ev.clientY - drag.startY;
            var moveThresh = finePointer ? 36 : 20;
            if (!drag.moved && (dx * dx + dy * dy) > moveThresh) {
                drag.moved = true;
                clearLongPress();
                clearPendingTap();
                lastTapCardId = null;
                hideActionMenu();
                hidePreview();
                hoverCardId = null;
            }
            if (!drag.moved) return;
            if (ev.pointerType === 'touch') {
                try { ev.preventDefault(); } catch (e4) { /* ignore */ }
            }

            if (drag.kind === 'card' && drag.el) {
                var pt = view.fieldPointFromClient(drag.boardId, ev.clientX, ev.clientY);
                /* Follow the pointer freely while dragging; clamp only on drop. */
                drag.el.style.left = Math.max(0, pt.x - 30) + 'px';
                drag.el.style.top = Math.max(0, pt.y - 42) + 'px';
                drag.el.style.zIndex = '5000';
                highlightDrop(drag.boardId, resolveDropZone(drag.boardId, ev.clientX, ev.clientY, drag));
            } else if (drag.kind === 'deck') {
                var b = view.boardEls(drag.boardId);
                if (b.ghost) {
                    b.ghost.classList.add('is-visible');
                    b.ghost.style.left = (ev.clientX - 28) + 'px';
                    b.ghost.style.top = (ev.clientY - 40) + 'px';
                }
                highlightDrop(drag.boardId, view.hitZone(drag.boardId, ev.clientX, ev.clientY));
            }
        }

        /**
         * Hand rail is tall; an upward drag from hand should play to field
         * even if the pointer is still overlapping the hand hitbox.
         */
        function resolveDropZone(boardId, clientX, clientY, dragCtx) {
            var zone = view.hitZone(boardId, clientX, clientY);
            if (!dragCtx || dragCtx.fromZone !== Z.HAND) return zone;
            if (zone !== Z.HAND) return zone;
            var lift = finePointer ? 36 : 24;
            var upward = dragCtx.startY - clientY;
            if (upward < lift) return zone;
            var b = view.boardEls(boardId);
            var hand = b.handZone && b.handZone.getBoundingClientRect();
            if (!hand) return Z.FIELD;
            /* Most of the hand rail counts as exiting onto the battlefield once lifted. */
            var exitFrac = finePointer ? 0.5 : 0.72;
            if (clientY < hand.top + hand.height * exitFrac) return Z.FIELD;
            return zone;
        }

        function fieldCardSize(boardId) {
            var cardW = 64;
            var cardH = 90;
            try {
                var b = view.boardEls(boardId);
                var cs = b.field && window.getComputedStyle(b.field);
                if (cs) {
                    var cw = parseFloat(cs.getPropertyValue('--cp-card-field-w'));
                    if (cw > 0) {
                        cardW = cw;
                        cardH = cw * 1.4;
                    }
                }
            } catch (e) { /* ignore */ }
            return { w: cardW, h: cardH };
        }

        /**
         * Clamp a pixel drop into the playable area, then return 0–1 norms
         * so the same relative spot appears on every device size.
         */
        function clampFieldPoint(boardId, x, y) {
            var play = view.playRect ? view.playRect(boardId) : null;
            var size = fieldCardSize(boardId);
            var maxX = play ? Math.max(0, play.width - size.w) : x;
            var maxY = play ? Math.max(0, play.height - size.h) : y;
            var px = Math.max(0, Math.min(x, maxX));
            var py = Math.max(0, Math.min(y, maxY));
            if (view.toNorm) return view.toNorm(boardId, px, py);
            return { x: px, y: py };
        }

        function highlightDrop(boardId, zone) {
            var b = view.boardEls(boardId);
            [b.handZone, b.treasureZone, b.discardZone, b.drawZone, b.commanderZone].forEach(function (z) {
                if (z) z.classList.remove('cp-drop-target', 'cp-drop-target--active');
            });
            var el = null;
            if (zone === Z.HAND) el = b.handZone;
            else if (zone === Z.TREASURE) el = b.treasureZone;
            else if (zone === Z.DISCARD) el = b.discardZone;
            else if (zone === 'deck') el = b.drawZone;
            else if (zone === Z.COMMANDER) el = b.commanderZone;
            if (el) {
                el.classList.add('cp-drop-target', 'cp-drop-target--active');
            }
        }

        function clearHighlights(boardId) {
            var b = view.boardEls(boardId);
            [b.handZone, b.treasureZone, b.discardZone, b.drawZone, b.commanderZone].forEach(function (z) {
                if (z) z.classList.remove('cp-drop-target', 'cp-drop-target--active');
            });
            if (b.ghost) b.ghost.classList.remove('is-visible');
        }

        function onPointerUp(ev) {
            clearLongPress();
            if (!drag) return;
            var d = drag;
            drag = null;
            if (view.setDraggingId) view.setDraggingId(null);
            clearHighlights(d.boardId);
            if (d.el) d.el.classList.remove('cp-card-dragging');
            if (d.wrap) d.wrap.classList.remove('cp-wrap-dragging');

            if (d.kind === 'inspect') {
                if (!d.moved) {
                    var inspectCard = store.findCard(d.cardId);
                    if (!finePointer) handleMobileCardTap(inspectCard, ev.clientX, ev.clientY);
                    else if (inspectCard) showPreview(inspectCard.card, opts.library, ev.clientX, ev.clientY, false);
                }
                return;
            }

            if (d.kind === 'deck') {
                if (!d.moved) {
                    var drawn = store.drawToHand(d.boardId, 1);
                    if (drawn.length) sfx.draw();
                    else onStatus('Deck is empty');
                } else {
                    var zone = view.hitZone(d.boardId, ev.clientX, ev.clientY);
                    var pt = view.fieldPointFromClient(d.boardId, ev.clientX, ev.clientY);
                    if (zone === Z.HAND) {
                        store.drawToHand(d.boardId, 1);
                        sfx.draw();
                    } else {
                        var place = clampFieldPoint(d.boardId, Math.max(0, pt.x - 30), Math.max(0, pt.y - 42));
                        var card = store.drawToField(d.boardId, place.x, place.y);
                        if (card) {
                            if (zone === Z.TREASURE) store.moveCard(card.id, { zone: Z.TREASURE });
                            else if (zone === Z.DISCARD) store.moveCard(card.id, { zone: Z.DISCARD });
                            sfx.place();
                        } else onStatus('Deck is empty');
                    }
                }
                return;
            }

            if (d.kind === 'card') {
                if (!d.moved) {
                    var found = store.findCard(d.cardId);
                    if (!found) return;
                    if (longPressFired) {
                        longPressFired = false;
                        return;
                    }
                    if (!finePointer) {
                        /* Mobile: tap = large card, double-tap = actions. */
                        handleMobileCardTap(found, ev.clientX, ev.clientY);
                    } else {
                        showPreview(found.card, opts.library, ev.clientX, ev.clientY, false);
                    }
                    return;
                }
                var dropZone = resolveDropZone(d.boardId, ev.clientX, ev.clientY, d);
                var dropPt = view.fieldPointFromClient(d.boardId, ev.clientX, ev.clientY);
                if (dropZone === 'deck') {
                    store.returnToDeck(d.cardId, true);
                    sfx.place();
                } else if (dropZone === Z.HAND) {
                    store.moveCard(d.cardId, { zone: Z.HAND });
                    sfx.draw();
                } else if (dropZone === Z.TREASURE) {
                    store.moveCard(d.cardId, { zone: Z.TREASURE });
                    sfx.place();
                } else if (dropZone === Z.DISCARD) {
                    store.moveCard(d.cardId, { zone: Z.DISCARD });
                    sfx.discard();
                } else if (dropZone === Z.COMMANDER) {
                    store.moveCard(d.cardId, { zone: Z.COMMANDER, isCommander: true });
                    sfx.place();
                } else {
                    var fieldPt = clampFieldPoint(d.boardId, dropPt.x - 30, dropPt.y - 42);
                    store.moveCard(d.cardId, {
                        zone: Z.FIELD,
                        x: fieldPt.x,
                        y: fieldPt.y
                    });
                    sfx.place();
                }
            }
        }

        function onDblClick(ev) {
            /* Mobile double-tap is handled in pointerup → action menu. */
            if (!finePointer) {
                ev.preventDefault();
                return;
            }
            var found = cardFromTarget(ev.target);
            if (!found || !store.canEdit(found.boardId)) return;
            if (found.card.zone === Z.HAND) {
                var pt = view.fieldPointFromClient(found.boardId, ev.clientX, ev.clientY);
                var fieldPt = clampFieldPoint(found.boardId, Math.max(20, pt.x - 30), Math.max(20, pt.y - 42));
                store.moveCard(found.card.id, {
                    zone: Z.FIELD,
                    x: fieldPt.x,
                    y: fieldPt.y
                });
                sfx.place();
            } else if (found.card.zone === Z.FIELD) {
                store.moveCard(found.card.id, { faceDown: !found.card.faceDown });
                sfx.flip();
            }
        }

        function onContextMenu(ev) {
            var found = cardFromTarget(ev.target);
            if (found && store.canEdit(found.boardId)) {
                ev.preventDefault();
                store.select(found.card.id, found.boardId);
                if (found.card.zone === Z.TREASURE) {
                    store.moveCard(found.card.id, { rot: ((found.card.rot || 0) + 90) % 360 });
                    sfx.place();
                    hideActionMenu();
                    return;
                }
                showActionMenu(ev.clientX, ev.clientY);
                return;
            }
            var boardId = boardFromEventTarget(ev.target);
            if (ev.target.closest('.cp-draw-zone') && store.canEdit(boardId)) {
                ev.preventDefault();
                openDeckSearch(boardId);
            }
        }

        function onKeyDown(ev) {
            var st = store.getState();
            if (!st.selectedId) return;
            if (ev.key === 'f' || ev.key === 'F') runAction(st.selectedId, 'flip');
            if (ev.key === 't' || ev.key === 'T') runAction(st.selectedId, 'tap');
            if (ev.key === 'Escape') {
                store.select(null, null);
                hideActionMenu();
                hidePreview();
            }
        }

        function bind() {
            root.addEventListener('pointerdown', onPointerDown, { passive: false });
            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
            root.addEventListener('dblclick', onDblClick);
            root.addEventListener('contextmenu', onContextMenu);
            window.addEventListener('keydown', onKeyDown);
            if (finePointer) {
                root.addEventListener('pointerover', onCardPointerEnter);
                root.addEventListener('pointerout', onCardPointerLeave);
                root.addEventListener('pointermove', onCardPointerMoveHover);
            }
            document.addEventListener('pointerdown', function (ev) {
                if (actionEl && !actionEl.hidden && !actionEl.contains(ev.target) && !ev.target.closest('.cp-card-on-field')) {
                    hideActionMenu();
                }
            }, true);
            document.addEventListener('click', function (ev) {
                if (previewEl && !previewEl.hidden && previewEl.classList.contains('cp-preview-pop--sheet')) {
                    if (ev.target.classList.contains('cp-preview-backdrop')) {
                        /* Handled in previewEl click (double-tap vs dismiss). */
                        return;
                    }
                    if (!previewEl.contains(ev.target) && !ev.target.closest('.cp-card-on-field')) {
                        if (tryConsumeDoubleTapFromPreview(ev.clientX, ev.clientY)) return;
                        clearTapMemory();
                        hidePreview();
                    }
                }
            });
        }

        return {
            bind: bind,
            hidePreview: hidePreview,
            hideActionMenu: hideActionMenu,
            showPreview: showPreview,
            runAction: runAction
        };
    }

    global.CardPlayerInteractions = { create: createInteractions };
})(typeof window !== 'undefined' ? window : globalThis);
