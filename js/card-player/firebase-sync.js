/**
 * Card Player — Firebase room sync on top of PlayStore.
 * Firestore doc shape v2 (+ shared.turn for coin / turns).
 */
(function (global) {
    'use strict';

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

        function cfgOk() {
            return !!(global.firebase && global.CardMakerFirebaseConfig && CardMakerFirebaseConfig.apiKey);
        }

        function ensureApp() {
            if (!cfgOk()) throw new Error('Firebase is not configured');
            if (!firebase.apps.length) {
                firebase.initializeApp(CardMakerFirebaseConfig);
            }
            db = firebase.firestore();
            return firebase.auth().signInAnonymously().then(function (cred) {
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

        function schedulePush() {
            if (!roomId || !db || applying) return;
            if (pushTimer) clearTimeout(pushTimer);
            pushTimer = setTimeout(pushNow, 180);
        }

        function pushNow() {
            pushTimer = null;
            if (!roomId || !db || applying) return;
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
            if (!roomId || !db || applying) return;
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
            if (startingCoin || !roomId) return;
            if (!data || !data.seat1Uid || !data.seat2Uid) return;
            var local = store.getState().localSeat;
            if (local !== 1) return;
            var turn = data.shared && data.shared.turn;
            if (turn && turn.coin && turn.activeSeat) return;
            startingCoin = true;
            var coin = Math.random() < 0.5 ? 'heads' : 'tails';
            store.startCoinFlip(coin);
            pushTurnOnly();
            setTimeout(function () { startingCoin = false; }, 800);
        }

        function applyDoc(data) {
            if (!data) return;
            if (data.v === 1) {
                data = {
                    v: 2,
                    shared: { commanderId: data.commanderId || '' },
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
                        if (tf !== lastFinger.turn) {
                            lastFinger.turn = tf;
                            store.applyTurnState(data.shared.turn);
                        }
                    } else if (both) {
                        maybeStartCoin(data);
                    }
                } else if (both) {
                    maybeStartCoin(data);
                }

                if (data.p1 && local !== 1) {
                    var f1 = finger(data.p1);
                    if (f1 !== lastFinger.p1) {
                        lastFinger.p1 = f1;
                        store.applySeatSlice('p1', data.p1, { animate: true });
                    }
                } else if (data.p1 && local === 1) {
                    lastFinger.p1 = finger(data.p1);
                }
                if (data.p2 && local !== 2) {
                    var f2 = finger(data.p2);
                    if (f2 !== lastFinger.p2) {
                        lastFinger.p2 = f2;
                        store.applySeatSlice('p2', data.p2, { animate: true });
                    }
                } else if (data.p2 && local === 2) {
                    lastFinger.p2 = finger(data.p2);
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
                                    turn: { phase: 'waiting', activeSeat: null, turnNumber: 0, coin: null, coinNonce: 0, announceNonce: 0 }
                                },
                                p1: store.serializeSeat('p1'),
                                p2: store.serializeSeat('p2'),
                                seat1Uid: seat === 1 ? uid : '',
                                seat2Uid: seat === 2 ? uid : '',
                                updatedBy: uid
                            };
                            tx.set(ref, doc);
                        } else {
                            var patch = { v: 2 };
                            if (seat === 1) patch.seat1Uid = uid;
                            else patch.seat2Uid = uid;
                            if (!data.p1) patch.p1 = store.serializeSeat('p1');
                            if (!data.p2) patch.p2 = store.serializeSeat('p2');
                            if (!data.shared) {
                                patch.shared = {
                                    commanderId: store.getState().commanderId || '',
                                    turn: { phase: 'waiting', activeSeat: null, turnNumber: 0, coin: null, coinNonce: 0, announceNonce: 0 }
                                };
                            }
                            tx.set(ref, patch, { merge: true });
                        }
                        return seat;
                    });
                }).then(function (seat) {
                    roomId = rid;
                    store.setLocalSeat(seat);
                    store.applyTurnState({ phase: 'waiting', activeSeat: null, turnNumber: 0, coin: null, coinNonce: 0, announceNonce: 0 });
                    if (unsub) unsub();
                    unsub = ref.onSnapshot(function (snap) {
                        if (!snap.exists) return;
                        if (snap.metadata && snap.metadata.hasPendingWrites) return;
                        applyDoc(snap.data());
                    }, function (err) {
                        onStatus('Room listen failed: ' + (err && err.message ? err.message : err));
                    });
                    onStatus('Connected as Player ' + seat + ' · room “' + rid + '”');
                    return { roomId: rid, seat: seat, url: buildShareUrl(rid) };
                });
            });
        }

        function disconnect() {
            if (unsub) {
                unsub();
                unsub = null;
            }
            roomId = '';
            startingCoin = false;
            store.setLocalSeat(null);
            lastFinger = { p1: '', p2: '', shared: '', turn: '' };
            onStatus('Disconnected');
        }

        function isConnected() {
            return !!roomId;
        }

        function getRoomId() {
            return roomId;
        }

        store.subscribe(function (_state, change) {
            if (applying) return;
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
