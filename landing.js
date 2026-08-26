/**
 * Landing page: reveal-on-scroll, card gallery tilt, waitlist mailto bridge.
 */
(function () {
    'use strict';

    var WAITLIST_TO = 'hello@wizardsofwhimsy.com';

    function reveal() {
        var nodes = document.querySelectorAll('.wow-reveal');
        if (!nodes.length) return;

        if (!('IntersectionObserver' in window)) {
            nodes.forEach(function (el) {
                el.classList.add('is-in');
            });
            return;
        }

        var io = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-in');
                        io.unobserve(entry.target);
                    }
                });
            },
            { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
        );

        nodes.forEach(function (el) {
            io.observe(el);
        });
    }

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

    function initStackTilt(stackEl) {
        if (!stackEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
        if (!stackEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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

            for (var i = 0; i < count; i++) {
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

        function onMove(clientX, clientY) {
            if (!dragging || !activeEl) return;
            dragX = clientX - startX;
            var tilt = Math.max(-9, Math.min(9, dragX * 0.07));
            var shake = Math.abs(dragX) > 12 ? Math.sin(Date.now() * 0.028) * Math.min(Math.abs(dragX) * 0.035, 4) : 0;
            activeEl.style.transform =
                'translate3d(' + dragX + 'px, ' + shake.toFixed(2) + 'px, 0) rotate(' + tilt.toFixed(2) + 'deg) scale(1)';
            setDragDirection();
            whimsy.shakeOff(dragX, activeEl);
        }

        function onEnd(clientX, clientY) {
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
                activeEl.style.transition = 'transform 0.35s var(--ease-out)';
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
            onMove(e.clientX, e.clientY);
        });
        stackEl.addEventListener('pointerup', function (e) {
            onEnd(e.clientX, e.clientY);
        });
        stackEl.addEventListener('pointercancel', function (e) {
            onEnd(e.clientX, e.clientY);
        });
    }

    function initGallery(cards, gallery, empty) {
        var stackEl = document.getElementById('wowCardStack');
        var nameEl = document.getElementById('wowGalleryName');
        var subEl = document.getElementById('wowGallerySub');
        var indexEl = document.getElementById('wowGalleryIndex');
        var totalEl = document.getElementById('wowGalleryTotal');
        var thumbsEl = document.getElementById('wowGalleryThumbs');
        var prevBtn = document.getElementById('wowGalleryPrev');
        var nextBtn = document.getElementById('wowGalleryNext');
        var cardEls = [];
        var index = 0;

        if (empty) empty.hidden = true;
        gallery.hidden = false;
        if (totalEl) totalEl.textContent = String(cards.length);

        function encodeSrc(path) {
            return String(path).split('/').map(function (part) {
                return encodeURIComponent(part);
            }).join('/');
        }

        function updateStackClasses() {
            cardEls.forEach(function (el, i) {
                var role = stackRole(signedOffset(i, index, cards.length));
                el.className = 'wow-stack-card ' + role;
                el.setAttribute('aria-hidden', role === 'is-active' ? 'false' : 'true');
            });
            var card = cards[index];
            if (nameEl) nameEl.textContent = card.name;
            if (subEl) subEl.textContent = card.subtitle || '';
            if (indexEl) indexEl.textContent = String(index + 1);
            if (thumbsEl) {
                var btns = thumbsEl.querySelectorAll('.wow-gallery-thumb');
                btns.forEach(function (btn, bi) {
                    btn.classList.toggle('is-active', bi === index);
                    btn.setAttribute('aria-selected', bi === index ? 'true' : 'false');
                });
            }
        }

        function popMeta() {
            if (nameEl) {
                nameEl.classList.remove('is-pop');
                void nameEl.offsetWidth;
                nameEl.classList.add('is-pop');
            }
        }

        function celebrateArrival(dir, source) {
            var active = cardEls[index];
            if (active) {
                active.classList.remove('is-arriving');
                void active.offsetWidth;
                active.classList.add('is-arriving');
            }
            popMeta();
            if (whimsy && stackEl && source !== 'swipe' && source !== 'thumb') {
                var rect = stackEl.getBoundingClientRect();
                whimsy.puff(rect.width * 0.5, rect.height * 0.42);
            }
        }

        function wiggleNav(btn) {
            if (!btn) return;
            btn.classList.remove('is-sparkle');
            void btn.offsetWidth;
            btn.classList.add('is-sparkle');
        }

        function show(i, opts) {
            opts = opts || {};
            var next = (i + cards.length) % cards.length;
            if (next === index && !opts.force) return;
            var dir = signedOffset(next, index, cards.length);
            if (dir === 0 && opts.dir) dir = opts.dir;
            index = next;
            updateStackClasses();
            if (opts.animate !== false) {
                celebrateArrival(dir > 0 ? 1 : -1, opts.source);
            }
        }

        function step(dir, source) {
            show(index + dir, { dir: dir, animate: source !== 'init', source: source });
            if (source === 'nav') {
                wiggleNav(dir < 0 ? prevBtn : nextBtn);
            }
        }

        var whimsy = null;

        if (stackEl) {
            stackEl.innerHTML = '';
            cards.forEach(function (card, ci) {
                var el = document.createElement('article');
                el.className = 'wow-stack-card';
                el.dataset.index = String(ci);
                el.setAttribute('aria-label', card.name);

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
        }

        if (thumbsEl) {
            thumbsEl.innerHTML = '';
            cards.forEach(function (card, ci) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'wow-gallery-thumb' + (ci === 0 ? ' is-active' : '');
                btn.setAttribute('role', 'tab');
                btn.setAttribute('aria-label', card.name);
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
                    if (whimsy && stackEl) {
                        var rect = stackEl.getBoundingClientRect();
                        whimsy.puff(rect.width * 0.5, rect.height * 0.75);
                    }
                });
                thumbsEl.appendChild(btn);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                step(-1, 'nav');
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                step(1, 'nav');
            });
        }
        if (prevBtn) prevBtn.disabled = cards.length <= 1;
        if (nextBtn) nextBtn.disabled = cards.length <= 1;

        document.addEventListener('keydown', function (ev) {
            if (gallery.hidden) return;
            var tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea') return;
            if (ev.key === 'ArrowLeft') step(-1, 'key');
            else if (ev.key === 'ArrowRight') step(1, 'key');
        });

        show(0, { animate: false, force: true });
    }

    function cardGallery() {
        var gallery = document.getElementById('wowGallery');
        var empty = document.getElementById('wowGalleryEmpty');
        if (!gallery) return;

        fetch('landing-cards.json', { cache: 'no-cache' })
            .then(function (res) {
                if (!res.ok) throw new Error('missing');
                return res.json();
            })
            .then(function (data) {
                var cards = Array.isArray(data) ? data.filter(function (c) {
                    return c && c.image && c.name;
                }) : [];
                if (!cards.length) {
                    if (empty) empty.hidden = false;
                    return;
                }
                initGallery(cards, gallery, empty);
            })
            .catch(function () {
                if (empty) empty.hidden = false;
            });
    }

    function waitlist() {
        var form = document.getElementById('wowWaitlistForm');
        var note = document.getElementById('wowWaitlistNote');
        var emailInput = document.getElementById('wowEmail');
        if (!form || !emailInput) return;

        form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            var email = String(emailInput.value || '').trim();
            if (!email || email.indexOf('@') < 1) {
                if (note) {
                    note.dataset.state = 'err';
                    note.textContent = 'Enter a valid email so we can reach you.';
                }
                emailInput.focus();
                return;
            }

            var subject = encodeURIComponent('Wizards of Whimsy waitlist');
            var body = encodeURIComponent(
                'Please add me to the Wizards of Whimsy updates list.\n\nEmail: ' + email + '\n'
            );
            window.location.href = 'mailto:' + WAITLIST_TO + '?subject=' + subject + '&body=' + body;

            if (note) {
                note.dataset.state = 'ok';
                note.textContent = 'Thanks — your email app should open with the signup note.';
            }
        });
    }

    function boot() {
        reveal();
        waitlist();
        cardGallery();
        var hero = document.querySelector('.wow-hero-copy');
        if (hero) {
            requestAnimationFrame(function () {
                hero.classList.add('is-in');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
