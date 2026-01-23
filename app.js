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
  var QUOTA_FILES = Number(BOOT.quotaFiles || 0); // 0 => unlimited (legacy / missing)
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
      checkIndex: document.getElementById('checkIndexBtn'),
      rebuildIndexForm: document.getElementById('rebuildIndexForm'),
      deleteAll: document.getElementById('deleteAllBtn'),
      reinstall: document.getElementById('reinstallBtn'),
      uploadBtn: document.getElementById('uploadBtn'),
      showMore: document.getElementById('showMoreBtn'),
      searchClear: document.getElementById('searchClear'),
      flagsDropdownBtn: document.getElementById('flagsDropdownBtn'),
      storageControl: document.getElementById('storageControlBtn')
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
    indexRebuildNowBtn: document.getElementById('mcRebuildIndexNowBtn'),

    storageModal: document.getElementById('mcStorageModal'),
    storageScanBtn: document.getElementById('mcStorageScanBtn'),
    storageDeleteBtn: document.getElementById('mcStorageDeleteBtn'),
    storageList: document.getElementById('mcStorageList'),
    storageSummary: document.getElementById('mcStorageSummary'),
    storageProgressWrap: document.getElementById('mcStorageProgressWrap'),
    storageProgressBar: document.getElementById('mcStorageProgressBar')
  };

  /* =========================
     SMALL HELPERS
     ========================= */
  function forceHide(el){
    if (!el) return;
    el.classList.remove('show');
    el.classList.remove('showing');

    // CSP-safe: use a class instead of inline style
    el.classList.add('d-none');

    el.setAttribute('aria-hidden', 'true');
  }

  function forceShow(el){
    if (!el) return;

    // CSP-safe: remove class instead of inline style
    el.classList.remove('d-none');

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
        iframe.className = 'd-none';
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

  function syncInfoModalFromTotals(){
    var infoFiles = document.getElementById('mcInfoFilesCount');
    var infoSize  = document.getElementById('mcInfoTotalSize');

    if (infoFiles) infoFiles.textContent = String(Number(Totals.files || 0));
    if (infoSize)  infoSize.textContent  = String(Totals.human || '');
  }

  function applyTotalsUiPolicy(){
    // Delete All availability should follow ALL uploads
    UI.setDeleteAllHasFiles(Number(Totals.files || 0) > 0);

    // Optional: keep the data attribute in sync (used by CSS / hints)
    if (DOM.buttons.deleteAll) {
      if (Number(Totals.files || 0) <= 0) DOM.buttons.deleteAll.setAttribute('data-mc-empty','1');
      else DOM.buttons.deleteAll.removeAttribute('data-mc-empty');
    }

    // Keep info modal totals synced
    syncInfoModalFromTotals();
  }

  /* =========================
     MODALS (centralized + safe cleanup)
     ========================= */
  function mcModalCleanup(){
    // How many modals are currently shown?
    var shown = document.querySelectorAll('.modal.show');
    var shownCount = shown ? shown.length : 0;

    // All backdrops currently in DOM
    var backs = document.querySelectorAll('.modal-backdrop');
    var backCount = backs ? backs.length : 0;

    if (shownCount <= 0) {
      // No modal visible => remove ALL backdrops + clear modal-open
      for (var i = backCount - 1; i >= 0; i--){
        try { backs[i].parentNode.removeChild(backs[i]); } catch (e0) {}
      }
      document.body.classList.remove('modal-open');
      return;
    }

    function preemptOtherModals(exceptEl){
      // Hide any currently shown modal except `exceptEl`.
      var shown = document.querySelectorAll('.modal.show');
      for (var i = 0; i < shown.length; i++){
        var el = shown[i];
        if (!el) continue;
        if (exceptEl && el === exceptEl) continue;

        // Prefer Bootstrap hide (so it cleans up its own state)
        if (window.bootstrap) {
          try {
            var inst = bootstrap.Modal.getInstance(el) || bootstrap.Modal.getOrCreateInstance(el);
            inst.hide();
          } catch (e0) {}
        }

        // Hard fallback: force-hide
        try {
          el.classList.remove('show');
          el.classList.remove('showing');
          el.classList.add('d-none');
          el.setAttribute('aria-hidden', 'true');
        } catch (e1) {}
      }

      // Cleanup duplicates/backdrops after transitions start
      mcModalCleanup();
    }
    
    // At least one modal is visible.
    // Keep EXACTLY one backdrop (Bootstrap expects this), remove extras only.
    if (backCount > 1) {
      for (var j = backCount - 1; j >= 1; j--){
        try { backs[j].parentNode.removeChild(backs[j]); } catch (e1) {}
      }
    }

    // Ensure body has modal-open if anything is shown.
    document.body.classList.add('modal-open');
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
      forceHide(el);
      el.removeAttribute('aria-modal');
      el.removeAttribute('role');
    }
    mcModalCleanup();
  }

  /* =========================
   HARD LOCK (state machine)
   Step 6 (clean cut)
   - Owns: lock state + modal show/hide
   - Exposes: syncFromStats(), isHard(), reason()
   - No direct UI coupling; UI registers an onChange hook
   ========================= */
  var HardLock = (function(){
    var state = {
      active: false,
      reason: null,   // 'drift' | 'missing' | 'forced' | 'unknown'
      source: null    // 'boot' | 'stats' | 'check' | 'action'
    };

    var shown = false; // modal shown?

    var onChange = null;

    function notify(){
      try { if (typeof onChange === 'function') onChange(getState()); } catch (e) {}
    }

    function getState(){
      return {
        active: !!state.active,
        reason: state.reason,
        source: state.source
      };
    }

    function setOnChange(fn){
      onChange = (typeof fn === 'function') ? fn : null;
    }

    function showModal(){
      if (!DOM.indexChangedModal) return;
      if (shown) return;

      // NEW: HardLock is blocking => close any other modal first (Storage, Info, etc.)
      preemptOtherModals(DOM.indexChangedModal);

      shown = true;
      modalShow(DOM.indexChangedModal);
    }

    function hideModal(){
      if (!DOM.indexChangedModal) return;
      if (!shown) return;
      shown = false;
      modalHide(DOM.indexChangedModal);
    }

    function activate(reason, source, opts){
      opts = opts || {};
      var wantShow = (opts.show !== false); // default: show

      state.active = true;
      state.reason = String(reason || 'unknown');
      state.source = String(source || 'unknown');

      if (wantShow) showModal();
      notify();
    }

    function clear(opts){
      opts = opts || {};
      var wantHide = (opts.hide !== false); // default: hide

      state.active = false;
      state.reason = null;
      state.source = null;

      if (wantHide) hideModal();
      notify();
    }

    function deriveReasonFromStats(stats){
      // prioritize explicit forced lock
      if (Number(stats && stats.index_forced || 0) === 1) return 'forced';
      if (Number(stats && stats.index_missing || 0) === 1) return 'missing';
      if (Number(stats && (stats.index_changed || stats.index_must_rebuild) ? 1 : 0) === 1) return 'drift';
      return null;
    }

    // single public entry for stats-driven lock decisions
    function syncFromStats(stats, source, opts){
      opts = opts || {};
      var r = deriveReasonFromStats(stats);

      if (r) {
        activate(r, source || 'stats', opts);
      } else {
        // only clear if we were locked
        if (state.active) clear(opts);
      }
    }

    function isHard(){ return !!state.active; }
    function reason(){ return state.reason; }
    function source(){ return state.source; }

    return {
      // hooks
      setOnChange: setOnChange,

      // transitions
      activate: activate,
      clear: clear,
      syncFromStats: syncFromStats,

      // read
      isHard: isHard,
      reason: reason,
      source: source,
      getState: getState,

      // modal-only (rare; used by CheckIndexFlow finish)
      showModal: showModal,
      hideModal: hideModal
    };
  })();

  /* =========================
    TOASTS (single owner)
    ========================= */
  var Toast = (function(){
    var mainTimer = 0;
    var searchTimer = 0;
    var suppressSearchUntil = 0;

    // timestamps to resolve “action toast vs user-driven search”
    var lastActionAt = 0;
    var lastUserQueryAt = 0;

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
      lastActionAt = Date.now();
      suppressSearchUntil = lastActionAt + 2200;
    }

    function noteUserQuery(){
      lastUserQueryAt = Date.now();
    }

    function canShowSearch(isAppend){
      if (isAppend) return true; // append toast is user-driven; always allowed

      // If an action toast just fired, suppress automatic search toasts,
      // BUT allow them immediately if the user changed query/filters after the action.
      if (suppressSearchUntil && Date.now() < suppressSearchUntil) {
        return (lastUserQueryAt > lastActionAt);
      }
      return true;
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
      show('warning', title || 'Working...', msg || '', { sticky:true, noClose:true });
      // spinner icon
      if (DOM.toast && DOM.toast.icon) DOM.toast.icon.className = 'bi bi-arrow-repeat mc-spin';
    }

    function showResults(shownCount, totalCount, filterKey, opts){
      opts = opts || {};
      var isAppend = !!opts.append;

      var st = DOM.searchToast;
      if (!st || !st.el) return;

      // Append toast replaces main toast (explicit user action: Show more)
      if (isAppend) {
        hideMain();
      } else {
        // If the user initiated a new query after an action toast,
        // let Search Results replace the main toast (e.g. Reset toast).
        if (lastUserQueryAt > lastActionAt) hideMain();
      }

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
      priorityAction: priorityAction,
      noteUserQuery: noteUserQuery
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
    OPERATION RUNNER (single owner)
    Step 1: prevents duplicate inflight operations
    - global ops: upload, rebuild, delete-all, etc.
    - keyed ops: per filename (delete/share/unshare/download)
    ========================= */
  var Op = (function(){
    var globalRunning = false;
    var keyRunning = Object.create(null);

    function runGlobal(fn){
      if (globalRunning) return Promise.resolve(null);
      globalRunning = true;

      return Promise.resolve()
        .then(function(){ return fn(); })
        .finally(function(){ globalRunning = false; });
    }

    function runKey(key, fn){
      key = String(key || '');
      if (!key) return Promise.resolve(null);

      if (keyRunning[key]) return Promise.resolve(null);
      keyRunning[key] = 1;

      return Promise.resolve()
        .then(function(){ return fn(); })
        .finally(function(){ delete keyRunning[key]; });
    }

    function isGlobal(){
      return !!globalRunning;
    }

    function isKey(key){
      key = String(key || '');
      if (!key) return false;
      return !!keyRunning[key];
    }

    return {
      runGlobal: runGlobal,
      runKey: runKey,
      isGlobal: isGlobal,
      isKey: isKey
    };
  })();

  /* =========================
    UI POLICY (single source of truth)
    - Step 2: token/ref-count busy state
    ========================= */
  var UI = (function(){
    // busy tokens
    var busyCount = 0;
    var nextTok = 1;
    var busyTokLive = Object.create(null);

    // legacy bridge (so old setBusy calls still behave predictably)
    var legacyTok = 0;

    var deleteAllHasFiles = (Number(BOOT.totalFiles || 0) > 0);

    function isBusy(){
      return (busyCount > 0);
    }

    function busyAcquire(reason){
      // reason is not used yet, but kept for debugging/future UI
      var tok = nextTok++;
      busyTokLive[tok] = 1;
      busyCount++;
      applyButtons();
      applyGridPolicy();
      return tok;
    }

    function busyRelease(tok){
      tok = Number(tok || 0);
      if (!tok) return;
      if (!busyTokLive[tok]) return;

      delete busyTokLive[tok];
      busyCount = Math.max(0, busyCount - 1);
      applyButtons();
      applyGridPolicy();
    }

    function busyResetAll(){
      busyTokLive = Object.create(null);
      busyCount = 0;
      legacyTok = 0;
      applyButtons();
      applyGridPolicy();
    }

    function applyButtons(){
      var hard = HardLock.isHard();
      var busy = isBusy();

      // Check Index is allowed even when hard-locked (but not when busy)
      setEnabled(DOM.buttons.checkIndex, !busy);

      setEnabled(DOM.buttons.reinstall, (!busy && !hard));
      setEnabled(DOM.buttons.deleteAll, (!busy && !hard && !!deleteAllHasFiles));
      setEnabled(DOM.buttons.showMore, (!busy && !hard));
      setEnabled(DOM.buttons.searchClear, (!busy && !hard));
      setEnabled(DOM.buttons.flagsDropdownBtn, (!busy && !hard));
      setEnabled(DOM.buttons.uploadBtn, (!busy && !hard));
      setEnabled(DOM.buttons.storageControl, (!busy && !hard));

      if (DOM.upload.input) DOM.upload.input.disabled = (busy || hard);

      // Search controls: do NOT disable q (caret glitches)
      if (DOM.search.q) DOM.search.q.disabled = false;
      if (DOM.search.from) DOM.search.from.disabled = (busy || hard);
      if (DOM.search.to) DOM.search.to.disabled = (busy || hard);
    }

    function applyGridPolicy(){
      if (!DOM.grid) return;
      var hard = HardLock.isHard();
      var busy = isBusy();

      var nodes = DOM.grid.querySelectorAll('button, input, select, textarea');
      for (var i = 0; i < nodes.length; i++) nodes[i].disabled = (busy || hard);

      // then re-apply row locks
      RowBusy.reapplyAll();
    }

    // Legacy boolean API (kept for now)
    function setBusy(v){
      v = !!v;
      if (v) {
        if (!legacyTok) legacyTok = busyAcquire('legacy');
      } else {
        if (legacyTok) {
          busyRelease(legacyTok);
          legacyTok = 0;
        }
      }
    }

    function setDeleteAllHasFiles(v){
      deleteAllHasFiles = !!v;
      applyButtons();
    }

    function getBusy(){
      return isBusy();
    }

    return {
      // Step 2 API
      busyAcquire: busyAcquire,
      busyRelease: busyRelease,
      busyResetAll: busyResetAll,

      // Existing API kept
      setBusy: setBusy,
      getBusy: getBusy,
      setDeleteAllHasFiles: setDeleteAllHasFiles,
      applyButtons: applyButtons,
      applyGridPolicy: applyGridPolicy
    };
  })();

  // Step 6: UI reacts to HardLock transitions in one place
  if (HardLock && HardLock.setOnChange) {
    HardLock.setOnChange(function(){
      try { UI.applyButtons(); } catch (e0) {}
      try { UI.applyGridPolicy(); } catch (e1) {}
    });
  }

  /* =========================
    GUARDS (single owner)
    Step 3: centralize "can I run?" checks
    ========================= */
  var Guard = (function(){

    function hardLock(){
      if (HardLock && HardLock.isHard && HardLock.isHard()) {
        if (HardLock.showModal) HardLock.showModal();
        return true;
      }
      return false;
    }

    function busy(){
      if (UI && UI.getBusy && UI.getBusy()) {
        Toast.show('info', 'Busy', 'Another operation is in progress. Please wait.');
        return true;
      }
      return false;
    }

    function rowBusy(filename){
      filename = String(filename || '');
      if (!filename) return false;
      if (RowBusy && RowBusy.isBusy && RowBusy.isBusy(filename)) {
        Toast.show('info', 'Busy', 'This file is already being processed.');
        return true;
      }
      return false;
    }

    // Generic guard: returns true if blocked
    function blockIf(opts){
      opts = opts || {};

      // 1) busy first (keeps UX consistent)
      if (opts.busy) {
        if (busy()) return true;
      }

      // 2) hard-lock (unless explicitly allowed)
      if (opts.hard && !opts.allowHard) {
        if (hardLock()) return true;
      }

      // 3) per-row busy (optional)
      if (opts.row) {
        if (rowBusy(opts.row)) return true;
      }

      return false;
    }

    return {
      hardLock: hardLock,
      busy: busy,
      rowBusy: rowBusy,
      blockIf: blockIf
    };
  })();

  /* =========================
    NET (single owner)
    Step 4: unified fetch + JSON parsing
    ========================= */
  var Net = (function(){
    function withHeaders(h, add){
      h = h || {};
      add = add || {};
      for (var k in add) {
        if (Object.prototype.hasOwnProperty.call(add, k)) h[k] = add[k];
      }
      return h;
    }

    function parseJsonLoose(txt){
      try { return JSON.parse(txt || ''); } catch (e) { return null; }
    }

    // Always returns: { ok, status, redirected, url, txt, data }
    function requestText(url, opts){
      opts = opts || {};
      if (!opts.credentials) opts.credentials = 'same-origin';

      return fetch(url, opts).then(function(res){
        return res.text().then(function(txt){
          var data = parseJsonLoose(txt);
          return {
            ok: !!res.ok,
            status: Number(res.status || 0),
            redirected: !!res.redirected,
            url: String(res.url || ''),
            txt: String(txt || ''),
            data: data
          };
        });
      });
    }

    function getJson(url, opts){
      opts = opts || {};
      opts.method = 'GET';
      opts.headers = withHeaders(opts.headers, { 'Accept': 'application/json' });
      return requestText(url, opts);
    }

    function postForm(url, formData, opts){
      opts = opts || {};
      opts.method = 'POST';
      opts.body = formData;
      opts.headers = withHeaders(opts.headers, {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json'
      });
      return requestText(url, opts);
    }

    // App-level “ok” envelope:
    // - GET endpoints: { ok:true, ... }
    // - POST endpoints: { ok:[...], err:[...], ... }
    function isAppOk(r){
      if (!(r && r.ok && r.data)) return false;

      var okv = r.data.ok;

      // list/stats endpoints
      if (okv === true) return true;

      // POST action endpoints
      if (Array.isArray(okv)) return true;

      return false;
    }

    return {
      requestText: requestText,
      getJson: getJson,
      postForm: postForm,
      isAppOk: isAppOk
    };
  })();

  /* =========================
    STORAGE CONTROL (admin tool)
    - Manual scan + delete (biggest files)
    - Uses Op.runGlobal so scan/delete cannot overlap
    - Uses UI busy tokens so the whole UI obeys busy policy
    ========================= */
  var StorageControl = (function(){
    var lastItems = [];      // [{ name, size, mtime, shared }]
    var selected = Object.create(null); // name => 1
    function resetUi(){
      // Always open clean: no stale scan results, no selection, no progress
      lastItems = [];
      clearSelection();
      resetProgress();

      if (DOM.storageList) DOM.storageList.innerHTML = '';
      if (DOM.storageSummary) DOM.storageSummary.textContent = 'No data.';

      setEnabled(DOM.storageDeleteBtn, false);

      // optional: ensure list is at top
      if (DOM.storageList) DOM.storageList.scrollTop = 0;
    }

    function setProgress(pct){
      pct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      if (DOM.storageProgressWrap) DOM.storageProgressWrap.classList.remove('d-none');
      if (DOM.storageProgressBar) {
        setPctClass(DOM.storageProgressBar, pct);
        DOM.storageProgressBar.textContent = pct + '%';
      }
    }

    function resetProgress(){
      if (DOM.storageProgressBar) {
        setPctClass(DOM.storageProgressBar, 0);
        DOM.storageProgressBar.textContent = '0%';
      }
      if (DOM.storageProgressWrap) DOM.storageProgressWrap.classList.add('d-none');
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

      setEnabled(DOM.storageDeleteBtn, (selectedNames().length > 0) && !UI.getBusy() && !HardLock.isHard());

      RenderLife.after();
    }

    function wireListSelection(){
      if (!DOM.storageList) return;

      // delegated change handler for checkboxes inside the modal
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
      // blocked by hard-lock and busy (uniform)
      if (Guard.blockIf({ busy:true, hard:true })) return Promise.resolve(null);

      return Op.runGlobal(function(){
        // acquire UI busy token so buttons disable uniformly
        var tok = UI.busyAcquire('storage-scan');

        Toast.priorityAction();
        Toast.workingWarning('Storage scan', 'Scanning biggest files...');

        setProgress(10);

        return postStorage('storage_scan', {})
          .then(function(r){
            if (!Net.isAppOk(r)) {
              Toast.show('danger', 'Storage scan', 'Scan failed (server error).');
              return null;
            }

            var env = r.data || {};
            var payload = (env && env.data && typeof env.data === 'object') ? env.data : {};
            var items = Array.isArray(payload.items) ? payload.items : [];

            lastItems = items;
            clearSelection();

            // stats sync (envelope has stats)
            syncStatsFrom(env);

            Toast.show('success', 'Storage scan', 'Scan completed.', { ttl: 1600 });
            setProgress(100);
            setTimeout(resetProgress, 450);

            render();

            // premium: make sure the user sees the top of the fresh results
            if (DOM.storageList) DOM.storageList.scrollTop = 0;

            return payload;
          })
          .catch(function(){
            Toast.show('danger', 'Storage scan', 'Scan failed (network error).');
            return null;
          })
          .finally(function(){
            UI.busyRelease(tok);
            tok = 0;
            resetProgress();
            // keep delete button state correct after busy clears
            render();
          });
      });
    }

    function deleteSelected(){
      if (Guard.blockIf({ busy:true, hard:true })) return Promise.resolve(null);

      var names = selectedNames();
      if (!names.length) return Promise.resolve(null);

      var msg = 'Delete ' + names.length + ' selected file(s)?';
      if (!window.confirm(msg)) return Promise.resolve(null);

      return Op.runGlobal(function(){
        var tok = UI.busyAcquire('storage-delete');

        Toast.priorityAction();
        Toast.workingWarning('Storage delete', 'Deleting selected files...');

        setProgress(10);

        // send as repeated fields (PHP-friendly)
        var fd = new FormData();
        fd.append('csrf', csrfToken);
        fd.append('action', 'storage_delete');
        for (var i = 0; i < names.length; i++) fd.append('names[]', names[i]);

        return Net.postForm(EP.index, fd)
          .then(function(r){
            if (!Net.isAppOk(r)) {
              Toast.show('danger', 'Storage delete', 'Delete failed (server error).');
              return null;
            }

            var env = r.data || {};
            var payload = (env && env.data && typeof env.data === 'object') ? env.data : {};

            // stats sync (envelope has stats)
            syncStatsFrom(env);

            // refresh list to desired count in current query view
            readInputsIntoQuery();

            // After deletion, server returns updated list under data.items
            if (Array.isArray(payload.items)) lastItems = payload.items;
            else lastItems = [];
            clearSelection();
            render();

            Toast.show('success', 'Storage delete', 'Delete completed.', { ttl: 1600 });
            setProgress(100);
            setTimeout(resetProgress, 450);

            return refreshToDesiredCount('Index', 'Could not refresh list (network/server error).');
          })
          .catch(function(){
            Toast.show('danger', 'Storage delete', 'Delete failed (network error).');
            return null;
          })
          .finally(function(){
            UI.busyRelease(tok);
            tok = 0;
            resetProgress();
            render();
          });
      });
    }

    function open(){
      if (!DOM.storageModal) return;

      if (Guard.blockIf({ busy:true, hard:true })) return;

      // Reset happens on modal "show" event (premium UX, always clean)
      modalShow(DOM.storageModal);
    }

    function wire(){
      wireListSelection();
      // Best UX: always reset when the modal is shown (prevents stale results on 2nd open)
      if (DOM.storageModal) {
        L.on(DOM.storageModal, 'show.bs.modal', function(){
          resetUi();
        });
      }

      if (DOM.buttons.storageControl) {
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

      // default disable until selection exists
      setEnabled(DOM.storageDeleteBtn, false);
    }

    return {
      wire: wire,
      open: open,
      scan: scan,
      deleteSelected: deleteSelected
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

  // Always totals for ALL uploaded files (never filtered)
  var Totals = {
    files: Number(BOOT.totalFiles || 0),
    human: (DOM.footerTotal ? String(DOM.footerTotal.textContent || '').trim() : formatBytes(0))
  };

  var __mcUrlInflight = Object.create(null);
  var __mcNavigating = false;

  var __mcListReqSeq = 0;
  var __mcListAbortCtl = null;
  var __mcListSilent = 0;
  var __mcListNoAbort = 0;

  /* =========================
   ENDPOINTS (uniform, base-safe)
   - NEVER call 'index.php' or 'link.php' by string literal in network code.
   - Always use these resolved URLs.
   ========================= */
  var EP = (function(){
    function baseDirUrl(){
      // Stable directory base even when current URL is "/subdir" (no trailing slash)
      // or "/subdir?check=1" etc.
      try {
        var origin = window.location.origin;
        var p = String(window.location.pathname || '/');

        var lastSeg = p.split('/').pop() || '';
        var looksLikeFile = (lastSeg.indexOf('.') !== -1);

        // if "/subdir" treat as directory => "/subdir/"
        if (!p.endsWith('/') && !looksLikeFile) p = p + '/';

        // if file path, strip filename
        if (!p.endsWith('/')) p = p.replace(/\/[^\/]*$/, '/');

        return origin + p;
      } catch (e) {
        return String(document.baseURI || window.location.href || '');
      }
    }

    function abs(rel){
      rel = String(rel || '');
      if (!rel) return '';
      try { return new URL(rel, baseDirUrl()).toString(); }
      catch (e) { return rel; }
    }

    return {
      index: abs('index.php'),
      link:  abs('link.php')
    };
  })();
  
  /* =========================
  CHECK INDEX FLOW (single owner)
  Step 7 (clean cut)
  - Owns the URL flag detection + “checking…” toast + deterministic finish
  - Does NOT decide drift itself (HardLock.syncFromStats already did that in applyStats)
  ========================= */
  var CheckIndexFlow = (function(){
    var pending = false;
    var started = false;
    var deferHard = false;

    function detect(){
      try {
        var u = new URL(window.location.href);
        pending = (u.searchParams.get('check') === '1');
      } catch (e) {
        pending = (String(window.location.search || '').indexOf('check=1') !== -1);
      }
      return pending;
    }

    function clearUrlFlag(){
      try {
        var u = new URL(window.location.href);
        if (!u.searchParams.has('check') && !u.searchParams.has('_')) return;
        u.searchParams.delete('check');
        u.searchParams.delete('_');
        window.history.replaceState(null, '', u.toString());
      } catch (e) {}
    }

    function beginIfNeeded(){
      if (!pending || started) return false;
      started = true;
      deferHard = false;

      Toast.priorityAction();
      Toast.show('warning', 'Check Index', 'Checking index state...', { ttl: 1200, noClose: true });

      // one-shot URL cleanup so refresh / copy-paste URL is clean
      clearUrlFlag();
      return true;
    }

    function isChecking(){
      return !!started;
    }

    function markDeferHard(){
      if (!started) return;
      deferHard = true;
    }

    // stats already applied (applyStats called before this)
    // so we finish based on HardLock + deferHard deterministically
    function finishFromStats(stats){
      if (!started) return;

      Toast.hideMain();

      var hard = (HardLock && HardLock.isHard) ? HardLock.isHard() : false;
      var forced = (Number(stats && stats.index_forced || 0) === 1);

      if (hard || forced || deferHard) {
        if (HardLock && HardLock.showModal) HardLock.showModal();
      } else {
        if (HardLock && HardLock.clear) HardLock.clear({ hide:true });
        Toast.priorityAction();
        Toast.show('success', 'Check Index', 'Index is up to date.', { ttl: 1600 });
      }

      pending = false;
      started = false;
      deferHard = false;

      // NEW: checking is over => allow shared-url hydration to run once
      RenderLife.after();
    }

    function fail(){
      if (!started) return;

      Toast.hideMain();

      // Don’t change HardLock state here; server state is unknown.
      Toast.priorityAction();
      Toast.show('warning', 'Check Index', 'Could not check index state (network/server error).', { ttl: 2200 });

      // one-shot
      pending = false;
      started = false;
      deferHard = false;
      
      // NEW: checking is over => allow shared-url hydration to run once
      RenderLife.after();
    }

    return {
      detect: detect,
      beginIfNeeded: beginIfNeeded,
      isChecking: isChecking,
      markDeferHard: markDeferHard,
      finishFromStats: finishFromStats,
      fail: fail
    };
  })();

  function refreshPageForCheckIndex(){
    try {
      var u = new URL(window.location.href);
      // cache-bust so drift detection is re-evaluated on the server
      u.searchParams.set('check', '1');
      u.searchParams.set('_', String(Date.now()));
      window.location.href = u.toString();
    } catch (e) {
      window.location.reload();
    }
  }

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
    // applyStats() only decides HARD lock vs clear
    // no "known/unknown drift" states are tracked client-side
    if (!stats) return;

    // Step 6: HardLock state machine owns the lock decision.
    // During "Check Index" refresh: do not show modal here (toast must finish first).
    var checking = (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking());
    if (checking) {
      // update lock state but DO NOT show modal yet
      HardLock.syncFromStats(stats, 'check', { show:false, hide:false });

      // if lock is active, remember that we must show it after the checking toast
      if (HardLock.isHard() && CheckIndexFlow && CheckIndexFlow.markDeferHard) {
        CheckIndexFlow.markDeferHard();
      }
    } else {
      // normal path: apply lock state and show/hide modal accordingly
      HardLock.syncFromStats(stats, 'stats', { show:true, hide:true });
    }

    if (stats.total_human && DOM.footerTotal) DOM.footerTotal.textContent = String(stats.total_human);

    // Update "all uploads" totals state (filter-independent)
    if (stats.total_human) Totals.human = String(stats.total_human);
    Totals.files = Number(stats.total_files || 0);

    applyTotalsUiPolicy();
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
        try { applyStats(payloadOrStats.stats); } catch (e0) {}
        return Promise.resolve(payloadOrStats.stats);
      }

      // sometimes we pass stats directly
      var looksLikeStats =
        Object.prototype.hasOwnProperty.call(payloadOrStats, 'total_files') ||
        Object.prototype.hasOwnProperty.call(payloadOrStats, 'total_human') ||
        Object.prototype.hasOwnProperty.call(payloadOrStats, 'index_changed') ||
        Object.prototype.hasOwnProperty.call(payloadOrStats, 'index_must_rebuild') ||
        Object.prototype.hasOwnProperty.call(payloadOrStats, 'index_missing') ||
        Object.prototype.hasOwnProperty.call(payloadOrStats, 'index_forced');

      if (looksLikeStats) {
        try { applyStats(payloadOrStats); } catch (e1) {}
        return Promise.resolve(payloadOrStats);
      }
    }

    return refreshStats();
  }

  function refreshStats(){
    var u;
    try { u = new URL(EP.index); }
    catch (e0) { u = null; }

    var statsUrl = u ? (u.searchParams.set('ajax','stats'), u.toString())
                     : (EP.index + '?ajax=stats');

    return Net.getJson(statsUrl)
      .then(function(r){
        if (!Net.isAppOk(r)) {
          if (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking()) {
            if (CheckIndexFlow.fail) CheckIndexFlow.fail();
          }
          return null;
        }

        syncStatsFrom(r.data);

        if (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking()) {
          var s = (r.data && r.data.stats && typeof r.data.stats === 'object') ? r.data.stats : r.data;
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

  /* =========================
    RENDER LIFECYCLE (single owner)
    Step 5: post-render policy + hydration
    - Any function that mutates the file grid should call RenderLife.after()
    - RenderLife runs once per tick (coalesced)
    ========================= */
  var RenderLife = (function(){
    var scheduled = false;

    function runOnce(){
      scheduled = false;

      // 1) Apply global disable/hardlock + then reapply row locks
      try { UI.applyGridPolicy(); } catch (e0) {}

      // 2) Hydrate any “shared but url missing” pills (best-effort)
      try { ensureVisibleSharedUrls(); } catch (e1) {}

      // 3) Keep info modal totals synced (cheap)
      try { applyTotalsUiPolicy(); } catch (e2) {}
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
  })();

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
      RenderLife.after();
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

      var pillText = isShared ? (url ? escapeHtml(url) : 'loading...') : 'File entry not shared';
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

    if (DOM.showMoreWrap && DOM.buttons.showMore && DOM.showMoreHint) {
      if (hasMore) {
        DOM.showMoreWrap.classList.remove('d-none');
        DOM.showMoreHint.textContent = 'Showing ' + arr.length + ' of ' + totalMatches + ' match(es).';
      } else {
        DOM.showMoreWrap.classList.add('d-none');
        DOM.showMoreHint.textContent = '';
      }
    }
    RenderLife.after();
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
        if (u === 'loading...') u = '';
      }

      if (u) map[fn] = u;
    }
    return map;
  }

  function fetchList(offset, append, preserveUrlMap){
    offset = Number(offset || 0);
    append = !!append;

    var reqOffset = offset;
    var reqAppend = append;
    var reqId = ++__mcListReqSeq;

    // Abort previous in-flight list request unless we're in "no abort" mode
    if (!__mcListNoAbort) {
      if (__mcListAbortCtl) { try { __mcListAbortCtl.abort(); } catch (e0) {} }
      __mcListAbortCtl = (window.AbortController ? new AbortController() : null);
    } else {
      __mcListAbortCtl = null;
    }

    var url;
    try { url = new URL(EP.index); }
    catch (e1) {
      // ultimate fallback: still do not hardcode 'index.php' here
      url = new URL(String(EP.index || ''), String(document.baseURI || window.location.href || ''));
    }

    url.searchParams.set('ajax', 'list');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (query.q) url.searchParams.set('q', query.q);
    if (query.from) url.searchParams.set('from', query.from);
    if (query.to) url.searchParams.set('to', query.to);
    url.searchParams.set('flags', query.flags || 'all');

    return Net.getJson(url.toString(), {
      signal: __mcListAbortCtl ? __mcListAbortCtl.signal : undefined
    })
    .then(function(r0){
      // normalize to the old internal shape used below
      var r = {
        ok: r0.ok,
        status: r0.status,
        data: r0.data,
        reqId: reqId,
        raw: r0.txt
      };

      if (r.reqId !== __mcListReqSeq) return { ignored: true };

      if (!r.ok || !r.data || r.data.ok !== true || !Array.isArray(r.data.files)) {
        var err = new Error('bad list');
        err.reqId = r.reqId;
        err.status = r.status;
        err.raw = r.raw;
        throw err;
      }

      pageState.total = Number(r.data.total || 0);

      // URL preservation priority:
      // 1) explicit preserveUrlMap (e.g., refreshToDesiredCount snapshot)
      // 2) current in-memory pageState (normal path)
      // 3) DOM (best-effort)
      var oldUrlMap = (preserveUrlMap && typeof preserveUrlMap === 'object') ? preserveUrlMap : indexExistingUrlsByName();

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

  function fetchListSafe(offset, append, toastTitle, toastMsg, preserveUrlMap){
    return fetchList(offset, append, preserveUrlMap)
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

    // Snapshot shared URLs BEFORE we wipe pageState/files (priority fix).
    // This is NOT a cache: it only survives inside this refresh run.
    var preserveUrlMap = indexExistingUrlsByName();
    var preserveDom = indexVisibleUrlsFromDom();
    for (var pk in preserveDom) {
      if (Object.prototype.hasOwnProperty.call(preserveDom, pk)) preserveUrlMap[pk] = preserveDom[pk];
    }

    __mcListSilent++;
    __mcListNoAbort++;

    var next = 0;
    var lastHasMore = false;

    pageState.files = [];
    pageState.offset = 0;

    function loop(){
      return fetchListSafe(
        next,
        next > 0,
        toastTitle || 'Index',
        toastMsg || 'Could not refresh list (network/server error).',
        preserveUrlMap
      )
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

      // Guard: hard-lock blocks everything except rebuild_index
      if (actionName !== 'rebuild_index') {
        if (Guard.blockIf({ hard:true })) return;
      }

      // Guard: row-level busy (delete_one)
      if (actionName === 'delete_one' && fileName) {
        if (Guard.blockIf({ row:fileName })) return;
      }

      // Guard: global busy blocks rebuild as well (rebuild sets busy token itself)
      if (Guard.blockIf({ busy:true })) return;

      var msg = form.getAttribute('data-confirm');
      if (msg && String(msg).trim().length) {
        if (!window.confirm(String(msg))) return;
      }

      // last-action priority
      Toast.priorityAction();

      var isRebuild = (actionName === 'rebuild_index');

      // pre-action UI effects
      var __busyTok = 0;

      if (isRebuild) {
        // rebuild progress: warning working toast (no close button, keep spacing)
        Toast.workingWarning('Rebuild progress', 'Rebuilding index now...');
        __busyTok = UI.busyAcquire('rebuild');

      } else if (actionName === 'delete_all') {
        // disable ONLY Delete All and show warning working toast
        setEnabled(DOM.buttons.deleteAll, false);
        Toast.workingWarning('Deleting all', 'Deleting all files...');

      } else if (actionName === 'delete_one' && fileName) {
        RowBusy.set(fileName, true);
      }

      // --- POST ---
      function doPost(){
        var postTo = String(form.getAttribute('action') || '').trim();
        if (!postTo) postTo = EP.index;
        return Net.postForm(postTo, fdPeek)
          .then(function(r){
            if (!r.data) {
              var preview = String(r.txt || '').trim();
              if (preview.length > 220) preview = preview.slice(0, 220) + '...';
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

            if (r.data && r.data.redirect) {
              var to = String(r.data.redirect || '').trim();
              if (to) {
                __mcNavigating = true;
                Toast.show('warning', 'Reinstall', 'Redirecting to installer...');
                setTimeout(function(){ window.location.href = to; }, 250);
                return null;
              }
            }

            // Uniform stats policy
            // (do not double-update; syncStatsFrom decides)
            syncStatsFrom(r.data);

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

            // ALWAYS end rebuild busy-state on completion (success or error)
            if (isRebuild) {
              try { UI.busyRelease(__busyTok); } catch (e0) {}
              __busyTok = 0;
            }

            if (actionName === 'delete_one' && fileName) {
              RowBusy.set(fileName, false);
            }

            // no-op: stats already applied/refreshed in success path
          });
      }

      doPost();
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
    if (namesLine.length > MAX_CHARS) namesLine = namesLine.slice(0, MAX_CHARS - 1) + '...';
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

    function quotaLeftNow(){
      if (!(QUOTA_FILES > 0)) return Infinity;
      var used = Number(Totals.files || 0);
      var left = QUOTA_FILES - used;
      return (left < 0) ? 0 : left;
    }

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

      if (Guard.blockIf({ busy:true, hard:true })) return;

      if (!input.files || input.files.length === 0) {
        Toast.show('warning', 'Upload', 'No files selected.');
        return;
      }

      if (QUOTA_FILES > 0) {
        var left = quotaLeftNow();
        if (left <= 0) {
          Toast.show('warning', 'Upload', 'Quota reached (' + QUOTA_FILES + ' files). Delete files to upload new ones.');
          return;
        }
        if (input.files.length > left) {
          Toast.show('warning', 'Upload', 'Quota allows ' + left + ' more file(s). You selected ' + input.files.length + '.');
          return;
        }
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

      var __uploadTok = UI.busyAcquire('upload');
      setProgress(0);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', EP.index, true);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

      xhr.upload.onprogress = function(e){
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };

      function finishUpload(needStats){
        UI.busyRelease(__uploadTok);
        __uploadTok = 0;
        if (needStats) syncStatsFrom(null, { forceRefresh:true });
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

          // Uniform stats policy
          syncStatsFrom(data);

          clearInputs();
          readInputsIntoQuery();

          input.value = '';
          setProgress(100);
          setTimeout(resetProgress, 600);

          runQuery(true).finally(function(){ finishUpload(false); });
        } else {
          Toast.show('danger', 'Upload', 'Upload failed (server error).');
          setTimeout(resetProgress, 600);
          finishUpload(true);
        }
      };

      xhr.onerror = function(){
        Toast.show('danger', 'Upload', 'Upload failed (network error).');
        setTimeout(resetProgress, 600);
        finishUpload(true);
      };

      xhr.onabort = function(){
        Toast.show('warning', 'Upload', 'Upload aborted.');
        setTimeout(resetProgress, 600);
        finishUpload(true);
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

    RenderLife.after();
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

    // During Check Index refresh or when hard-locked, do not hydrate URLs.
    if (CheckIndexFlow && CheckIndexFlow.isChecking && CheckIndexFlow.isChecking()) return;
    if (HardLock && HardLock.isHard && HardLock.isHard()) return;

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
    if (Guard.blockIf({ hard:true })) return;

    var key = String(pill.getAttribute('data-f') || '');
    var fn = decName(key);
    if (!fn) return;

    if (Guard.blockIf({ row: fn })) return;

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

    if (Guard.blockIf({ hard:true, row:file })) return;

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

      // Uniform stats policy
      syncStatsFrom(resp);

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

    if (Guard.blockIf({ hard:true, row:file })) return;

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
  
  function initIndexCheckAndRebuild(){
    // 1) Check Index button => refresh page (server re-checks drift)
    if (DOM.buttons.checkIndex) {
      L.on(DOM.buttons.checkIndex, 'click', function(){
        // allow check even if hard-locked (that’s the whole point)
        if (UI.getBusy()) return;
        refreshPageForCheckIndex();
      });
    }

    // 2) Blocking modal: Rebuild Index Now => trigger hidden js-ajax rebuild form, then close modal
    if (DOM.indexRebuildNowBtn) {
      L.on(DOM.indexRebuildNowBtn, 'click', function(){
        if (UI.getBusy()) return;

        var form = DOM.buttons.rebuildIndexForm;
        if (!form) return;

        // Close modal first (NO working toast while modal is on)
        modalHide(DOM.indexChangedModal);

        // Fire the existing centralized js-ajax submit pipeline.
        // Small delay so Bootstrap cleanup settles.
        setTimeout(function(){
          if (HardLock.isHard()) {
            // We are rebuilding; allow it
            // (HardLock stays until applyStats clears it after rebuild)
          }

          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            // fallback for older browsers
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
      if (Guard.blockIf({ hard:true })) return;
      Toast.noteUserQuery();
      readInputsIntoQuery();
      runQuery(true);
    }, 160);

    if (DOM.search.q) L.on(DOM.search.q, 'input', onType);

    if (DOM.search.from) {
      L.on(DOM.search.from, 'change', function(){
        if (Guard.blockIf({ hard:true })) return;
        Toast.noteUserQuery();
        readInputsIntoQuery();
        runQuery(true);
      });
    }

    if (DOM.search.to) {
      L.on(DOM.search.to, 'change', function(){
        if (Guard.blockIf({ hard:true })) return;
        Toast.noteUserQuery();
        readInputsIntoQuery();
        runQuery(true);
      });
    }

    L.on(document, 'click', function(ev){
      var t = ev.target;
      if (!(t instanceof Element)) return;
      var item = t.closest('[data-flag]');
      if (!item) return;
      if (Guard.blockIf({ hard:true })) return;
      var v = String(item.getAttribute('data-flag') || 'all');
      Toast.noteUserQuery();
      setFlagsUI(v, false);
    });

    if (DOM.buttons.searchClear) {
      L.on(DOM.buttons.searchClear, 'click', function(){
        if (Guard.blockIf({ hard:true })) return;

        var hadFilter =
          ((DOM.search.q && String(DOM.search.q.value || '').trim()) ||
          (DOM.search.from && String(DOM.search.from.value || '')) ||
          (DOM.search.to && String(DOM.search.to.value || '')) ||
          (DOM.search.flagsBtn &&
            String(DOM.search.flagsBtn.getAttribute('data-value') || 'all') !== 'all'));

        // NEW: if user expanded the list via "Show more", Reset should restore the initial (first page) state
        var expandedBeyondPage = (pageState && Array.isArray(pageState.files) && pageState.files.length > PAGE_SIZE);

        // True no-op only when no filters AND not expanded
        if (!hadFilter && !expandedBeyondPage) return;

        clearInputs();
        Toast.hideSearch();
        readInputsIntoQuery();

        // reset=true => collapses back to first page and reloads
        runQuery(true);

        Toast.show('success', 'Reset results', 'Results reset to initial state.', { ttl: 1600 });
      });
    }

    if (DOM.buttons.showMore) {
      L.on(DOM.buttons.showMore, 'click', function(){
        if (Guard.blockIf({ hard:true })) return;

        // Disable ONLY Show More while loading
        setEnabled(DOM.buttons.showMore, false);

        var nextOffset = Number(pageState.offset || 0);

        fetchListSafe(nextOffset, true, 'Index', 'Could not load more items.')
        .finally(function(){
          // re-enable if still allowed
          if (!UI.getBusy() && !HardLock.isHard()) {
            setEnabled(DOM.buttons.showMore, true);
          }
          RenderLife.after();
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
      syncInfoModalFromTotals();
    });
  }

  function initInitialPaint(){
    CheckIndexFlow.detect();
    CheckIndexFlow.beginIfNeeded();

    // First-paint stats application (same path as ajax=stats)
    syncStatsFrom({
      index_changed: Number(BOOT.index_changed || 0),
      index_must_rebuild: Number(BOOT.index_must_rebuild || 0),
      index_forced: Number(BOOT.index_forced || 0),
      index_missing: Number(BOOT.index_missing || 0),
      total_files: Number(BOOT.totalFiles || 0),
      total_human: (
        DOM.footerTotal
          ? String(DOM.footerTotal.textContent || '').trim()
          : ''
      )
    });

    UI.busyResetAll();

    updateCounts(pageState.files.length, pageState.total);

    var hasMoreBoot = (pageState.total > pageState.files.length);
    renderFiles(pageState.files, pageState.total, splitTerms(''), hasMoreBoot);
    RenderLife.now();

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
  initIndexCheckAndRebuild();
  initSearch();
  wireAjaxForms();
  wireUpload();
  wireDelegatedFileActions();
  initBackToTop();
  initInfoModal();
  if (StorageControl && StorageControl.wire) StorageControl.wire();
  refreshStats();
})();