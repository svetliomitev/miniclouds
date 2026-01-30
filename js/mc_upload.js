/* MiniCloudS mc_upload.js
   - Upload flow owner (extracted from app.js)
   - Exposes: MC.initUpload(deps) -> Upload API
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initUpload = function initUpload(deps){
    deps = deps || {};

    var BOOT = deps.BOOT || {};
    var DOM = deps.DOM || {};
    var EP = deps.EP || {};
    var UI = deps.UI || {};
    var Guard = deps.Guard || {};
    var HardLock = deps.HardLock || {};
    var Toast = deps.Toast || {};

    var QUOTA_FILES = Number(deps.QUOTA_FILES || 0);

    var Totals = deps.Totals || {};
    var setEnabled = deps.setEnabled;
    var setPctClass = deps.setPctClass;

    var formatBytes = deps.formatBytes;
    var classifyToast = deps.classifyToast;

    var clearInputs = deps.clearInputs;
    var readInputsIntoQuery = deps.readInputsIntoQuery;

    var runQuery = deps.runQuery;

    var syncStatsFrom = deps.syncStatsFrom;

    function summarizeUploadOk(okMsgs){
      okMsgs = Array.isArray(okMsgs) ? okMsgs : [];
      var uploaded = [];
      var otherOk = [];
      for (var i = 0; i < okMsgs.length; i++) {
        var s = String(okMsgs[i] || '');
        var m = s.match(/^Uploaded:\s*(.+)\s*$/i);
        if (m && m[1]) uploaded.push(m[1]); else otherOk.push(s);
      }
      if (!uploaded.length) return okMsgs.slice();

      var MAX_NAMES = 3, MAX_CHARS = 140;
      var shown = uploaded.slice(0, MAX_NAMES);
      var namesLine = shown.join(', ');
      if (namesLine.length > MAX_CHARS) namesLine = namesLine.slice(0, MAX_CHARS - 1) + '...';
      var more = uploaded.length - shown.length;

      var compact = [];
      compact.push('Uploaded ' + uploaded.length + ' file(s).');
      if (shown.length) compact.push('Files: ' + namesLine + (more > 0 ? ' (+' + more + ' more)' : ''));
      for (var j = 0; j < otherOk.length; j++) compact.push(otherOk[j]);
      return compact;
    }

    function wireUpload(){
      var form = DOM.upload && DOM.upload.form;
      var input = DOM.upload && DOM.upload.input;
      var btn = DOM.buttons && DOM.buttons.uploadBtn;
      var wrap = DOM.upload && DOM.upload.wrap;
      var bar = DOM.upload && DOM.upload.bar;
      if (!form || !input || !btn || !wrap || !bar) return;

      var maxTotal = Number(BOOT.maxPostBytes || 0);
      var maxPerFile = Number(BOOT.maxFileBytes || 0);
      var maxFiles = Number(BOOT.maxFileUploads || 0);

      function quotaLeftNow(){
        if (!(QUOTA_FILES > 0)) return Infinity;
        var used = Number(Totals.files || 0);
        var left = QUOTA_FILES - used;
        return (left < 0) ? 0 : left;
      }

      function setProgress(pct){
        pct = Math.max(0, Math.min(100, pct));
        wrap.classList.remove('d-none');
        if (typeof setPctClass === 'function') setPctClass(bar, pct);
        bar.textContent = pct + '%';
      }

      function resetProgress(){
        if (typeof setPctClass === 'function') setPctClass(bar, 0);
        bar.textContent = '0%';
        wrap.classList.add('d-none');
      }

      form.addEventListener('submit', function(ev){
        if (!window.XMLHttpRequest || !window.FormData) return;
        ev.preventDefault();

        if (Guard && Guard.blockIf && Guard.blockIf({ busy:true, hard:true })) return;

        if (!input.files || input.files.length === 0) {
          if (Toast && Toast.show) Toast.show('warning', 'Upload', 'No files selected.');
          return;
        }

        if (QUOTA_FILES > 0) {
          var left = quotaLeftNow();
          if (left <= 0) {
            if (Toast && Toast.show) Toast.show('warning', 'Upload', 'Quota reached (' + QUOTA_FILES + ' files). Delete files to upload new ones.');
            return;
          }
          if (input.files.length > left) {
            if (Toast && Toast.show) Toast.show('warning', 'Upload', 'Quota allows ' + left + ' more file(s). You selected ' + input.files.length + '.');
            return;
          }
        }

        if (maxFiles > 0 && input.files.length > maxFiles) {
          if (Toast && Toast.show) Toast.show('warning', 'Upload', 'Too many files selected (' + input.files.length + '). Max allowed is ' + maxFiles + '.');
          return;
        }

        var total = 0;
        for (var i = 0; i < input.files.length; i++) {
          var sz = Number(input.files[i].size || 0);
          total += sz;
          if (maxPerFile > 0 && sz > maxPerFile) {
            if (Toast && Toast.show) Toast.show('warning', 'Upload', 'A file is larger than the per-file limit (' + (typeof formatBytes === 'function' ? formatBytes(maxPerFile) : maxPerFile) + ').');
            return;
          }
        }

        if (maxTotal > 0 && total > maxTotal) {
          if (Toast && Toast.show) Toast.show('warning', 'Upload', 'Selected files total (' + (typeof formatBytes === 'function' ? formatBytes(total) : total) + ') exceeds the server limit (' + (typeof formatBytes === 'function' ? formatBytes(maxTotal) : maxTotal) + ').');
          return;
        }

        if (Toast && Toast.priorityAction) Toast.priorityAction();

        // Prevent double-submit during the 0ms tick (do NOT disable file input).
        if (typeof setEnabled === 'function') setEnabled(btn, false);

        // Yield one tick so the browser can start cleanly (helps large batches).
        setTimeout(function(){
          // Capture files BEFORE busyAcquire disables the file input
          var fd = new FormData(form);

          var __uploadTok = (UI && UI.busyAcquire) ? UI.busyAcquire('upload') : 0;
          setProgress(0);

          var xhr = new XMLHttpRequest();
          xhr.open('POST', EP.index, true);
          xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

          xhr.upload.onprogress = function(e){
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };

          function finishUpload(needStats){
            try {
              if (UI && UI.busyRelease) UI.busyRelease(__uploadTok);
            } catch (e0) {}
            __uploadTok = 0;

            if (needStats && typeof syncStatsFrom === 'function') {
              syncStatsFrom(null, { forceRefresh:true });
            }

            // Re-enable defensively (UI.applyButtons will also handle this)
            if (typeof setEnabled === 'function') {
              var busy = (UI && UI.getBusy) ? UI.getBusy() : false;
              var hard = (HardLock && HardLock.isHard) ? HardLock.isHard() : false;
              setEnabled(btn, (!busy && !hard));
            }
          }

          xhr.onload = function(){
            var data = null;
            try { data = JSON.parse(xhr.responseText || '{}'); } catch (e0) {}

            if (xhr.status === 200 && data) {
              var ok = Array.isArray(data.ok) ? data.ok : [];
              var err = Array.isArray(data.err) ? data.err : [];
              ok = summarizeUploadOk(ok);

              var t = (typeof classifyToast === 'function')
                ? classifyToast(ok, err, {
                    successTitle: 'Upload completed',
                    warnTitle: 'Upload',
                    errorTitle: 'Upload',
                    infoTitle: 'Upload'
                  })
                : null;

              if (t && t.msg && Toast && Toast.show) Toast.show(t.kind, t.title, t.msg);

              if (typeof syncStatsFrom === 'function') syncStatsFrom(data);

              if (typeof clearInputs === 'function') clearInputs();
              if (typeof readInputsIntoQuery === 'function') readInputsIntoQuery();

              input.value = '';
              setProgress(100);
              setTimeout(resetProgress, 600);

              if (typeof runQuery === 'function') {
                runQuery(true).finally(function(){ finishUpload(false); });
              } else {
                finishUpload(false);
              }
            } else {
              if (Toast && Toast.show) Toast.show('danger', 'Upload', 'Upload failed (server error).');
              setTimeout(resetProgress, 600);
              finishUpload(true);
            }
          };

          xhr.onerror = function(){
            if (Toast && Toast.show) Toast.show('danger', 'Upload', 'Upload failed (network error).');
            setTimeout(resetProgress, 600);
            finishUpload(true);
          };

          xhr.onabort = function(){
            if (Toast && Toast.show) Toast.show('warning', 'Upload', 'Upload aborted.');
            setTimeout(resetProgress, 600);
            finishUpload(true);
          };

          xhr.send(fd);
        }, 0);
      }, true);
    }

    return {
      wireUpload: wireUpload,
      summarizeUploadOk: summarizeUploadOk
    };
  };

})();