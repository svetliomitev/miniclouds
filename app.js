/* MiniCloudS app.js
   Assumes window.MC_BOOT exists (set by index.php).
*/
(function(){
  'use strict';

  /* =========================
     BOOT
     ========================= */
  var BOOT = (function(){
    try {
      var el = document.getElementById('mc-boot');
      if (!el) return {};
      var txt = String(el.textContent || '').trim();
      if (!txt) return {};
      var data = JSON.parse(txt);
      return (data && typeof data === 'object') ? data : {};
    } catch (e) {
      return {};
    }
  })();

  var PAGE_SIZE = Number(BOOT.pageSize || 20);
  var csrfToken = String(BOOT.csrf || '');

  /* =========================
     CSP-SAFE PROGRESS WIDTH
     ========================= */
  // Sets progress width via CSS class mc-w-0..mc-w-100 (no inline style => CSP-safe)
  function setPctClass(el, pct){
    if (!el) return;
    pct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));

    // remove any previous mc-w-* class
    var parts = String(el.className || '').split(/\s+/);
    var kept = [];
    for (var i = 0; i < parts.length; i++){
      var c = parts[i];
      if (!c) continue;
      if (c.indexOf('mc-w-') === 0) continue;
      kept.push(c);
    }
    kept.push('mc-w-' + pct);
    el.className = kept.join(' ').trim();
  }

  /* =========================
     LIFECYCLE (single place for listeners)
     ========================= */
  var L = (function(){
    var items = [];

    function on(target, type, handler, options){
      if (!target || !target.addEventListener) return handler;
      target.addEventListener(type, handler, options);
      items.push({ target: target, type: type, handler: handler, options: options });
      return handler;
    }

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
      rebuildIndex: document.getElementById('rebuildIndexBtn'),
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
    infoModal: document.getElementById('mcInfoModal'),

    indexChangedModal: document.getElementById('mcIndexChangedModal'),
    rebuildModal: document.getElementById('mcRebuildModal'),
    rebuildStatusText: document.getElementById('mcRebuildStatusText')
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

  // IMPORTANT: stable attribute representation for filenames
  function encName(name){
    try { return encodeURIComponent(String(name || '')); } catch (e) { return ''; }
  }
  function decName(s){
    try { return decodeURIComponent(String(s || '')); } catch (e) { return String(s || ''); }
  }

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

    var filesNow = DOM.counts && DOM.counts.total1 ? DOM.counts.total1.textContent : '';
    var sizeNow  = DOM.footerTotal ? DOM.footerTotal.textContent : '';

    if (infoFiles && filesNow) infoFiles.textContent = String(filesNow).trim();
    if (infoSize && sizeNow) infoSize.textContent = String(sizeNow).trim();
  }

  /* =========================
     MODALS (centralized + safe cleanup)
     ========================= */
  function mcModalCleanup(){
    var backs = document.querySelectorAll('.modal-backdrop');
    for (var i = 0; i < backs.length; i++){
      try { backs[i].parentNode.removeChild(backs[i]); } catch (e) {}
    }

    var anyShown = document.querySelector('.modal.show');
    if (!anyShown) {
      document.body.classList.remove('modal-open');
      try { document.body.style.removeProperty('overflow'); } catch (e2) {}
      try { document.body.style.removeProperty('paddingRight'); } catch (e3) {}
    }
  }

  function modalShow(el){
    if (!el || !window.bootstrap) return;
    mcModalCleanup();
    try {
      var m = bootstrap.Modal.getOrCreateInstance(el, { backdrop:'static', keyboard:false });
      m.show();
    } catch (e) {}
  }

  function modalHide(el){
    if (el && window.bootstrap) {
      try {
        var inst = bootstrap.Modal.getInstance(el) || bootstrap.Modal.getOrCreateInstance(el);
        inst.hide();
      } catch (e) {}
    }
    if (el) {
      el.classList.remove('show');
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('aria-modal');
      el.removeAttribute('role');
    }
    mcModalCleanup();
  }

  /* =========================
     HARD LOCK (index drift)
     ========================= */
  var HardLock = (function(){
    var shown = false;
    var hard = false;

    function show(){
      if (shown) return;
      if (!DOM.indexChangedModal) return;
      shown = true;
      hard = true;
      modalShow(DOM.indexChangedModal);
    }

    function clear(){
      if (!hard && !shown) return;
      hard = false;
      shown = false;
      modalHide(DOM.indexChangedModal);
    }

    function isHard(){ return !!hard; }

    return { show: show, clear: clear, isHard: isHard };
  })();

  /* =========================
    TOASTS (single owner)
    ========================= */
  var Toast = (function(){
    var mainTimer = 0;
    var searchTimer = 0;
    var suppressSearchUntil = 0;

    // lifecycle scopes (so we never leak handlers / never collide)
    var mainScope = null;

    function toastIconClassFor(kind){
      switch (kind) {
        case 'success': return 'bi bi-check-circle-fill';
        case 'danger':  return 'bi bi-x-circle-fill';
        case 'warning': return 'bi bi-exclamation-triangle-fill';
        case 'info':    return 'bi bi-info-circle-fill';
        default:        return 'bi bi-dot';
      }
    }

    function hideMain(){
      if (mainTimer) { clearTimeout(mainTimer); mainTimer = 0; }

      // dispose any handlers belonging to the currently shown main toast
      if (mainScope) {
        try { mainScope.dispose(); } catch (e0) {}
        mainScope = null;
      }

      if (DOM.toast && DOM.toast.close) DOM.toast.close.disabled = false;
      if (DOM.toast && DOM.toast.el) forceHide(DOM.toast.el);
    }

    function hideSearch(){
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0; }

      var st = DOM.searchToast;
      if (st.scope) {
        try { st.scope.dispose(); } catch (e0) {}
        st.scope = null;
      }
      st.keyLast = null;
      if (st.el) forceHide(st.el);
    }

    // “Last action wins”: any action toast kills search toast immediately.
    function priorityAction(){
      hideSearch();
      suppressSearchUntil = Date.now() + 2200;
    }

    function canShowSearch(isAppend){
      if (isAppend) return true; // append toast is user-driven; always allowed
      return !(suppressSearchUntil && Date.now() < suppressSearchUntil);
    }

    function show(kind, title, msg, opts){
      opts = opts || {};
      priorityAction(); // action toast always wins

      var t = DOM.toast;
      if (!t || !t.el) return;

      // hard reset previous main toast + its handlers
      hideMain();

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

      // close button policy
      var closable = !opts.noClose;

      if (t.close) {
        // Keep spacing: hide visually but preserve layout when not closable
        if (!closable) t.close.classList.add('invisible');
        else t.close.classList.remove('invisible');

        t.close.disabled = !closable;
      }

      // attach close handler ONLY for this toast instance (lifecycle-safe)
      if (closable && t.close) {
        mainScope = L.scope();
        mainScope.on(t.close, 'click', function(ev){
          ev.preventDefault();
          ev.stopPropagation();
          hideMain();
        });
      } else {
        mainScope = null;
      }

      forceShow(t.el);
      t.el.classList.add('show');

      if (!opts.sticky) {
        mainTimer = setTimeout(function(){
          mainTimer = 0;
          hideMain();
        }, Number(opts.ttl || 2000));
      }
    }

    // Sticky “working” (Delete All)
    function workingWarning(title, msg){
      priorityAction();
      show('warning', title || 'Working…', msg || '', { sticky:true, noClose:true });
      // spinner icon
      if (DOM.toast && DOM.toast.icon) DOM.toast.icon.className = 'bi bi-arrow-repeat mc-spin';
    }

    function showResults(shownCount, totalCount, filterKey, opts){
      opts = opts || {};
      var isAppend = !!opts.append;

      var st = DOM.searchToast;
      if (!st || !st.el) return;

      // Append toast replaces main toast (explicit user action: Show more)
      if (isAppend) hideMain();

      if (!canShowSearch(isAppend)) return;

      if (!isAppend && filterKey === st.keyLast) return;
      st.keyLast = filterKey;

      if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0; }
      if (st.scope) {
        try { st.scope.dispose(); } catch (e0) {}
        st.scope = null;
      }

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

      function hide(){ hideSearch(); }

      function scrollToResultsAndHide(){
        var target = DOM.filesSection;
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior:'smooth', block:'start' });
        hide();
      }

      st.scope.on(st.el, 'click', function(){
        if (isAppend) hide();
        else scrollToResultsAndHide();
      });

      if (st.close) {
        st.scope.on(st.close, 'click', function(ev){
          ev.preventDefault();
          ev.stopPropagation();
          hide();
        });
      }

      forceShow(st.el);
      st.el.classList.add('show');

      if (isAppend) {
        searchTimer = setTimeout(function(){
          searchTimer = 0;
          hide();
        }, Number(opts.ttl || 2000));
      }
    }

    function hideAll(){
      hideSearch();
      hideMain();
    }

    return {
      show: show,
      workingWarning: workingWarning,
      showResults: showResults,
      hideAll: hideAll,
      hideMain: hideMain,
      hideSearch: hideSearch,
      priorityAction: priorityAction
    };
  })();

  /* =========================
     ROW BUSY (single owner)
     ========================= */
  var RowBusy = (function(){
    var map = Object.create(null);

    function set(filename, busy){
      filename = String(filename || '');
      if (!filename) return;

      if (busy) map[filename] = 1;
      else delete map[filename];

      if (!DOM.grid) return;
      var key = encName(filename);
      var wrapper = DOM.grid.querySelector('[data-file-card="' + cssEscape(key) + '"]');
      if (!wrapper) return;

      var controls = wrapper.querySelectorAll('[data-share-btn],[data-download-btn],form.js-ajax button[type="submit"]');
      for (var i = 0; i < controls.length; i++){
        controls[i].disabled = !!busy;
        controls[i].setAttribute('aria-disabled', busy ? 'true' : 'false');
      }
    }

    function isBusy(filename){
      filename = String(filename || '');
      return !!(map && map[filename]);
    }

    function reapplyAll(){
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k)) set(k, true);
      }
    }

    return { set: set, isBusy: isBusy, reapplyAll: reapplyAll };
  })();

  /* =========================
     UI POLICY (single source of truth)
     ========================= */
  var UI = (function(){
    var busy = false;
    var deleteAllHasFiles = (Number(BOOT.totalFiles || 0) > 0);

    function applyButtons(){
      var hard = HardLock.isHard();

      // Rebuild is allowed even when hard-locked (but not when busy)
      setEnabled(DOM.buttons.rebuildIndex, !busy);

      setEnabled(DOM.buttons.reinstall, (!busy && !hard));
      setEnabled(DOM.buttons.deleteAll, (!busy && !hard && !!deleteAllHasFiles));
      setEnabled(DOM.buttons.showMore, (!busy && !hard));
      setEnabled(DOM.buttons.searchClear, (!busy && !hard));
      setEnabled(DOM.buttons.flagsDropdownBtn, (!busy && !hard));
      setEnabled(DOM.buttons.uploadBtn, (!busy && !hard));

      if (DOM.upload.input) DOM.upload.input.disabled = (busy || hard);

      // Search controls: do NOT disable q (caret glitches)
      if (DOM.search.q) DOM.search.q.disabled = false;
      if (DOM.search.from) DOM.search.from.disabled = (busy || hard);
      if (DOM.search.to) DOM.search.to.disabled = (busy || hard);
    }

    function applyGridPolicy(){
      if (!DOM.grid) return;
      var hard = HardLock.isHard();
      var nodes = DOM.grid.querySelectorAll('button, input, select, textarea');
      for (var i = 0; i < nodes.length; i++) nodes[i].disabled = (busy || hard);
      // then re-apply row locks
      RowBusy.reapplyAll();
    }

    function setBusy(v){
      busy = !!v;
      applyButtons();
      applyGridPolicy();
    }

    function setDeleteAllHasFiles(v){
      deleteAllHasFiles = !!v;
      applyButtons();
    }

    function getBusy(){ return !!busy; }

    return {
      setBusy: setBusy,
      getBusy: getBusy,
      setDeleteAllHasFiles: setDeleteAllHasFiles,
      applyButtons: applyButtons,
      applyGridPolicy: applyGridPolicy
    };
  })();

  /* =========================
     STATE
     ========================= */
  var query = { q:'', from:'', to:'', flags:'all' };

  var bootFiles = Array.isArray(BOOT.filesPage) ? BOOT.filesPage : [];

  var pageState = {
    offset: bootFiles.length,
    total: Number(BOOT.totalFiles || 0),
    files: bootFiles
  };

  var __mcUrlInflight = Object.create(null);
  var __mcNavigating = false;

  var __mcListReqSeq = 0;
  var __mcListAbortCtl = null;
  var __mcListSilent = 0;
  var __mcListNoAbort = 0;

  var __mcBaseHref = (function(){
    try { return new URL('index.php', window.location.href).toString(); } catch (e) { return 'index.php'; }
  })();

  function queryKey(){
    return 'q=' + (query.q||'') + '|from=' + (query.from||'') + '|to=' + (query.to||'') + '|flags=' + (query.flags||'all');
  }

  /* =========================
     STATS
     ========================= */
  function updateCounts(shown, total){
    shown = Number(shown || 0);
    total = Number(total || 0);
    if (DOM.counts.shown1) DOM.counts.shown1.textContent = String(shown);
    if (DOM.counts.total1) DOM.counts.total1.textContent = String(total);
    if (DOM.counts.shown2) DOM.counts.shown2.textContent = String(shown);
    if (DOM.counts.total2) DOM.counts.total2.textContent = String(total);
  }

  function applyStats(stats){
    if (!stats) return;

    var changed = (Number(stats.index_changed || 0) === 1);
    var known   = (Number(stats.index_changed_known || 0) === 1);

    if (changed && known) {
      HardLock.show();
      UI.setBusy(UI.getBusy()); // re-apply policy
    } else {
      // server is clean => unlock if we were locked
      if (HardLock.isHard()) {
        HardLock.clear();
        UI.setBusy(UI.getBusy());
      }
    }

    if (stats.total_human && DOM.footerTotal) DOM.footerTotal.textContent = String(stats.total_human);

    var totalAll = Number(stats.total_files || 0);
    UI.setDeleteAllHasFiles(totalAll > 0);

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
                ' data-share-btn>' + shareLabel + '</button>' +

              '<button class="btn btn-outline-primary btn-sm" type="button"' +
                ' data-f="' + escapeHtml(key) + '"' +
                ' data-download-btn>Download</button>' +

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

    // re-apply policies after render (single owner)
    UI.applyGridPolicy();

    ensureVisibleSharedUrls();

    if (DOM.showMoreWrap && DOM.buttons.showMore && DOM.showMoreHint) {
      if (hasMore) {
        DOM.showMoreWrap.classList.remove('d-none');
        DOM.showMoreHint.textContent = 'Showing ' + arr.length + ' of ' + totalMatches + ' match(es).';
      } else {
        DOM.showMoreWrap.classList.add('d-none');
        DOM.showMoreHint.textContent = '';
      }
      UI.applyButtons();
    }
  }

  /* =========================
     SEARCH UI
     ========================= */
  function setFlagsUI(value, silent){
    value = String(value || 'all');
    if (!DOM.search.flagsBtn || !DOM.search.flagsLabel) return;

    var prev = String(DOM.search.flagsBtn.getAttribute('data-value') || 'all');

    DOM.search.flagsBtn.setAttribute('data-value', value);
    DOM.search.flagsLabel.textContent = (value === 'shared') ? 'Shared only' : 'All files';

    if (silent) return;
    if (prev === value) return;

    if (HardLock.isHard()) return;
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
     LIST FETCH (centralized)
     ========================= */
  function getVisibleCountNow(){
    if (DOM.grid) {
      var cards = DOM.grid.querySelectorAll('[data-file-card]');
      if (cards && cards.length) return cards.length;
    }
    return (pageState && Array.isArray(pageState.files)) ? pageState.files.length : PAGE_SIZE;
  }

  function indexExistingUrlsByName(){
    var map = Object.create(null);
    for (var i = 0; i < pageState.files.length; i++) {
      var it = pageState.files[i];
      if (!it) continue;
      var n = String(it.name || '');
      if (!n) continue;
      if (it.shared && it.url) map[n] = String(it.url);
    }
    return map;
  }

  function indexVisibleUrlsFromDom(){
    var map = Object.create(null);
    if (!DOM.grid) return map;

    var cards = DOM.grid.querySelectorAll('.file-card[data-shared="1"]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var wrapper = card.closest('[data-file-card]');
      if (!wrapper) continue;

      var key = String(wrapper.getAttribute('data-file-card') || '');
      var fn = decName(key);
      if (!fn) continue;

      var u = String(card.getAttribute('data-url') || '').trim();
      if (!u) {
        var span = wrapper.querySelector('[data-link-text]');
        if (span) u = String(span.textContent || '').trim();
        if (u === 'loading…') u = '';
      }

      if (u) map[fn] = u;
    }
    return map;
  }

  function fetchList(offset, append){
    offset = Number(offset || 0);
    append = !!append;

    var reqOffset = offset;
    var reqAppend = append;
    var reqId = ++__mcListReqSeq;

    if (!__mcListNoAbort) {
      if (__mcListAbortCtl) { try { __mcListAbortCtl.abort(); } catch (e0) {} }
    }
    __mcListAbortCtl = (window.AbortController ? new AbortController() : null);

    var url;
    try { url = new URL(__mcBaseHref); }
    catch (e1) { url = new URL('index.php', window.location.href); }

    url.searchParams.set('ajax', 'list');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(PAGE_SIZE));
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

      var oldUrlMap = indexExistingUrlsByName();
      var domUrlMap = indexVisibleUrlsFromDom();
      for (var k0 in domUrlMap) {
        if (Object.prototype.hasOwnProperty.call(domUrlMap, k0)) oldUrlMap[k0] = domUrlMap[k0];
      }

      if (reqAppend) pageState.files = pageState.files.concat(r.data.files);
      else pageState.files = r.data.files;

      var returned = r.data.files.length;
      pageState.offset = reqOffset + returned;

      for (var k = 0; k < pageState.files.length; k++) {
        var row = pageState.files[k];
        if (!row) continue;
        var nm = String(row.name || '');
        if (!nm) continue;
        if (row.shared && (!row.url || String(row.url) === '') && oldUrlMap[nm]) row.url = oldUrlMap[nm];
      }

      if (!__mcListSilent) {
        var terms = splitTerms(query.q || '');
        updateCounts(pageState.files.length, pageState.total);

        var returnedNow = (r.data && Array.isArray(r.data.files)) ? r.data.files.length : 0;

        if (reqAppend && returnedNow > 0 && pageState.total > 0) {
          Toast.showResults(
            pageState.files.length,
            pageState.total,
            queryKey() + '|append|shown=' + pageState.files.length + '|total=' + pageState.total,
            { append:true, ttl:2000 }
          );
        } else {
          var hasFilter = ((query.q && query.q.trim()) || query.from || query.to || (query.flags && query.flags !== 'all'));
          if (hasFilter) {
            if (pageState.total > 0) {
              Toast.showResults(
                pageState.files.length,
                pageState.total,
                queryKey() + '|n=' + pageState.total + '|shown=' + pageState.files.length,
                { append:false, ttl:2000 }
              );
            } else {
              Toast.hideSearch();
            }
          } else {
            Toast.hideSearch();
          }
        }

        var hm = r.data.has_more;
        var hasMore = (hm === true) || (hm === 1) || (hm === '1');
        renderFiles(pageState.files, pageState.total, terms, hasMore);
      }

      return r.data;
    })
    .catch(function(e){
      if (e && (e.name === 'AbortError' || e.code === 20)) return { ignored:true };
      if (e && typeof e === 'object' && e.reqId == null) e.reqId = reqId;
      throw e;
    });
  }

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
          Toast.show('warning', toastTitle || 'Index', toastMsg || 'Could not load list (network/server error).');
        }
        return null;
      });
  }

  function refreshToDesiredCount(toastTitle, toastMsg){
    var desired = Math.max(PAGE_SIZE, Number(getVisibleCountNow() || 0));

    __mcListSilent++;
    __mcListNoAbort++;

    var next = 0;
    var lastHasMore = false;

    pageState.files = [];
    pageState.offset = 0;

    function loop(){
      return fetchListSafe(next, next > 0, toastTitle || 'Index', toastMsg || 'Could not refresh list (network/server error).')
        .then(function(resp){
          if (!resp) return null;

          next = Number(pageState.offset || 0);

          var hm = resp.has_more;
          lastHasMore = (hm === true) || (hm === 1) || (hm === '1');

          if (pageState.files.length >= desired) return null;
          if (pageState.files.length >= Number(pageState.total || 0)) return null;
          if (!lastHasMore) return null;

          return loop();
        });
    }

    return loop()
      .finally(function(){
        __mcListSilent = Math.max(0, __mcListSilent - 1);
        __mcListNoAbort = Math.max(0, __mcListNoAbort - 1);
      })
      .then(function(){
        var terms = splitTerms(query.q || '');
        updateCounts(pageState.files.length, pageState.total);

        var hasFilter = ((query.q && query.q.trim()) || query.from || query.to || (query.flags && query.flags !== 'all'));
        if (hasFilter) {
          if (pageState.total > 0) {
            Toast.showResults(
              pageState.files.length,
              pageState.total,
              queryKey() + '|n=' + pageState.total + '|shown=' + pageState.files.length,
              { append:false, ttl:2000 }
            );
          } else {
            Toast.hideSearch();
          }
        } else {
          Toast.hideSearch();
        }

        renderFiles(pageState.files, pageState.total, terms, !!lastHasMore);
        return null;
      });
  }

  function runQuery(reset){
    reset = !!reset;
    if (HardLock.isHard()) return Promise.resolve(null);

    if (reset) {
      if (DOM.showMoreWrap) DOM.showMoreWrap.classList.add('d-none');
      if (DOM.showMoreHint) DOM.showMoreHint.textContent = '';
      pageState.offset = 0;
      pageState.files = [];
    }

    return fetchListSafe(pageState.offset, !reset, 'Index', 'Could not load list (network/server error).');
  }

  /* =========================
     ACTIONS (server calls)
     ========================= */
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

  function postJson(url, fd){
    return fetch(url, {
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
    });
  }

  /* =========================
     AJAX FORMS (.js-ajax)  (centralized flow)
     ========================= */
  function wireAjaxForms(){
    function onSubmit(ev){
      var form = ev.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.classList.contains('js-ajax')) return;

      // IMPORTANT: never intercept uploadForm here (upload uses its own XHR+progress)
      if (DOM.upload.form && form === DOM.upload.form) return;

      ev.preventDefault();

      var fdPeek = new FormData(form);
      var actionName = String(fdPeek.get('action') || '');
      var fileName = String(fdPeek.get('name') || '');

      if (HardLock.isHard() && actionName !== 'rebuild_index') {
        HardLock.show();
        return;
      }

      if (actionName === 'delete_one' && fileName && RowBusy.isBusy(fileName)) {
        Toast.show('info', 'Busy', 'This file is already being processed.');
        return;
      }

      var msg = form.getAttribute('data-confirm');
      if (msg && String(msg).trim().length) {
        if (!window.confirm(String(msg))) return;
      }

      // last-action priority
      Toast.priorityAction();

      var isRebuild = (actionName === 'rebuild_index');

      // pre-action UI effects
      if (isRebuild) {
        if (DOM.rebuildStatusText) DOM.rebuildStatusText.textContent = 'Rebuilding indexes…';
        modalShow(DOM.rebuildModal);
        UI.setBusy(true);
      } else if (actionName === 'delete_all') {
        // disable ONLY Delete All and show warning working toast
        setEnabled(DOM.buttons.deleteAll, false);
        Toast.workingWarning('Deleting all', 'Deleting all files...');
      } else if (actionName === 'delete_one' && fileName) {
        RowBusy.set(fileName, true);
      }

      postJson(form.getAttribute('action') || 'index.php', fdPeek)
        .then(function(r){
          if (!r.data) {
            var preview = String(r.txt || '').trim();
            if (preview.length > 220) preview = preview.slice(0, 220) + '…';
            if (r.redirected) Toast.show('danger', 'Error', 'Server redirected instead of returning JSON (AJAX not detected).');
            else Toast.show('danger', 'Error', 'Non-JSON response (' + r.status + '): ' + (preview || 'empty'));
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

          if (t && t.msg) Toast.show(t.kind, t.title, t.msg);
          else Toast.hideMain();

          // STRICT: close rebuild modal early when JSON arrived
          if (isRebuild) {
            try { modalHide(DOM.rebuildModal); } catch (e0) {}
            try { mcModalCleanup(); } catch (e1) {}
            UI.setBusy(false);
          }

          if (r.data && r.data.redirect) {
            var to = String(r.data.redirect || '').trim();
            if (to) {
              __mcNavigating = true;
              Toast.show('warning', 'Reinstall', 'Redirecting to installer...');
              setTimeout(function(){ window.location.href = to; }, 250);
              return null;
            }
          }

          if (r.data && r.data.stats) applyStats(r.data.stats);
          else refreshStats();

          // delete_all is a reset
          if (actionName === 'delete_all') {
            clearInputs();
            readInputsIntoQuery();
            return runQuery(true);
          }

          readInputsIntoQuery();
          return refreshToDesiredCount('Index', 'Could not refresh list (network/server error).');
        })
        .catch(function(){
          if (!__mcNavigating) Toast.show('danger', 'Error', 'Request failed (network error).');
          return null;
        })
        .finally(function(){
          if (__mcNavigating) return;

          if (isRebuild) {
            try { UI.setBusy(false); } catch (e0) {}
            try { modalHide(DOM.rebuildModal); } catch (e1) {}
            try { mcModalCleanup(); } catch (e2) {}
          }

          if (actionName === 'delete_all') {
            UI.applyButtons();
          }

          if (actionName === 'delete_one' && fileName) {
            RowBusy.set(fileName, false);
          }

          mcModalCleanup();
          refreshStats();
        });
    }

    L.on(document, 'submit', onSubmit, true);
  }

  /* =========================
     UPLOAD WITH PROGRESS
     ========================= */
  function setPctClassUpload(el, pct){
    setPctClass(el, pct);
  }

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
      setPctClassUpload(bar, pct);
      bar.textContent = pct + '%';
    }
    function resetProgress(){
      setPctClassUpload(bar, 0);
      bar.textContent = '0%';
      wrap.classList.add('d-none');
    }

    L.on(form, 'submit', function(ev){
      if (!window.XMLHttpRequest || !window.FormData) return;
      ev.preventDefault();

      if (UI.getBusy()) {
        Toast.show('info', 'Busy', 'Another operation is in progress. Please wait.');
        return;
      }
      if (HardLock.isHard()) {
        HardLock.show();
        return;
      }

      if (!input.files || input.files.length === 0) {
        Toast.show('warning', 'Upload', 'No files selected.');
        return;
      }

      if (maxFiles > 0 && input.files.length > maxFiles) {
        Toast.show('warning', 'Upload', 'Too many files selected (' + input.files.length + '). Max allowed is ' + maxFiles + '.');
        return;
      }

      var total = 0;
      for (var i = 0; i < input.files.length; i++) {
        var sz = Number(input.files[i].size || 0);
        total += sz;
        if (maxPerFile > 0 && sz > maxPerFile) {
          Toast.show('warning', 'Upload', 'A file is larger than the per-file limit (' + formatBytes(maxPerFile) + ').');
          return;
        }
      }

      if (maxTotal > 0 && total > maxTotal) {
        Toast.show('warning', 'Upload', 'Selected files total (' + formatBytes(total) + ') exceeds the server limit (' + formatBytes(maxTotal) + ').');
        return;
      }

      Toast.priorityAction();

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
          if (t.msg) Toast.show(t.kind, t.title, t.msg);

          if (data.stats) applyStats(data.stats);
          else refreshStats();

          clearInputs();
          readInputsIntoQuery();

          input.value = '';
          setProgress(100);
          setTimeout(resetProgress, 600);

          runQuery(true).finally(finishUpload);
        } else {
          Toast.show('danger', 'Upload', 'Upload failed (server error).');
          setTimeout(resetProgress, 600);
          finishUpload();
        }
      };

      xhr.onerror = function(){
        Toast.show('danger', 'Upload', 'Upload failed (network error).');
        setTimeout(resetProgress, 600);
        finishUpload();
      };

      xhr.onabort = function(){
        Toast.show('warning', 'Upload', 'Upload aborted.');
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

    UI.applyGridPolicy();
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
    if (HardLock.isHard()) { HardLock.show(); return; }

    var key = String(pill.getAttribute('data-f') || '');
    var fn = decName(key);
    if (!fn) return;

    if (RowBusy.isBusy(fn)) {
      Toast.show('info', 'Busy', 'This file is already being processed.');
      return;
    }

    var f = null;
    for (var i = 0; i < pageState.files.length; i++) {
      if (pageState.files[i] && String(pageState.files[i].name || '') === fn) { f = pageState.files[i]; break; }
    }
    if (!f || !f.shared) return;

    Toast.priorityAction();

    var url = String(f.url || '');
    if (!url) url = await ensureUrlForFile(fn) || '';
    if (!url) {
      Toast.show('danger', 'Shared link', 'Could not load shared link.');
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      Toast.show('success', 'Shared link', 'Shared link copied.');
    } catch (e) {
      Toast.show('danger', 'Shared link', 'Clipboard copy failed.');
    }
  }

  async function toggleShareByFilename(file){
    file = String(file || '');
    if (!file) return;

    if (RowBusy.isBusy(file)) { Toast.show('info', 'Busy', 'This file is already being processed.'); return; }
    if (HardLock.isHard()) { HardLock.show(); return; }

    Toast.priorityAction();

    var f = null;
    for (var i = 0; i < pageState.files.length; i++) {
      if (pageState.files[i] && String(pageState.files[i].name || '') === file) { f = pageState.files[i]; break; }
    }
    var isShared = !!(f && f.shared);

    if (!isShared) {
      try {
        RowBusy.set(file, true);

        var url = await getShortUrl(file, 'make_link');
        patchVisibleCard(file, true, url);

        try {
          await navigator.clipboard.writeText(url);
          Toast.show('success', 'Shared link', 'Shared link copied.');
        } catch (eClip) {
          Toast.show('warning', 'Shared link', 'Link created, but clipboard copy failed.');
        }

        readInputsIntoQuery();
        if (query.flags === 'shared') {
          await refreshToDesiredCount('Index', 'Could not refresh list (network/server error).');
        }
      } catch (e) {
        Toast.show('danger', 'Shared link', (e && e.message) ? e.message : 'Failed to create link.');
      } finally {
        RowBusy.set(file, false);
      }
      return;
    }

    try {
      RowBusy.set(file, true);

      var resp = await unshareOnServer(file);

      var okMsgs = (resp && Array.isArray(resp.ok)) ? resp.ok : [];
      var errMsgs = (resp && Array.isArray(resp.err)) ? resp.err : [];

      patchVisibleCard(file, false, '');

      var t = classifyToast(okMsgs, errMsgs, {
        successTitle: 'Shared link',
        warnTitle: 'Shared link',
        errorTitle: 'Shared link'
      });
      if (t.msg) Toast.show(t.kind, t.title, t.msg);

      if (resp && resp.stats) applyStats(resp.stats);
      else refreshStats();

      readInputsIntoQuery();
      await refreshToDesiredCount('Index', 'Could not refresh list (network/server error).');
    } catch (e2) {
      Toast.show('danger', 'Shared link', 'Shared link delete failed.');
    } finally {
      RowBusy.set(file, false);
    }
  }

  async function downloadByFilename(file){
    file = String(file || '');
    if (!file) return;

    if (RowBusy.isBusy(file)) { Toast.show('info', 'Busy', 'This file is already being processed.'); return; }
    if (HardLock.isHard()) { HardLock.show(); return; }

    Toast.priorityAction();

    try {
      RowBusy.set(file, true);
      var url = await getShortUrl(file, 'get_direct');
      Toast.show('success', 'Download', 'Download started.');
      startDownloadNoNav(url);
    } catch (e) {
      Toast.show('danger', 'Download', (e && e.message) ? e.message : 'Failed to start download.');
    } finally {
      RowBusy.set(file, false);
    }
  }

  /* =========================
     DELEGATED FILE ACTIONS
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
    if (t.msg) Toast.show(t.kind, t.title, t.msg);
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
      if (HardLock.isHard()) return;
      readInputsIntoQuery();
      runQuery(true);
    }, 160);

    if (DOM.search.q) L.on(DOM.search.q, 'input', onType);

    if (DOM.search.from) {
      L.on(DOM.search.from, 'change', function(){
        if (HardLock.isHard()) return;
        readInputsIntoQuery();
        runQuery(true);
      });
    }

    if (DOM.search.to) {
      L.on(DOM.search.to, 'change', function(){
        if (HardLock.isHard()) return;
        readInputsIntoQuery();
        runQuery(true);
      });
    }

    L.on(document, 'click', function(ev){
      var t = ev.target;
      if (!(t instanceof Element)) return;
      var item = t.closest('[data-flag]');
      if (!item) return;
      if (HardLock.isHard()) return;
      var v = String(item.getAttribute('data-flag') || 'all');
      setFlagsUI(v, false);
    });

    if (DOM.buttons.searchClear) {
      L.on(DOM.buttons.searchClear, 'click', function(){
        if (HardLock.isHard()) return;
        clearInputs();
        Toast.hideSearch();
        readInputsIntoQuery();
        runQuery(true);
        // IMPORTANT: do NOT refocus search field after Clear
      });
    }

    if (DOM.buttons.showMore) {
      L.on(DOM.buttons.showMore, 'click', function(){
        if (HardLock.isHard()) return;

        // Disable ONLY Show More while loading
        setEnabled(DOM.buttons.showMore, false);

        var nextOffset = Number(pageState.offset || 0);

        fetchListSafe(nextOffset, true, 'Index', 'Could not load more items.')
          .finally(function(){
            UI.applyButtons(); // restores showMore depending on policy/hasMore rendering
          });
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
    if (Number(BOOT.indexChanged || 0) === 1) HardLock.show();

    UI.setDeleteAllHasFiles(pageState.total > 0);
    UI.setBusy(false);

    updateCounts(pageState.files.length, pageState.total);

    var hasMoreBoot = (pageState.total > pageState.files.length);
    renderFiles(pageState.files, pageState.total, splitTerms(''), hasMoreBoot);

    ensureVisibleSharedUrls();
  }

  /* =========================
     TEARDOWN
     ========================= */
  L.on(window, 'pagehide', function(){
    try { Toast.hideAll(); } catch (e0) {}
    L.dispose();
  });

  /* =========================
     BOOT
     ========================= */
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