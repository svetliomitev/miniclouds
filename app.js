/* MiniCloudS app.js
   Assumes window.MC_BOOT exists (set by index.php).
*/
(function(){
  'use strict';

  var BOOT = window.MC_BOOT || {};
  var PAGE_SIZE = Number(BOOT.pageSize || 20);
  var csrfToken = String(BOOT.csrf || '');

  /* =========================
     LIFECYCLE MANAGER (single place for transient UI listeners)
     ========================= */
  var L = (function(){
    var items = [];

    function on(target, type, handler, options){
      if (!target || !target.addEventListener) return handler;
      target.addEventListener(type, handler, options);
      items.push({ target: target, type: type, handler: handler, options: options });
      return handler;
    }

    // per-feature scoped listeners (for transient UI like the search toast)
    function scope(){
      var local = [];
      function onLocal(target, type, handler, options){
        if (!target || !target.addEventListener) return handler;
        target.addEventListener(type, handler, options);
        local.push({ target: target, type: type, handler: handler, options: options });
        return handler;
      }
      function disposeLocal(){
        for (var i = local.length - 1; i >= 0; i--) {
          var it = local[i];
          try { it.target.removeEventListener(it.type, it.handler, it.options); } catch (e) {}
        }
        local.length = 0;
      }
      return { on: onLocal, dispose: disposeLocal };
    }

    function dispose(){
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        try { it.target.removeEventListener(it.type, it.handler, it.options); } catch (e) {}
      }
      items.length = 0;
    }

    return { on: on, scope: scope, dispose: dispose };
  })();

  /* =========================
     DOM CACHE
     ========================= */
  var DOM = {
    toast: {
      el: document.getElementById('toast'),
      title: document.getElementById('toastTitle'),
      body: document.getElementById('toastBody'),
      icon: document.getElementById('toastIcon'),
      close: document.getElementById('toastCloseBtn')
    },
    searchToast: {
      el: document.getElementById('toastSearch'),
      title: document.getElementById('toastSearchTitle'),
      body: document.getElementById('toastSearchBody'),
      icon: document.getElementById('toastSearchIcon'),
      close: document.getElementById('toastSearchCloseBtn'),
      keyLast: null,
      scope: null
    },
    grid: document.getElementById('filesGrid'),
    empty: document.getElementById('filesEmpty'),
    filesSection: document.getElementById('filesSection') || document.getElementById('filesGrid'),

    counts: {
      shown1: document.getElementById('fileCount'),
      total1: document.getElementById('fileTotal'),
      shown2: document.getElementById('fileCount2'),
      total2: document.getElementById('fileTotal2')
    },

    footerTotal: document.getElementById('totalUploaded'),

    buttons: {
      deleteAll: document.getElementById('deleteAllBtn'),
      reinstall: document.getElementById('reinstallBtn'),
      uploadBtn: document.getElementById('uploadBtn'),
      showMore: document.getElementById('showMoreBtn'),
      searchClear: document.getElementById('searchClear'),
      flagsDropdownBtn: document.getElementById('flagsDropdownBtn')
    },

    upload: {
      form: document.getElementById('uploadForm'),
      input: document.getElementById('filesInput'),
      wrap: document.getElementById('uploadProgressWrap'),
      bar: document.getElementById('uploadProgressBar')
    },

    search: {
      q: document.getElementById('searchQ'),
      from: document.getElementById('searchFrom'),
      to: document.getElementById('searchTo'),
      flagsBtn: document.getElementById('flagsDropdownBtn'),
      flagsLabel: document.getElementById('flagsDropdownLabel')
    },

    showMoreWrap: document.getElementById('showMoreWrap'),
    showMoreHint: document.getElementById('showMoreHint'),

    backToTop: document.getElementById('backToTop'),
    infoModal: document.getElementById('mcInfoModal')
  };

  /* =========================
     SMALL HELPERS
     ========================= */
  function forceHide(el){
    if (!el) return;
    el.classList.remove('show');
    el.classList.remove('showing');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }
  function forceShow(el){
    if (!el) return;
    el.style.display = '';
    el.removeAttribute('aria-hidden');
  }
  function setEnabled(el, enabled){
    if (!el) return;
    el.disabled = !enabled;
    el.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]);
    });
  }

  function cssEscape(s){
    s = String(s);
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return s.replace(/["\\#.;?&,+*~':"!^$[\]()=>|/@\s]/g, '\\$&');
  }

  // IMPORTANT: keep a stable attribute representation for filenames (no HTML escaping mismatch)
  function encName(name){
    try { return encodeURIComponent(String(name || '')); } catch (e) { return ''; }
  }
  function decName(s){
    try { return decodeURIComponent(String(s || '')); } catch (e) { return String(s || ''); }
  }

  // Start a download without navigating (avoids aggressive page blanking).
  // Uses a hidden iframe so cookies/session are included (same-origin).
  function startDownloadNoNav(url){
    url = String(url || '');
    if (!url) return;

    try {
      var iframe = document.getElementById('mcDownloadFrame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'mcDownloadFrame';
        iframe.style.display = 'none';
        iframe.setAttribute('aria-hidden', 'true');
        document.body.appendChild(iframe);
      }
      iframe.src = url;
    } catch (e) {
      // fallback: normal navigation
      window.location.href = url;
    }
  }

  function formatBytes(bytes){
    var units = ['B','KB','MB','GB','TB'];
    var v = Number(bytes) || 0;
    var i = 0;
    while (v >= 1024 && i < units.length - 1) { v = v / 1024; i++; }
    return (i === 0 ? String(Math.floor(v)) : v.toFixed(2)) + ' ' + units[i];
  }
  function formatDate(ts){
    var d = new Date((Number(ts) || 0) * 1000);
    function pad(n){ return String(n).padStart(2,'0'); }
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function splitTerms(q){
    q = String(q || '').trim();
    if (!q) return [];
    return q.split(/\s+/).filter(Boolean);
  }
  function escapeRegExp(s){
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function highlightText(original, terms){
    if (!terms || !terms.length) return escapeHtml(original);
    var parts = [];
    for (var i = 0; i < terms.length; i++) {
      var t = String(terms[i] || '').trim();
      if (t) parts.push(escapeRegExp(t));
    }
    if (!parts.length) return escapeHtml(original);

    var re;
    try { re = new RegExp('(' + parts.join('|') + ')', 'giu'); }
    catch (e) { return escapeHtml(original); }

    var out = '';
    var s = String(original || '');
    var last = 0;
    re.lastIndex = 0;

    var m;
    while ((m = re.exec(s)) !== null) {
      var start = m.index;
      var match = m[0];
      if (start > last) out += escapeHtml(s.slice(last, start));
      out += '<mark>' + escapeHtml(match) + '</mark>';
      last = start + match.length;
      if (re.lastIndex === start) re.lastIndex++;
    }
    if (last < s.length) out += escapeHtml(s.slice(last));
    return out;
  }
  function syncInfoModalFromUI(){
    var infoFiles = document.getElementById('mcInfoFilesCount');
    var infoSize  = document.getElementById('mcInfoTotalSize');

    // source-of-truth from already-updated UI
    var filesNow = DOM.counts && DOM.counts.total1 ? DOM.counts.total1.textContent : '';
    var sizeNow  = DOM.footerTotal ? DOM.footerTotal.textContent : '';

    if (infoFiles && filesNow) infoFiles.textContent = String(filesNow).trim();
    if (infoSize && sizeNow) infoSize.textContent = String(sizeNow).trim();
  }

  /* =========================
     TOASTS (NO bootstrap.Toast JS; styling only)
     ========================= */
  var searchToastSuppressUntil = 0;

  function toastIconClassFor(kind){
    switch (kind) {
      case 'success': return 'bi bi-check-circle-fill';
      case 'danger':  return 'bi bi-x-circle-fill';
      case 'warning': return 'bi bi-exclamation-triangle-fill';
      case 'info':    return 'bi bi-info-circle-fill';
      default:        return 'bi bi-dot';
    }
  }

  var __mcToastTimer = 0;
  var __mcSearchToastTimer = 0;

  function hideMainToast(){
    var t = DOM.toast;
    if (__mcToastTimer) { clearTimeout(__mcToastTimer); __mcToastTimer = 0; }
    if (t && t.el) forceHide(t.el);
  }

  function canShowSearchToast(){
    return !(searchToastSuppressUntil && Date.now() < searchToastSuppressUntil);
  }

  function hideSearchResultsToast(){
  var st = DOM.searchToast;

  if (__mcSearchToastTimer) { clearTimeout(__mcSearchToastTimer); __mcSearchToastTimer = 0; }

  if (st.scope) {
    try { st.scope.dispose(); } catch (e0) {}
    st.scope = null;
  }
  st.keyLast = null;
  if (st.el) forceHide(st.el);
  }

  function scrollToResultsAndHide(){
    var target = DOM.filesSection;
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    hideSearchResultsToast();
  }

  function showToast(kind, title, msg){
    // when a “real” toast shows, the search toast must disappear
    hideSearchResultsToast();
    searchToastSuppressUntil = Date.now() + 2200;

    var t = DOM.toast;
    if (!t.el) return;

    hideMainToast();

    var cls = 'toast border-0 w-100 pretty';
    if (kind === 'success') cls += ' text-bg-success';
    else if (kind === 'danger') cls += ' text-bg-danger';
    else if (kind === 'warning') cls += ' text-bg-warning';
    else if (kind === 'info') cls += ' text-bg-info';
    else cls += ' text-bg-secondary';

    t.el.className = cls;
    if (t.icon) t.icon.className = toastIconClassFor(kind);
    if (t.title) t.title.textContent = title || 'Message';
    if (t.body) t.body.textContent = msg || '';

    forceShow(t.el);
    t.el.classList.add('show');

    __mcToastTimer = setTimeout(function(){
      __mcToastTimer = 0;
      hideMainToast();
    }, 2000);
  }

  function classifyToast(okMsgs, errMsgs, opts){
    okMsgs = Array.isArray(okMsgs) ? okMsgs : [];
    errMsgs = Array.isArray(errMsgs) ? errMsgs : [];
    opts = opts || {};

    function isWarnText(s){
      s = String(s || '');
      return /could not be removed|some .* could not/i.test(s);
    }

    var hasOk = okMsgs.length > 0;
    var hasErr = errMsgs.length > 0;
    var allErrAreWarn = hasErr && errMsgs.every(isWarnText);
    var okContainsWarn = okMsgs.some(isWarnText);

    if (hasErr && (!hasOk || !allErrAreWarn)) {
      return { kind:'danger', title: opts.errorTitle || 'Error', msg: errMsgs.join(' | ') };
    }
    if ((hasOk && hasErr && allErrAreWarn) || okContainsWarn) {
      var warnParts = [];
      if (hasOk) warnParts = warnParts.concat(okMsgs);
      if (hasErr) warnParts = warnParts.concat(errMsgs);
      return { kind:'warning', title: opts.warnTitle || 'Warning', msg: warnParts.join(' | ') };
    }
    if (hasOk) {
      return { kind:'success', title: opts.successTitle || 'Success', msg: okMsgs.join(' | ') };
    }
    return { kind:'info', title: opts.infoTitle || 'Info', msg: opts.infoMsg || '' };
  }

  function showResultsToast(shownCount, totalCount, filterKey, opts){
    var st = DOM.searchToast;
    opts = opts || {};
    if (!st.el) return;
    if (!canShowSearchToast()) return;

    var isAppend = !!opts.append;

    // Dedupe only for non-append (append is user-driven feedback)
    if (!isAppend && filterKey === st.keyLast) return;
    st.keyLast = filterKey;

    // clear any previous auto-hide
    if (__mcSearchToastTimer) { clearTimeout(__mcSearchToastTimer); __mcSearchToastTimer = 0; }

    // reset scoped listeners for this toast instance
    if (st.scope) {
      try { st.scope.dispose(); } catch (e0) {}
      st.scope = null;
    }

    // Style + copy
    if (isAppend) {
      st.el.className = 'toast border-0 w-100 pretty text-bg-success';
      if (st.icon) st.icon.className = 'bi bi-check-circle-fill';
      if (st.title) st.title.textContent = 'Loaded results';
      if (st.body) st.body.textContent =
        'Showing ' + Number(shownCount || 0) + ' of ' + Number(totalCount || 0) + ' result(s).';
    } else {
      st.el.className = 'toast border-0 w-100 pretty text-bg-warning';
      if (st.icon) st.icon.className = 'bi bi-funnel-fill';
      if (st.title) st.title.textContent = 'Search Results';
      if (st.body) st.body.textContent =
        'Showing ' + Number(shownCount || 0) + ' of ' + Number(totalCount || 0) + ' result(s). Tap to view.';
    }

    st.scope = L.scope();

    // Click behavior:
    // - initial search: click scrolls to results
    // - append: click just closes (no scroll)
    st.scope.on(st.el, 'click', function(){
      if (isAppend) { hideSearchResultsToast(); return; }
      scrollToResultsAndHide();
    });

    // Close button: ALWAYS just close (no scroll)
    if (st.close) {
      st.scope.on(st.close, 'click', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        hideSearchResultsToast();
      });
    }

    forceShow(st.el);
    st.el.classList.add('show');

    // Append toast auto-dismiss (like success toasts)
    if (isAppend) {
      __mcSearchToastTimer = setTimeout(function(){
        __mcSearchToastTimer = 0;
        hideSearchResultsToast();
      }, Number(opts.ttl || 2000));
    }
  }

  function replaceSearchToastForAction(){
    hideSearchResultsToast();
  }

  if (DOM.toast.close) {
    L.on(DOM.toast.close, 'click', function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      hideMainToast();
    });
  }

  /* =========================
     BUSY / ENABLE-DISABLE POLICY (single source of truth)
     ========================= */
  var UI = {
    busy: false,
    _deleteAllHasFiles: (Number(BOOT.totalFiles || 0) > 0),
    setBusy: function(isBusy){
      UI.busy = !!isBusy;

      setEnabled(DOM.buttons.reinstall, !UI.busy);

      if (DOM.upload.input) DOM.upload.input.disabled = UI.busy;
      setEnabled(DOM.buttons.uploadBtn, !UI.busy);

      // Search controls: DO NOT disable q (caret glitches)
      if (DOM.search.q) DOM.search.q.disabled = false;
      if (DOM.search.from) DOM.search.from.disabled = UI.busy;
      if (DOM.search.to) DOM.search.to.disabled = UI.busy;
      setEnabled(DOM.buttons.flagsDropdownBtn, !UI.busy);
      setEnabled(DOM.buttons.searchClear, !UI.busy);

      setEnabled(DOM.buttons.showMore, !UI.busy);

      UI.applyBusyToGrid();
      UI.applyDeleteAllPolicy();
    },
    applyBusyToGrid: function(){
      if (!DOM.grid) return;
      var nodes = DOM.grid.querySelectorAll('button, input, select, textarea');
      for (var i = 0; i < nodes.length; i++) nodes[i].disabled = UI.busy;
    },
    setDeleteAllHasFiles: function(hasFiles){
      UI._deleteAllHasFiles = !!hasFiles;
      UI.applyDeleteAllPolicy();
    },
    applyDeleteAllPolicy: function(){
      setEnabled(DOM.buttons.deleteAll, !UI.busy && !!UI._deleteAllHasFiles);
    }
  };

  /* =========================
     STATE
     ========================= */
  var query = { q:'', from:'', to:'', flags:'all' };

  var pageState = {
    offset: 0,
    limit: PAGE_SIZE,
    total: Number(BOOT.totalFiles || 0),
    files: Array.isArray(BOOT.filesPage) ? BOOT.filesPage : []
  };

  // URL fetch dedupe
  var __mcUrlInflight = Object.create(null);

  // navigation guard: suppress "network error" toasts when we intentionally redirect (reinstall)
  var __mcNavigating = false;

  // list request sequencing
  var __mcListReqSeq = 0;
  var __mcListAbortCtl = null;

  // stable URL base
  var __mcBaseHref = (function(){
    try { return new URL('index.php', window.location.href).toString(); } catch (e) { return 'index.php'; }
  })();

  function queryKey(){
    return 'q=' + (query.q||'') + '|from=' + (query.from||'') + '|to=' + (query.to||'') + '|flags=' + (query.flags||'all');
  }

  /* =========================
     STATS (single updater)
     ========================= */
  function applyStats(stats){
    if (!stats) return;

    if (stats.total_human && DOM.footerTotal) DOM.footerTotal.textContent = String(stats.total_human);

    var totalAll = Number(stats.total_files || 0);
    UI.setDeleteAllHasFiles(totalAll > 0);

    // keep totals consistent in the UI (shown stays as-is)
    var shownNow = (DOM.counts && DOM.counts.shown1) ? Number(DOM.counts.shown1.textContent || 0) : 0;
    updateCounts(shownNow, totalAll);

    if (DOM.buttons.deleteAll) {
      if (totalAll <= 0) DOM.buttons.deleteAll.setAttribute('data-mc-empty','1');
      else DOM.buttons.deleteAll.removeAttribute('data-mc-empty');
    }
  }

  function refreshStats(){
    return fetch('index.php?ajax=stats', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(res){
      return res.json().then(function(data){ return { ok: res.ok, data: data }; });
    })
    .then(function(r){
      if (!r.ok || !r.data || r.data.ok !== true) return null;
      applyStats(r.data);
      return r.data;
    })
    .catch(function(){ return null; });
  }

  /* =========================
     RENDER
     ========================= */
  function updateCounts(shown, total){
    shown = Number(shown || 0);
    total = Number(total || 0);
    if (DOM.counts.shown1) DOM.counts.shown1.textContent = String(shown);
    if (DOM.counts.total1) DOM.counts.total1.textContent = String(total);
    if (DOM.counts.shown2) DOM.counts.shown2.textContent = String(shown);
    if (DOM.counts.total2) DOM.counts.total2.textContent = String(total);
  }

  function renderFiles(arr, totalMatches, highlightTerms, hasMore){
    arr = Array.isArray(arr) ? arr : [];
    totalMatches = Number(totalMatches || 0);

    if (!DOM.grid || !DOM.empty) return;

    if (arr.length === 0) {
      DOM.grid.classList.add('d-none');
      DOM.empty.classList.remove('d-none');
      DOM.grid.innerHTML = '';
      if (DOM.showMoreWrap) DOM.showMoreWrap.classList.add('d-none');
      if (DOM.showMoreHint) DOM.showMoreHint.textContent = '';
      return;
    }

    DOM.empty.classList.add('d-none');
    DOM.grid.classList.remove('d-none');

    var html = [];
    for (var idx = 0; idx < arr.length; idx++) {
      var f = arr[idx] || {};
      var rawName = String(f.name || '');
      var key = encName(rawName);

      var nameHtml = highlightText(rawName, highlightTerms || []);
      var size = escapeHtml(formatBytes(f.size || 0));
      var mtime = escapeHtml(formatDate(f.mtime || 0));
      var altClass = (idx % 2 === 1) ? 'alt' : '';
      var isShared = !!f.shared;
      var sharedClass = isShared ? ' shared' : '';
      var sharedAttr = isShared ? '1' : '0';
      var url = String(f.url || '');

      var pillText = isShared ? (url ? escapeHtml(url) : 'loading…') : 'File entry not shared';
      var pillClickable = (isShared ? ' is-clickable' : '');
      var shareLabel = isShared ? 'Unshare' : 'Share';

      // IMPORTANT: data-file-card and data-f are URL-encoded filename keys.
      html.push(
        '<div class="col-12 col-md-6" data-file-card="' + escapeHtml(key) + '">' +
          '<div class="file-card ' + altClass + sharedClass + '"' +
            ' data-shared="' + sharedAttr + '"' +
            ' data-url="' + escapeHtml(url) + '">' +

            '<div class="file-name">' + nameHtml + '</div>' +

            '<div class="file-meta">' +
              '<div class="file-meta-row">' +
                '<div><span class="text-body-secondary">Size:</span> ' + size + '</div>' +
                '<div><span class="text-body-secondary">Date:</span> ' + mtime + '</div>' +
              '</div>' +
            '</div>' +

            '<div class="file-link-row">' +
              '<div class="file-link-pill' + pillClickable + '"' +
                (isShared ? ' title="Click to copy link"' : '') +
                ' role="' + (isShared ? 'button' : 'note') + '"' +
                ' tabindex="' + (isShared ? '0' : '-1') + '"' +
                ' data-link-pill' +
                ' data-f="' + escapeHtml(key) + '">' +
                  '<span data-link-text>' + pillText + '</span>' +
              '</div>' +
            '</div>' +

            '<div class="file-actions">' +
              '<button class="btn btn-outline-secondary btn-sm" type="button"' +
                ' data-f="' + escapeHtml(key) + '"' +
                ' data-share-btn>' +
                shareLabel +
              '</button>' +

              '<button class="btn btn-outline-primary btn-sm" type="button"' +
                ' data-f="' + escapeHtml(key) + '"' +
                ' data-download-btn>' +
                'Download' +
              '</button>' +

              '<form method="post" class="js-ajax" data-confirm="Delete this file?">' +
                '<input type="hidden" name="csrf" value="' + escapeHtml(csrfToken) + '">' +
                '<input type="hidden" name="action" value="delete_one">' +
                '<input type="hidden" name="name" value="' + escapeHtml(rawName) + '">' +
                '<button class="btn btn-outline-danger btn-sm" type="submit">Delete</button>' +
              '</form>' +
            '</div>' +

          '</div>' +
        '</div>'
      );
    }
    DOM.grid.innerHTML = html.join('');

    UI.applyBusyToGrid();
    ensureVisibleSharedUrls();

    if (DOM.showMoreWrap && DOM.buttons.showMore && DOM.showMoreHint) {
      if (hasMore) {
        DOM.showMoreWrap.classList.remove('d-none');
        DOM.buttons.showMore.disabled = false;
        DOM.showMoreHint.textContent = 'Showing ' + arr.length + ' of ' + totalMatches + ' match(es).';
      } else {
        DOM.showMoreWrap.classList.add('d-none');
        DOM.showMoreHint.textContent = '';
      }
    }
  }

  /* =========================
     SEARCH UI
     ========================= */
  function setFlagsUI(value, silent){
  value = String(value || 'all');
  if (!DOM.search.flagsBtn || !DOM.search.flagsLabel) return;

  var prev = String(DOM.search.flagsBtn.getAttribute('data-value') || 'all');

  // Always ensure label is correct, but do NOT re-run query if no change.
  DOM.search.flagsBtn.setAttribute('data-value', value);
  DOM.search.flagsLabel.textContent = (value === 'shared') ? 'Shared only' : 'All files';

  if (silent) return;

  // No-op: same filter selected again => do nothing (no fetch, no toast).
  if (prev === value) return;

  if (UI.busy) return;
  readInputsIntoQuery();
  runQuery(true);
  }

  function readInputsIntoQuery(){
    query.q = DOM.search.q ? String(DOM.search.q.value || '') : '';
    query.from = DOM.search.from ? String(DOM.search.from.value || '') : '';
    query.to = DOM.search.to ? String(DOM.search.to.value || '') : '';
    query.flags = DOM.search.flagsBtn ? String(DOM.search.flagsBtn.getAttribute('data-value') || 'all') : 'all';
  }

  function clearInputs(){
    if (DOM.search.q) DOM.search.q.value = '';
    if (DOM.search.from) DOM.search.from.value = '';
    if (DOM.search.to) DOM.search.to.value = '';
    setFlagsUI('all', true);
    query = { q:'', from:'', to:'', flags:'all' };
  }

  /* =========================
     LIST FETCH
     ========================= */
  function fetchList(offset, append){
    offset = Number(offset || 0);
    append = !!append;

    var reqId = ++__mcListReqSeq;

    if (__mcListAbortCtl) { try { __mcListAbortCtl.abort(); } catch (e0) {} }
    __mcListAbortCtl = (window.AbortController ? new AbortController() : null);

    var url;
    try { url = new URL(__mcBaseHref); }
    catch (e1) { url = new URL('index.php', window.location.href); }

    url.searchParams.set('ajax', 'list');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(pageState.limit));
    if (query.q) url.searchParams.set('q', query.q);
    if (query.from) url.searchParams.set('from', query.from);
    if (query.to) url.searchParams.set('to', query.to);
    url.searchParams.set('flags', query.flags || 'all');

    return fetch(url.toString(), {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      signal: __mcListAbortCtl ? __mcListAbortCtl.signal : undefined
    })
    .then(function(res){
      return res.text().then(function(txt){
        var data = null;
        try { data = JSON.parse(txt || ''); } catch (e2) {}
        return { ok: res.ok, status: res.status, data: data, reqId: reqId, raw: txt };
      });
    })
    .then(function(r){
      if (r.reqId !== __mcListReqSeq) return { ignored: true };

      if (!r.ok || !r.data || r.data.ok !== true || !Array.isArray(r.data.files)) {
        var err = new Error('bad list');
        err.reqId = r.reqId;
        err.status = r.status;
        err.raw = r.raw;
        throw err;
      }

      pageState.total = Number(r.data.total || 0);
      pageState.offset = Number(r.data.offset || 0);

      if (append) pageState.files = pageState.files.concat(r.data.files);
      else pageState.files = r.data.files;

      var terms = splitTerms(query.q || '');
      updateCounts(pageState.files.length, pageState.total);

      var hasFilter = ((query.q && query.q.trim()) || query.from || query.to || (query.flags && query.flags !== 'all'));
      if (hasFilter) {
        if (pageState.total > 0) {
          showResultsToast(
            pageState.files.length,
            pageState.total,
            queryKey() + '|n=' + pageState.total + '|shown=' + pageState.files.length,
            { append: append, ttl: 2000 }
          );
        } else {
          hideSearchResultsToast();
        }
      } else {
        hideSearchResultsToast();
      }

      var hm = r.data.has_more;
      var hasMore = (hm === true) || (hm === 1) || (hm === '1');

      renderFiles(pageState.files, pageState.total, terms, hasMore);

      return r.data;
    })
    .catch(function(e){
      // keep abort as "ignored" so upstream can stay quiet if desired
      if (e && (e.name === 'AbortError' || e.code === 20)) return { ignored: true };
      if (e && typeof e === 'object' && e.reqId == null) e.reqId = reqId;
      throw e;
    });
  }

  // Uniform “safe” wrapper: resolves to null on any failure; no unhandled rejections.
  function fetchListSafe(offset, append, toastTitle, toastMsg){
    return fetchList(offset, append)
      .then(function(data){
        if (data && data.ignored) return null;
        return data;
      })
      .catch(function(e){
        if (e && (e.name === 'AbortError' || e.code === 20)) return null;

        var rid = (e && e.reqId != null) ? Number(e.reqId) : -1;
        if (rid === __mcListReqSeq && !__mcNavigating) {
          showToast('warning', toastTitle || 'Index', toastMsg || 'Could not load list (network/server error).');
        }
        return null;
      });
  }

  function runQuery(reset, opts){
    reset = !!reset;
    opts = opts || {};
    var manageBusy = (opts.manageBusy !== false);

    if (reset) {
      if (DOM.showMoreWrap) DOM.showMoreWrap.classList.add('d-none');
      if (DOM.showMoreHint) DOM.showMoreHint.textContent = '';
      pageState.offset = 0;
      pageState.files = [];
    }

    if (manageBusy) UI.setBusy(true);

    return fetchListSafe(pageState.offset, !reset, 'Index', 'Could not load list (network/server error).')
      .finally(function(){
        if (manageBusy) UI.setBusy(false);
      });
  }

  /* =========================
     AJAX FORMS (.js-ajax)
     ========================= */
  function wireAjaxForms(){
    function onSubmit(ev){
      var form = ev.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.classList.contains('js-ajax')) return;

      ev.preventDefault();

      if (UI.busy) {
        showToast('info', 'Busy', 'Another operation is in progress. Please wait.');
        return;
      }

      var msg = form.getAttribute('data-confirm');
      if (msg && String(msg).trim().length) {
        if (!window.confirm(String(msg))) return;
      }

      replaceSearchToastForAction();

      var fd = new FormData(form);
      var actionName = String(fd.get('action') || '');

      UI.setBusy(true);

      fetch(form.getAttribute('action') || 'index.php', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        }
      })
      .then(function(res){
        return res.text().then(function(txt){
          var data = null;
          try { data = JSON.parse(txt || ''); } catch (e0) {}
          return { ok: res.ok, status: res.status, redirected: !!res.redirected, url: res.url, txt: txt, data: data };
        });
      })
      .then(function(r){
        if (!r.data) {
          var preview = String(r.txt || '').trim();
          if (preview.length > 220) preview = preview.slice(0, 220) + '…';
          if (r.redirected) showToast('danger', 'Error', 'Server redirected instead of returning JSON (AJAX not detected).');
          else showToast('danger', 'Error', 'Non-JSON response (' + r.status + '): ' + (preview || 'empty'));
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
        if (t && t.msg) showToast(t.kind, t.title, t.msg);

        // If server instructs redirect (reinstall), treat as intentional navigation.
        if (r.data && r.data.redirect) {
          var to = String(r.data.redirect || '').trim();
          if (to) {
            __mcNavigating = true;

            // brief toast that will disappear on navigation
            showToast('warning', 'Reinstall', 'Redirecting to installer...');

            // navigate soon; do NOT refresh list/stats (would trigger false network errors)
            setTimeout(function(){ window.location.href = to; }, 250);
            return null;
          }
        }

        if (r.data && r.data.stats) applyStats(r.data.stats);
        else refreshStats();

        if (actionName === 'delete_all') {
          clearInputs();
        }

        readInputsIntoQuery();

        // Keep busy until list refresh completes (manageBusy:false here!)
        return runQuery(true, { manageBusy:false });
      })
      .catch(function(){
        if (!__mcNavigating) {
          showToast('danger', 'Error', 'Request failed (network error).');
        }
        return null;
      })
      .finally(function(){
        UI.setBusy(false);
      });
    }

    L.on(document, 'submit', onSubmit, true);
  }

  /* =========================
     UPLOAD WITH PROGRESS
     ========================= */
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
    if (namesLine.length > MAX_CHARS) namesLine = namesLine.slice(0, MAX_CHARS - 1) + '…';
    var more = uploaded.length - shown.length;

    var compact = [];
    compact.push('Uploaded ' + uploaded.length + ' file(s).');
    if (shown.length) compact.push('Files: ' + namesLine + (more > 0 ? ' (+' + more + ' more)' : ''));
    for (var j = 0; j < otherOk.length; j++) compact.push(otherOk[j]);
    return compact;
  }

  function wireUpload(){
    var form = DOM.upload.form;
    var input = DOM.upload.input;
    var btn = DOM.buttons.uploadBtn;
    var wrap = DOM.upload.wrap;
    var bar = DOM.upload.bar;

    if (!form || !input || !btn || !wrap || !bar) return;

    var maxTotal = Number(BOOT.maxPostBytes || 0);
    var maxPerFile = Number(BOOT.maxFileBytes || 0);
    var maxFiles = Number(BOOT.maxFileUploads || 0);

    function setProgress(pct){
      pct = Math.max(0, Math.min(100, pct));
      wrap.classList.remove('d-none');
      bar.style.width = pct + '%';
      bar.textContent = pct + '%';
    }
    function resetProgress(){
      bar.style.width = '0%';
      bar.textContent = '0%';
      wrap.classList.add('d-none');
    }

    L.on(form, 'submit', function(ev){
      if (!window.XMLHttpRequest || !window.FormData) return;

      ev.preventDefault();

      if (UI.busy) {
        showToast('info', 'Busy', 'Another operation is in progress. Please wait.');
        return;
      }

      if (!input.files || input.files.length === 0) {
        showToast('warning', 'Upload', 'No files selected.');
        return;
      }

      if (maxFiles > 0 && input.files.length > maxFiles) {
        showToast('warning', 'Upload', 'Too many files selected (' + input.files.length + '). Max allowed is ' + maxFiles + '.');
        return;
      }

      var total = 0;
      for (var i = 0; i < input.files.length; i++) {
        var sz = Number(input.files[i].size || 0);
        total += sz;
        if (maxPerFile > 0 && sz > maxPerFile) {
          showToast('warning', 'Upload', 'A file is larger than the per-file limit (' + formatBytes(maxPerFile) + ').');
          return;
        }
      }

      if (maxTotal > 0 && total > maxTotal) {
        showToast('warning', 'Upload', 'Selected files total (' + formatBytes(total) + ') exceeds the server limit (' + formatBytes(maxTotal) + ').');
        return;
      }

      var fd = new FormData(form);

      UI.setBusy(true);
      setProgress(0);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'index.php', true);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

      xhr.upload.onprogress = function(e){
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };

      function finishUpload(){
        UI.setBusy(false);
        refreshStats();
      }

      xhr.onload = function(){
        var data = null;
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e0) {}

        if (xhr.status === 200 && data) {
          var ok = Array.isArray(data.ok) ? data.ok : [];
          var err = Array.isArray(data.err) ? data.err : [];

          ok = summarizeUploadOk(ok);

          var t = classifyToast(ok, err, {
            successTitle: 'Upload completed',
            warnTitle: 'Upload',
            errorTitle: 'Upload',
            infoTitle: 'Upload'
          });
          if (t.msg) showToast(t.kind, t.title, t.msg);

          if (data.stats) applyStats(data.stats);
          else refreshStats();

          clearInputs();
          readInputsIntoQuery();

          input.value = '';
          setProgress(100);
          setTimeout(resetProgress, 600);

          // keep busy until list refresh completes
          runQuery(true, { manageBusy:false }).finally(finishUpload);
        } else {
          showToast('danger', 'Upload', 'Upload failed (server error).');
          setTimeout(resetProgress, 600);
          finishUpload();
        }
      };

      xhr.onerror = function(){
        showToast('danger', 'Upload', 'Upload failed (network error).');
        setTimeout(resetProgress, 600);
        finishUpload();
      };

      xhr.onabort = function(){
        showToast('warning', 'Upload', 'Upload aborted.');
        setTimeout(resetProgress, 600);
        finishUpload();
      };

      xhr.send(fd);
    });
  }

  /* =========================
     SHARE / LINKS
     ========================= */
  async function getShortUrl(filename, mode){
    mode = String(mode || 'make_link');

    var fd = new FormData();
    fd.append('csrf', csrfToken);
    fd.append('action', mode);
    fd.append('name', filename);

    var res = await fetch('link.php', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });

    var data = null;
    try { data = await res.json(); } catch(e) {}

    if (!res.ok) {
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

    var res = await fetch('index.php', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
    });

    var data = null;
    try { data = await res.json(); } catch(e) {}

    if (!res.ok || !data) throw new Error('Unshare failed');
    return data;
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
      if (span) span.textContent = isShared ? (url ? url : 'loading…') : 'File entry not shared';

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

    UI.applyBusyToGrid();
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

    if (__mcUrlInflight[filename]) return __mcUrlInflight[filename];

    __mcUrlInflight[filename] = getShortUrl(filename)
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
      .finally(function(){ delete __mcUrlInflight[filename]; });

    return __mcUrlInflight[filename];
  }

  function ensureVisibleSharedUrls(){
    if (!DOM.grid) return;
    var nodes = DOM.grid.querySelectorAll('.file-card[data-shared="1"]');
    for (var i = 0; i < nodes.length; i++) {
      var card = nodes[i];
      var wrapper = card.closest('[data-file-card]');
      if (!wrapper) continue;

      var key = String(wrapper.getAttribute('data-file-card') || '');
      var fn = decName(key);
      if (!fn) continue;

      var url = String(card.getAttribute('data-url') || '');
      if (!url && !__mcUrlInflight[fn]) ensureUrlForFile(fn);
    }
  }

  async function onLinkPillClick(pill){
    if (UI.busy) {
      showToast('info', 'Busy', 'Another operation is in progress. Please wait.');
      return;
    }

    var key = String(pill.getAttribute('data-f') || '');
    var fn = decName(key);
    if (!fn) return;

    var f = null;
    for (var i = 0; i < pageState.files.length; i++) {
      if (pageState.files[i] && String(pageState.files[i].name || '') === fn) { f = pageState.files[i]; break; }
    }
    if (!f || !f.shared) return;

    replaceSearchToastForAction();

    var url = String(f.url || '');
    if (!url) url = await ensureUrlForFile(fn) || '';
    if (!url) {
      showToast('danger', 'Shared link', 'Could not load shared link.');
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      showToast('success', 'Shared link', 'Shared link copied.');
    } catch (e) {
      showToast('danger', 'Shared link', 'Clipboard copy failed.');
    }
  }

  async function toggleShareByFilename(file){
    if (UI.busy) { showToast('info', 'Busy', 'Another operation is in progress. Please wait.'); return; }
    file = String(file || '');
    if (!file) return;

    replaceSearchToastForAction();

    var f = null;
    for (var i = 0; i < pageState.files.length; i++) {
      if (pageState.files[i] && String(pageState.files[i].name || '') === file) { f = pageState.files[i]; break; }
    }
    var isShared = !!(f && f.shared);

    if (!isShared) {
      try {
        UI.setBusy(true);
        var url = await getShortUrl(file, 'make_link');
        patchVisibleCard(file, true, url);
        await navigator.clipboard.writeText(url);
        showToast('success', 'Shared link', 'Shared link copied.');
        readInputsIntoQuery();
        if (query.flags === 'shared') await runQuery(true, { manageBusy:false });
      } catch (e) {
        showToast('danger', 'Shared link', (e && e.message) ? e.message : 'Failed to create/copy link.');
      } finally {
        UI.setBusy(false);
      }
      return;
    }

    try {
      UI.setBusy(true);
      var resp = await unshareOnServer(file);

      var okMsgs = (resp && Array.isArray(resp.ok)) ? resp.ok : [];
      var errMsgs = (resp && Array.isArray(resp.err)) ? resp.err : [];

      patchVisibleCard(file, false, '');

      var t = classifyToast(okMsgs, errMsgs, {
        successTitle: 'Shared link',
        warnTitle: 'Shared link',
        errorTitle: 'Shared link'
      });
      if (t.msg) showToast(t.kind, t.title, t.msg);

      if (resp && resp.stats) applyStats(resp.stats);
      else refreshStats();

      readInputsIntoQuery();
      await runQuery(true, { manageBusy:false });

    } catch (e2) {
      showToast('danger', 'Shared link', 'Shared link delete failed.');
    } finally {
      UI.setBusy(false);
    }
  }

  async function downloadByFilename(file){
    if (UI.busy) { showToast('info', 'Busy', 'Another operation is in progress. Please wait.'); return; }
    file = String(file || '');
    if (!file) return;

    replaceSearchToastForAction();

    try {
      UI.setBusy(true);
      var url = await getShortUrl(file, 'get_direct');
      showToast('success', 'Download', 'Download started.');
      startDownloadNoNav(url);
    } catch (e) {
      showToast('danger', 'Download', (e && e.message) ? e.message : 'Failed to start download.');
    } finally {
      UI.setBusy(false);
    }
  }

  /* =========================
     DELEGATED FILE ACTIONS (NO onclick)
     ========================= */
  function wireDelegatedFileActions(){
    if (!DOM.grid) return;

    L.on(DOM.grid, 'click', function(ev){
      var t = ev.target;
      if (!(t instanceof Element)) return;

      var shareBtn = t.closest('[data-share-btn]');
      if (shareBtn && DOM.grid.contains(shareBtn)) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleShareByFilename(decName(shareBtn.getAttribute('data-f') || ''));
        return;
      }

      var dlBtn = t.closest('[data-download-btn]');
      if (dlBtn && DOM.grid.contains(dlBtn)) {
        ev.preventDefault();
        ev.stopPropagation();
        downloadByFilename(decName(dlBtn.getAttribute('data-f') || ''));
        return;
      }

      var pill = t.closest('[data-link-pill]');
      if (pill && DOM.grid.contains(pill)) {
        ev.preventDefault();
        ev.stopPropagation();
        onLinkPillClick(pill);
        return;
      }
    }, true);

    L.on(DOM.grid, 'keydown', function(ev){
      var t = ev.target;
      if (!(t instanceof Element)) return;

      var pill = t.closest('[data-link-pill]');
      if (!pill || !DOM.grid.contains(pill)) return;

      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        onLinkPillClick(pill);
      }
    }, true);
  }

  /* =========================
     INIT
     ========================= */
  function initFlash(){
    var ok = Array.isArray(BOOT.flashOk) ? BOOT.flashOk : [];
    var err = Array.isArray(BOOT.flashErr) ? BOOT.flashErr : [];
    if (!ok.length && !err.length) return;

    var t = classifyToast(ok, err, { successTitle:'Success', warnTitle:'Warning', errorTitle:'Error' });
    if (t.msg) showToast(t.kind, t.title, t.msg);
  }

  function initSearch(){
    function debounce(fn, ms){
      var t;
      return function(){
        clearTimeout(t);
        t = setTimeout(fn, ms);
      };
    }

    var onType = debounce(function(){
      if (UI.busy) return;
      readInputsIntoQuery();
      runQuery(true);
    }, 160);

    if (DOM.search.q) L.on(DOM.search.q, 'input', onType);

    if (DOM.search.from) {
      L.on(DOM.search.from, 'change', function(){
        if (UI.busy) return;
        readInputsIntoQuery();
        runQuery(true);
      });
    }

    if (DOM.search.to) {
      L.on(DOM.search.to, 'change', function(){
        if (UI.busy) return;
        readInputsIntoQuery();
        runQuery(true);
      });
    }

    // flags dropdown items (data-flag)
    L.on(document, 'click', function(ev){
      var t = ev.target;
      if (!(t instanceof Element)) return;
      var item = t.closest('[data-flag]');
      if (!item) return;
      var v = String(item.getAttribute('data-flag') || 'all');
      setFlagsUI(v, false);
    });

    if (DOM.buttons.searchClear) {
      L.on(DOM.buttons.searchClear, 'click', function(){
        if (UI.busy) return;
        clearInputs();
        hideSearchResultsToast();
        readInputsIntoQuery();
        runQuery(true);
        if (DOM.search.q) DOM.search.q.focus();
      });
    }

    // Show more: uniform safe behavior (resolve null on failure, no unhandled rejection)
    if (DOM.buttons.showMore) {
      L.on(DOM.buttons.showMore, 'click', function(){
        if (UI.busy) return;
        pageState.offset = pageState.files.length;

        UI.setBusy(true);
        fetchListSafe(pageState.offset, true, 'Index', 'Could not load more items.')
          .finally(function(){ UI.setBusy(false); });
      });
    }

    setFlagsUI('all', true);
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
      syncInfoModalFromUI();
    });
  }

  function initInitialPaint(){
    // ensure delete-all policy is correct even before stats refresh completes
    UI.setDeleteAllHasFiles(pageState.total > 0);

    updateCounts(pageState.files.length, pageState.total);

    // best-effort hasMore on boot (server still authoritative after first ajax list)
    var hasMoreBoot = (pageState.total > pageState.files.length);
    renderFiles(pageState.files, pageState.total, splitTerms(''), hasMoreBoot);

    ensureVisibleSharedUrls();
  }

  // teardown on navigation
  L.on(window, 'pagehide', function(){
    try { hideSearchResultsToast(); } catch (e0) {}
    try { hideMainToast(); } catch (e1) {}
    L.dispose();
  });

  // boot
  initFlash();
  initInitialPaint();
  initSearch();
  wireAjaxForms();
  wireUpload();
  wireDelegatedFileActions();
  initBackToTop();
  initInfoModal();
  refreshStats();
})();