/**
 * Universal Card Maker navigation — sticky header with section links (desktop)
 * and a jump dropdown (mobile). Include cardmaker-nav.css + this script on every app page.
 */
(function () {
    'use strict';

    var PAGES = [
        { id: 'editor', href: 'editor.html', label: 'Card Maker' },
        { id: 'saved', href: 'saved-projects.html', label: 'Saved cards' },
        { id: 'deck', href: 'deck-builder.html', label: 'Deck builder' },
        { id: 'play', href: 'card-player.html', label: 'Play cards' },
        { id: 'account', href: 'account.html', label: 'Account' },
        { id: 'print', href: 'card-grid.html', label: 'Print', print: true }
    ];

    function pageIdFromLocation() {
        var path = (window.location.pathname || '').split('/').pop() || 'editor.html';
        if (!path || path === '/') return 'editor';
        var i;
        for (i = 0; i < PAGES.length; i++) {
            if (PAGES[i].href === path) return PAGES[i].id;
        }
        return 'editor';
    }

    function escapeAttr(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function getVisiblePages() {
        if (window.WowAuth && typeof window.WowAuth.filterNavPages === 'function') {
            return window.WowAuth.filterNavPages(PAGES);
        }
        return PAGES.filter(function (p) {
            return p.id !== 'editor' && p.id !== 'saved' && p.id !== 'print' && p.id !== 'account';
        });
    }

    function buildNavHtml(activeId, pages) {
        pages = pages || getVisiblePages();
        var links = pages.map(function (p) {
            var cls = 'cm-app-nav-link';
            if (p.print) cls += ' cm-app-nav-link--print';
            if (p.id === activeId) cls += ' is-active';
            return '<a class="' + cls + '" href="' + escapeAttr(p.href) + '">' + escapeAttr(p.label) + '</a>';
        }).join('');

        var options = pages.map(function (p) {
            var sel = p.id === activeId ? ' selected' : '';
            return '<option value="' + escapeAttr(p.href) + '"' + sel + '>' + escapeAttr(p.label) + '</option>';
        }).join('');

        return (
            '<header class="cm-app-nav" id="cmAppNav" role="banner">' +
                '<div class="cm-app-nav-inner">' +
                    '<a class="cm-app-nav-brand" href="index.html">Wizards of Whimsy</a>' +
                    '<span class="cm-app-nav-spacer" aria-hidden="true"></span>' +
                    '<nav class="cm-app-nav-links" aria-label="App sections">' + links + '</nav>' +
                    '<div class="cm-app-nav-auth" id="cmAppNavAuth" aria-label="Account"></div>' +
                    '<label class="cm-app-nav-jump">' +
                        '<span class="cm-app-nav-jump-label">Go to</span>' +
                        '<select class="cm-app-nav-select" id="cmNavJumpSelect" aria-label="Jump to section">' +
                            options +
                        '</select>' +
                    '</label>' +
                '</div>' +
            '</header>'
        );
    }

    function mountNav() {
        if (document.getElementById('cmAppNav')) return;
        var activeId = pageIdFromLocation();
        var pages = getVisiblePages();
        var wrap = document.createElement('div');
        wrap.innerHTML = buildNavHtml(activeId, pages);
        var nav = wrap.firstElementChild;
        if (!nav) return;
        document.body.insertBefore(nav, document.body.firstChild);

        var sel = document.getElementById('cmNavJumpSelect');
        if (sel) {
            sel.addEventListener('change', function () {
                var href = sel.value;
                if (href && href !== window.location.pathname.split('/').pop()) {
                    window.location.href = href;
                }
            });
        }

        if (window.WowAuth && typeof window.WowAuth.updateNavAuth === 'function') {
            window.WowAuth.updateNavAuth();
        }
    }

    function refreshNav() {
        var existing = document.getElementById('cmAppNav');
        if (!existing) {
            mountNav();
            return;
        }
        var activeId = pageIdFromLocation();
        var pages = getVisiblePages();
        var wrap = document.createElement('div');
        wrap.innerHTML = buildNavHtml(activeId, pages);
        var nav = wrap.firstElementChild;
        if (!nav) return;
        existing.replaceWith(nav);

        var sel = document.getElementById('cmNavJumpSelect');
        if (sel) {
            sel.addEventListener('change', function () {
                var href = sel.value;
                if (href && href !== window.location.pathname.split('/').pop()) {
                    window.location.href = href;
                }
            });
        }

        if (window.WowAuth && typeof window.WowAuth.updateNavAuth === 'function') {
            window.WowAuth.updateNavAuth();
        }
    }

    window.CardMakerNav = {
        refresh: refreshNav
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountNav);
    } else {
        mountNav();
    }
})();
