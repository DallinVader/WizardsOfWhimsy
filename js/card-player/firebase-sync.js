/**

 * Card Player — Firebase room sync on top of PlayStore.

 * Firestore doc shape v2 (+ shared.turn for coin / turns).

 *

 * Seat presence:

 *  - Reconnect with the same auth uid reclaims the seat and rehydrates board/hand.

 *  - Leaving (Disconnect / tab close) clears the seat uid; board data stays so a

 *    reconnect can restore it.

 *  - When both seats are empty the room is wiped so the next match starts clean.

 */

(function (global) {

    'use strict';



    function waitingTurn() {

        return {

            phase: 'waiting',

            activeSeat: null,

            turnNumber: 0,

            coin: null,

            coinNonce: 0,

            announceNonce: 0

        };

    }



    function emptySeatPayload() {

        return { deckIds: [], cards: [], rev: 0 };

    }



    function createFirebaseSync(opts) {

        var store = opts.store;

        var onStatus = opts.onStatus || function () {};

        var db = null;

        var unsub = null;

        var authUid = '';

        var roomId = '';

        var pushTimer = null;

        var applying = false;

        var lastFinger = { p1: '', p2: '', shared: '', turn: '' };

        var startingCoin = false;

        var ownHydrated = false;

        var releasing = false;

        var unloadBound = false;



        function cfgOk() {

            return !!(global.firebase && global.CardMakerFirebaseConfig && CardMakerFirebaseConfig.apiKey);

        }



        function ensureApp() {

            if (!cfgOk()) throw new Error('Firebase is not configured');

            if (!firebase.apps.length) {

                firebase.initializeApp(CardMakerFirebaseConfig);

            }

            db = firebase.firestore();

            var auth = firebase.auth();

            var persist = firebase.auth.Auth.Persistence.LOCAL;

            return auth.setPersistence(persist).catch(function () { /* ignore */ }).then(function () {

                return auth.signInAnonymously();

            }).then(function (cred) {

                authUid = cred.user && cred.user.uid ? cred.user.uid : '';

                return authUid;

            });

        }



        function finger(obj) {

            try { return JSON.stringify(obj); } catch (e) { return String(Math.random()); }

        }



        function normalizeRoomId(raw) {

            return String(raw || '')

                .trim()

                .toLowerCase()

                .replace(/[^a-z0-9\-_/]/g, '-')

                .replace(/-+/g, '-')

                .slice(0, 64);

        }



        function buildShareUrl(rid) {

            var u = new URL(window.location.href);

            u.searchParams.set('room', rid);

            return u.toString();

        }



        function roomRef(rid) {

            return db.collection('cardPlayerRooms').doc(rid || roomId);

        }



        function schedulePush() {

            if (!roomId || !db || applying || releasing) return;

            if (pushTimer) clearTimeout(pushTimer);

            pushTimer = setTimeout(pushNow, 180);

        }



        function pushNow() {

            pushTimer = null;

            if (!roomId || !db || applying || releasing) return;

            var seat = store.getState().localSeat;

            if (!seat) return;

            var st = store.getState();

            var shared = {

                commanderId: st.commanderId || '',

                turn: store.serializeTurn()

            };

            var patch = {

                v: 2,

                shared: shared,

                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),

                updatedBy: authUid

            };

            if (seat === 1) patch.p1 = store.serializeSeat('p1');

            else patch.p2 = store.serializeSeat('p2');



            db.collection('cardPlayerRooms').doc(roomId).set(patch, { merge: true }).catch(function (err) {

                onStatus('Sync error: ' + (err && err.message ? err.message : err));

            });

        }



        function pushTurnOnly() {

            if (!roomId || !db || applying || releasing) return;

            var st = store.getState();

            if (!st.localSeat) return;

            db.collection('cardPlayerRooms').doc(roomId).set({

                v: 2,

                shared: {

                    commanderId: st.commanderId || '',

                    turn: store.serializeTurn()

                },

                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),

                updatedBy: authUid

            }, { merge: true }).catch(function (err) {

                onStatus('Turn sync error: ' + (err && err.message ? err.message : err));

            });

        }



        function maybeStartCoin(data) {

            if (startingCoin || !roomId || releasing) return;

            if (!data || !data.seat1Uid || !data.seat2Uid) return;

            var local = store.getState().localSeat;

            if (local !== 1) return;

            var turn = data.shared && data.shared.turn;

            /* Only start when the match has not already chosen a first player. */

            if (turn && turn.phase && turn.phase !== 'waiting' && turn.phase !== 'idle') return;

            if (turn && turn.coin && turn.activeSeat) return;

            startingCoin = true;

            var coin = Math.random() < 0.5 ? 'heads' : 'tails';

            store.startCoinFlip(coin);

            pushTurnOnly();

            setTimeout(function () { startingCoin = false; }, 800);

        }



        function applySeatFromRemote(boardId, slice, isOwn) {

            if (!slice) return;

            var f = finger(slice);

            var key = boardId === 'p2' ? 'p2' : 'p1';

            if (!isOwn && f === lastFinger[key]) return;

            lastFinger[key] = f;

            store.applySeatSlice(boardId, slice, { animate: !isOwn });

        }



        function applyDoc(data, opts) {

            if (!data) return;

            opts = opts || {};

            if (data.v === 1) {

                data = {

                    v: 2,

                    shared: { commanderId: data.commanderId || '', turn: data.turn || null },

                    p1: { deckIds: data.deckIds || [], cards: (data.cards || []).filter(function (c) { return !c || c.b !== 'p2'; }) },

                    p2: { deckIds: data.deckP2Ids || [], cards: (data.cards || []).filter(function (c) { return c && c.b === 'p2'; }) },

                    seat1Uid: data.seat1Uid || '',

                    seat2Uid: data.seat2Uid || '',

                    updatedBy: data.updatedBy || ''

                };

            }

            applying = true;

            try {

                var local = store.getState().localSeat;

                var both = !!(data.seat1Uid && data.seat2Uid);

                store.setRoomBothSeated(both);



                if (data.shared) {

                    var sharedCopy = {

                        commanderId: data.shared.commanderId || '',

                        turn: data.shared.turn || null

                    };

                    var sf = finger(sharedCopy);

                    if (sf !== lastFinger.shared) {

                        lastFinger.shared = sf;

                        if (sharedCopy.commanderId !== store.getState().commanderId) {

                            store.setCommander(sharedCopy.commanderId || '');

                        }

                    }

                    if (data.shared.turn) {

                        var tf = finger(data.shared.turn);

                        if (tf !== lastFinger.turn || opts.forceTurn) {

                            lastFinger.turn = tf;

                            store.applyTurnState(data.shared.turn);

                        }

                    } else if (both) {

                        maybeStartCoin(data);

                    }

                } else if (both) {

                    maybeStartCoin(data);

                }



                /*

                 * Own seat: rehydrate once on connect/reconnect (or when forced).

                 * After that the local client is authoritative so we don't clobber

                 * in-progress drags with echo snapshots.

                 */

                if (data.p1) {

                    if (local === 1) {

                        if (!ownHydrated || opts.forceOwn) {

                            applySeatFromRemote('p1', data.p1, true);

                            ownHydrated = true;

                        } else {

                            lastFinger.p1 = finger(data.p1);

                        }

                    } else {

                        applySeatFromRemote('p1', data.p1, false);

                    }

                }

                if (data.p2) {

                    if (local === 2) {

                        if (!ownHydrated || opts.forceOwn) {

                            applySeatFromRemote('p2', data.p2, true);

                            ownHydrated = true;

                        } else {

                            lastFinger.p2 = finger(data.p2);

                        }

                    } else {

                        applySeatFromRemote('p2', data.p2, false);

                    }

                }



                if (both) maybeStartCoin(data);

            } finally {

                applying = false;

            }

        }



        function pickSeat(data, uid) {

            data = data || {};

            if (data.seat1Uid === uid) return 1;

            if (data.seat2Uid === uid) return 2;

            if (!data.seat1Uid) return 1;

            if (!data.seat2Uid) return 2;

            return 0;

        }



        function bindUnloadRelease() {

            if (unloadBound) return;

            unloadBound = true;

            var release = function () {

                if (!roomId || !authUid) return;

                try {

                    releaseSeat({ keepalive: true });

                } catch (e) { /* ignore */ }

            };

            window.addEventListener('pagehide', release);

            window.addEventListener('beforeunload', release);

        }



        /**

         * Clear our seat claim. If nobody remains, wipe the room so the next

         * match starts fresh. Board slices stay until that full reset so a

         * reconnect can restore hand/field.

         */

        function releaseSeat(opts) {

            opts = opts || {};

            if (!db || !authUid) return Promise.resolve();

            var rid = roomId || opts.roomId;

            var seat = opts.seat != null ? opts.seat : store.getState().localSeat;

            if (!rid || !seat) return Promise.resolve();

            if (releasing && !opts.keepalive) return Promise.resolve();

            releasing = true;

            var ref = roomRef(rid);



            if (opts.keepalive && global.navigator && typeof navigator.sendBeacon === 'function') {

                /* Best-effort: Firestore REST is awkward via beacon; fall through to async write. */

            }



            return db.runTransaction(function (tx) {

                return tx.get(ref).then(function (snap) {

                    if (!snap.exists) return { reset: false };

                    var data = snap.data() || {};

                    var s1 = data.seat1Uid || '';

                    var s2 = data.seat2Uid || '';

                    if (seat === 1 && s1 === authUid) s1 = '';

                    else if (seat === 2 && s2 === authUid) s2 = '';

                    else return { reset: false, skipped: true };



                    if (!s1 && !s2) {

                        tx.set(ref, {

                            v: 2,

                            shared: {

                                commanderId: '',

                                turn: waitingTurn()

                            },

                            p1: emptySeatPayload(),

                            p2: emptySeatPayload(),

                            seat1Uid: '',

                            seat2Uid: '',

                            updatedBy: authUid,

                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()

                        });

                        return { reset: true };

                    }

                    tx.set(ref, {

                        seat1Uid: s1,

                        seat2Uid: s2,

                        updatedBy: authUid,

                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()

                    }, { merge: true });

                    return { reset: false };

                });

            }).catch(function () {

                return { reset: false, error: true };

            }).then(function (result) {

                releasing = false;

                return result || { reset: false };

            });

        }



        function connect(rawRoom) {

            var rid = normalizeRoomId(rawRoom);

            if (!rid) {

                onStatus('Enter a room name');

                return Promise.reject(new Error('room'));

            }

            return ensureApp().then(function (uid) {

                var ref = db.collection('cardPlayerRooms').doc(rid);

                return db.runTransaction(function (tx) {

                    return tx.get(ref).then(function (snap) {

                        var data = snap.exists ? snap.data() : null;

                        var seat = pickSeat(data, uid);

                        if (!seat) throw new Error('Room is full');

                        var doc;

                        if (!snap.exists) {

                            doc = {

                                v: 2,

                                shared: {

                                    commanderId: store.getState().commanderId || '',

                                    turn: waitingTurn()

                                },

                                p1: seat === 1 ? store.serializeSeat('p1') : emptySeatPayload(),

                                p2: seat === 2 ? store.serializeSeat('p2') : emptySeatPayload(),

                                seat1Uid: seat === 1 ? uid : '',

                                seat2Uid: seat === 2 ? uid : '',

                                updatedBy: uid,

                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()

                            };

                            tx.set(ref, doc);

                        } else {

                            var patch = {

                                v: 2,

                                updatedBy: uid,

                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()

                            };

                            if (seat === 1) patch.seat1Uid = uid;

                            else patch.seat2Uid = uid;

                            /* Never overwrite an existing seat board with empty local state — reconnect restores it. */

                            if (!data.p1) patch.p1 = seat === 1 ? store.serializeSeat('p1') : emptySeatPayload();

                            if (!data.p2) patch.p2 = seat === 2 ? store.serializeSeat('p2') : emptySeatPayload();

                            if (!data.shared) {

                                patch.shared = {

                                    commanderId: store.getState().commanderId || '',

                                    turn: waitingTurn()

                                };

                            } else if (!data.shared.turn) {

                                patch.shared = Object.assign({}, data.shared, { turn: waitingTurn() });

                            }

                            tx.set(ref, patch, { merge: true });

                        }

                        return seat;

                    });

                }).then(function (seat) {

                    roomId = rid;

                    ownHydrated = false;

                    startingCoin = false;

                    lastFinger = { p1: '', p2: '', shared: '', turn: '' };

                    releasing = false;

                    store.setLocalSeat(seat);

                    bindUnloadRelease();



                    /* Hydrate board + turn from the room before listening (reconnect-safe). */

                    return ref.get().then(function (snap) {

                        if (snap.exists) {

                            applyDoc(snap.data(), { forceOwn: true, forceTurn: true });

                        } else {

                            store.applyTurnState(waitingTurn());

                            ownHydrated = true;

                        }

                        if (unsub) unsub();

                        unsub = ref.onSnapshot(function (snap2) {

                            if (!snap2.exists) return;

                            if (snap2.metadata && snap2.metadata.hasPendingWrites) return;

                            applyDoc(snap2.data());

                        }, function (err) {

                            onStatus('Room listen failed: ' + (err && err.message ? err.message : err));

                        });

                        onStatus('Connected as Player ' + seat + ' · room “' + rid + '”');

                        return { roomId: rid, seat: seat, url: buildShareUrl(rid) };

                    });

                });

            });

        }



        function disconnect() {

            var rid = roomId;

            var seat = store.getState().localSeat;

            if (unsub) {

                unsub();

                unsub = null;

            }

            if (pushTimer) {

                clearTimeout(pushTimer);

                pushTimer = null;

            }

            return releaseSeat({ roomId: rid, seat: seat }).then(function (result) {

                roomId = '';

                startingCoin = false;

                ownHydrated = false;

                releasing = false;

                store.setLocalSeat(null);

                lastFinger = { p1: '', p2: '', shared: '', turn: '' };

                if (result && result.reset) {

                    onStatus('Disconnected · room reset');

                } else {

                    onStatus('Disconnected');

                }

            });

        }



        function isConnected() {

            return !!roomId;

        }



        function getRoomId() {

            return roomId;

        }



        store.subscribe(function (_state, change) {

            if (applying || releasing) return;

            if (!roomId) return;

            if (change && (change.type === 'remote-apply' || change.type === 'remote-full' || change.type === 'seat' || change.type === 'room-seats')) return;

            if (change && change.type === 'turn') {

                pushTurnOnly();

                return;

            }

            schedulePush();

        });



        return {

            cfgOk: cfgOk,

            connect: connect,

            disconnect: disconnect,

            isConnected: isConnected,

            getRoomId: getRoomId,

            buildShareUrl: buildShareUrl,

            normalizeRoomId: normalizeRoomId,

            schedulePush: schedulePush,

            pushTurnOnly: pushTurnOnly

        };

    }



    global.CardPlayerFirebaseSync = { create: createFirebaseSync };

})(typeof window !== 'undefined' ? window : globalThis);


