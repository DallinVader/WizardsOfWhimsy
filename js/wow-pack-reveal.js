/**
 * Pack peel reveal — swipe top card away; card backs, progress, summary, sound.
 */
(function (global) {
    'use strict';

    var MAX_STACK = 3;
    var FLY_MS = 200;
    var SWIPE_THRESHOLD = 48;
    var OPEN_BEAT_MS = 200;
    var FLIP_MS = 360;
    /** Enable peel swipe this many ms after flip starts (before flip animation finishes). */
    var FLIP_PEEL_UNLOCK_MS = 120;
    var RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'fantastical'];
    var SOUND_MUTE_KEY = 'wow_pack_sound_mute';

    function encodeSrc(path) {
        if (!path) return '';
        if (/^data:|^https?:|^blob:/i.test(String(path))) return String(path);
        return String(path).split('/').map(function (part) {
            return encodeURIComponent(part);
        }).join('/');
    }

    function normalizeRarity(value) {
        return String(value || '').trim().toLowerCase();
    }

    function rarityIndex(rarity) {
        var idx = RARITY_ORDER.indexOf(normalizeRarity(rarity));
        return idx < 0 ? 0 : idx;
    }

    function rarityClass(rarity) {
        if (!rarity) return '';
        var s = String(rarity).trim();
        if (!s) return '';
        return 'wow-stack-rarity--' + s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }

    function prefersReducedMotion() {
        return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function preloadImage(src) {
        if (!src) return;
        var img = new Image();
        img.decoding = 'async';
        img.src = encodeSrc(src);
    }

    function preloadAll(cards) {
        (cards || []).forEach(function (card) {
            preloadImage(card && card.image);
        });
    }

    var sound = (function () {
        var ctx = null;

        function getCtx() {
            if (!ctx) {
                var Ctx = global.AudioContext || global.webkitAudioContext;
                if (!Ctx) return null;
                ctx = new Ctx();
            }
            if (ctx.state === 'suspended') ctx.resume();
            return ctx;
        }

        function isMuted() {
            var v = global.localStorage.getItem(SOUND_MUTE_KEY);
            if (v === null) return false;
            return v === '1';
        }

        function setMuted(m) {
            global.localStorage.setItem(SOUND_MUTE_KEY, m ? '1' : '0');
        }

        function playNote(ac, freq, start, dur, vol, type) {
            var osc = ac.createOscillator();
            var gain = ac.createGain();
            osc.type = type || 'triangle';
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0001), start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start(start);
            osc.stop(start + dur + 0.04);
        }

        /** Filtered noise burst — paper / cardboard texture. */
        function playNoiseWhoosh(ac, opts) {
            opts = opts || {};
            var dur = opts.dur != null ? opts.dur : 0.22;
            var vol = opts.vol != null ? opts.vol : 0.14;
            var f0 = opts.f0 != null ? opts.f0 : 900;
            var f1 = opts.f1 != null ? opts.f1 : 2800;
            var f2 = opts.f2 != null ? opts.f2 : 700;
            var q = opts.q != null ? opts.q : 1.1;
            var t = ac.currentTime;
            var samples = Math.max(1, Math.floor(ac.sampleRate * dur));
            var buf = ac.createBuffer(1, samples, ac.sampleRate);
            var data = buf.getChannelData(0);
            var i;
            for (i = 0; i < samples; i++) {
                var env = Math.pow(1 - i / samples, 0.55);
                data[i] = (Math.random() * 2 - 1) * env;
            }
            var src = ac.createBufferSource();
            src.buffer = buf;
            var filter = ac.createBiquadFilter();
            filter.type = 'bandpass';
            filter.Q.value = q;
            filter.frequency.setValueAtTime(f0, t);
            filter.frequency.exponentialRampToValueAtTime(Math.max(f1, 80), t + dur * 0.35);
            filter.frequency.exponentialRampToValueAtTime(Math.max(f2, 60), t + dur);
            var gain = ac.createGain();
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0001), t + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            src.connect(filter);
            filter.connect(gain);
            gain.connect(ac.destination);
            src.start(t);
            src.stop(t + dur + 0.02);
        }

        /** Soft low thump — card landing / slap. */
        function playCardThump(ac, delay, vol) {
            var t = ac.currentTime + (delay || 0);
            var osc = ac.createOscillator();
            var gain = ac.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(180, t);
            osc.frequency.exponentialRampToValueAtTime(55, t + 0.08);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(Math.max(vol || 0.08, 0.0001), t + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start(t);
            osc.stop(t + 0.12);
        }

        /** Physical card flip: air whoosh + soft slap. */
        function playCardFlip() {
            if (isMuted()) return;
            var ac = getCtx();
            if (!ac) return;
            playNoiseWhoosh(ac, {
                dur: 0.28,
                vol: 0.16,
                f0: 700,
                f1: 3200,
                f2: 500,
                q: 0.9
            });
            playCardThump(ac, 0.14, 0.07);
        }

        /** Swipe card away: longer scrape / flutter. */
        function playCardSwipe() {
            if (isMuted()) return;
            var ac = getCtx();
            if (!ac) return;
            playNoiseWhoosh(ac, {
                dur: 0.2,
                vol: 0.12,
                f0: 1200,
                f1: 2400,
                f2: 400,
                q: 0.85
            });
        }

        /** Rare / pack-complete chimes (kept separate from flip physics). */
        function playTaskComplete(variant) {
            if (isMuted()) return;
            var ac = getCtx();
            if (!ac) return;
            var t = ac.currentTime;

            if (variant === 'rare') {
                playNote(ac, 659.25, t, 0.16, 0.09, 'sine');
                playNote(ac, 987.77, t + 0.07, 0.2, 0.08, 'triangle');
                playNote(ac, 1318.51, t + 0.14, 0.24, 0.06, 'sine');
                return;
            }

            if (variant === 'celebrate') {
                playNote(ac, 523.25, t, 0.14, 0.06, 'triangle');
                playNote(ac, 659.25, t + 0.06, 0.16, 0.09, 'sine');
                playNote(ac, 987.77, t + 0.12, 0.22, 0.08, 'sine');
                playNote(ac, 1318.51, t + 0.18, 0.28, 0.05, 'triangle');
            }
        }

        function playPeel() {
            playCardSwipe();
        }

        function playRare() {
            playTaskComplete('rare');
        }

        function playFinale() {
            playTaskComplete('celebrate');
        }

        function playFlip() {
            playCardFlip();
        }

        function playSummaryComplete() {
            playTaskComplete('celebrate');
        }

        return {
            isMuted: isMuted,
            setMuted: setMuted,
            playPeel: playPeel,
            playFlip: playFlip,
            playRare: playRare,
            playFinale: playFinale,
            playSummaryComplete: playSummaryComplete,
            playTaskComplete: playTaskComplete
        };
    })();

    function createCardEl(card, depth, cardBackUrl) {
        var el = document.createElement('article');
        el.className = 'wow-peel-card wow-peel-card--depth-' + depth;
        if (depth === 0) el.classList.add('is-top');
        el.setAttribute('aria-hidden', depth === 0 ? 'false' : 'true');

        var rarity = card && card.rarity ? rarityClass(card.rarity) : '';
        if (rarity && depth === 0) el.classList.add(rarity);

        var faceSrc = card && card.image ? card.image : '';
        var backSrc = cardBackUrl || '';

        if (backSrc && faceSrc) {
            var flip = document.createElement('div');
            flip.className = 'wow-peel-flip';

            var inner = document.createElement('div');
            inner.className = 'wow-peel-flip-inner';

            var backFace = document.createElement('div');
            backFace.className = 'wow-peel-face wow-peel-face--back';
            var backImg = document.createElement('img');
            backImg.src = encodeSrc(backSrc);
            backImg.alt = 'Card back';
            backImg.width = 400;
            backImg.height = 560;
            backImg.decoding = 'async';
            backImg.draggable = false;
            backFace.appendChild(backImg);

            var frontFace = document.createElement('div');
            frontFace.className = 'wow-peel-face wow-peel-face--front';
            var frontImg = document.createElement('img');
            frontImg.src = encodeSrc(faceSrc);
            frontImg.alt = card.name || 'Card';
            frontImg.width = 400;
            frontImg.height = 560;
            frontImg.decoding = 'async';
            frontImg.draggable = false;
            frontImg.loading = depth <= 1 ? 'eager' : 'lazy';
            frontFace.appendChild(frontImg);

            if (depth === 0 && card && card.isNew) {
                var faceBadge = document.createElement('span');
                faceBadge.className = 'wow-peel-new';
                faceBadge.textContent = 'NEW';
                frontFace.appendChild(faceBadge);
            }

            inner.appendChild(backFace);
            inner.appendChild(frontFace);
            flip.appendChild(inner);
            el.appendChild(flip);
        } else {
            var img = document.createElement('img');
            img.src = encodeSrc(faceSrc || backSrc);
            img.alt = card.name || 'Card';
            img.width = 400;
            img.height = 560;
            img.decoding = 'async';
            img.draggable = false;
            img.loading = depth <= 1 ? 'eager' : 'lazy';
            el.appendChild(img);
            if (depth === 0 && card && card.isNew) {
                var soloBadge = document.createElement('span');
                soloBadge.className = 'wow-peel-new';
                soloBadge.textContent = 'NEW';
                el.appendChild(soloBadge);
            }
        }

        return el;
    }

    function triggerFlipOnTop(stackEl, reduced, onDone) {
        var topCard = stackEl.querySelector('.wow-peel-card.is-top');
        var inner = topCard && topCard.querySelector('.wow-peel-flip-inner');
        if (!inner) {
            if (onDone) onDone(false);
            return;
        }
        if (inner.classList.contains('is-flipped')) {
            if (onDone) onDone(true);
            return;
        }

        topCard.classList.add('is-revealing');
        sound.playFlip();

        if (reduced) {
            inner.classList.add('is-flipped');
            topCard.classList.remove('is-revealing');
            if (onDone) onDone(true);
            return;
        }

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                inner.classList.add('is-flipped');
            });
        });

        window.setTimeout(function () {
            if (onDone) onDone(false);
        }, FLIP_PEEL_UNLOCK_MS);

        window.setTimeout(function () {
            topCard.classList.remove('is-revealing');
        }, FLIP_MS);
    }

    function bindPeelSwipe(stackEl, canPeel, onPeel) {
        var dragX = 0;
        var dragging = false;
        var topEl = null;
        var startX = 0;
        var raf = null;

        function applyDrag() {
            if (!topEl) return;
            var tilt = Math.max(-12, Math.min(12, dragX * 0.08));
            topEl.style.transform = 'translate3d(' + dragX + 'px, 0, 0) rotate(' + tilt.toFixed(1) + 'deg)';
            raf = null;
        }

        function onMove(clientX) {
            if (!dragging || !topEl) return;
            dragX = clientX - startX;
            if (raf == null) raf = requestAnimationFrame(applyDrag);
        }

        function snapBack() {
            if (!topEl) return;
            topEl.classList.add('is-snapping');
            topEl.style.transform = '';
            window.setTimeout(function () {
                if (topEl) topEl.classList.remove('is-snapping');
            }, 220);
        }

        function onEnd() {
            if (!dragging) return;
            dragging = false;
            stackEl.classList.remove('is-dragging');
            if (topEl) topEl.classList.remove('is-grabbing');

            var dir = 0;
            if (dragX < -SWIPE_THRESHOLD && canPeel()) dir = -1;
            else if (dragX > SWIPE_THRESHOLD && canPeel()) dir = 1;

            if (dir !== 0) onPeel(dir);
            else snapBack();

            dragX = 0;
            topEl = null;
        }

        stackEl.addEventListener('pointerdown', function (e) {
            if (!canPeel()) return;
            topEl = stackEl.querySelector('.wow-peel-card.is-top');
            if (!topEl || !e.target.closest('.wow-peel-card.is-top')) return;
            if (e.button !== 0) return;
            e.preventDefault();
            dragging = true;
            startX = e.clientX;
            dragX = 0;
            stackEl.classList.add('is-dragging');
            topEl.classList.add('is-grabbing');
            topEl.classList.remove('is-snapping');
            topEl.style.transition = 'none';
            stackEl.setPointerCapture(e.pointerId);
        });

        stackEl.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            onMove(e.clientX);
        });

        stackEl.addEventListener('pointerup', onEnd);
        stackEl.addEventListener('pointercancel', onEnd);
    }

    function renderSummaryGrid(summaryGridEl, cards, escapeHtml) {
        if (!summaryGridEl) return;
        escapeHtml = escapeHtml || function (s) { return String(s); };
        summaryGridEl.innerHTML = (cards || []).map(function (card, i) {
            var r = rarityClass(card.rarity);
            var rLabel = card.rarity ? String(card.rarity) : '';
            var art = card.image
                ? '<img src="' + escapeHtml(encodeSrc(card.image)) + '" alt="" loading="lazy">'
                : '<span class="wow-pack-summary-placeholder">🃏</span>';
            var newBadge = card.isNew ? '<span class="wow-pack-summary-new">NEW</span>' : '';
            return (
                '<article class="wow-pack-summary-card' + (r ? ' ' + r : '') + '">' +
                    '<div class="wow-pack-summary-art">' + art + newBadge + '</div>' +
                    '<p class="wow-pack-summary-name">' + escapeHtml(card.name || 'Card') + '</p>' +
                    (rLabel ? '<p class="wow-pack-summary-rarity">' + escapeHtml(rLabel) + '</p>' : '') +
                    '<span class="wow-pack-summary-num">' + (i + 1) + '</span>' +
                '</article>'
            );
        }).join('');
    }

    /**
     * @param {object} opts
     */
    function init(opts) {
        opts = opts || {};
        var stackEl = opts.stackEl;
        var cards = opts.cards || [];
        var cardBackUrl = opts.cardBackUrl || '';
        var nameEl = opts.nameEl;
        var newEl = opts.newEl;
        var subEl = opts.subEl;
        var indexEl = opts.indexEl;
        var totalEl = opts.totalEl;
        var hintEl = opts.hintEl;
        var progressEl = opts.progressEl;
        var peelPhaseEl = opts.peelPhaseEl;
        var summaryEl = opts.summaryEl;
        var summaryGridEl = opts.summaryGridEl;
        var revealAllBtn = opts.revealAllBtn;
        var skipRaresBtn = opts.skipRaresBtn;
        var soundBtn = opts.soundBtn;
        var skipLowRarityOnStart = !!opts.skipLowRarityOnStart;
        var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
        var onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null;
        var escapeHtml = opts.escapeHtml;
        var reduced = prefersReducedMotion();
        var flyMs = reduced ? 0 : FLY_MS;
        var peelIndex = 0;
        var animating = false;
        var opening = true;
        var keyHandler = null;
        var summaryShown = false;
        var finishTimer = null;
        var flippedTop = false;
        var PROGRESS_DOT_LIMIT = 24;

        if (!stackEl || !cards.length) {
            return {
                reset: function () {},
                revealAll: function () {},
                skipToRares: function () {},
                showSummary: function () {},
                getIndex: function () { return 0; },
                destroy: function () {}
            };
        }

        stackEl.classList.add('wow-peel-stack');

        if (totalEl) totalEl.textContent = String(cards.length);
        preloadAll(cards);

        function firstRarePlusIndex() {
            var i;
            for (i = 0; i < cards.length; i++) {
                if (rarityIndex(cards[i] && cards[i].rarity) >= 2) return i;
            }
            return -1;
        }

        function updateSoundBtn() {
            if (!soundBtn) return;
            soundBtn.setAttribute('aria-pressed', sound.isMuted() ? 'true' : 'false');
            soundBtn.textContent = sound.isMuted() ? 'Sound off' : 'Sound on';
            soundBtn.title = sound.isMuted() ? 'Enable pack sounds' : 'Mute pack sounds';
        }

        function updateSkipRaresBtn() {
            if (!skipRaresBtn) return;
            var target = firstRarePlusIndex();
            var canSkip = !summaryShown && !opening && target >= 0 && peelIndex < target;
            skipRaresBtn.hidden = !canSkip;
            skipRaresBtn.disabled = animating || !canSkip;
        }

        function updateProgress() {
            if (!progressEl) return;
            var total = cards.length;
            var current = Math.min(peelIndex + 1, total);
            if (total > PROGRESS_DOT_LIMIT) {
                var pct = total > 0 ? Math.round((peelIndex / total) * 100) : 0;
                if (peelIndex >= total) pct = 100;
                progressEl.innerHTML =
                    '<div class="wow-pack-progress-bar" aria-hidden="true">' +
                        '<div class="wow-pack-progress-bar-fill" style="width:' + pct + '%"></div>' +
                    '</div>' +
                    '<span class="wow-pack-progress-label">' + current + ' / ' + total + '</span>';
            } else {
                progressEl.innerHTML = cards.map(function (_, i) {
                    var cls = 'wow-pack-progress-dot';
                    if (i < peelIndex) cls += ' is-done';
                    else if (i === peelIndex) cls += ' is-current';
                    return '<span class="' + cls + '" aria-hidden="true"></span>';
                }).join('');
            }
            progressEl.setAttribute('aria-label', 'Card ' + current + ' of ' + total);
        }

        function canPeel() {
            /* Allow swiping the final revealed card away to open the overview. */
            return peelIndex < cards.length && !animating && !opening && !summaryShown && flippedTop;
        }

        function flashRarity(card, isFinale) {
            if (reduced || !stackEl) return;
            var idx = rarityIndex(card && card.rarity);
            stackEl.classList.remove('is-rarity-flash', 'is-rarity-flash--epic', 'is-finale-flash');
            if (isFinale && idx >= 3) {
                stackEl.classList.add('is-finale-flash');
            } else if (idx >= 2) {
                stackEl.classList.add('is-rarity-flash');
                if (idx >= 3) stackEl.classList.add('is-rarity-flash--epic');
            }
            window.setTimeout(function () {
                stackEl.classList.remove('is-rarity-flash', 'is-rarity-flash--epic', 'is-finale-flash');
            }, isFinale ? 900 : 550);
        }

        function updateMeta() {
            var card = cards[peelIndex];
            if (nameEl) {
                if (!flippedTop && !summaryShown && !opening) {
                    nameEl.textContent = '· · ·';
                    nameEl.classList.remove('is-pop');
                } else if (!opening && card) {
                    nameEl.textContent = card.name || '';
                    nameEl.classList.remove('is-pop');
                    void nameEl.offsetWidth;
                    nameEl.classList.add('is-pop');
                } else {
                    nameEl.textContent = '';
                    nameEl.classList.remove('is-pop');
                }
            }
            if (subEl) {
                if (!flippedTop && !summaryShown && !opening) {
                    subEl.textContent = '';
                    subEl.className = 'wow-gallery-sub';
                } else if (!opening && card) {
                    subEl.textContent = card.subtitle || '';
                    subEl.className = 'wow-gallery-sub' + (card.rarity ? ' ' + rarityClass(card.rarity) : '');
                } else {
                    subEl.textContent = '';
                    subEl.className = 'wow-gallery-sub';
                }
            }
            if (newEl) {
                var showNew = !!(flippedTop && !opening && !summaryShown && card && card.isNew);
                newEl.hidden = !showNew;
            }
            if (indexEl) indexEl.textContent = String(Math.min(peelIndex + 1, cards.length));
            if (hintEl) {
                if (summaryShown) {
                    hintEl.textContent = '';
                } else if (opening) {
                    hintEl.textContent = 'Opening pack…';
                } else if (!flippedTop) {
                    hintEl.textContent = 'Revealing card…';
                } else if (peelIndex === cards.length - 1) {
                    var lastRarityIdx = rarityIndex(card && card.rarity);
                    hintEl.textContent = lastRarityIdx >= 2
                        ? 'Best pull! Swipe away to see your overview →'
                        : 'Swipe the last card away to see your pack overview →';
                } else if (canPeel()) {
                    hintEl.textContent = 'Swipe the card away to reveal the next pull →';
                } else {
                    hintEl.textContent = '';
                }
            }
            if (revealAllBtn) revealAllBtn.hidden = summaryShown || opening;
            updateSkipRaresBtn();
            stackEl.classList.remove('is-finished');
            updateProgress();
            if (onChange && card) onChange(peelIndex, card);
        }

        function renderStack() {
            stackEl.innerHTML = '';
            var i;
            for (i = 0; i < MAX_STACK && peelIndex + i < cards.length; i++) {
                stackEl.appendChild(createCardEl(cards[peelIndex + i], i, cardBackUrl));
            }
        }

        function showSummary() {
            if (summaryShown) return;
            summaryShown = true;
            if (finishTimer) window.clearTimeout(finishTimer);
            finishTimer = null;
            renderSummaryGrid(summaryGridEl, cards, escapeHtml);
            if (peelPhaseEl) peelPhaseEl.hidden = true;
            if (summaryEl) summaryEl.hidden = false;
            var panel = summaryEl && summaryEl.closest ? summaryEl.closest('.wow-pack-modal-panel') : null;
            if (panel) panel.classList.add('wow-pack-modal-panel--summary');
            var dialog = summaryEl && summaryEl.closest ? summaryEl.closest('.wow-pack-modal-dialog') : null;
            if (dialog) dialog.classList.add('wow-pack-modal-dialog--summary');
            if (revealAllBtn) revealAllBtn.hidden = true;
            if (skipRaresBtn) skipRaresBtn.hidden = true;
            if (hintEl) hintEl.textContent = '';
            sound.playSummaryComplete();
            if (onComplete) onComplete(cards);
        }

        function afterReveal(card, isFinale, alreadyFlipped) {
            flippedTop = true;
            animating = false;
            var idx = rarityIndex(card && card.rarity);
            if (!alreadyFlipped) {
                if (isFinale && idx >= 3) {
                    sound.playFinale();
                } else if (idx >= 2) {
                    sound.playRare();
                }
            }
            updateMeta();
            flashRarity(card, isFinale);
        }

        function revealTopCard() {
            animating = true;
            flippedTop = false;
            triggerFlipOnTop(stackEl, reduced, function (alreadyFlipped) {
                afterReveal(cards[peelIndex], peelIndex === cards.length - 1, !!alreadyFlipped);
            });
        }

        function flyAway(dir) {
            if (!canPeel()) return;
            var top = stackEl.querySelector('.wow-peel-card.is-top');
            if (!top) return;

            animating = true;
            stackEl.classList.add('is-peeling');
            sound.playPeel();

            var flyX = dir * (stackEl.offsetWidth * 1.15 + 40);
            top.classList.remove('is-grabbing');
            top.classList.add('is-flying');

            function afterFly() {
                peelIndex += 1;
                stackEl.classList.remove('is-peeling');
                if (peelIndex >= cards.length) {
                    animating = false;
                    flippedTop = false;
                    showSummary();
                    return;
                }
                renderStack();
                revealTopCard();
            }

            if (reduced || flyMs === 0) {
                afterFly();
                return;
            }

            top.style.transition = 'transform ' + flyMs + 'ms cubic-bezier(0.22, 1, 0.36, 1), opacity ' + flyMs + 'ms ease';
            top.style.transform = 'translate3d(' + flyX + 'px, -28px, 0) rotate(' + (dir * 16) + 'deg)';
            top.style.opacity = '0';

            window.setTimeout(afterFly, flyMs);
        }

        function revealAll() {
            while (peelIndex < cards.length - 1) {
                peelIndex += 1;
            }
            animating = false;
            opening = false;
            flippedTop = true;
            stackEl.classList.remove('is-opening', 'is-peeling');
            renderStack();
            var topInner = stackEl.querySelector('.wow-peel-card.is-top .wow-peel-flip-inner');
            if (topInner) topInner.classList.add('is-flipped');
            updateMeta();
            flashRarity(cards[peelIndex], true);
            /* Still require a swipe of the last card — do not jump to summary. */
        }

        /** Jump past common/uncommon pulls to the first rare+ (or last card if none). */
        function skipToRares() {
            if (summaryShown || animating) return;
            var target = firstRarePlusIndex();
            if (target < 0) {
                revealAll();
                return;
            }
            if (peelIndex > target) return;
            if (peelIndex === target && flippedTop) {
                updateSkipRaresBtn();
                return;
            }
            peelIndex = target;
            animating = false;
            opening = false;
            flippedTop = true;
            stackEl.classList.remove('is-opening', 'is-peeling');
            renderStack();
            var topInner = stackEl.querySelector('.wow-peel-card.is-top .wow-peel-flip-inner');
            if (topInner) topInner.classList.add('is-flipped');
            updateMeta();
            flashRarity(cards[peelIndex], peelIndex === cards.length - 1);
            var idx = rarityIndex(cards[peelIndex] && cards[peelIndex].rarity);
            if (idx >= 3) sound.playFinale();
            else if (idx >= 2) sound.playRare();
        }

        function reset() {
            peelIndex = 0;
            animating = false;
            flippedTop = false;
            opening = !reduced;
            summaryShown = false;
            if (finishTimer) window.clearTimeout(finishTimer);
            stackEl.classList.remove('is-peeling', 'is-finished', 'is-opening');
            if (peelPhaseEl) peelPhaseEl.hidden = false;
            if (summaryEl) summaryEl.hidden = true;
            var panel = summaryEl && summaryEl.closest ? summaryEl.closest('.wow-pack-modal-panel') : null;
            if (panel) panel.classList.remove('wow-pack-modal-panel--summary');
            var dialog = summaryEl && summaryEl.closest ? summaryEl.closest('.wow-pack-modal-dialog') : null;
            if (dialog) dialog.classList.remove('wow-pack-modal-dialog--summary');
            if (reduced) opening = false;
            else stackEl.classList.add('is-opening');
            renderStack();
            updateMeta();
            if (opening) {
                window.setTimeout(function () {
                    opening = false;
                    stackEl.classList.remove('is-opening');
                    if (skipLowRarityOnStart) {
                        skipToRares();
                        stackEl.focus();
                    } else {
                        revealTopCard();
                        stackEl.focus();
                    }
                }, OPEN_BEAT_MS);
            } else if (skipLowRarityOnStart) {
                skipToRares();
                stackEl.focus();
            } else {
                revealTopCard();
                stackEl.focus();
            }
        }

        bindPeelSwipe(stackEl, canPeel, flyAway);

        if (revealAllBtn) {
            revealAllBtn.addEventListener('click', revealAll);
        }

        if (skipRaresBtn) {
            skipRaresBtn.addEventListener('click', skipToRares);
        }

        if (soundBtn) {
            updateSoundBtn();
            soundBtn.addEventListener('click', function () {
                sound.setMuted(!sound.isMuted());
                updateSoundBtn();
            });
        }

        keyHandler = function (ev) {
            var tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea') return;
            if (summaryShown) return;
            if (ev.key === ' ' || ev.key === 'ArrowRight' || ev.key === 'Enter') {
                if (!canPeel()) return;
                ev.preventDefault();
                flyAway(1);
            }
        };
        document.addEventListener('keydown', keyHandler);

        opening = !reduced;
        if (reduced) opening = false;
        else stackEl.classList.add('is-opening');

        renderStack();
        updateMeta();
        updateSoundBtn();

        function beginReveal() {
            opening = false;
            stackEl.classList.remove('is-opening');
            if (skipLowRarityOnStart) {
                skipToRares();
            } else {
                revealTopCard();
            }
            stackEl.focus();
        }

        if (opening) {
            window.setTimeout(beginReveal, OPEN_BEAT_MS);
        } else {
            beginReveal();
        }

        return {
            reset: reset,
            revealAll: revealAll,
            skipToRares: skipToRares,
            showSummary: showSummary,
            getIndex: function () { return peelIndex; },
            destroy: function () {
                if (keyHandler) document.removeEventListener('keydown', keyHandler);
                if (finishTimer) window.clearTimeout(finishTimer);
                stackEl.innerHTML = '';
                stackEl.classList.remove('wow-peel-stack', 'is-dragging', 'is-peeling', 'is-finished', 'is-opening');
                var panel = summaryEl && summaryEl.closest ? summaryEl.closest('.wow-pack-modal-panel') : null;
                if (panel) panel.classList.remove('wow-pack-modal-panel--summary');
                var dialog = summaryEl && summaryEl.closest ? summaryEl.closest('.wow-pack-modal-dialog') : null;
                if (dialog) dialog.classList.remove('wow-pack-modal-dialog--summary');
            }
        };
    }

    function trapFocus(modalEl) {
        if (!modalEl) return function () {};
        var previous = document.activeElement;

        function onKeyDown(e) {
            if (e.key !== 'Tab' || !modalEl.classList.contains('is-open')) return;
            var focusable = modalEl.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (!focusable.length) return;
            var first = focusable[0];
            var last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', onKeyDown);
        return function () {
            document.removeEventListener('keydown', onKeyDown);
            if (previous && previous.focus) previous.focus();
        };
    }

    global.WowPackReveal = {
        init: init,
        trapFocus: trapFocus,
        sound: sound,
        rarityIndex: rarityIndex
    };
})(window);
