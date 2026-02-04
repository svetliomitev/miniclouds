/* mc_storage_control.js
   Storage Control admin tool (scan + delete biggest files)
   Exposes: MC.initStorageControl(deps) -> { wire, open, scan, deleteSelected }
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initStorageControl = function initStorageControl(deps){
    deps = deps || {};

    var DOM = deps.DOM || {};
    var L = deps.L;

    var Net = deps.Net;
    var EP = deps.EP;

    var Op = deps.Op;
    var UI = deps.UI;
    var Guard = deps.Guard;
    var HardLock = deps.HardLock;
    var Toast = deps.Toast;

    var RenderLife = deps.RenderLife;

    var csrfToken = String(deps.csrfToken || '');

    // helpers
    var setEnabled = deps.setEnabled;
    var escapeHtml = deps.escapeHtml;
    var encName = deps.encName;
    var decName = deps.decName;
    var formatBytes = deps.formatBytes;
    var formatDate = deps.formatDate;

    // callbacks owned elsewhere
    var syncStatsFrom = deps.syncStatsFrom;
    var buildStatsUrl = deps.buildStatsUrl;
    var readInputsIntoQuery = deps.readInputsIntoQuery;
    var refreshToDesiredCount = deps.refreshToDesiredCount;

    var Modals = deps.Modals || {};

    var lastItems = [];                  // [{ name, size, mtime, shared }]
    var selected = Object.create(null);  // name => 1

    function pickDataPayload(env){
      if (env && env.data && typeof env.data === 'object') return env.data;
      return {};
    }

    function msgClear(){
      if (!DOM.storageMsg) return;
      DOM.storageMsg.className = 'alert d-none mb-3';
      DOM.storageMsg.textContent = '';
    }

    function msgShow(kind, text){
      if (!DOM.storageMsg) return;

      kind = String(kind || 'secondary');
      text = String(text || '').trim();
      if (!text) { msgClear(); return; }

      var cls = 'alert mb-3';

      if (kind === 'success') cls += ' alert-success';
      else if (kind === 'danger') cls += ' alert-danger';
      else if (kind === 'warning') cls += ' alert-warning';
      else if (kind === 'info') cls += ' alert-info';
      else cls += ' alert-secondary';

      DOM.storageMsg.className = cls;
      DOM.storageMsg.textContent = text;
    }

    function clearSelection(){
      selected = Object.create(null);
    }

    function selectedNames(){
      var out = [];
      for (var k in selected) {
        if (Object.prototype.hasOwnProperty.call(selected, k) && selected[k]) out.push(k);
      }
      return out;
    }

    function resetProgress(){
      // Indeterminate progress: just hide
      if (DOM.storageProgressWrap) DOM.storageProgressWrap.classList.add('d-none');
    }

    function setProgress(pct){
      // Indeterminate progress: just show (ignore pct)
      if (DOM.storageProgressWrap) DOM.storageProgressWrap.classList.remove('d-none');
    }

    function resetUi(){
      lastItems = [];
      clearSelection();
      resetProgress();
      msgClear();

      if (DOM.storageList) DOM.storageList.innerHTML = '';
      if (DOM.storageSummary) DOM.storageSummary.textContent = 'No data.';

      if (setEnabled) setEnabled(DOM.storageDeleteBtn, false);

      if (DOM.storageList) DOM.storageList.scrollTop = 0;
    }

    function render(){
      if (!DOM.storageList) return;

      var html = [];
      var totalSelBytes = 0;
      var selCount = 0;

      for (var i = 0; i < lastItems.length; i++){
        var it = lastItems[i] || {};
        var nm = String(it.name || '');
        if (!nm) continue;

        var isSel = !!selected[nm];
        if (isSel) {
          selCount++;
          totalSelBytes += Number(it.size || 0);
        }

        html.push(
          '<div class="d-flex align-items-start gap-2 py-2 border-bottom">' +
            '<div class="pt-1">' +
              '<input class="form-check-input" type="checkbox" data-mc-storage-check data-name="' + escapeHtml(encName(nm)) + '"' +
                (isSel ? ' checked' : '') + '>' +
            '</div>' +
            '<div class="flex-grow-1">' +
              '<div class="fw-semibold">' + escapeHtml(nm) + '</div>' +
              '<div class="text-body-secondary small">' +
                'Size: ' + escapeHtml(formatBytes(it.size || 0)) +
                ' · Date: ' + escapeHtml(formatDate(it.mtime || 0)) +
                (it.shared ? ' · <span class="text-warning">Shared</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }

      DOM.storageList.innerHTML = html.join('');

      if (DOM.storageSummary) {
        DOM.storageSummary.textContent =
          (lastItems.length ? ('Showing ' + lastItems.length + ' item(s). ') : 'No data. ') +
          (selCount ? ('Selected: ' + selCount + ' (' + formatBytes(totalSelBytes) + ').') : 'Selected: 0.');
      }

      if (setEnabled) {
        setEnabled(
          DOM.storageDeleteBtn,
          (selectedNames().length > 0) && !UI.getBusy() && !HardLock.isHard()
        );
      }

      if (RenderLife && RenderLife.after) RenderLife.after();
    }

    function wireListSelection(){
      if (!DOM.storageList) return;

      L.on(DOM.storageList, 'change', function(ev){
        var t = ev.target;
        if (!(t instanceof Element)) return;
        if (!t.matches('[data-mc-storage-check]')) return;

        var enc = String(t.getAttribute('data-name') || '');
        var nm = decName(enc);
        if (!nm) return;

        if (t.checked) selected[nm] = 1;
        else delete selected[nm];

        render();
      }, true);
    }

    function postStorage(action, payload){
      var fd = new FormData();
      fd.append('csrf', csrfToken);
      fd.append('action', action);

      payload = payload || {};
      for (var k in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) {
          fd.append(k, String(payload[k]));
        }
      }

      return Net.postForm(EP.index, fd);
    }

    function scan(){
      if (Guard.blockIf({ busy:true, hard:true })) return Promise.resolve(null);

      msgClear();

      return Op.runGlobal(function(){
        var tok = UI.busyAcquire('storage-scan');

        msgShow('info', 'Scanning biggest files...');
        setProgress(0);

        clearSelection();
        render();

        return postStorage('storage_scan', { limit: 200 })
          .then(function(r){
            if (!Net.isAppOk(r)) return null;

            var env = r.data || {};
            var payload = pickDataPayload(env);

            syncStatsFrom(env);

            lastItems = Array.isArray(payload.items) ? payload.items : [];
            clearSelection();
            render();

            msgShow('success', 'Scan completed.');
            setProgress(100);

            if (DOM.storageList) DOM.storageList.scrollTop = 0;

            return true;
          })
          .catch(function(){
            return null;
          })
          .finally(function(){
            UI.busyRelease(tok);
            tok = 0;

            setTimeout(function(){
              resetProgress();
              render();
            }, 200);
          });
      });
    }

    function deleteSelected(){
      if (Guard.blockIf({ busy:true, hard:true })) return Promise.resolve(null);

      var names = selectedNames();
      if (!names.length) return Promise.resolve(null);

      msgClear();

      var msg = 'Delete ' + names.length + ' selected file(s)?';
      if (!window.confirm(msg)) return Promise.resolve(null);

      return Op.runGlobal(function(){
        var tok = UI.busyAcquire('storage-delete');

        msgShow('info', 'Deleting selected files...');
        setProgress(0);

        var total = names.length;
        var done = 0;

        function postChunk(chunkNames, returnItems){
          var fd = new FormData();
          fd.append('csrf', csrfToken);
          fd.append('action', 'storage_delete');
          fd.append('return_items', returnItems ? '1' : '0');

          for (var i = 0; i < chunkNames.length; i++) fd.append('names[]', chunkNames[i]);

          return Net.postForm(EP.index, fd);
        }

        var aggDeleted = 0;
        var aggFailed = 0;

        function next(){
          var CHUNK = 25;

          var start = done;
          var end = Math.min(total, start + CHUNK);
          var chunkNames = names.slice(start, end);

          var isLast = (end >= total);

          return postChunk(chunkNames, isLast)
            .then(function(r){
              if (!r) return null;

              // Do not require Net.isAppOk(): server may return err[] but still delete files.
              var env = r.data || {};
              var payload = pickDataPayload(env);

              syncStatsFrom(env);

              aggDeleted += Number(payload.deleted || 0);
              aggFailed  += Number(payload.failed || 0);

              done = end;
              if (total > 0) setProgress(Math.floor((done * 100) / total));

              if (isLast) {
                if (Array.isArray(payload.items)) lastItems = payload.items;
                else lastItems = [];
              }

              if (!isLast) return next();

              clearSelection();
              render();

              if (aggDeleted > 0 && aggFailed > 0) {
                msgShow('warning', 'Delete completed with warnings. Deleted: ' + aggDeleted + ', failed: ' + aggFailed + '.');
              } else if (aggDeleted > 0) {
                msgShow('success', 'Delete completed.');
              } else {
                msgShow('danger', 'Delete failed.');
                return null;
              }

              setProgress(100);

              readInputsIntoQuery();

              return refreshToDesiredCount('Index', 'Could not refresh list (network/server error).')
                .then(function(){
                  return true;
                })
                .catch(function(){
                  msgShow('warning', 'Deleted, but list refresh failed.');
                  return true;
                });
            })
            .catch(function(){
              return null;
            });
        }

        return Promise.resolve()
          .then(next)
          .then(function(res){
            if (!res) {
              msgShow('danger', 'Delete failed.');
              return null;
            }
            return res;
          })
          .finally(function(){
            UI.busyRelease(tok);
            tok = 0;

            setTimeout(function(){
              resetProgress();
              render();
            }, 200);
          });
      });
    }

    function open(){
      if (!DOM.storageModal) return;
      if (Guard.blockIf({ busy:true })) return;

      var statsUrl = buildStatsUrl();

      Net.getJson(statsUrl)
        .then(function(r){
          if (!Net.isAppOk(r)) {
            Toast.show('warning', 'Storage Control', 'Could not check index state (network/server error).');
            return null;
          }

          syncStatsFrom(r.data);

          var stats = (r.data && r.data.stats && typeof r.data.stats === 'object') ? r.data.stats : r.data;
          var blocked = (Number(stats && stats.idx_blocked || 0) === 1) || (Number(stats && stats.idx_missing || 0) === 1);

          if (blocked) return null;

          if (Modals && Modals.show) Modals.show(DOM.storageModal);
          return null;
        })
        .catch(function(){
          Toast.show('warning', 'Storage Control', 'Could not check index state (network error).');
          return null;
        });
    }

    function wire(){
      wireListSelection();

      if (DOM.storageModal) {
        L.on(DOM.storageModal, 'show.bs.modal', function(){
          resetUi();
        });
      }

      if (DOM.buttons && DOM.buttons.storageControl) {
        L.on(DOM.buttons.storageControl, 'click', function(ev){
          ev.preventDefault();
          open();
        });
      }

      if (DOM.storageScanBtn) {
        L.on(DOM.storageScanBtn, 'click', function(ev){
          ev.preventDefault();
          scan();
        });
      }

      if (DOM.storageDeleteBtn) {
        L.on(DOM.storageDeleteBtn, 'click', function(ev){
          ev.preventDefault();
          deleteSelected();
        });
      }

      if (setEnabled) setEnabled(DOM.storageDeleteBtn, false);
    }

    return {
      wire: wire,
      open: open,
      scan: scan,
      deleteSelected: deleteSelected
    };
  };

})();