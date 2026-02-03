/* mc_init.js
   Orchestrator: init + teardown + boot sequencing
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initAppInit = function initAppInit(opts){
    opts = opts || {};

    var BOOT = opts.BOOT;

    var DOM = opts.DOM;
    var L = opts.L;

    var UI = opts.UI;
    var HardLock = opts.HardLock;

    var Toast = opts.Toast;
    var RenderLife = opts.RenderLife;

    var CheckIndexFlow = opts.CheckIndexFlow;

    var Modals = opts.Modals || {};

    var Totals = opts.Totals;
    var pageState = opts.pageState;

    var PAGE_SIZE = Number(opts.PAGE_SIZE || 20);

    // callbacks from other owners
    var classifyToast = opts.classifyToast;
    var syncStatsFrom = opts.syncStatsFrom;
    var refreshStats = opts.refreshStats;

    var renderFiles = opts.renderFiles;
    var updateCounts = opts.updateCounts;
    var splitTerms = opts.splitTerms;

    var wireAjaxForms = opts.wireAjaxForms;

    var Upload = opts.Upload;
    var DelegatedActions = opts.DelegatedActions;
    var StorageControl = opts.StorageControl;
    var Search = opts.Search;

    function syncInfoModalFromTotals(){
      if (DOM.infoFilesCount) DOM.infoFilesCount.textContent = String(Totals.files || 0);
      if (DOM.infoTotalSize)  DOM.infoTotalSize.textContent  = Totals.human || '';
    }

    function applyTotalsUiPolicy(){
      var totalFiles = (Totals.files || 0);

      // Delete All availability should follow ALL uploads
      if (UI && UI.setDeleteAllHasFiles) UI.setDeleteAllHasFiles(totalFiles > 0);

      // Optional: keep the data attribute in sync (used by CSS / hints)
      if (DOM.buttons.deleteAll) {
        if (totalFiles <= 0) DOM.buttons.deleteAll.setAttribute('data-mc-empty','1');
        else DOM.buttons.deleteAll.removeAttribute('data-mc-empty');
      }

      // Keep info modal totals synced
      syncInfoModalFromTotals();
    }

    function initIndexCheckAndRebuild(){
      // 1) Check Index button => refresh stats (server re-checks drift)
      if (DOM.buttons.checkIndex) {
        L.on(DOM.buttons.checkIndex, 'click', function(){
          // allowed even when hard-locked; only blocked when busy
          if (UI && UI.getBusy && UI.getBusy()) return;
          if (CheckIndexFlow && CheckIndexFlow.begin) CheckIndexFlow.begin();
          refreshStats();
        });
      }

      // 2) Blocking modal: Rebuild Index Now => trigger hidden js-ajax rebuild form, then close modal
      if (DOM.indexRebuildNowBtn) {
        L.on(DOM.indexRebuildNowBtn, 'click', function(){
          if (UI && UI.getBusy && UI.getBusy()) return;

          var form = DOM.buttons.rebuildIndexForm;
          if (!form) return;

          // Close modal first (NO working toast while modal is on)
          if (Modals && Modals.hide) Modals.hide(DOM.indexChangedModal);

          // Fire the existing centralized js-ajax submit pipeline.
          // Small delay so Bootstrap cleanup settles.
          setTimeout(function(){
            if (typeof form.requestSubmit === 'function') {
              form.requestSubmit();
            } else {
              form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
            }
          }, 50);
        });
      }
    }

    function initFlash(){
      var ok = Array.isArray(BOOT.flashOk) ? BOOT.flashOk : [];
      var err = Array.isArray(BOOT.flashErr) ? BOOT.flashErr : [];
      if (!ok.length && !err.length) return;

      var t = classifyToast(ok, err, { successTitle:'Success', warnTitle:'Warning', errorTitle:'Error' });
      if (t && t.msg) Toast.show(t.kind, t.title, t.msg);
    }

    function initBackToTop(){
      var btn = DOM.backToTop;
      if (!btn) return;

      function update(){
        if (window.scrollY > 400) btn.classList.add('show');
        else btn.classList.remove('show');
      }
      L.on(window, 'scroll', update, { passive: true });
      update();

      L.on(btn, 'click', function(){
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    function initInfoModal(){
      if (!DOM.infoModal || !window.bootstrap) return;
      L.on(DOM.infoModal, 'show.bs.modal', function(){
        syncInfoModalFromTotals();
      });
    }

    function initModalLifecycle(){
      if (!window.bootstrap) return;

      // Modal "will show" policy (moved from app.js MC.onModalWillShow)
      L.on(document, 'show.bs.modal', function(ev){
        var el = ev && ev.target;

        // Storage Control modal => ALWAYS baseline
        if (DOM && DOM.storageModal && el === DOM.storageModal) {
          if (Search && Search.resetToInitial) Search.resetToInitial(true);
          return;
        }

        // Index Changed modal => baseline only if NOT boot-time
        if (DOM && DOM.indexChangedModal && el === DOM.indexChangedModal) {
          if (HardLock && HardLock.source && HardLock.source() !== 'boot') {
            if (Search && Search.resetToInitial) Search.resetToInitial(true);
          }
        }
      }, true);

      // Any modal closed by Bootstrap should restore background UI.
      L.on(document, 'hidden.bs.modal', function(){
        try { if (MC && MC.Modals && MC.Modals.cleanup) MC.Modals.cleanup(); } catch (e0) {}
        try { if (UI && UI.applyButtons) UI.applyButtons(); } catch (e1) {}
        try { if (UI && UI.applyGridPolicy) UI.applyGridPolicy(); } catch (e2) {}
      }, true);
    }

    function initInitialPaint(){
      // First-paint stats application (same path as ajax=stats)
      syncStatsFrom({
        idx_blocked: Number(BOOT.idx_blocked || 0),
        idx_missing: Number(BOOT.idx_missing || 0),
        idx_known:   Number(BOOT.idx_known || 0),
        total_files: Number(BOOT.totalFiles || 0),
        total_human: (
          DOM.footerTotal
            ? String(DOM.footerTotal.textContent || '').trim()
            : ''
        )
      }, { source: 'boot' });

      if (UI && UI.busyResetAll) UI.busyResetAll();

      updateCounts(pageState.files.length, pageState.total);

      var hasMoreBoot = (pageState.total > pageState.files.length);
      renderFiles(pageState.files, pageState.total, splitTerms(''), hasMoreBoot);
      if (RenderLife && RenderLife.now) RenderLife.now();
    }

    function wireTeardown(){
      L.on(window, 'pagehide', function(){
        try { if (Toast && Toast.hideAll) Toast.hideAll(); } catch (e0) {}
        L.dispose();
      });
    }

    function boot(){
      initFlash();
      initInitialPaint();
      initIndexCheckAndRebuild();

      if (Search && Search.wire) Search.wire();
      if (wireAjaxForms) wireAjaxForms();
      if (Upload && Upload.wireUpload) Upload.wireUpload();
      if (DelegatedActions && DelegatedActions.wire) DelegatedActions.wire();
      if (StorageControl && StorageControl.wire) StorageControl.wire();

      initBackToTop();
      initInfoModal();
      initModalLifecycle();

      refreshStats();
    }

    return {
      // expose policies so other modules can call them through app.js wrappers
      applyTotalsUiPolicy: applyTotalsUiPolicy,
      syncInfoModalFromTotals: syncInfoModalFromTotals,

      wireTeardown: wireTeardown,
      boot: boot
    };
  };
})();