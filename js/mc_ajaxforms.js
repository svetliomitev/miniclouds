/* mc_ajaxforms.js
   Centralized .js-ajax submit pipeline + toast classification
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initAjaxForms = function initAjaxForms(opts){
    opts = opts || {};

    var DOM = opts.DOM;
    var L = opts.L;

    var Net = opts.Net;
    var EP = opts.EP;

    var Toast = opts.Toast;
    var UI = opts.UI;
    var Guard = opts.Guard;
    var RowBusy = opts.RowBusy;

    var navigatingRef = opts.navigatingRef; // { value: bool }

    // callbacks (owned elsewhere)
    var syncStatsFrom = opts.syncStatsFrom;
    var clearInputs = opts.clearInputs;
    var readInputsIntoQuery = opts.readInputsIntoQuery;
    var runQuery = opts.runQuery;
    var refreshToDesiredCount = opts.refreshToDesiredCount;

    var setEnabled = opts.setEnabled;

    var __mcWarnTextRe = /could not be removed|some .* could not/i;

    // Single owner: toast classification (shared by Upload/Links/AppInit/etc.)
    // Exposed early so app.js can pass it before initAjaxForms() is called.
    MC.classifyToast = MC.classifyToast || function classifyToast(okMsgs, errMsgs, optsLocal){
      okMsgs = Array.isArray(okMsgs) ? okMsgs : [];
      errMsgs = Array.isArray(errMsgs) ? errMsgs : [];
      optsLocal = optsLocal || {};

      function isWarnText(s){
        s = String(s || '');
        return __mcWarnTextRe.test(s);
      }

      var hasOk = okMsgs.length > 0;
      var hasErr = errMsgs.length > 0;
      var allErrAreWarn = hasErr && errMsgs.every(isWarnText);
      var okContainsWarn = okMsgs.some(isWarnText);

      if (hasErr && (!hasOk || !allErrAreWarn)) {
        return { kind:'danger', title: optsLocal.errorTitle || 'Error', msg: errMsgs.join(' | ') };
      }
      if ((hasOk && hasErr && allErrAreWarn) || okContainsWarn) {
        var warnParts = [];
        if (hasOk) warnParts = warnParts.concat(okMsgs);
        if (hasErr) warnParts = warnParts.concat(errMsgs);
        return { kind:'warning', title: optsLocal.warnTitle || 'Warning', msg: warnParts.join(' | ') };
      }
      if (hasOk) {
        return { kind:'success', title: optsLocal.successTitle || 'Success', msg: okMsgs.join(' | ') };
      }
      return { kind:'info', title: optsLocal.infoTitle || 'Info', msg: optsLocal.infoMsg || '' };
    };

    var classifyToast = MC.classifyToast;

    function wire(){
      function onSubmit(ev){
        var form = ev.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!form.classList.contains('js-ajax')) return;

        // IMPORTANT: never intercept uploadForm here (upload uses its own XHR+progress)
        if (DOM && DOM.upload && DOM.upload.form && form === DOM.upload.form) return;

        ev.preventDefault();

        var fdPeek = new FormData(form);
        var actionName = String(fdPeek.get('action') || '');
        var fileName = String(fdPeek.get('name') || '');

        // Guard: hard-lock blocks everything except rebuild_index
        if (actionName !== 'rebuild_index') {
          if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;
        }

        // Guard: row-level busy (delete_one)
        if (actionName === 'delete_one' && fileName) {
          if (Guard && Guard.blockIf && Guard.blockIf({ row:fileName })) return;
        }

        // Guard: global busy blocks rebuild as well (rebuild sets busy token itself)
        if (Guard && Guard.blockIf && Guard.blockIf({ busy:true })) return;

        var msg = form.getAttribute('data-confirm');
        if (msg && String(msg).trim().length) {
          if (!window.confirm(String(msg))) return;
        }

        // last-action priority
        if (Toast && Toast.priorityAction) Toast.priorityAction();

        var isRebuild = (actionName === 'rebuild_index');

        // pre-action UI effects
        var __busyTok = 0;

        if (isRebuild) {
          // rebuild progress: warning working toast (no close button, keep spacing)
          if (Toast && Toast.workingWarning) Toast.workingWarning('Rebuild progress', 'Rebuilding index now...');
          if (UI && UI.busyAcquire) __busyTok = UI.busyAcquire('rebuild');

        } else if (actionName === 'delete_all') {
          // global op: acquire busy token so UI blocks uniformly
          if (Toast && Toast.workingWarning) Toast.workingWarning('Deleting all', 'Deleting all files...');
          if (UI && UI.busyAcquire) __busyTok = UI.busyAcquire('delete-all');

          // optional extra safety: also disable the button itself immediately
          if (setEnabled && DOM && DOM.buttons && DOM.buttons.deleteAll) {
            setEnabled(DOM.buttons.deleteAll, false);
          }

        } else if (actionName === 'delete_one' && fileName) {
          if (RowBusy && RowBusy.set) RowBusy.set(fileName, true);
        }

        function doPost(){
          var postTo = String(form.getAttribute('action') || '').trim();
          if (!postTo) postTo = (EP && EP.index) ? EP.index : 'index.php';

          return Net.postForm(postTo, fdPeek)
            .then(function(r){
              if (!r || !r.data) {
                var preview = String((r && r.txt) || '').trim();
                if (preview.length > 220) preview = preview.slice(0, 220) + '...';

                if (r && r.redirected) {
                  if (Toast && Toast.show) Toast.show('danger', 'Error', 'Server redirected instead of returning JSON (AJAX not detected).');
                } else {
                  if (Toast && Toast.show) Toast.show('danger', 'Error', 'Non-JSON response (' + ((r && r.status) || 0) + '): ' + (preview || 'empty'));
                }
                return null;
              }

              var okMsgs = Array.isArray(r.data.ok) ? r.data.ok : [];
              var errMsgs = Array.isArray(r.data.err) ? r.data.err : [];

              var t = classifyToast(okMsgs, errMsgs, {
                successTitle: 'Success',
                warnTitle: 'Warning',
                errorTitle: 'Error',
                infoTitle: 'Info'
              });

              if (t && t.msg) {
                if (Toast && Toast.show) Toast.show(t.kind, t.title, t.msg);
              } else {
                if (Toast && Toast.hideMain) Toast.hideMain();
              }

              if (r.data && r.data.redirect) {
                var to = String(r.data.redirect || '').trim();
                if (to) {
                  if (navigatingRef) navigatingRef.value = true;
                  if (Toast && Toast.show) Toast.show('warning', 'Reinstall', 'Redirecting to installer...');
                  setTimeout(function(){ window.location.href = to; }, 250);
                  return null;
                }
              }

              // Uniform stats policy
              if (typeof syncStatsFrom === 'function') syncStatsFrom(r.data);

              // rebuild_index: reset UI to initial state (no filters, first page)
              if (actionName === 'rebuild_index') {
                if (typeof clearInputs === 'function') clearInputs();
                if (Toast && Toast.hideSearch) Toast.hideSearch();
                if (typeof readInputsIntoQuery === 'function') readInputsIntoQuery();
                if (typeof runQuery === 'function') return runQuery(true);
                return null;
              }

              // delete_all is a reset
              if (actionName === 'delete_all') {
                if (typeof clearInputs === 'function') clearInputs();
                if (typeof readInputsIntoQuery === 'function') readInputsIntoQuery();
                if (typeof runQuery === 'function') return runQuery(true);
                return null;
              }

              if (typeof readInputsIntoQuery === 'function') readInputsIntoQuery();
              if (typeof refreshToDesiredCount === 'function') {
                return refreshToDesiredCount('Index', 'Could not refresh list (network/server error).');
              }
              return null;
            })
            .catch(function(){
              if (!(navigatingRef && navigatingRef.value)) {
                if (Toast && Toast.show) Toast.show('danger', 'Error', 'Request failed (network error).');
              }
              return null;
            })
            .finally(function(){
              // ALWAYS release busy/row busy even if we are navigating.
              // Navigation should only skip UI toasts/extra work, never cleanup.
              if (isRebuild || actionName === 'delete_all') {
                try { if (UI && UI.busyRelease) UI.busyRelease(__busyTok); } catch (e0) {}
                __busyTok = 0;
              }

              if (actionName === 'delete_one' && fileName) {
                if (RowBusy && RowBusy.set) RowBusy.set(fileName, false);
              }

              if (navigatingRef && navigatingRef.value) return;

              // no-op: stats already applied/refreshed in success path
            });
        }

        doPost();
      }

      L.on(document, 'submit', onSubmit, true);
    }

    return {
      wire: wire,
      classifyToast: classifyToast
    };
  };
})();