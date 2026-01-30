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
    } catch (e0) {
      return {};
    }
  })();

  var PAGE_SIZE = Number(BOOT.pageSize || 20);
  var QUOTA_FILES = Number(BOOT.quotaFiles || 0); // 0 => unlimited (legacy / missing)
  var csrfToken = String(BOOT.csrf || '');

  /* =========================
    MC HELPERS (module)
    ========================= */
  var MC = (window.MC || (window.MC = {}));
  var H = (MC.h || (MC.h = {}));

  // helpers (keep old local names so the rest of app.js stays untouched)
  var setPctClass        = H.setPctClass;
  var forceHide          = H.forceHide;
  var forceShow          = H.forceShow;
  var setEnabled         = H.setEnabled;
  var escapeHtml         = H.escapeHtml;
  var cssEscape          = H.cssEscape;
  var encName            = H.encName;
  var decName            = H.decName;
  var startDownloadNoNav = H.startDownloadNoNav;
  var formatBytes        = H.formatBytes;
  var formatDate         = H.formatDate;
  var splitTerms         = H.splitTerms;
  var escapeRegExp       = H.escapeRegExp;
  var highlightText      = H.highlightText;

  /* =========================
    MC NET (module)
    ========================= */
  var Net = (MC.Net || null);

  /* =========================
     MC OP (module)
     ========================= */
  var Op = (MC.Op || null);

  /* =========================
   ENDPOINTS (module)
   ========================= */
  var EP = (MC.EP && MC.EP.init) ? MC.EP.init() : { index:'index.php', link:'link.php' };

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
      el:    document.getElementById('toast'),
      title: document.getElementById('toastTitle'),
      body:  document.getElementById('toastBody'),
      icon:  document.getElementById('toastIcon'),
      close: document.getElementById('toastCloseBtn')
    },
    searchToast: {
      el:      document.getElementById('toastSearch'),
      title:   document.getElementById('toastSearchTitle'),
      body:    document.getElementById('toastSearchBody'),
      icon:    document.getElementById('toastSearchIcon'),
      close:   document.getElementById('toastSearchCloseBtn'),
      keyLast: null,
      scope:   null
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
    infoFilesCount: document.getElementById('mcInfoFilesCount'),
    infoTotalSize:  document.getElementById('mcInfoTotalSize'),

    indexChangedModal: document.getElementById('mcIndexChangedModal'),
    indexRebuildNowBtn: document.getElementById('mcRebuildIndexNowBtn'),

    storageModal: document.getElementById('mcStorageModal'),
    storageScanBtn: document.getElementById('mcStorageScanBtn'),
    storageDeleteBtn: document.getElementById('mcStorageDeleteBtn'),
    storageList: document.getElementById('mcStorageList'),
    storageSummary: document.getElementById('mcStorageSummary'),
    storageProgressWrap: document.getElementById('mcStorageProgressWrap'),
    storageProgressBar: document.getElementById('mcStorageProgressBar'),
    storageMsg: document.getElementById('mcStorageMsg')
  };

  /* =========================
    HARD LOCK (module init)
    ========================= */
  var HardLock = (MC.initHardLock ? MC.initHardLock({
    DOM: DOM,
    Modals: (MC.Modals || null),
    forceShow: forceShow,
    forceHide: forceHide,
    bootstrapRef: (window.bootstrap || null)
  }) : null);

  // keep local modal function names (so the rest of app.js stays untouched)
  var modalShow = (MC.Modals && MC.Modals.show)
    ? function(el){ MC.Modals.show(el, forceShow, window.bootstrap || null); }
    : function(){};

  var modalHide = (MC.Modals && MC.Modals.hide)
    ? function(el){ MC.Modals.hide(el, forceHide, window.bootstrap || null); }
    : function(){};

  /* =========================
    TOAST (module init)
    ========================= */
  var Toast = (MC.initToast ? MC.initToast({
    DOM: DOM,
    L: L,
    forceShow: forceShow,
    forceHide: forceHide
  }) : null);

  /* =========================
     ROW BUSY (module init)
     ========================= */
  var RowBusy = (MC.initRowBusy ? MC.initRowBusy({
    DOM: DOM,
    encName: encName,
    cssEscape: cssEscape
  }) : null);

  // Step 6: UI reacts to HardLock transitions in one place
  if (HardLock && HardLock.setOnChange) {
    HardLock.setOnChange(function(){
      try { UI.applyButtons(); } catch (e0) {}
      try { UI.applyGridPolicy(); } catch (e1) {}
    });
  }

  /* =========================
  UI POLICY (module init)
  - must run AFTER DOM + HardLock + RowBusy exist
  ========================= */
  var UI = (MC.initUI ? MC.initUI({
    BOOT: BOOT,
    DOM: DOM,
    HardLock: HardLock,
    RowBusy: RowBusy,
    setEnabled: setEnabled
  }) : null);

  /* =========================
  GUARD (module init)
  ========================= */
  var Guard = (MC.initGuard ? MC.initGuard({
    HardLock: HardLock,
    UI: UI,
    RowBusy: RowBusy,
    Toast: Toast
  }) : null);

  /* =========================
  RENDER LIFECYCLE (module init)
  ========================= */
  var RenderLife = (MC.initRenderLife ? MC.initRenderLife({
    onApplyGridPolicy: function(){ if (UI && UI.applyGridPolicy) UI.applyGridPolicy(); },
    onHydrateSharedUrls: function(){ ensureVisibleSharedUrls(); },
    onApplyTotalsPolicy: function(){ applyTotalsUiPolicy(); }
  }) : null);

  /* =========================
  CHECK INDEX FLOW (module init)
  ========================= */
  var CheckIndexFlow = (MC.initCheckIndexFlow ? MC.initCheckIndexFlow({
    Toast: Toast,
    HardLock: HardLock,
    RenderLife: RenderLife
  }) : null);

  /* =========================
     STORAGE CONTROL (module init)
     ========================= */
  var StorageControl = (MC.initStorageControl ? MC.initStorageControl({
    DOM: DOM,
    L: L,

    Net: Net,
    EP: EP,

    Op: Op,
    UI: UI,
    Guard: Guard,
    HardLock: HardLock,
    Toast: Toast,

    RenderLife: RenderLife,

    csrfToken: csrfToken,

    setEnabled: setEnabled,
    setPctClass: setPctClass,
    escapeHtml: escapeHtml,
    cssEscape: cssEscape,
    encName: encName,
    decName: decName,
    formatBytes: formatBytes,
    formatDate: formatDate,

    syncStatsFrom: syncStatsFrom,
    buildStatsUrl: buildStatsUrl,
    readInputsIntoQuery: readInputsIntoQuery,
    refreshToDesiredCount: refreshToDesiredCount,

    modalShow: modalShow
  }) : null);

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

  /* =========================
    STATS (module init)
    ========================= */
  var Stats = (MC.initStats ? MC.initStats({
    DOM: DOM,
    Totals: Totals,
    HardLock: HardLock,
    CheckIndexFlow: CheckIndexFlow,
    Net: Net,
    EP: EP,
    Toast: Toast,
    applyTotalsUiPolicy: applyTotalsUiPolicy
  }) : null);

  // keep old local function names so the rest of app.js stays untouched
  function pickStatsFromEnvelope(env){ return Stats.pickStatsFromEnvelope(env); }
  function applyStats(stats){ return Stats.applyStats(stats); }
  function looksLikeStatsObject(o){ return Stats.looksLikeStatsObject(o); }
  function syncStatsFrom(payloadOrStats, opts){ return Stats.syncStatsFrom(payloadOrStats, opts); }
  function buildStatsUrl(){ return Stats.buildStatsUrl(); }
  function refreshStats(){ return Stats.refreshStats(); }

  /* =========================
    UPLOAD (module init)
  ========================= */
  var Upload = (MC.initUpload ? MC.initUpload({
    BOOT: BOOT,
    DOM: DOM,
    EP: EP,
    UI: UI,
    Guard: Guard,
    HardLock: HardLock,
    Toast: Toast,
    QUOTA_FILES: QUOTA_FILES,
    Totals: Totals,
    setEnabled: setEnabled,
    setPctClass: setPctClass,
    formatBytes: formatBytes,
    classifyToast: classifyToast,
    clearInputs: clearInputs,
    readInputsIntoQuery: readInputsIntoQuery,
    runQuery: runQuery,
    syncStatsFrom: syncStatsFrom
  }) : null);

  /* =========================
     LINKS (module init)
     ========================= */
  var Links = (MC.initLinks ? MC.initLinks({
    DOM: DOM,
    Net: Net,
    EP: EP,
    Toast: Toast,
    Guard: Guard,
    RowBusy: RowBusy,
    RenderLife: RenderLife,
    HardLock: HardLock,
    CheckIndexFlow: CheckIndexFlow,

    csrfToken: csrfToken,

    encName: encName,
    decName: decName,
    cssEscape: cssEscape,
    startDownloadNoNav: startDownloadNoNav,

    classifyToast: classifyToast,
    syncStatsFrom: syncStatsFrom,

    readInputsIntoQuery: readInputsIntoQuery,
    refreshToDesiredCount: refreshToDesiredCount,

    getQueryFlags: function(){ return String(query.flags || 'all'); },

    pageState: pageState,
    urlInflight: __mcUrlInflight
  }) : null);

  /* =========================
    DELEGATED ACTIONS (module init)
    ========================= */
  var DelegatedActions = (MC.initDelegatedActions ? MC.initDelegatedActions({
    DOM: DOM,
    L: L,
    Links: Links,
    decName: decName
  }) : null);

  function ensureVisibleSharedUrls(){
    if (DelegatedActions && DelegatedActions.ensureVisibleSharedUrls) {
      DelegatedActions.ensureVisibleSharedUrls();
    }
  }

  function queryKey(){
    return 'q=' + (query.q||'') + '|from=' + (query.from||'') + '|to=' + (query.to||'') + '|flags=' + (query.flags||'all');
  }

  function updateCounts(shown, total){
    shown = Number(shown || 0);
    total = Number(total || 0);
    if (DOM.counts.shown1) DOM.counts.shown1.textContent = String(shown);
    if (DOM.counts.total1) DOM.counts.total1.textContent = String(total);
    if (DOM.counts.shown2) DOM.counts.shown2.textContent = String(shown);
    if (DOM.counts.total2) DOM.counts.total2.textContent = String(total);
  }

  /* =========================
     RENDER (module init)
     ========================= */
  var Render = (MC.initRender ? MC.initRender({
    DOM: DOM,
    RenderLife: RenderLife,
    csrfToken: csrfToken,

    encName: encName,
    escapeHtml: escapeHtml,
    formatBytes: formatBytes,
    formatDate: formatDate,
    highlightText: highlightText
  }) : null);

  function renderFiles(arr, totalMatches, highlightTerms, hasMore){
    if (Render && Render.renderFiles) return Render.renderFiles(arr, totalMatches, highlightTerms, hasMore);
  }

  /* =========================
     LIST (module init)
     ========================= */
  var __mcNavigatingRef = { value: false };

  var List = (MC.initList ? MC.initList({
    DOM: DOM,
    Net: Net,
    EP: EP,
    Toast: Toast,

    PAGE_SIZE: PAGE_SIZE,

    splitTerms: splitTerms,
    decName: decName,

    renderFiles: renderFiles,
    updateCounts: updateCounts,

    getQuery: function(){ return query; },
    pageState: pageState,

    // optional helpers (preserve URLs)
    indexExistingUrlsByName: function(){
      var map = Object.create(null);
      for (var i = 0; i < pageState.files.length; i++) {
        var it = pageState.files[i];
        if (!it) continue;
        var n = String(it.name || '');
        if (!n) continue;
        if (it.shared && it.url) map[n] = String(it.url);
      }
      return map;
    },

    indexVisibleUrlsFromDom: function(){
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
    },

    __mcNavigatingRef: __mcNavigatingRef
  }) : null);

  function fetchListSafe(offset, append, toastTitle, toastMsg, preserveUrlMap){
    if (!List || !List.fetchListSafe) return Promise.resolve(null);
    return List.fetchListSafe(offset, append, toastTitle, toastMsg, preserveUrlMap);
  }

  function refreshToDesiredCount(toastTitle, toastMsg){
    if (!List || !List.refreshToDesiredCount) return Promise.resolve(null);
    return List.refreshToDesiredCount(toastTitle, toastMsg);
  }

  function runQuery(reset, opts){
    reset = !!reset;
    opts = opts || {};

    if (HardLock.isHard() && !opts.allowHard) return Promise.resolve(null);
    if (!List || !List.runQuery) return Promise.resolve(null);
    return List.runQuery(reset);
  }

  /* =========================
     SEARCH (module init)
     ========================= */
  var Search = (MC.initSearch ? MC.initSearch({
    DOM: DOM,
    L: L,
    Guard: Guard,
    UI: UI,
    HardLock: HardLock,
    Toast: Toast,

    PAGE_SIZE: PAGE_SIZE,
    pageState: pageState,

    setEnabled: setEnabled,
    fetchListSafe: fetchListSafe,
    runQuery: runQuery,
    RenderLife: RenderLife,

    getQuery: function(){ return query; },
    setQuery: function(q){ query = q; }
  }) : null);

  function setFlagsUI(value, silent){
    if (Search && Search.setFlagsUI) return Search.setFlagsUI(value, silent);
  }

  function readInputsIntoQuery(){
    if (Search && Search.readInputsIntoQuery) return Search.readInputsIntoQuery();
    query.q = DOM.search.q ? String(DOM.search.q.value || '') : '';
    query.from = DOM.search.from ? String(DOM.search.from.value || '') : '';
    query.to = DOM.search.to ? String(DOM.search.to.value || '') : '';
    query.flags = DOM.search.flagsBtn ? String(DOM.search.flagsBtn.getAttribute('data-value') || 'all') : 'all';
    return query;
  }

  function clearInputs(){
    if (Search && Search.clearInputs) return Search.clearInputs();
    if (DOM.search.q) DOM.search.q.value = '';
    if (DOM.search.from) DOM.search.from.value = '';
    if (DOM.search.to) DOM.search.to.value = '';
    setFlagsUI('all', true);
    query = { q:'', from:'', to:'', flags:'all' };
    return query;
  }

  /* =========================
     MODAL → BASELINE RESET POLICY
     ========================= */
  MC.onModalWillShow = function(el){
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
  };

  /* =========================
     AJAX FORMS (module init)
     ========================= */
  var AjaxForms = (MC.initAjaxForms ? MC.initAjaxForms({
    DOM: DOM,
    L: L,

    Net: Net,
    EP: EP,

    Toast: Toast,
    UI: UI,
    Guard: Guard,
    RowBusy: RowBusy,

    navigatingRef: __mcNavigatingRef,

    syncStatsFrom: syncStatsFrom,
    clearInputs: clearInputs,
    readInputsIntoQuery: readInputsIntoQuery,
    runQuery: runQuery,
    refreshToDesiredCount: refreshToDesiredCount,

    setEnabled: setEnabled
  }) : null);

  function classifyToast(okMsgs, errMsgs, opts){
    if (AjaxForms && AjaxForms.classifyToast) return AjaxForms.classifyToast(okMsgs, errMsgs, opts);
    return { kind:'info', title:'Info', msg:'' };
  }

  function wireAjaxForms(){
    if (AjaxForms && AjaxForms.wire) AjaxForms.wire();
  }

  /* =========================
     APP INIT (module init)
     ========================= */
  var AppInit = (MC.initAppInit ? MC.initAppInit({
    BOOT: BOOT,

    DOM: DOM,
    L: L,

    UI: UI,
    HardLock: HardLock,

    Toast: Toast,
    RenderLife: RenderLife,

    CheckIndexFlow: CheckIndexFlow,

    modalHide: modalHide,

    Totals: Totals,
    pageState: pageState,
    PAGE_SIZE: PAGE_SIZE,

    classifyToast: classifyToast,
    syncStatsFrom: syncStatsFrom,
    refreshStats: refreshStats,

    renderFiles: renderFiles,
    updateCounts: updateCounts,
    splitTerms: splitTerms,

    wireAjaxForms: wireAjaxForms,

    Upload: Upload,
    DelegatedActions: DelegatedActions,
    StorageControl: StorageControl,
    Search: Search
  }) : null);

  /* keep old local names (adapters) */
  function syncInfoModalFromTotals(){
    if (AppInit && AppInit.syncInfoModalFromTotals) return AppInit.syncInfoModalFromTotals();
  }

  function applyTotalsUiPolicy(){
    if (AppInit && AppInit.applyTotalsUiPolicy) return AppInit.applyTotalsUiPolicy();
  }

  /* =========================
    BOOT
    ========================= */
  if (AppInit && AppInit.wireTeardown) AppInit.wireTeardown();
  if (AppInit && AppInit.boot) AppInit.boot();
})();