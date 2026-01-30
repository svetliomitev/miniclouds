/* MiniCloudS mc_checkindex.js
   - Check Index flow owner (extracted from app.js)
   - Exposes: MC.initCheckIndexFlow(deps) -> CheckIndexFlow
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initCheckIndexFlow = function initCheckIndexFlow(deps){
    deps = deps || {};
    var Toast = deps.Toast || {};
    var HardLock = deps.HardLock || {};
    var RenderLife = deps.RenderLife || {};

    var started = false;
    var deferHard = false;

    function begin(){
      if (started) return false;
      started = true;
      deferHard = false;

      if (Toast && Toast.priorityAction) Toast.priorityAction();
      if (Toast && Toast.show) Toast.show('warning', 'Check Index', 'Checking index state...', { ttl: 1200, noClose: true });
      return true;
    }

    function isChecking(){
      return !!started;
    }

    function markDeferHard(){
      if (!started) return;
      deferHard = true;
    }

    function finishFromStats(s){
      if (!started) return;

      if (Toast && Toast.hideMain) Toast.hideMain();

      // HardLock was already updated by Stats.applyStats() (during checking: show/hide deferred)

      var hard = (HardLock && HardLock.isHard) ? HardLock.isHard() : false;

      if (hard || deferHard) {
        if (HardLock && HardLock.showModal) HardLock.showModal();
      } else {
        if (HardLock && HardLock.clear) HardLock.clear({ hide:true });
        if (Toast && Toast.priorityAction) Toast.priorityAction();
        if (Toast && Toast.show) Toast.show('success', 'Check Index', 'Index is up to date.', { ttl: 1600 });
      }

      started = false;
      deferHard = false;

      if (RenderLife && RenderLife.after) RenderLife.after();
    }

    function fail(){
      if (!started) return;

      if (Toast && Toast.hideMain) Toast.hideMain();
      if (Toast && Toast.priorityAction) Toast.priorityAction();
      if (Toast && Toast.show) Toast.show('warning', 'Check Index', 'Could not check index state (network/server error).', { ttl: 2200 });

      started = false;
      deferHard = false;

      if (RenderLife && RenderLife.after) RenderLife.after();
    }

    return {
      begin: begin,
      isChecking: isChecking,
      markDeferHard: markDeferHard,
      finishFromStats: finishFromStats,
      fail: fail
    };
  };

})();