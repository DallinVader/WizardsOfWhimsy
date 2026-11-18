/**
 * Card Player — render store state into dual play mats.
 */
(function (global) {
    'use strict';

    var CARD_BACK = 'assets/cards/Card%20Back.png';

    function createBoardView(opts) {
        var store = opts.store;
        var library = opts.library;
        var root = opts.root;
        var Z = store.ZONES;
        var nodes = {};
        var cardEls = Object.create(null);
        var pendingFaces = Object.create(null);

        function qs(sel, el) {
            return (el || root).querySelector(sel);
        }

        function boardEls(boardId) {
            if (nodes[boardId]) return nodes[boardId];
            var field = boardId === 'p2' ? qs('#cpPlayingFieldP2') : qs('#cpPlayingField');
            var suffix = boardId === 'p2' ? 'P2' : '';
            nodes[boardId] = {
                field: field,
                wrap: field && field.closest('.cp-field-wrap'),
                handZone: qs('#cpHandZone' + suffix),
                handCount: qs('#cpHandCountZone' + suffix),
                treasureZone: qs('#cpTreasureZone' + suffix),
                treasureCount: qs('#cpTreasureCountZone' + suffix),
                drawZone: qs('#cpDrawZone' + suffix),
                deckCount: qs('#cpDeckCountZone' + suffix),
                discardZone: qs('#cpDiscardZone' + suffix),
                discardCount: qs('#cpDiscardCountZone' + suffix),
                commanderZone: qs('#cpCommanderZone' + suffix),
                ghost: qs('#cpDeckDragGhost' + suffix)
            };
            return nodes[boardId];
        }

        function ensureCardEl(card, boardId) {
            var el = cardEls[card.id];
            if (el) return el;
            el = document.createElement('div');
            el.className = 'cp-card-on-field';
            el.dataset.cpInstanceId = card.id;
            el.dataset.cpCardLibId = card.libId;
            el.dataset.cpBoard = boardId;
            el.innerHTML =
                '<div class="cp-card-rot">' +
                    '<div class="cp-flip-inner">' +
                        '<div class="cp-flip-face cp-flip-face-front"><img alt="" decoding="async" src="' + CARD_BACK + '" /></div>' +
                        '<div class="cp-flip-face cp-flip-face-back"><img src="' + CARD_BACK + '" alt="" decoding="async" /></div>' +
                    '</div>' +
                '</div>';
            cardEls[card.id] = el;
            var field = boardEls(boardId).field;
            if (field) field.appendChild(el);
            loadFace(card);
            return el;
        }

        function loadFace(card) {
            if (pendingFaces[card.id] === card.libId) return;
            pendingFaces[card.id] = card.libId;
            var el = cardEls[card.id];
            if (!el) return;
            var img = el.querySelector('.cp-flip-face-front img');
            if (img && !img.src) img.src = CARD_BACK;
            library.getFaceUrl(card.libId).then(function (url) {
                if (!cardEls[card.id] || pendingFaces[card.id] !== card.libId) return;
                if (img) img.src = url || CARD_BACK;
            });
        }

        function zoneHost(boardId, zoneName) {
            var b = boardEls(boardId);
            if (zoneName === Z.HAND) return b.handZone;
            if (zoneName === Z.TREASURE) return b.treasureZone;
            if (zoneName === Z.DISCARD) return b.discardZone;
            if (zoneName === Z.COMMANDER) return b.commanderZone;
            return null;
        }

        function zoneRect(boardId, zoneName) {
            var b = boardEls(boardId);
            var zoneEl = zoneHost(boardId, zoneName);
            if (!zoneEl || !b.field) return null;
            /* Prefer offsets relative to the field (local space under seat rotation). */
            var left = zoneEl.offsetLeft;
            var top = zoneEl.offsetTop;
            if (zoneEl.offsetParent && zoneEl.offsetParent !== b.field) {
                left = 0;
                top = 0;
                var node = zoneEl;
                while (node && node !== b.field) {
                    left += node.offsetLeft;
                    top += node.offsetTop;
                    node = node.offsetParent;
                }
                if (node !== b.field) {
                    left = zoneEl.offsetLeft;
                    top = zoneEl.offsetTop;
                }
            }
            return {
                left: left,
                top: top,
                width: zoneEl.offsetWidth,
                height: zoneEl.offsetHeight,
                host: zoneEl
            };
        }

        var draggingId = null;

        function setDraggingId(id) {
            draggingId = id || null;
        }

        function layoutZoneCards(boardId, zone, cards) {
            var rect = zoneRect(boardId, zone);
            if (!rect || rect.width < 8 || rect.height < 8) return;
            var n = cards.length;
            var aspect = 1.4;
            var field = boardEls(boardId).field;
            cards.forEach(function (card, i) {
                if (draggingId && card.id === draggingId) return;
                var el = ensureCardEl(card, boardId);
                if (field && el.parentNode !== field) field.appendChild(el);
                var pad = zone === Z.HAND ? 4 : 4;
                var maxByH = Math.max(22, (rect.height - pad * 2) / aspect);
                var w = zone === Z.HAND
                    ? Math.min(maxByH, Math.min(110, rect.width * 0.28))
                    : zone === Z.TREASURE ? Math.min(maxByH, rect.width * 0.18)
                    : zone === Z.COMMANDER ? Math.min(70, Math.max(28, Math.min(maxByH, rect.width)))
                    : Math.min(maxByH, Math.max(24, rect.width * 0.55));
                el.style.width = w + 'px';
                var cardH = w * aspect;
                if (cardH > rect.height - 4) {
                    w = Math.max(22, (rect.height - 4) / aspect);
                    cardH = w * aspect;
                    el.style.width = w + 'px';
                }
                var x;
                var y;
                if (zone === Z.HAND) {
                    var step = Math.min(w * 0.5, Math.max(22, w * 0.4));
                    var totalW = w + Math.max(0, n - 1) * step;
                    if (totalW > rect.width - 8 && n > 1) {
                        step = Math.max(w * 0.2, (rect.width - 8 - w) / (n - 1));
                        totalW = w + (n - 1) * step;
                    }
                    var startX = rect.left + Math.max(4, (rect.width - totalW) / 2);
                    x = startX + i * step;
                    y = rect.top + Math.max(pad, (rect.height - cardH) / 2);
                    y = Math.min(y, rect.top + Math.max(2, rect.height - cardH - 2));
                    y = Math.max(rect.top + 2, y);
                    var fan = n <= 1 ? 0 : ((i / Math.max(1, n - 1)) - 0.5) * Math.min(6, 1.2 + n * 0.4);
                    el.querySelector('.cp-card-rot').style.transform = 'rotate(' + ((card.rot || 0) + fan) + 'deg)';
                } else if (zone === Z.TREASURE) {
                    var tStep = Math.min(w * 0.48, 30);
                    var tTotal = w + Math.max(0, n - 1) * tStep;
                    if (tTotal > rect.width - 8 && n > 1) {
                        tStep = Math.max(12, (rect.width - 8 - w) / (n - 1));
                        tTotal = w + (n - 1) * tStep;
                    }
                    var tStart = rect.left + Math.max(4, (rect.width - tTotal) / 2);
                    x = tStart + i * tStep;
                    y = rect.top + Math.max(pad, (rect.height - cardH) / 2);
                    el.querySelector('.cp-card-rot').style.transform = 'rotate(' + (card.rot || 0) + 'deg)';
                } else if (zone === Z.DISCARD) {
                    x = rect.left + 4 + Math.min(i, 6) * 2;
                    y = rect.top + 4 + Math.min(i, 6) * 2;
                    el.querySelector('.cp-card-rot').style.transform = 'rotate(' + (card.rot || 0) + 'deg)';
                } else {
                    x = rect.left + (rect.width - w) / 2;
                    y = rect.top + Math.max(0, (rect.height - cardH) / 2);
                    el.querySelector('.cp-card-rot').style.transform = 'rotate(' + (card.rot || 0) + 'deg)';
                }
                el.style.left = x + 'px';
                el.style.top = y + 'px';
                el.style.bottom = '';
                el.style.zIndex = String(100 + i);
            });
        }

        function applyCardChrome(card, el, boardId) {
            el.dataset.cpCardLibId = card.libId;
            el.dataset.cpBoard = boardId;
            el.classList.toggle('cp-hand-card', card.zone === Z.HAND);
            el.classList.toggle('is-selected', store.getState().selectedId === card.id);
            el.classList.toggle('cp-card-exhausted', (card.rot || 0) % 180 === 90);
            if (card.isCommander) el.setAttribute('data-cp-commander', '1');
            else el.removeAttribute('data-cp-commander');
            if (card.zone === Z.COMMANDER) el.setAttribute('data-cp-commander-in-zone', '1');
            else el.removeAttribute('data-cp-commander-in-zone');
            if (card.zone === Z.DISCARD) el.setAttribute('data-cp-discard', '1');
            else el.removeAttribute('data-cp-discard');
            if (card.zone === Z.TREASURE) el.setAttribute('data-cp-treasure', '1');
            else el.removeAttribute('data-cp-treasure');

            var flip = el.querySelector('.cp-flip-inner');
            var hideOpponentHand = false;
            var st = store.getState();
            if (st.localSeat && !store.canEdit(boardId) && card.zone === Z.HAND) {
                hideOpponentHand = true;
            }
            var showBack = card.faceDown || hideOpponentHand;
            if (flip) flip.classList.toggle('cp-flip-inner--back', showBack);

            if (draggingId && card.id === draggingId) return;
            if (card.zone === Z.FIELD) {
                el.style.left = (card.x || 0) + 'px';
                el.style.top = (card.y || 0) + 'px';
                el.style.width = '';
                el.style.zIndex = '40';
                var rot = el.querySelector('.cp-card-rot');
                if (rot) rot.style.transform = 'rotate(' + (card.rot || 0) + 'deg)';
            }
        }

        function renderBoard(boardId) {
            var b = boardEls(boardId);
            if (!b.field) return;
            var cards = store.cardList(boardId);
            var seen = Object.create(null);
            var byZone = { field: [], hand: [], discard: [], treasure: [], commander: [] };

            cards.forEach(function (card) {
                seen[card.id] = true;
                var el = ensureCardEl(card, boardId);
                if (el.parentNode !== b.field) b.field.appendChild(el);
                if (el.dataset.cpCardLibId !== card.libId) loadFace(card);
                if (!(draggingId && card.id === draggingId)) applyCardChrome(card, el, boardId);
                if (byZone[card.zone]) byZone[card.zone].push(card);
                else byZone.field.push(card);
            });

            Object.keys(cardEls).forEach(function (id) {
                var el = cardEls[id];
                if (el.dataset.cpBoard !== boardId) return;
                if (!seen[id]) {
                    el.remove();
                    delete cardEls[id];
                    delete pendingFaces[id];
                }
            });

            layoutZoneCards(boardId, Z.HAND, byZone.hand.sort(function (a, c) { return a.order - c.order; }));
            layoutZoneCards(boardId, Z.TREASURE, byZone.treasure.sort(function (a, c) { return a.order - c.order; }));
            layoutZoneCards(boardId, Z.DISCARD, byZone.discard.sort(function (a, c) { return a.order - c.order; }));
            layoutZoneCards(boardId, Z.COMMANDER, byZone.commander);

            var deckN = store.getDeckIds(boardId).length;
            if (b.deckCount) b.deckCount.textContent = String(deckN);
            if (b.handCount) b.handCount.textContent = String(byZone.hand.length);
            if (b.discardCount) b.discardCount.textContent = String(byZone.discard.length);
            var ready = byZone.treasure.filter(function (c) { return (c.rot || 0) % 180 !== 90; }).length;
            if (b.treasureCount) b.treasureCount.textContent = String(ready);
            if (b.drawZone) b.drawZone.classList.toggle('is-empty', deckN === 0);

            b.field.classList.toggle('cp-board-readonly', !store.canEdit(boardId));
        }

        function renderShell() {
            var st = store.getState();
            var play = qs('.cp-panel-play');
            if (play) {
                play.classList.toggle('cp-solo-mode', !st.localSeat);
                play.classList.toggle('cp-local-seat-p2', st.localSeat === 2);
            }
            var banner = qs('#cpSoloBanner');
            if (banner) banner.hidden = !!st.localSeat;
        }

        var raf = 0;
        function render() {
            if (raf) return;
            raf = requestAnimationFrame(function () {
                raf = 0;
                renderShell();
                renderBoard('p1');
                renderBoard('p2');
            });
        }

        function getCardEl(id) {
            return cardEls[id] || null;
        }

        function fieldPointFromClient(boardId, clientX, clientY) {
            var b = boardEls(boardId);
            if (!b.field) return { x: 0, y: 0 };
            var r = b.field.getBoundingClientRect();
            return { x: clientX - r.left, y: clientY - r.top };
        }

        function hitZone(boardId, clientX, clientY) {
            var b = boardEls(boardId);
            function inside(el, name) {
                if (!el) return null;
                var r = el.getBoundingClientRect();
                if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return name;
                return null;
            }
            return inside(b.drawZone, 'deck') ||
                inside(b.handZone, Z.HAND) ||
                inside(b.treasureZone, Z.TREASURE) ||
                inside(b.discardZone, Z.DISCARD) ||
                inside(b.commanderZone, Z.COMMANDER) ||
                Z.FIELD;
        }

        store.subscribe(function () { render(); });

        var resizeTimer = 0;
        function onResize() {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                resizeTimer = 0;
                render();
            }, 80);
        }
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);

        return {
            render: render,
            boardEls: boardEls,
            getCardEl: getCardEl,
            fieldPointFromClient: fieldPointFromClient,
            hitZone: hitZone,
            zoneRect: zoneRect,
            setDraggingId: setDraggingId
        };
    }

    global.CardPlayerBoardView = { create: createBoardView };
})(typeof window !== 'undefined' ? window : globalThis);
