/* MiniCloudS mc_links.js
   - Share / Links owner (extracted from app.js)
   - Exposes: MC.initLinks(deps) -> Links API
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initLinks = function initLinks(deps){
    deps = deps || {};

    var DOM = deps.DOM || {};
    var Net = deps.Net || {};
    var EP = deps.EP || {};
    var Toast = deps.Toast || {};
    var Guard = deps.Guard || {};
    var RowBusy = deps.RowBusy || {};
    var RenderLife = deps.RenderLife || {};
    var HardLock = deps.HardLock || {};
    var CheckIndexFlow = deps.CheckIndexFlow || {};

    var csrfToken = String(deps.csrfToken || '');

    var encName = deps.encName;
    var decName = deps.decName;
    var cssEscape = deps.cssEscape;

    var startDownloadNoNav = deps.startDownloadNoNav;

    var classifyToast = deps.classifyToast;
    var syncStatsFrom = deps.syncStatsFrom;

    var readInputsIntoQuery = deps.readInputsIntoQuery;
    var refreshToDesiredCount = deps.refreshToDesiredCount;

    var getQueryFlags = deps.getQueryFlags || function(){ return 'all'; };

    var pageState = deps.pageState || { files: [] };
    var urlInflight = deps.urlInflight || Object.create(null);

    async function getShortUrl(filename, mode){
      mode = String(mode || 'make_link');

      var fd = new FormData();
      fd.append('csrf', csrfToken);
      fd.append('action', mode);
      fd.append('name', filename);

      var r = await Net.postForm(EP.link, fd);

      var data = r.data;

      if (!r.ok) {
        var msg = (data && data.error) ? data.error : 'Link failed';
        throw new Error(msg);
      }
      if (!data || !data.url) throw new Error('Bad response');

      var u = String(data.url);
      if (u.startsWith('/')) return window.location.origin + u;
      return u;
    }

    async function unshareOnServer(filename){
      var fd = new FormData();
      fd.append('csrf', csrfToken);
      fd.append('action', 'unshare_one');
      fd.append('name', filename);

      var r = await Net.postForm(EP.index, fd, {
        headers: { 'Accept': 'application/json' }
      });

      if (!r.ok || !r.data) throw new Error('Unshare failed');
      return r.data;
    }

    function patchVisibleCard(filename, isShared, url){
      filename = String(filename || '');
      if (!filename) return;

      for (var i = 0; i < pageState.files.length; i++) {
        if (pageState.files[i] && String(pageState.files[i].name || '') === filename) {
          pageState.files[i].shared = !!isShared;
          pageState.files[i].url = (isShared && url) ? String(url) : '';
          break;
        }
      }

      var key = encName(filename);
      var wrapper = DOM.grid ? DOM.grid.querySelector('[data-file-card="' + cssEscape(key) + '"]') : null;
      if (!wrapper) return;

      var inner = wrapper.querySelector('.file-card');
      if (!inner) return;

      if (isShared) inner.classList.add('shared');
      else inner.classList.remove('shared');

      inner.setAttribute('data-shared', isShared ? '1' : '0');
      inner.setAttribute('data-url', (isShared && url) ? String(url) : '');

      var pill = wrapper.querySelector('[data-link-pill]');
      if (pill) {
        var span = pill.querySelector('[data-link-text]');
        if (span) span.textContent = isShared ? (url ? url : 'loading...') : 'File entry not shared';

        if (isShared) {
          pill.classList.add('is-clickable');
          pill.setAttribute('role', 'button');
          pill.setAttribute('tabindex', '0');
          pill.setAttribute('title', 'Click to copy link');
        } else {
          pill.classList.remove('is-clickable');
          pill.setAttribute('role', 'note');
          pill.setAttribute('tabindex', '-1');
          pill.removeAttribute('title');
        }
      }

      var shareBtn = wrapper.querySelector('[data-share-btn]');
      if (shareBtn) shareBtn.textContent = isShared ? 'Unshare' : 'Share';

      if (RenderLife && RenderLife.after) RenderLife.after();
    }

    function ensureUrlForFile(filename){
      filename = String(filename || '');
      if (!filename) return Promise.resolve(null);

      for (var i = 0; i < pageState.files.length; i++) {
        if (pageState.files[i] && String(pageState.files[i].name || '') === filename) {
          if (pageState.files[i].shared && pageState.files[i].url) return Promise.resolve(String(pageState.files[i].url));
          if (!pageState.files[i].shared) return Promise.resolve(null);
          break;
        }
      }

      if (urlInflight[filename]) return urlInflight[filename];

      urlInflight[filename] = getShortUrl(filename)
        .then(function(url){
          for (var j = 0; j < pageState.files.length; j++) {
            if (pageState.files[j] && String(pageState.files[j].name || '') === filename) {
              if (!!pageState.files[j].shared) patchVisibleCard(filename, true, url);
              break;
            }
          }
          return url;
        })
        .catch(function(){ return null; })
        .finally(function(){ delete urlInflight[filename]; });

      return urlInflight[filename];
    }

    function ensureVisibleSharedUrls(){
      if (!DOM.grid) return;

      // During Check Index refresh, do not hydrate URLs (avoid overlap with "checking" flow).
      if (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking()) return;

      // HardLock must NOT block hydration.
      // Hydration is read-only; clicks/actions are blocked elsewhere by Guard.
      var nodes = DOM.grid.querySelectorAll('.file-card[data-shared="1"]');
      for (var i = 0; i < nodes.length; i++) {
        var card = nodes[i];
        var wrapper = card.closest('[data-file-card]');
        if (!wrapper) continue;

        var key = String(wrapper.getAttribute('data-file-card') || '');
        var fn = decName(key);
        if (!fn) continue;

        var url = String(card.getAttribute('data-url') || '');
        if (!url && !urlInflight[fn]) ensureUrlForFile(fn);
      }
    }

    async function onLinkPillClick(pill){
      if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;

      var key = String(pill.getAttribute('data-f') || '');
      var fn = decName(key);
      if (!fn) return;

      if (Guard && Guard.blockIf && Guard.blockIf({ row: fn })) return;

      var f = null;
      for (var i = 0; i < pageState.files.length; i++) {
        if (pageState.files[i] && String(pageState.files[i].name || '') === fn) { f = pageState.files[i]; break; }
      }
      if (!f || !f.shared) return;

      if (Toast && Toast.priorityAction) Toast.priorityAction();

      var url = String(f.url || '');
      if (!url) url = await ensureUrlForFile(fn) || '';
      if (!url) {
        if (Toast && Toast.show) Toast.show('danger', 'Shared link', 'Could not load shared link.');
        return;
      }

      try {
        await navigator.clipboard.writeText(url);
        if (Toast && Toast.show) Toast.show('success', 'Shared link', 'Shared link copied.');
      } catch (e) {
        if (Toast && Toast.show) Toast.show('danger', 'Shared link', 'Clipboard copy failed.');
      }
    }

    async function toggleShareByFilename(file){
      file = String(file || '');
      if (!file) return;

      if (Guard && Guard.blockIf && Guard.blockIf({ hard:true, row:file })) return;

      if (Toast && Toast.priorityAction) Toast.priorityAction();

      var f = null;
      for (var i = 0; i < pageState.files.length; i++) {
        if (pageState.files[i] && String(pageState.files[i].name || '') === file) { f = pageState.files[i]; break; }
      }
      var isShared = !!(f && f.shared);

      if (!isShared) {
        try {
          if (RowBusy && RowBusy.set) RowBusy.set(file, true);

          var url = await getShortUrl(file, 'make_link');
          patchVisibleCard(file, true, url);

          try {
            await navigator.clipboard.writeText(url);
            if (Toast && Toast.show) Toast.show('success', 'Shared link', 'Shared link copied.');
          } catch (eClip) {
            if (Toast && Toast.show) Toast.show('warning', 'Shared link', 'Link created, but clipboard copy failed.');
          }

          if (typeof readInputsIntoQuery === 'function') readInputsIntoQuery();
          if (getQueryFlags() === 'shared') {
            if (typeof refreshToDesiredCount === 'function') {
              await refreshToDesiredCount('Index', 'Could not refresh list (network/server error).');
            }
          }
        } catch (e) {
          if (Toast && Toast.show) Toast.show('danger', 'Shared link', (e && e.message) ? e.message : 'Failed to create link.');
        } finally {
          if (RowBusy && RowBusy.set) RowBusy.set(file, false);
        }
        return;
      }

      try {
        if (RowBusy && RowBusy.set) RowBusy.set(file, true);

        var resp = await unshareOnServer(file);

        var okMsgs = (resp && Array.isArray(resp.ok)) ? resp.ok : [];
        var errMsgs = (resp && Array.isArray(resp.err)) ? resp.err : [];

        patchVisibleCard(file, false, '');

        if (typeof classifyToast === 'function') {
          var t = classifyToast(okMsgs, errMsgs, {
            successTitle: 'Shared link',
            warnTitle: 'Shared link',
            errorTitle: 'Shared link'
          });
          if (t && t.msg && Toast && Toast.show) Toast.show(t.kind, t.title, t.msg);
        }

        if (typeof syncStatsFrom === 'function') syncStatsFrom(resp);

        if (typeof readInputsIntoQuery === 'function') readInputsIntoQuery();
        if (typeof refreshToDesiredCount === 'function') {
          await refreshToDesiredCount('Index', 'Could not refresh list (network/server error).');
        }
      } catch (e2) {
        if (Toast && Toast.show) Toast.show('danger', 'Shared link', 'Shared link delete failed.');
      } finally {
        if (RowBusy && RowBusy.set) RowBusy.set(file, false);
      }
    }

    async function downloadByFilename(file){
      file = String(file || '');
      if (!file) return;

      if (Guard && Guard.blockIf && Guard.blockIf({ hard:true, row:file })) return;

      if (Toast && Toast.priorityAction) Toast.priorityAction();

      try {
        if (RowBusy && RowBusy.set) RowBusy.set(file, true);
        var url = await getShortUrl(file, 'get_direct');
        if (Toast && Toast.show) Toast.show('success', 'Download', 'Download started.');
        startDownloadNoNav(url);
      } catch (e) {
        if (Toast && Toast.show) Toast.show('danger', 'Download', (e && e.message) ? e.message : 'Failed to start download.');
      } finally {
        if (RowBusy && RowBusy.set) RowBusy.set(file, false);
      }
    }

    return {
      ensureVisibleSharedUrls: ensureVisibleSharedUrls,
      onLinkPillClick: onLinkPillClick,
      toggleShareByFilename: toggleShareByFilename,
      downloadByFilename: downloadByFilename,
      ensureUrlForFile: ensureUrlForFile,
      patchVisibleCard: patchVisibleCard
    };
  };

})();