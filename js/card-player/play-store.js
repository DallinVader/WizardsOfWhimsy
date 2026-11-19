/**
 * Card Player — authoritative play state (seats, decks, cards).
 * Zones: field | hand | discard | treasure | commander | (deck is id list only).
 */
(function (global) {
    'use strict';

    var ZONES = { FIELD: 'field', HAND: 'hand', DISCARD: 'discard', TREASURE: 'treasure', COMMANDER: 'commander' };

    function uid() {
        return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function emptySeat() {
        return {
            deckIds: [],
            cards: {},
            rev: 0
        };
    }

    function emptyTurn() {
        return {
            phase: 'idle', /* idle | waiting | coin | announce | play */
            activeSeat: null,
            turnNumber: 0,
            coin: null, /* heads | tails */
            coinNonce: 0,
            announceNonce: 0
        };
    }

    function createStore() {
        var state = {
            mode: 'solo',
            localSeat: null,
            commanderId: '',
            p1: emptySeat(),
            p2: emptySeat(),
            selectedId: null,
            selectedBoard: null,
            turn: emptyTurn(),
            roomBothSeated: false
        };
        var listeners = [];
        var suppress = 0;

        function emit(change) {
            if (suppress) return;
            var i;
            for (i = 0; i < listeners.length; i++) {
                try { listeners[i](state, change || { type: 'update' }); } catch (e) { /* ignore */ }
            }
        }

        function seatKey(boardId) {
            return boardId === 'p2' ? 'p2' : 'p1';
        }

        function getSeat(boardId) {
            return state[seatKey(boardId)];
        }

        function bump(boardId) {
            getSeat(boardId).rev += 1;
        }

        function cardList(boardId) {
            var seat = getSeat(boardId);
            return Object.keys(seat.cards).map(function (id) { return seat.cards[id]; });
        }

        function cardsInZone(boardId, zone) {
            return cardList(boardId)
                .filter(function (c) { return c.zone === zone; })
                .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        }

        function nextOrder(boardId, zone) {
            var max = 0;
            cardsInZone(boardId, zone).forEach(function (c) {
                if ((c.order || 0) > max) max = c.order || 0;
            });
            return max + 1;
        }

        function findCard(instanceId) {
            var c = state.p1.cards[instanceId];
            if (c) return { boardId: 'p1', card: c };
            c = state.p2.cards[instanceId];
            if (c) return { boardId: 'p2', card: c };
            return null;
        }

        function setDeck(boardId, libIds) {
            getSeat(boardId).deckIds = (libIds || []).slice();
            bump(boardId);
            emit({ type: 'deck', boardId: boardId });
        }

        function getDeckIds(boardId) {
            return getSeat(boardId).deckIds.slice();
        }

        function shuffleDeck(boardId) {
            var d = getSeat(boardId).deckIds;
            var i;
            for (i = d.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = d[i];
                d[i] = d[j];
                d[j] = t;
            }
            bump(boardId);
            emit({ type: 'deck', boardId: boardId });
        }

        function addCard(boardId, card) {
            var seat = getSeat(boardId);
            var c = {
                id: card.id || uid(),
                libId: card.libId,
                zone: card.zone || ZONES.FIELD,
                x: card.x || 0,
                y: card.y || 0,
                rot: card.rot || 0,
                faceDown: !!card.faceDown,
                order: card.order != null ? card.order : 0,
                fromDeck: !!card.fromDeck,
                isCommander: !!card.isCommander
            };
            seat.cards[c.id] = c;
            bump(boardId);
            emit({ type: 'card-add', boardId: boardId, cardId: c.id });
            return c;
        }

        function removeCard(instanceId) {
            var found = findCard(instanceId);
            if (!found) return null;
            delete getSeat(found.boardId).cards[instanceId];
            if (state.selectedId === instanceId) {
                state.selectedId = null;
                state.selectedBoard = null;
            }
            bump(found.boardId);
            emit({ type: 'card-remove', boardId: found.boardId, cardId: instanceId });
            return found;
        }

        function moveCard(instanceId, patch) {
            var found = findCard(instanceId);
            if (!found) return null;
            var c = found.card;
            var prevZone = c.zone;
            if (patch.zone && patch.zone !== c.zone) {
                c.zone = patch.zone;
                if (c.zone !== ZONES.FIELD) {
                    c.order = patch.order != null ? patch.order : nextOrder(found.boardId, c.zone);
                }
            }
            if (patch.x != null) c.x = patch.x;
            if (patch.y != null) c.y = patch.y;
            if (patch.rot != null) c.rot = patch.rot;
            if (patch.faceDown != null) c.faceDown = !!patch.faceDown;
            if (patch.order != null) c.order = patch.order;
            if (patch.fromDeck != null) c.fromDeck = !!patch.fromDeck;
            if (patch.isCommander != null) c.isCommander = !!patch.isCommander;
            bump(found.boardId);
            emit({
                type: 'card-move',
                boardId: found.boardId,
                cardId: instanceId,
                prevZone: prevZone,
                zone: c.zone
            });
            return c;
        }

        function drawToHand(boardId, n) {
            n = Math.max(0, n | 0);
            var seat = getSeat(boardId);
            var drawn = [];
            while (n > 0 && seat.deckIds.length) {
                var libId = seat.deckIds.shift();
                var card = addCard(boardId, {
                    libId: libId,
                    zone: ZONES.HAND,
                    order: nextOrder(boardId, ZONES.HAND),
                    fromDeck: true
                });
                drawn.push(card);
                n--;
            }
            bump(boardId);
            emit({ type: 'draw', boardId: boardId, count: drawn.length });
            return drawn;
        }

        function drawToField(boardId, x, y) {
            var seat = getSeat(boardId);
            if (!seat.deckIds.length) return null;
            var libId = seat.deckIds.shift();
            var card = addCard(boardId, {
                libId: libId,
                zone: ZONES.FIELD,
                /* Normalized 0–1 play-mat coords (cross-device). */
                x: x != null ? x : 0.18,
                y: y != null ? y : 0.2,
                fromDeck: true
            });
            bump(boardId);
            emit({ type: 'draw-field', boardId: boardId, cardId: card.id });
            return card;
        }

        function returnToDeck(instanceId, top) {
            var found = findCard(instanceId);
            if (!found) return;
            var libId = found.card.libId;
            removeCard(instanceId);
            var d = getSeat(found.boardId).deckIds;
            if (top) d.unshift(libId);
            else d.push(libId);
            bump(found.boardId);
            emit({ type: 'return-deck', boardId: found.boardId });
        }

        function clearBoard(boardId, opts) {
            opts = opts || {};
            var seat = getSeat(boardId);
            var keepCommander = !!opts.keepCommander;
            Object.keys(seat.cards).forEach(function (id) {
                var c = seat.cards[id];
                if (keepCommander && c.isCommander) return;
                delete seat.cards[id];
            });
            bump(boardId);
            emit({ type: 'clear', boardId: boardId });
        }

        function mulligan(boardId) {
            var hand = cardsInZone(boardId, ZONES.HAND);
            hand.forEach(function (c) {
                getSeat(boardId).deckIds.push(c.libId);
                delete getSeat(boardId).cards[c.id];
            });
            shuffleDeck(boardId);
            drawToHand(boardId, 7);
            emit({ type: 'mulligan', boardId: boardId });
        }

        function shuffleDiscardIntoDeck(boardId) {
            var disc = cardsInZone(boardId, ZONES.DISCARD);
            disc.forEach(function (c) {
                getSeat(boardId).deckIds.push(c.libId);
                delete getSeat(boardId).cards[c.id];
            });
            shuffleDeck(boardId);
            emit({ type: 'discard-to-deck', boardId: boardId });
        }

        function untapAll(boardId) {
            cardList(boardId).forEach(function (c) {
                if (c.zone === ZONES.FIELD || c.zone === ZONES.TREASURE) c.rot = 0;
            });
            bump(boardId);
            emit({ type: 'untap', boardId: boardId });
        }

        function setCommander(libId) {
            state.commanderId = libId || '';
            suppress++;
            try {
                ['p1', 'p2'].forEach(function (boardId) {
                    cardList(boardId).forEach(function (c) {
                        if (c.isCommander) {
                            delete getSeat(boardId).cards[c.id];
                        }
                    });
                    if (state.commanderId) {
                        addCard(boardId, {
                            libId: state.commanderId,
                            zone: ZONES.COMMANDER,
                            isCommander: true,
                            order: 1
                        });
                    } else {
                        bump(boardId);
                    }
                });
            } finally {
                suppress--;
            }
            emit({ type: 'commander' });
        }

        function select(instanceId, boardId) {
            state.selectedId = instanceId || null;
            state.selectedBoard = boardId || null;
            emit({ type: 'select' });
        }

        function setLocalSeat(seat) {
            state.localSeat = seat;
            state.mode = seat ? 'online' : 'solo';
            if (!seat) {
                state.turn = emptyTurn();
                state.roomBothSeated = false;
            }
            emit({ type: 'seat' });
        }

        function activeBoardId() {
            if (state.localSeat === 2) return 'p2';
            return 'p1';
        }

        function isMyTurn() {
            if (!state.localSeat) return true;
            if (!state.turn || state.turn.phase === 'idle') return true;
            if (state.turn.phase === 'waiting') return true; /* setup before match */
            if (state.turn.phase !== 'play') return false;
            return state.turn.activeSeat === state.localSeat;
        }

        function canEdit(boardId) {
            if (!state.localSeat) return true;
            if (state.localSeat === 1 && boardId !== 'p1') return false;
            if (state.localSeat === 2 && boardId !== 'p2') return false;
            if (!isMyTurn()) return false;
            return true;
        }

        function applyTurnState(turn, opts) {
            opts = opts || {};
            var next = Object.assign(emptyTurn(), turn || {});
            var prev = state.turn || emptyTurn();
            var changed =
                prev.phase !== next.phase ||
                prev.activeSeat !== next.activeSeat ||
                prev.turnNumber !== next.turnNumber ||
                prev.coin !== next.coin ||
                prev.coinNonce !== next.coinNonce ||
                prev.announceNonce !== next.announceNonce;
            state.turn = next;
            if (changed || opts.force) emit({ type: 'turn', turn: state.turn });
        }

        function setRoomBothSeated(both) {
            var v = !!both;
            if (state.roomBothSeated === v) return;
            state.roomBothSeated = v;
            emit({ type: 'room-seats', both: v });
        }

        function startCoinFlip(coin) {
            var side = coin === 'tails' ? 'tails' : 'heads';
            var first = side === 'heads' ? 1 : 2;
            state.turn = {
                phase: 'coin',
                activeSeat: first,
                turnNumber: 1,
                coin: side,
                coinNonce: (state.turn && state.turn.coinNonce || 0) + 1,
                announceNonce: (state.turn && state.turn.announceNonce || 0)
            };
            emit({ type: 'turn', turn: state.turn });
            return state.turn;
        }

        function beginAnnounce() {
            if (!state.turn || !state.turn.activeSeat) return;
            if (state.turn.phase !== 'coin') return;
            state.turn = Object.assign({}, state.turn, {
                phase: 'announce',
                announceNonce: (state.turn.announceNonce || 0) + 1
            });
            emit({ type: 'turn', turn: state.turn });
            return state.turn;
        }

        function beginPlayPhase() {
            if (!state.turn || !state.turn.activeSeat) return;
            if (state.turn.phase !== 'announce' && state.turn.phase !== 'play') return;
            if (state.turn.phase === 'play') return state.turn;
            state.turn = Object.assign({}, state.turn, { phase: 'play' });
            emit({ type: 'turn', turn: state.turn });
            return state.turn;
        }

        function endTurn() {
            if (!state.localSeat || !isMyTurn()) return null;
            if (!state.roomBothSeated) return null;
            if (!state.turn || state.turn.phase !== 'play') return null;
            var nextSeat = state.turn.activeSeat === 1 ? 2 : 1;
            state.turn = {
                phase: 'announce',
                activeSeat: nextSeat,
                turnNumber: (state.turn.turnNumber || 0) + 1,
                coin: state.turn.coin,
                coinNonce: state.turn.coinNonce || 0,
                announceNonce: (state.turn.announceNonce || 0) + 1
            };
            emit({ type: 'turn', turn: state.turn });
            return state.turn;
        }

        function serializeTurn() {
            var t = state.turn || emptyTurn();
            return {
                phase: t.phase,
                activeSeat: t.activeSeat,
                turnNumber: t.turnNumber,
                coin: t.coin,
                coinNonce: t.coinNonce,
                announceNonce: t.announceNonce
            };
        }

        function serializeSeat(boardId) {
            var seat = getSeat(boardId);
            var cards = cardList(boardId).map(function (c) {
                /* Field l/t are 0–1 fractions of the playable mat (cross-device). */
                var lx = c.x;
                var ty = c.y;
                if (c.zone === ZONES.FIELD) {
                    if (lx > 1.05 || ty > 1.05) {
                        /* Legacy absolute px — keep sending; receivers map via playRect. */
                        lx = c.x;
                        ty = c.y;
                    } else {
                        lx = Math.max(0, Math.min(1, Number(c.x) || 0));
                        ty = Math.max(0, Math.min(1, Number(c.y) || 0));
                    }
                }
                var row = {
                    i: c.id,
                    lib: c.libId,
                    b: boardId,
                    l: lx,
                    t: ty,
                    h: c.zone === ZONES.HAND ? 1 : 0,
                    d: c.zone === ZONES.DISCARD ? 1 : 0,
                    tr: c.zone === ZONES.TREASURE ? 1 : 0,
                    cz: c.isCommander ? 1 : 0,
                    czIn: c.zone === ZONES.COMMANDER ? 1 : 0,
                    rot: c.rot || 0,
                    back: c.faceDown ? 1 : 0,
                    fromDeck: c.fromDeck ? 1 : 0
                };
                if (c.zone === ZONES.DISCARD) row.do = c.order || 0;
                if (c.zone === ZONES.TREASURE) row.tro = c.order || 0;
                return row;
            });
            return {
                deckIds: seat.deckIds.slice(),
                cards: cards,
                rev: seat.rev
            };
        }

        function applySeatSlice(boardId, slice, opts) {
            opts = opts || {};
            if (!slice) return;
            suppress++;
            try {
                var seat = getSeat(boardId);
                if (Array.isArray(slice.deckIds)) seat.deckIds = slice.deckIds.slice();
                var keep = {};
                (slice.cards || []).forEach(function (row) {
                    if (!row || !row.lib) return;
                    var id = row.i || uid();
                    keep[id] = true;
                    var zone = ZONES.FIELD;
                    if (row.h) zone = ZONES.HAND;
                    else if (row.d) zone = ZONES.DISCARD;
                    else if (row.tr) zone = ZONES.TREASURE;
                    else if (row.czIn) zone = ZONES.COMMANDER;
                    var existing = seat.cards[id];
                    var order = 0;
                    if (zone === ZONES.DISCARD) order = row.do || 0;
                    if (zone === ZONES.TREASURE) order = row.tro || 0;
                    if (zone === ZONES.HAND || zone === ZONES.COMMANDER) order = existing && existing.order || 0;
                    seat.cards[id] = {
                        id: id,
                        libId: row.lib,
                        zone: zone,
                        x: parseFloat(row.l) || 0,
                        y: parseFloat(row.t) || 0,
                        rot: row.rot || 0,
                        faceDown: !!row.back,
                        order: order,
                        fromDeck: !!row.fromDeck,
                        isCommander: !!row.cz
                    };
                });
                Object.keys(seat.cards).forEach(function (id) {
                    if (!keep[id]) delete seat.cards[id];
                });
                if (slice.rev != null) seat.rev = slice.rev;
                else bump(boardId);
            } finally {
                suppress--;
            }
            emit({ type: 'remote-apply', boardId: boardId, animate: !!opts.animate });
        }

        function replaceFromV2Doc(doc) {
            if (!doc) return;
            suppress++;
            try {
                if (doc.shared && doc.shared.commanderId != null) {
                    state.commanderId = doc.shared.commanderId || '';
                }
                if (doc.p1) applySeatSlice('p1', doc.p1, { animate: false });
                if (doc.p2) applySeatSlice('p2', doc.p2, { animate: false });
            } finally {
                suppress--;
            }
            emit({ type: 'remote-full' });
        }

        function getState() { return state; }

        function subscribe(fn) {
            listeners.push(fn);
            return function () {
                listeners = listeners.filter(function (x) { return x !== fn; });
            };
        }

        return {
            ZONES: ZONES,
            getState: getState,
            subscribe: subscribe,
            getSeat: getSeat,
            cardList: cardList,
            cardsInZone: cardsInZone,
            findCard: findCard,
            nextOrder: nextOrder,
            setDeck: setDeck,
            getDeckIds: getDeckIds,
            shuffleDeck: shuffleDeck,
            addCard: addCard,
            removeCard: removeCard,
            moveCard: moveCard,
            drawToHand: drawToHand,
            drawToField: drawToField,
            returnToDeck: returnToDeck,
            clearBoard: clearBoard,
            mulligan: mulligan,
            shuffleDiscardIntoDeck: shuffleDiscardIntoDeck,
            untapAll: untapAll,
            setCommander: setCommander,
            select: select,
            setLocalSeat: setLocalSeat,
            activeBoardId: activeBoardId,
            canEdit: canEdit,
            isMyTurn: isMyTurn,
            applyTurnState: applyTurnState,
            setRoomBothSeated: setRoomBothSeated,
            startCoinFlip: startCoinFlip,
            beginAnnounce: beginAnnounce,
            beginPlayPhase: beginPlayPhase,
            endTurn: endTurn,
            serializeTurn: serializeTurn,
            serializeSeat: serializeSeat,
            applySeatSlice: applySeatSlice,
            replaceFromV2Doc: replaceFromV2Doc,
            uid: uid
        };
    }

    global.CardPlayerStore = { create: createStore, ZONES: ZONES };
})(typeof window !== 'undefined' ? window : globalThis);
