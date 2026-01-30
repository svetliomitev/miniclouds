/* MiniCloudS mc_modals_hardlock.js
   - Modal helpers + HardLock state machine (extracted from app.js)
   - Exposes:
     MC.Modals = { cleanup, preempt, show, hide }
     MC.initHardLock(deps) -> HardLock
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  /* =========================
     MODALS (centralized + safe cleanup)
     ========================= */
  MC.Modals = (function(){
    function mcModalCleanup(){
      // How many modals are currently shown?
      var shown = document.querySelectorAll('.modal.show');
      var shownCount = shown ? shown.length : 0;

      // All backdrops currently in DOM
      var backs = document.querySelectorAll('.modal-backdrop');
      var backCount = backs ? backs.length : 0;

      if (shownCount <= 0) {
        // No modal visible => remove ALL backdrops + clear modal-open
        for (var i = backCount - 1; i >= 0; i--){
          try { backs[i].parentNode.removeChild(backs[i]); } catch (e0) {}
        }
        document.body.classList.remove('modal-open');
        return;
      }

      // At least one modal is visible.
      // Keep EXACTLY one backdrop (Bootstrap expects this), remove extras only.
      if (backCount > 1) {
        for (var j = backCount - 1; j >= 1; j--){
          try { backs[j].parentNode.removeChild(backs[j]); } catch (e1) {}
        }
      }

      // Ensure body has modal-open if anything is shown.
      document.body.classList.add('modal-open');
    }

    function preemptOtherModals(exceptEl, forceHide, bootstrapRef){
      var shown = document.querySelectorAll('.modal.show');
      for (var i = 0; i < shown.length; i++){
        var el = shown[i];
        if (!el) continue;
        if (exceptEl && el === exceptEl) continue;

        if (bootstrapRef) {
          try {
            var inst = bootstrapRef.Modal.getInstance(el) || bootstrapRef.Modal.getOrCreateInstance(el);
            inst.hide();
          } catch (e0) {}
        }

        try {
          el.classList.remove('show');
          el.classList.remove('showing');
          el.classList.add('d-none');
          el.setAttribute('aria-hidden', 'true');
        } catch (e1) {}
      }

      mcModalCleanup();
    }

    function modalShow(el, forceShow, bootstrapRef){
      if (!el) return;

      if (forceShow) forceShow(el);
      mcModalCleanup();

      if (!bootstrapRef) return;

      try {
        var m = bootstrapRef.Modal.getOrCreateInstance(el, { backdrop:'static', keyboard:false });
        try { if (MC && typeof MC.onModalWillShow === 'function') MC.onModalWillShow(el); } catch (e0) {}
        m.show();
      } catch (e) {}

      try { if (MC && typeof MC.onModalShown === 'function') MC.onModalShown(el); } catch (e1) {}
    }

    function modalHide(el, forceHide, bootstrapRef){
      if (el && bootstrapRef) {
        try {
          var inst = bootstrapRef.Modal.getInstance(el) || bootstrapRef.Modal.getOrCreateInstance(el);
          inst.hide();
        } catch (e) {}
      }
      if (el) {
        try { el.classList.remove('show'); } catch (e0) {}
        if (forceHide) forceHide(el);
        try {
          el.removeAttribute('aria-modal');
          el.removeAttribute('role');
        } catch (e1) {}
      }
      mcModalCleanup();
    }

    return {
      cleanup: mcModalCleanup,
      preempt: preemptOtherModals,
      show: modalShow,
      hide: modalHide
    };
  })();

  /* =========================
     HARD LOCK (state machine)
     Step 6 (clean cut)
     ========================= */
  MC.initHardLock = function initHardLock(deps){
    deps = deps || {};
    var DOM = deps.DOM || {};
    var Modals = deps.Modals || MC.Modals || {};
    var forceShow = deps.forceShow;
    var forceHide = deps.forceHide;
    var bootstrapRef = deps.bootstrapRef || (window.bootstrap || null);

    var state = {
      active: false,
      reason: null,   // 'drift' | 'missing' | 'forced' | 'unknown'
      source: null    // 'boot' | 'stats' | 'check' | 'action'
    };

    function isModalShown(){
      return !!(
        DOM.indexChangedModal &&
        DOM.indexChangedModal.classList.contains('show')
      );
    }

    var onChange = null;

    function notify(){
      try { if (typeof onChange === 'function') onChange(getState()); } catch (e) {}
    }

    function getState(){
      return {
        active: !!state.active,
        reason: state.reason,
        source: state.source
      };
    }

    function setOnChange(fn){
      onChange = (typeof fn === 'function') ? fn : null;
    }

    function showModal(){
      if (!DOM.indexChangedModal) return;

      // DOM is the single source of truth
      if (isModalShown()) return;

      // HardLock preempts all other modals (Storage, Info, etc.)
      if (Modals && Modals.preempt) Modals.preempt(DOM.indexChangedModal, forceHide, bootstrapRef);

      if (Modals && Modals.show) Modals.show(DOM.indexChangedModal, forceShow, bootstrapRef);
    }

    function hideModal(){
      if (!DOM.indexChangedModal) return;

      if (!isModalShown()) return;

      if (Modals && Modals.hide) Modals.hide(DOM.indexChangedModal, forceHide, bootstrapRef);
    }

    function activate(reason, source, opts){
      opts = opts || {};
      var wantShow = (opts.show !== false); // default: show

      state.active = true;
      state.reason = String(reason || 'unknown');
      state.source = String(source || 'unknown');

      if (wantShow) showModal();
      notify();
    }

    function clear(opts){
      opts = opts || {};
      var wantHide = (opts.hide !== false); // default: hide

      state.active = false;
      state.reason = null;
      state.source = null;

      if (wantHide) hideModal();
      notify();
    }

    function deriveReasonFromStats(stats){
      if (Number(stats && stats.idx_missing || 0) === 1) return 'missing';
      if (Number(stats && stats.idx_blocked || 0) === 1) return 'drift';
      return null;
    }

    // single public entry for stats-driven lock decisions
    function syncFromStats(stats, source, opts){
      opts = opts || {};
      var r = deriveReasonFromStats(stats);

      if (r) {
        activate(r, source || 'stats', opts);
      } else {
        // only clear if we were locked
        if (state.active) clear(opts);
      }
    }

    function isHard(){ return !!state.active; }
    function reason(){ return state.reason; }
    function source(){ return state.source; }

    return {
      // hooks
      setOnChange: setOnChange,

      // transitions
      activate: activate,
      clear: clear,
      syncFromStats: syncFromStats,

      // read
      isHard: isHard,
      reason: reason,
      source: source,
      getState: getState,

      // modal-only (rare; used by CheckIndexFlow finish)
      showModal: showModal,
      hideModal: hideModal
    };
  };

})();