/**
 * Card Player — coin flip + turn banners for two-player rooms.
 */
(function (global) {
    'use strict';

    function createTurnUi(opts) {
        var store = opts.store;
        var onStatus = opts.onStatus || function () {};
        var overlay = null;
        var coinCard = null;
        var coinResult = null;
        var banner = null;
        var bannerText = null;
        var hud = null;
        var endBtn = null;
        var lastCoinNonce = -1;
        var lastAnnounceNonce = -1;
        var timers = [];

        function clearTimers() {
            timers.forEach(function (t) { clearTimeout(t); });
            timers = [];
        }

        function later(fn, ms) {
            var id = setTimeout(fn, ms);
            timers.push(id);
            return id;
        }

        function ensureDom() {
            if (overlay) return;
            overlay = document.getElementById('cpTurnOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'cpTurnOverlay';
                overlay.className = 'cp-turn-overlay';
                overlay.hidden = true;
                overlay.innerHTML =
                    '<div class="cp-turn-overlay-inner">' +
                        '<div class="cp-coin-stage" id="cpCoinStage" hidden>' +
                            '<p class="cp-coin-title">First player</p>' +
                            '<div class="cp-coin-scene">' +
                                '<div class="cp-coin-card" id="cpCoinCard">' +
                                    '<div class="cp-coin-face cp-coin-heads">' +
                                        '<span class="cp-coin-eyebrow">Wizards of Whimsy</span>' +
                                        '<strong>HEADS</strong>' +
                                        '<span>Player 1 goes first</span>' +
                                    '</div>' +
                                    '<div class="cp-coin-face cp-coin-tails">' +
                                        '<img src="assets/cards/Card%20Back.png" alt="" />' +
                                        '<strong>TAILS</strong>' +
                                        '<span>Player 2 goes first</span>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            '<p class="cp-coin-result" id="cpCoinResult"></p>' +
                        '</div>' +
                        '<div class="cp-turn-banner" id="cpTurnBanner" hidden>' +
                            '<p id="cpTurnBannerText">Player 1&apos;s turn</p>' +
                        '</div>' +
                    '</div>';
                var host = document.querySelector('.cp-panel-play') || document.body;
                host.appendChild(overlay);
            }
            coinCard = document.getElementById('cpCoinCard');
            coinResult = document.getElementById('cpCoinResult');
            banner = document.getElementById('cpTurnBanner');
            bannerText = document.getElementById('cpTurnBannerText');

            hud = document.getElementById('cpTurnHud');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'cpTurnHud';
                hud.className = 'cp-turn-hud';
                hud.hidden = true;
                hud.innerHTML =
                    '<span id="cpTurnHudLabel">Turn</span>' +
                    '<button type="button" class="cp-btn cp-btn-primary" id="cpEndTurnBtn">End turn</button>';
                var play = document.querySelector('.cp-panel-play');
                if (play) play.appendChild(hud);
            }
            endBtn = document.getElementById('cpEndTurnBtn');
            if (endBtn && !endBtn._cpBound) {
                endBtn._cpBound = true;
                endBtn.addEventListener('click', function () {
                    var turn = store.endTurn();
                    if (!turn) {
                        onStatus('Not your turn');
                        return;
                    }
                    onStatus('Turn passed to Player ' + turn.activeSeat);
                });
            }
        }

        function showOverlay(show, passThrough) {
            ensureDom();
            overlay.hidden = !show;
            overlay.classList.toggle('cp-turn-overlay--pass-through', !!passThrough);
        }

        function runCoinFlip(turn) {
            ensureDom();
            clearTimers();
            var stage = document.getElementById('cpCoinStage');
            if (stage) stage.hidden = false;
            if (banner) banner.hidden = true;
            showOverlay(true, false);
            if (coinResult) coinResult.textContent = 'Flipping…';
            if (coinCard) {
                coinCard.classList.remove('cp-coin-land-heads', 'cp-coin-land-tails', 'cp-coin-spinning');
                void coinCard.offsetWidth;
                coinCard.classList.add('cp-coin-spinning');
                coinCard.classList.add(turn.coin === 'tails' ? 'cp-coin-land-tails' : 'cp-coin-land-heads');
            }
            later(function () {
                if (coinResult) {
                    coinResult.textContent = turn.coin === 'tails'
                        ? 'Tails — Player 2 goes first'
                        : 'Heads — Player 1 goes first';
                }
            }, 1600);
            later(function () {
                var stageEl = document.getElementById('cpCoinStage');
                if (stageEl) stageEl.hidden = true;
                /* Player 1 advances match phases so both clients stay in sync. */
                var st = store.getState();
                if (st.localSeat === 1 && st.turn && st.turn.phase === 'coin') {
                    store.beginAnnounce();
                }
            }, 2800);
        }

        function runAnnounce(turn) {
            ensureDom();
            clearTimers();
            var stage = document.getElementById('cpCoinStage');
            if (stage) stage.hidden = true;
            /* Banner is visual-only so it never blocks the board on mobile. */
            showOverlay(true, true);
            if (banner) banner.hidden = false;
            var local = store.getState().localSeat;
            var mine = local && turn.activeSeat === local;
            if (bannerText) {
                bannerText.textContent = mine
                    ? 'Your turn'
                    : ('Player ' + turn.activeSeat + '\'s turn');
            }
            if (banner) {
                banner.classList.remove('cp-turn-banner--pulse');
                void banner.offsetWidth;
                banner.classList.add('cp-turn-banner--pulse');
            }
            later(function () {
                if (banner) banner.hidden = true;
                showOverlay(false, false);
                var st = store.getState();
                if (st.localSeat === 1 && st.turn && st.turn.phase === 'announce') {
                    store.beginPlayPhase();
                }
            }, 1200);
        }

        function syncHud() {
            ensureDom();
            var st = store.getState();
            var turn = st.turn || {};
            var online = !!st.localSeat;
            var inMatch = online && turn.phase && turn.phase !== 'idle' && turn.phase !== 'waiting';
            hud.hidden = !inMatch;
            var label = document.getElementById('cpTurnHudLabel');
            if (label) {
                if (!st.roomBothSeated && inMatch) {
                    label.textContent = 'Opponent away · board saved';
                } else if (turn.phase === 'play') {
                    label.textContent = store.isMyTurn()
                        ? ('Your turn · #' + (turn.turnNumber || 1))
                        : ('Player ' + turn.activeSeat + '\'s turn · #' + (turn.turnNumber || 1));
                } else if (turn.phase === 'coin') {
                    label.textContent = 'Determining first player…';
                } else if (turn.phase === 'announce') {
                    label.textContent = 'Starting turn…';
                } else {
                    label.textContent = st.roomBothSeated ? 'Match ready' : 'Waiting for opponent…';
                }
            }
            if (endBtn) {
                endBtn.disabled = !(turn.phase === 'play' && store.isMyTurn() && st.roomBothSeated);
                endBtn.hidden = turn.phase !== 'play';
            }
            document.body.classList.toggle('cp-not-my-turn', online && turn.phase === 'play' && !store.isMyTurn());
        }

        function onStore(_state, change) {
            var turn = store.getState().turn || {};
            if (turn.phase === 'waiting' || turn.phase === 'idle') {
                lastCoinNonce = -1;
                lastAnnounceNonce = -1;
                clearTimers();
                ensureDom();
                showOverlay(false);
                if (banner) banner.hidden = true;
                var stageIdle = document.getElementById('cpCoinStage');
                if (stageIdle) stageIdle.hidden = true;
            }
            if (change && change.type === 'turn') {
                if (turn.phase === 'coin' && turn.coinNonce !== lastCoinNonce) {
                    lastCoinNonce = turn.coinNonce;
                    runCoinFlip(turn);
                } else if (turn.phase === 'announce' && turn.announceNonce !== lastAnnounceNonce) {
                    lastAnnounceNonce = turn.announceNonce;
                    runAnnounce(turn);
                } else if (turn.phase === 'play') {
                    ensureDom();
                    showOverlay(false);
                    if (banner) banner.hidden = true;
                    var stage = document.getElementById('cpCoinStage');
                    if (stage) stage.hidden = true;
                }
            }
            syncHud();
        }

        function bind() {
            ensureDom();
            store.subscribe(onStore);
            syncHud();
        }

        return { bind: bind, syncHud: syncHud };
    }

    global.CardPlayerTurns = { create: createTurnUi };
})(typeof window !== 'undefined' ? window : globalThis);
