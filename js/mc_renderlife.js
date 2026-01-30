/* MiniCloudS mc_renderlife.js
   - Post-render policy + hydration (extracted from app.js)
   - Exposes: MC.initRenderLife(deps) -> RenderLife
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initRenderLife = function initRenderLife(deps){
    deps = deps || {};
    var onApplyGridPolicy = deps.onApplyGridPolicy;
    var onHydrateSharedUrls = deps.onHydrateSharedUrls;
    var onApplyTotalsPolicy = deps.onApplyTotalsPolicy;

    var scheduled = false;

    function runOnce(){
      scheduled = false;

      // 1) Apply global disable/hardlock + then reapply row locks
      try { if (typeof onApplyGridPolicy === 'function') onApplyGridPolicy(); } catch (e0) {}

      // 2) Hydrate any “shared but url missing” pills (best-effort)
      try { if (typeof onHydrateSharedUrls === 'function') onHydrateSharedUrls(); } catch (e1) {}

      // 3) Keep info modal totals synced (cheap)
      try { if (typeof onApplyTotalsPolicy === 'function') onApplyTotalsPolicy(); } catch (e2) {}
    }

    function after(){
      if (scheduled) return;
      scheduled = true;

      // microtask if possible, fallback to macrotask
      if (typeof Promise !== 'undefined' && Promise.resolve) {
        Promise.resolve().then(runOnce);
      } else {
        setTimeout(runOnce, 0);
      }
    }

    function now(){
      // force immediate run (rare: first paint)
      if (scheduled) scheduled = false;
      runOnce();
    }

    return { after: after, now: now };
  };

})();