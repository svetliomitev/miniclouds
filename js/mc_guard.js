/* MiniCloudS mc_guard.js
   - Centralized "can I run?" checks (extracted from app.js)
   - Exposes: MC.initGuard(deps) -> Guard
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initGuard = function initGuard(deps){
    deps = deps || {};
    var HardLock = deps.HardLock || {};
    var UI = deps.UI || {};
    var RowBusy = deps.RowBusy || {};
    var Toast = deps.Toast || {};

    function hardLock(){
      if (HardLock && HardLock.isHard && HardLock.isHard()) {
        if (HardLock.showModal) HardLock.showModal();
        return true;
      }
      return false;
    }

    function busy(){
      if (UI && UI.getBusy && UI.getBusy()) {
        if (Toast && Toast.show) Toast.show('info', 'Busy', 'Another operation is in progress. Please wait.');
        return true;
      }
      return false;
    }

    function rowBusy(filename){
      filename = String(filename || '');
      if (!filename) return false;
      if (RowBusy && RowBusy.isBusy && RowBusy.isBusy(filename)) {
        if (Toast && Toast.show) Toast.show('info', 'Busy', 'This file is already being processed.');
        return true;
      }
      return false;
    }

    // Generic guard: returns true if blocked
    function blockIf(opts){
      opts = opts || {};

      // 1) busy first (keeps UX consistent)
      if (opts.busy) {
        if (busy()) return true;
      }

      // 2) hard-lock (unless explicitly allowed)
      if (opts.hard && !opts.allowHard) {
        if (hardLock()) return true;
      }

      // 3) per-row busy (optional)
      if (opts.row) {
        if (rowBusy(opts.row)) return true;
      }

      return false;
    }

    return {
      hardLock: hardLock,
      busy: busy,
      rowBusy: rowBusy,
      blockIf: blockIf
    };
  };

})();