/**
 * Swipeable tilt card stack — shared by landing gallery and pack reveal.
 */
(function (global) {
    'use strict';

    function signedOffset(i, active, len) {
        var d = i - active;
        if (d > len / 2) d -= len;
        if (d < -len / 2) d += len;
        return d;
    }

    function stackRole(offset) {
        if (offset === 0) return 'is-active';
        if (offset === -1) return 'is-left';
        if (offset === 1) return 'is-right';
        return 'is-back';
    }

    function encodeSrc(path) {
        if (!path) return '';
        if (/^data:|^https?:|^blob:/i.test(String(path))) return String(path);
        return String(path).split('/').map(function (part) {
            return encodeURIComponent(part);
        }).join('/');
    }

    function initStackTilt(stackEl) {
        if (!stackEl || global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        var maxTilt = 14;
        var raf = null;
        var pending = null;

        function applyTilt(card, xNorm, yNorm, active) {
            if (!card) return;
            var inner = card.querySelector('.wow-card-tilt-inner');
            var shine = card.querySelector('.wow-card-shine');
            if (!inner) return;
            if (!active) {
                inner.style.transform = '';
                card.classList.remove('is-tilting');
                if (shine) shine.style.background = '';
                return;
            }
            card.classList.add('is-tilting');
            var rotY = (xNorm - 0.5) * 2 * maxTilt;
            var rotX = (0.5 - yNorm) * 2 * maxTilt;
            inner.style.transform =
                'rotateX(' + rotX.toFixed(2) + 'deg) rotateY(' + rotY.toFixed(2) + 'deg) scale3d(1.03, 1.03, 1.03)';
            if (shine) {
                shine.style.background =
                    'radial-gradient(circle at ' +
                    (xNorm * 100).toFixed(1) + '% ' +
                    (yNorm * 100).toFixed(1) +
                    '%, rgba(255,248,230,0.35), transparent 58%)';
            }
        }

        function onMove(clientX, clientY) {
            var card = stackEl.querySelector('.wow-stack-card.is-active');
            if (!card) return;
            var rect = card.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            var xNorm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            var yNorm = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
            pending = { card: card, x: xNorm, y: yNorm, active: true };
            if (raf != null) return;
            raf = requestAnimationFrame(function () {
                raf = null;
                if (!pending) return;
                applyTilt(pending.card, pending.x, pending.y, pending.active);
                pending = null;
            });
        }

        stackEl.addEventListener('mousemove', function (e) {
            if (stackEl.classList.contains('is-dragging')) return;
            onMove(e.clientX, e.clientY);
        });
        stackEl.addEventListener('mouseleave', function () {
            var card = stackEl.querySelector('.wow-stack-card.is-active');
            applyTilt(card, 0.5, 0.5, false);
        });
    }

    function initWhimsySparkles(stackEl) {
        var noop = { shakeOff: function () {}, shakeBurst: function () {}, puff: function () {} };
        if (!stackEl || global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return noop;
        }

        var layer = document.createElement('div');
        layer.className = 'wow-dust-layer';
        layer.setAttribute('aria-hidden', 'true');
        stackEl.appendChild(layer);

        var lastTrail = 0;

        function layerPoint(stackRect, x, y) {
            var padX = stackRect.width * 0.18;
            var padY = stackRect.height * 0.18;
            return { x: x + padX, y: y + padY };
        }

        function spawnFall(stackRect, x, y, dir, power) {
            var el = document.createElement('span');
            var tone = Math.random() > 0.45 ? 'wow-dust--gold' : 'wow-dust--violet';
            var bright = Math.random() > 0.65 ? ' wow-dust--bright' : '';
            el.className = 'wow-dust ' + tone + bright;

            var size = 3 + Math.random() * 4.5;
            var pt = layerPoint(stackRect, x, y);
            el.style.left = pt.x + 'px';
            el.style.top = pt.y + 'px';
            el.style.setProperty('--ds', size.toFixed(1) + 'px');

            var p = Math.max(0.35, power || 0.5);
            var dx = -dir * (8 + Math.random() * 38 * p) + (Math.random() - 0.5) * 22;
            var dy = 14 + Math.random() * (26 + p * 36);
            el.style.setProperty('--sx', dx.toFixed(1) + 'px');
            el.style.setProperty('--sy', dy.toFixed(1) + 'px');
            el.style.setProperty('--dur', (0.75 + Math.random() * 0.5) + 's');

            layer.appendChild(el);
            requestAnimationFrame(function () {
                el.classList.add('is-falling');
            });
            window.setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 1300);
        }

        function shakeOff(dragX, cardEl) {
            if (!cardEl || Math.abs(dragX) < 4) return;

            var now = Date.now();
            var interval = Math.max(12, 26 - Math.abs(dragX) * 0.12);
            if (now - lastTrail < interval) return;
            lastTrail = now;

            var stackRect = stackEl.getBoundingClientRect();
            var cardRect = cardEl.getBoundingClientRect();
            var dir = dragX > 0 ? 1 : -1;
            var power = Math.min(Math.abs(dragX) / 65, 1.25);
            var count = 2 + Math.floor(power * 6);
            var i;

            for (i = 0; i < count; i++) {
                var edgeX;
                var edgeY;
                if (Math.random() > 0.82 && power > 0.45) {
                    edgeX = cardRect.left - stackRect.left + cardRect.width * Math.random();
                    edgeY = cardRect.top - stackRect.top + Math.random() * 10;
                } else {
                    if (dir > 0) {
                        edgeX = cardRect.left - stackRect.left + Math.random() * 16;
                    } else {
                        edgeX = cardRect.right - stackRect.left - Math.random() * 16;
                    }
                    edgeY = cardRect.top - stackRect.top + cardRect.height * (0.06 + Math.random() * 0.88);
                }
                spawnFall(stackRect, edgeX, edgeY, dir, power);
            }
        }

        function shakeBurst(cardEl, dragX) {
            if (!cardEl) return;
            var stackRect = stackEl.getBoundingClientRect();
            var cardRect = cardEl.getBoundingClientRect();
            var dir = dragX > 0 ? 1 : -1;
            var power = 1.35;
            var i;
            for (i = 0; i < 16; i++) {
                var edgeX;
                if (dir > 0) {
                    edgeX = cardRect.left - stackRect.left + Math.random() * 24;
                } else {
                    edgeX = cardRect.right - stackRect.left - Math.random() * 24;
                }
                var edgeY = cardRect.top - stackRect.top + cardRect.height * (0.04 + Math.random() * 0.92);
                spawnFall(stackRect, edgeX, edgeY, dir, power);
            }
        }

        function puff(x, y) {
            var stackRect = stackEl.getBoundingClientRect();
            var i;
            for (i = 0; i < 5; i++) {
                spawnFall(
                    stackRect,
                    x + (Math.random() - 0.5) * 30,
                    y + (Math.random() - 0.5) * 20,
                    Math.random() > 0.5 ? 1 : -1,
                    0.55
                );
            }
        }

        return { shakeOff: shakeOff, shakeBurst: shakeBurst, puff: puff };
    }

    function initStackSwipe(stackEl, onStep, whimsy) {
        if (!stackEl) return;

        var dragX = 0;
        var dragging = false;
        var activeEl = null;
        var startX = 0;
        var threshold = 56;
        whimsy = whimsy || { shakeOff: function () {}, shakeBurst: function () {} };

        function setDragDirection() {
            stackEl.classList.toggle('is-dragging-left', dragX < -8);
            stackEl.classList.toggle('is-dragging-right', dragX > 8);
        }

        function clearDragDirection() {
            stackEl.classList.remove('is-dragging-left', 'is-dragging-right');
        }

        function resetActiveTransform() {
            if (activeEl) {
                activeEl.style.transform = '';
                activeEl.style.transition = '';
            }
        }

        function onStart(clientX) {
            activeEl = stackEl.querySelector('.wow-stack-card.is-active');
            if (!activeEl) return;
            dragging = true;
            startX = clientX;
            dragX = 0;
            stackEl.classList.add('is-dragging');
            activeEl.classList.add('is-grabbing');
            activeEl.style.transition = 'none';
            clearDragDirection();
        }

        function onMove(clientX) {
            if (!dragging || !activeEl) return;
            dragX = clientX - startX;
            var tilt = Math.max(-9, Math.min(9, dragX * 0.07));
            var shake = Math.abs(dragX) > 12 ? Math.sin(Date.now() * 0.028) * Math.min(Math.abs(dragX) * 0.035, 4) : 0;
            activeEl.style.transform =
                'translate3d(' + dragX + 'px, ' + shake.toFixed(2) + 'px, 0) rotate(' + tilt.toFixed(2) + 'deg) scale(1)';
            setDragDirection();
            whimsy.shakeOff(dragX, activeEl);
        }

        function onEnd(clientX) {
            if (!dragging) return;
            var releaseDragX = dragX;
            var releaseCard = activeEl;
            dragging = false;
            stackEl.classList.remove('is-dragging');
            clearDragDirection();
            if (activeEl) activeEl.classList.remove('is-grabbing');

            if (releaseDragX < -threshold) {
                whimsy.shakeBurst(releaseCard, releaseDragX);
                resetActiveTransform();
                onStep(1, 'swipe');
            } else if (releaseDragX > threshold) {
                whimsy.shakeBurst(releaseCard, releaseDragX);
                resetActiveTransform();
                onStep(-1, 'swipe');
            } else if (activeEl) {
                activeEl.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
                activeEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg) scale(1)';
                window.setTimeout(function () {
                    if (activeEl) activeEl.style.transition = '';
                }, 360);
            }
            dragX = 0;
            activeEl = null;
        }

        stackEl.addEventListener('pointerdown', function (e) {
            if (!e.target.closest('.wow-stack-card.is-active')) return;
            if (e.button !== 0) return;
            stackEl.setPointerCapture(e.pointerId);
            onStart(e.clientX);
        });
        stackEl.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            onMove(e.clientX);
        });
        stackEl.addEventListener('pointerup', function (e) {
            onEnd(e.clientX);
        });
        stackEl.addEventListener('pointercancel', function (e) {
            onEnd(e.clientX);
        });
    }

    /**
     * @param {object} opts
     * @param {HTMLElement} opts.stackEl
     * @param {Array<{name:string,subtitle?:string,image?:string,rarity?:string}>} opts.cards
     * @param {HTMLElement} [opts.nameEl]
     * @param {HTMLElement} [opts.subEl]
     * @param {HTMLElement} [opts.indexEl]
     * @param {HTMLElement} [opts.totalEl]
     * @param {HTMLElement} [opts.thumbsEl]
     * @param {HTMLElement} [opts.prevBtn]
     * @param {HTMLElement} [opts.nextBtn]
     * @param {function(number, object)} [opts.onChange]
     * @param {number} [opts.startIndex]
     * @param {boolean} [opts.enableKeyboard]
     */
    function init(opts) {
        opts = opts || {};
        var stackEl = opts.stackEl;
        var cards = opts.cards || [];
        var nameEl = opts.nameEl;
        var subEl = opts.subEl;
        var indexEl = opts.indexEl;
        var totalEl = opts.totalEl;
        var thumbsEl = opts.thumbsEl;
        var prevBtn = opts.prevBtn;
        var nextBtn = opts.nextBtn;
        var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
        var cardEls = [];
        var index = 0;
        var keyHandler = null;

        if (!stackEl || !cards.length) {
            return { show: function () {}, step: function () {}, getIndex: function () { return 0; }, destroy: function () {} };
        }

        if (totalEl) totalEl.textContent = String(cards.length);

        function rarityClass(rarity) {
            if (!rarity) return '';
            var s = String(rarity).trim();
            if (!s) return '';
            return 'wow-stack-rarity--' + s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        }

        function updateStackClasses() {
            cardEls.forEach(function (el, i) {
                var role = stackRole(signedOffset(i, index, cards.length));
                var card = cards[i];
                var rarityCls = card && card.rarity ? rarityClass(card.rarity) : '';
                el.className = 'wow-stack-card ' + role + (rarityCls && role === 'is-active' ? ' ' + rarityCls : '');
                el.setAttribute('aria-hidden', role === 'is-active' ? 'false' : 'true');
            });
            var card = cards[index];
            if (nameEl) nameEl.textContent = card.name || '';
            if (subEl) {
                subEl.textContent = card.subtitle || '';
                subEl.className = 'wow-gallery-sub' + (card.rarity ? ' ' + rarityClass(card.rarity) : '');
            }
            if (indexEl) indexEl.textContent = String(index + 1);
            if (thumbsEl) {
                var btns = thumbsEl.querySelectorAll('.wow-gallery-thumb');
                btns.forEach(function (btn, bi) {
                    btn.classList.toggle('is-active', bi === index);
                    btn.setAttribute('aria-selected', bi === index ? 'true' : 'false');
                });
            }
            if (onChange) onChange(index, card);
        }

        function popMeta() {
            if (nameEl) {
                nameEl.classList.remove('is-pop');
                void nameEl.offsetWidth;
                nameEl.classList.add('is-pop');
            }
        }

        function clearActiveTilt() {
            cardEls.forEach(function (card) {
                var inner = card.querySelector('.wow-card-tilt-inner');
                var shine = card.querySelector('.wow-card-shine');
                card.classList.remove('is-tilting', 'is-arriving');
                if (inner) inner.style.transform = '';
                if (shine) shine.style.background = '';
            });
        }

        function celebrateArrival(dir, source) {
            var active = cardEls[index];
            if (active) {
                active.classList.remove('is-arriving');
                void active.offsetWidth;
                active.classList.add('is-arriving');
            }
            popMeta();
            /* Dust only for swipe — arrow/thumb clicks stay quieter. */
            if (whimsy && stackEl && source === 'swipe') {
                var rect = stackEl.getBoundingClientRect();
                whimsy.puff(rect.width * 0.5, rect.height * 0.42);
            }
        }

        function pulseNav(btn) {
            if (!btn) return;
            btn.classList.remove('is-sparkle');
            void btn.offsetWidth;
            btn.classList.add('is-sparkle');
            window.setTimeout(function () {
                btn.classList.remove('is-sparkle');
            }, 320);
        }

        function show(i, optsShow) {
            optsShow = optsShow || {};
            var next = (i + cards.length) % cards.length;
            if (next === index && !optsShow.force) return;
            var dir = signedOffset(next, index, cards.length);
            if (dir === 0 && optsShow.dir) dir = optsShow.dir;
            clearActiveTilt();
            index = next;
            updateStackClasses();
            if (optsShow.animate !== false) {
                celebrateArrival(dir > 0 ? 1 : -1, optsShow.source);
            }
        }

        function step(dir, source) {
            show(index + dir, { dir: dir, animate: source !== 'init', source: source });
            if (source === 'nav') {
                pulseNav(dir < 0 ? prevBtn : nextBtn);
            }
        }

        var whimsy = null;

        stackEl.innerHTML = '';
        cards.forEach(function (card, ci) {
            var el = document.createElement('article');
            el.className = 'wow-stack-card';
            el.dataset.index = String(ci);
            el.setAttribute('aria-label', card.name || 'Card');

            var inner = document.createElement('div');
            inner.className = 'wow-card-tilt-inner';

            var img = document.createElement('img');
            img.src = encodeSrc(card.image);
            img.alt = card.name + (card.subtitle ? ' — ' + card.subtitle : '');
            img.width = 400;
            img.height = 560;
            img.decoding = 'async';
            img.draggable = false;
            if (ci > 0) img.loading = 'lazy';

            var shine = document.createElement('div');
            shine.className = 'wow-card-shine';
            shine.setAttribute('aria-hidden', 'true');

            inner.appendChild(img);
            el.appendChild(inner);
            el.appendChild(shine);
            stackEl.appendChild(el);
            cardEls.push(el);
        });

        initStackTilt(stackEl);
        whimsy = initWhimsySparkles(stackEl);
        initStackSwipe(stackEl, step, whimsy);

        if (thumbsEl) {
            thumbsEl.innerHTML = '';
            cards.forEach(function (card, ci) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'wow-gallery-thumb' + (ci === 0 ? ' is-active' : '');
                btn.setAttribute('role', 'tab');
                btn.setAttribute('aria-label', card.name || 'Card');
                btn.setAttribute('aria-selected', ci === 0 ? 'true' : 'false');
                var thumbImg = document.createElement('img');
                thumbImg.src = encodeSrc(card.image);
                thumbImg.alt = '';
                thumbImg.loading = 'lazy';
                thumbImg.draggable = false;
                btn.appendChild(thumbImg);
                btn.addEventListener('click', function () {
                    if (ci === index) return;
                    var dir = signedOffset(ci, index, cards.length);
                    show(ci, { dir: dir, source: 'thumb' });
                });
                thumbsEl.appendChild(btn);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', function () { step(-1, 'nav'); });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', function () { step(1, 'nav'); });
        }
        if (prevBtn) prevBtn.disabled = cards.length <= 1;
        if (nextBtn) nextBtn.disabled = cards.length <= 1;

        if (opts.enableKeyboard !== false) {
            keyHandler = function (ev) {
                var tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
                if (tag === 'input' || tag === 'textarea') return;
                if (ev.key === 'ArrowLeft') step(-1, 'key');
                else if (ev.key === 'ArrowRight') step(1, 'key');
            };
            document.addEventListener('keydown', keyHandler);
        }

        var start = parseInt(opts.startIndex, 10);
        if (!isFinite(start) || start < 0) start = 0;
        if (start >= cards.length) start = cards.length - 1;
        show(start, { animate: false, force: true });

        return {
            show: show,
            step: step,
            getIndex: function () { return index; },
            destroy: function () {
                if (keyHandler) document.removeEventListener('keydown', keyHandler);
                stackEl.innerHTML = '';
            }
        };
    }

    global.WowCardStack = {
        init: init,
        signedOffset: signedOffset,
        stackRole: stackRole
    };
})(window);
