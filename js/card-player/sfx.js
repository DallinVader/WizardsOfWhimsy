/**
 * Card Player — light procedural SFX (Web Audio).
 */
(function (global) {
    'use strict';

    var MUTE_KEY = 'cpPlayerSfxMuted';

    function createSfx() {
        var muted = false;
        var ctx = null;

        try {
            muted = localStorage.getItem(MUTE_KEY) === '1';
        } catch (e) { /* ignore */ }

        function reducedMotion() {
            try {
                return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            } catch (e2) {
                return false;
            }
        }

        function ensureCtx() {
            if (ctx) return ctx;
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            return ctx;
        }

        function enabled() {
            return !muted && !reducedMotion();
        }

        function beep(freq, dur, type, gain) {
            if (!enabled()) return;
            var ac = ensureCtx();
            if (!ac) return;
            if (ac.state === 'suspended') ac.resume();
            var t0 = ac.currentTime;
            var osc = ac.createOscillator();
            var g = ac.createGain();
            osc.type = type || 'triangle';
            osc.frequency.value = freq;
            g.gain.setValueAtTime(gain == null ? 0.04 : gain, t0);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
            osc.connect(g);
            g.connect(ac.destination);
            osc.start(t0);
            osc.stop(t0 + dur + 0.02);
        }

        function place() { beep(180, 0.08, 'triangle', 0.05); }
        function flip() { beep(420, 0.06, 'sine', 0.035); }
        function discard() { beep(120, 0.1, 'square', 0.03); }
        function draw() { beep(260, 0.05, 'triangle', 0.04); }

        function setMuted(v) {
            muted = !!v;
            try {
                if (muted) localStorage.setItem(MUTE_KEY, '1');
                else localStorage.removeItem(MUTE_KEY);
            } catch (e) { /* ignore */ }
        }

        function toggle() {
            setMuted(!muted);
            return muted;
        }

        return {
            enabled: enabled,
            isMuted: function () { return muted; },
            setMuted: setMuted,
            toggle: toggle,
            place: place,
            flip: flip,
            discard: discard,
            draw: draw
        };
    }

    global.CardPlayerSfx = { create: createSfx };
})(typeof window !== 'undefined' ? window : globalThis);
