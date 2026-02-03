/* MiniCloudS mc_ops_ui.js
   - Op runner + UI busy policy (extracted from app.js)
   - Exposes: MC.Op, MC.initUI(deps) -> UI
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  /* =========================
    OPERATION RUNNER (single owner)
    Step 1: prevents duplicate inflight operations
    - global ops: upload, rebuild, delete-all, etc.
    - keyed ops: per filename (delete/share/unshare/download)
    ========================= */
  MC.Op = (function(){
    var globalRunning = false;
    var keyRunning = Object.create(null);

    function runGlobal(fn){
      if (globalRunning) return Promise.resolve(null);
      globalRunning = true;

      return Promise.resolve()
        .then(function(){
          return fn();
        })
        .finally(function(){
          globalRunning = false;
        });
    }

    function runKey(key, fn){
      key = String(key || '');
      if (!key) return Promise.resolve(null);

      if (keyRunning[key]) return Promise.resolve(null);
      keyRunning[key] = 1;

      return Promise.resolve()
        .then(function(){
          return fn();
        })
        .finally(function(){
          delete keyRunning[key];
        });
    }

    function isGlobal(){
      return !!globalRunning;
    }

    function isKey(key){
      key = String(key || '');
      if (!key) return false;
      return !!keyRunning[key];
    }

    return {
      runGlobal: runGlobal,
      runKey: runKey,
      isGlobal: isGlobal,
      isKey: isKey
    };
  })();

  /* =========================
    UI POLICY (single source of truth)
    - Step 2: token/ref-count busy state
    ========================= */
  MC.initUI = function initUI(deps){
    deps = deps || {};
    var BOOT = deps.BOOT || {};
    var DOM = deps.DOM || {};
    var HardLock = deps.HardLock || {};
    var RowBusy = deps.RowBusy || {};
    var setEnabled = deps.setEnabled;

    // busy tokens
    var busyCount = 0;
    var nextTok = 1;
    var busyTokLive = Object.create(null);

    // legacy bridge (so old setBusy calls still behave predictably)
    var legacyTok = 0;

    var deleteAllHasFiles = (Number(BOOT.totalFiles || 0) > 0);

    function isBusy(){
      return (busyCount > 0);
    }

    function busyAcquire(reason){
      // reason is not used yet, but kept for debugging/future UI
      var tok = nextTok++;
      busyTokLive[tok] = 1;
      busyCount++;
      applyButtons();
      applyGridPolicy();
      return tok;
    }

    function busyRelease(tok){
      tok = Number(tok || 0);
      if (!tok) return;
      if (!busyTokLive[tok]) return;

      delete busyTokLive[tok];
      busyCount = Math.max(0, busyCount - 1);
      applyButtons();
      applyGridPolicy();
    }

    function busyResetAll(){
      busyTokLive = Object.create(null);
      busyCount = 0;
      legacyTok = 0;
      applyButtons();
      applyGridPolicy();
    }

    function applyButtons(){
      var hard = (HardLock && HardLock.isHard) ? HardLock.isHard() : false;
      var busy = isBusy();
      var overlay = document.body.classList.contains('modal-open');

      // Uniform: any modal open => background controls disabled
      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.checkIndex, (!busy && !hard && !overlay));

      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.reinstall, (!busy && !hard && !overlay));
      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.deleteAll, (!busy && !hard && !overlay && !!deleteAllHasFiles));
      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.showMore, (!busy && !hard && !overlay));
      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.searchClear, (!busy && !hard && !overlay));
      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.flagsDropdownBtn, (!busy && !hard && !overlay));
      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.uploadBtn, (!busy && !hard && !overlay));
      if (setEnabled) setEnabled(DOM.buttons && DOM.buttons.storageControl, (!busy && !hard && !overlay));

      if (DOM.upload && DOM.upload.input) DOM.upload.input.disabled = (busy || hard || overlay);

      // Search controls
      // q: keep enabled (caret/focus glitches when disabled), but block editing during busy/hard/overlay
      if (DOM.search && DOM.search.q) {
        DOM.search.q.disabled = false;
        DOM.search.q.readOnly = (busy || hard || overlay);
        DOM.search.q.setAttribute('aria-disabled', (busy || hard || overlay) ? 'true' : 'false');
      }
      if (DOM.search && DOM.search.from) DOM.search.from.disabled = (busy || hard || overlay);
      if (DOM.search && DOM.search.to) DOM.search.to.disabled = (busy || hard || overlay);
    }

    function applyGridPolicy(){
      if (!DOM.grid) return;
      var hard = (HardLock && HardLock.isHard) ? HardLock.isHard() : false;
      var busy = isBusy();
      var overlay = document.body.classList.contains('modal-open');

      var nodes = DOM.grid.querySelectorAll('button, input, select, textarea');
      for (var i = 0; i < nodes.length; i++) nodes[i].disabled = (busy || hard || overlay);

      if (RowBusy && RowBusy.reapplyAll) RowBusy.reapplyAll();
    }

    function updateCounts(shown, total){
      shown = Number(shown || 0);
      total = Number(total || 0);

      if (DOM && DOM.counts) {
        if (DOM.counts.shown1) DOM.counts.shown1.textContent = String(shown);
        if (DOM.counts.total1) DOM.counts.total1.textContent = String(total);
        if (DOM.counts.shown2) DOM.counts.shown2.textContent = String(shown);
        if (DOM.counts.total2) DOM.counts.total2.textContent = String(total);
      }
    }

    // Legacy boolean API (kept for now)
    function setBusy(v){
      v = !!v;
      if (v) {
        if (!legacyTok) legacyTok = busyAcquire('legacy');
      } else {
        if (legacyTok) {
          busyRelease(legacyTok);
          legacyTok = 0;
        }
      }
    }

    function setDeleteAllHasFiles(v){
      deleteAllHasFiles = !!v;
      applyButtons();
    }

    function getBusy(){
      return isBusy();
    }

    return {
      // Step 2 API
      busyAcquire: busyAcquire,
      busyRelease: busyRelease,
      busyResetAll: busyResetAll,

      // Existing API kept
      setBusy: setBusy,
      getBusy: getBusy,
      setDeleteAllHasFiles: setDeleteAllHasFiles,
      applyButtons: applyButtons,
      applyGridPolicy: applyGridPolicy,
      updateCounts: updateCounts
    };
  };

})();