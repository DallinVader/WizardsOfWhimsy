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

    function initGallery(cards, gallery, empty) {
        if (empty) empty.hidden = true;
        gallery.hidden = false;

        if (!window.WowCardStack || typeof window.WowCardStack.init !== 'function') return;

        var controller = window.WowCardStack.init({
            stackEl: document.getElementById('wowCardStack'),
            cards: cards,
            nameEl: document.getElementById('wowGalleryName'),
            subEl: document.getElementById('wowGallerySub'),
            indexEl: document.getElementById('wowGalleryIndex'),
            totalEl: document.getElementById('wowGalleryTotal'),
            thumbsEl: document.getElementById('wowGalleryThumbs'),
            prevBtn: document.getElementById('wowGalleryPrev'),
            nextBtn: document.getElementById('wowGalleryNext'),
            enableKeyboard: false
        });

        document.addEventListener('keydown', function (ev) {
            if (gallery.hidden) return;
            var tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea') return;
            if (ev.key === 'ArrowLeft') controller.step(-1, 'key');
            else if (ev.key === 'ArrowRight') controller.step(1, 'key');
        });
    }

    function encodeSrc(path) {
        if (!path) return '';
        if (/^data:|^https?:|^blob:/i.test(String(path))) return String(path);
        return String(path).split('/').map(function (part) {
            return encodeURIComponent(part);
        }).join('/');
    }

    function loadLandingCards() {
        return fetch('assets/landing/landing-cards.json', { cache: 'no-cache' })
            .then(function (res) {
                if (!res.ok) throw new Error('missing');
                return res.json();
            })
            .then(function (data) {
                return Array.isArray(data) ? data.filter(function (c) {
                    return c && c.image && c.name;
                }) : [];
            });
    }

    function initHeroFlip(cards) {
        var cardEl = document.getElementById('wowHeroCard');
        var frontImg = document.getElementById('wowHeroCardFront');
        if (!cardEl || !frontImg || !cards.length) return;

        var lastIndex = -1;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function pickRandomIndex() {
            if (cards.length === 1) return 0;
            var idx = Math.floor(Math.random() * cards.length);
            if (idx === lastIndex) {
                idx = (idx + 1 + Math.floor(Math.random() * (cards.length - 1))) % cards.length;
            }
            return idx;
        }

        function preload(src) {
            if (!src) return;
            var img = new Image();
            img.decoding = 'async';
            img.src = encodeSrc(src);
        }

        cards.forEach(function (c) { preload(c.image); });

        function showRandomFace() {
            var idx = pickRandomIndex();
            lastIndex = idx;
            var card = cards[idx];
            frontImg.src = encodeSrc(card.image);
            frontImg.alt = card.name || 'Card';
            cardEl.classList.add('is-flipped');
            if (reduced) {
                cardEl.classList.add('is-instant');
            }
        }

        function showBack() {
            cardEl.classList.remove('is-flipped');
            cardEl.classList.remove('is-instant');
        }

        cardEl.addEventListener('pointerenter', showRandomFace);
        cardEl.addEventListener('pointerleave', showBack);
        cardEl.addEventListener('focus', showRandomFace);
        cardEl.addEventListener('blur', showBack);

        cardEl.setAttribute('tabindex', '0');
        cardEl.setAttribute('role', 'img');
        cardEl.setAttribute('aria-label', 'Hover to flip a random card');
        cardEl.removeAttribute('aria-hidden');
        cardEl.classList.add('is-ready');
    }

    function cardGallery() {
        var gallery = document.getElementById('wowGallery');
        var empty = document.getElementById('wowGalleryEmpty');

        loadLandingCards()
            .then(function (cards) {
                initHeroFlip(cards);
                if (!gallery) return;
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
