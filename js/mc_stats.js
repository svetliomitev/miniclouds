/* MiniCloudS mc_stats.js
   - Stats sync layer (extracted from app.js)
   - Exposes: MC.initStats(deps) -> Stats API
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initStats = function initStats(deps){
    deps = deps || {};

    var DOM = deps.DOM || {};
    var Totals = deps.Totals || {};
    var HardLock = deps.HardLock || {};
    var CheckIndexFlow = deps.CheckIndexFlow || {};
    var Net = deps.Net || {};
    var EP = deps.EP || {};
    var Toast = deps.Toast || {};

    var applyTotalsUiPolicy = deps.applyTotalsUiPolicy;
    var DateNow = deps.DateNow || function(){ return Date.now(); };

    function pickStatsFromEnvelope(env){
      if (env && env.stats && typeof env.stats === 'object') return env.stats;
      return env;
    }

    function looksLikeStatsObject(o){
      if (!o || typeof o !== 'object') return false;

      return (
        Object.prototype.hasOwnProperty.call(o, 'total_files') ||
        Object.prototype.hasOwnProperty.call(o, 'total_human') ||
        Object.prototype.hasOwnProperty.call(o, 'idx_blocked') ||
        Object.prototype.hasOwnProperty.call(o, 'idx_missing') ||
        Object.prototype.hasOwnProperty.call(o, 'idx_known')
      );
    }

    function applyStats(stats, source){
      // applyStats() only decides HARD lock vs clear
      // no "known/unknown drift" states are tracked client-side
      if (!stats) return;

      // Step 6: HardLock state machine owns the lock decision.
      // During "Check Index" refresh: do not show modal here (toast must finish first).
      var checking = (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking());
      if (checking) {
        // During Check Index: NEVER clear HardLock here.
        // Only activate if drift/missing is reported; otherwise keep current lock state.
        if (Number(stats && stats.idx_missing || 0) === 1 || Number(stats && stats.idx_blocked || 0) === 1) {
          if (HardLock && HardLock.syncFromStats) HardLock.syncFromStats(stats, 'check', { show:false, hide:false });
          if (HardLock && HardLock.isHard && HardLock.isHard() && CheckIndexFlow && CheckIndexFlow.markDeferHard) {
            CheckIndexFlow.markDeferHard();
          }
        }
      } else {
        if (HardLock && HardLock.syncFromStats) HardLock.syncFromStats(stats, String(source || 'stats'), { show:true, hide:true });
      }

      var totalHuman = (stats && stats.total_human) || '';

      if (DOM.footerTotal) DOM.footerTotal.textContent = totalHuman;

      // Update "all uploads" totals state (filter-independent)
      Totals.human = totalHuman;
      Totals.files = Number(stats.total_files || 0);

      if (typeof applyTotalsUiPolicy === 'function') applyTotalsUiPolicy();
    }

    // Single “stats sync” policy:
    // - If payload includes stats => applyStats(stats)
    // - Else if payload itself looks like stats => applyStats(payload)
    // - Else => refreshStats()
    // Always returns a Promise.
    function syncStatsFrom(payloadOrStats, opts){
      opts = opts || {};
      var forceRefresh = !!opts.forceRefresh;

      if (!forceRefresh && payloadOrStats && typeof payloadOrStats === 'object') {
        // common: { ok:true, stats:{...} }
        if (payloadOrStats.stats && typeof payloadOrStats.stats === 'object') {
          try { applyStats(payloadOrStats.stats, opts.source); } catch (e0) {}
          return Promise.resolve(payloadOrStats.stats);
        }

        // sometimes we pass stats directly
        if (looksLikeStatsObject(payloadOrStats)) {
          try { applyStats(payloadOrStats, opts.source); } catch (e1) {}
          return Promise.resolve(payloadOrStats);
        }
      }

      return refreshStats(opts);
    }

    function buildStatsUrl(){
      var u;
      try { u = new URL(EP.index); }
      catch (e0) { u = null; }

      if (u) {
        u.searchParams.set('ajax', 'stats');
        u.searchParams.set('_', String(DateNow())); // cache-buster
        return u.toString();
      }

      // cache-buster
      return EP.index + '?ajax=stats&_=' + DateNow();
    }

    function refreshStats(opts){
      opts = opts || {};
      var statsUrl = buildStatsUrl();
      return Net.getJson(statsUrl)
        .then(function(r){
          if (!Net.isAppOk(r)) {
            if (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking()) {
              if (CheckIndexFlow.fail) CheckIndexFlow.fail();
            }
            return null;
          }

          var s = pickStatsFromEnvelope(r.data);
          if (s && looksLikeStatsObject(s)) {
            try { applyStats(s, opts.source); } catch (e0) {}
          }

          if (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking()) {
            if (CheckIndexFlow.finishFromStats) CheckIndexFlow.finishFromStats(s);
          }

          return r.data;
        })
        .catch(function(){
          if (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking()) {
            if (CheckIndexFlow.fail) CheckIndexFlow.fail();
          }
          return null;
        });
    }

    return {
      pickStatsFromEnvelope: pickStatsFromEnvelope,
      looksLikeStatsObject: looksLikeStatsObject,
      applyStats: applyStats,
      syncStatsFrom: syncStatsFrom,
      buildStatsUrl: buildStatsUrl,
      refreshStats: refreshStats
    };
  };

})();