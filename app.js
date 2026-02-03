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

  // Bound Modals API (single adapter) — modules call Modals.show/hide(el)
  var Modals = (function(){
    var api = (MC && MC.Modals) ? MC.Modals : null;
    var bs = window.bootstrap || null;

    return {
      show: (api && api.show) ? function(el){ api.show(el, forceShow, bs); } : function(){},
      hide: (api && api.hide) ? function(el){ api.hide(el, forceHide, bs); } : function(){}
    };
  })();

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

  var hydrateSharedUrls = null;

  /* =========================
  RENDER LIFECYCLE (module init)
  ========================= */
  var RenderLife = (MC.initRenderLife ? MC.initRenderLife({
    onApplyGridPolicy: function(){ if (UI && UI.applyGridPolicy) UI.applyGridPolicy(); },
    onHydrateSharedUrls: function(){
      if (typeof hydrateSharedUrls === 'function') hydrateSharedUrls();
    },
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

  /* keep old local names (adapters) */
  function applyTotalsUiPolicy(){
    if (AppInit && AppInit.applyTotalsUiPolicy) return AppInit.applyTotalsUiPolicy();
  }

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

  /* =========================
     LIST (module init)
     ========================= */
  var __mcNavigatingRef = { value: false };

  var List = (MC.initList ? MC.initList({
    DOM: DOM,
    Net: Net,
    EP: EP,
    Toast: Toast,
    HardLock: HardLock,

    PAGE_SIZE: PAGE_SIZE,

    splitTerms: splitTerms,
    decName: decName,

    renderFiles: (Render && Render.renderFiles) ? Render.renderFiles : null,
    updateCounts: (UI && UI.updateCounts) ? UI.updateCounts : null,

    getQuery: function(){ return query; },
    pageState: pageState,

    __mcNavigatingRef: __mcNavigatingRef
  }) : null);

  var fetchListSafe = (List && List.fetchListSafe)
    ? List.fetchListSafe
    : function(){ return Promise.resolve(null); };

  var refreshToDesiredCount = (List && List.refreshToDesiredCount)
    ? List.refreshToDesiredCount
    : function(){ return Promise.resolve(null); };

  var runQuery = (List && List.runQuery)
    ? List.runQuery
    : function(){ return Promise.resolve(null); };

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

  var setFlagsUI = (Search && Search.setFlagsUI)
    ? Search.setFlagsUI
    : function(){};

  var readInputsIntoQuery = (Search && Search.readInputsIntoQuery)
    ? Search.readInputsIntoQuery
    : function(){ return query; };

  var clearInputs = (Search && Search.clearInputs)
    ? Search.clearInputs
    : function(){ return query; };

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

    syncStatsFrom: (Stats ? Stats.syncStatsFrom : null),
    clearInputs: clearInputs,
    readInputsIntoQuery: readInputsIntoQuery,
    runQuery: runQuery,
    refreshToDesiredCount: refreshToDesiredCount,

    setEnabled: setEnabled
  }) : null);

  function wireAjaxForms(){
    if (AjaxForms && AjaxForms.wire) AjaxForms.wire();
  }

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
    classifyToast: (MC && MC.classifyToast) ? MC.classifyToast : null,
    clearInputs: clearInputs,
    readInputsIntoQuery: readInputsIntoQuery,
    runQuery: runQuery,
    syncStatsFrom: (Stats ? Stats.syncStatsFrom : null)
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

    classifyToast: (MC && MC.classifyToast) ? MC.classifyToast : null,
    syncStatsFrom: (Stats ? Stats.syncStatsFrom : null),

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

  hydrateSharedUrls = (DelegatedActions && DelegatedActions.ensureVisibleSharedUrls)
    ? DelegatedActions.ensureVisibleSharedUrls
    : null;

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

    syncStatsFrom: (Stats ? Stats.syncStatsFrom : null),
    buildStatsUrl: (Stats ? Stats.buildStatsUrl : null),
    readInputsIntoQuery: readInputsIntoQuery,
    refreshToDesiredCount: refreshToDesiredCount,

    Modals: Modals
  }) : null);

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

    Modals: Modals,

    Totals: Totals,
    pageState: pageState,
    PAGE_SIZE: PAGE_SIZE,

    classifyToast: (MC && MC.classifyToast) ? MC.classifyToast : null,
    syncStatsFrom: (Stats ? Stats.syncStatsFrom : null),
    refreshStats: (Stats ? Stats.refreshStats : null),

    renderFiles: (Render && Render.renderFiles) ? Render.renderFiles : null,
    updateCounts: (UI && UI.updateCounts) ? UI.updateCounts : null,
    splitTerms: splitTerms,

    wireAjaxForms: wireAjaxForms,

    Upload: Upload,
    DelegatedActions: DelegatedActions,
    StorageControl: StorageControl,
    Search: Search
  }) : null);

  /* =========================
    BOOT
    ========================= */
  if (AppInit && AppInit.wireTeardown) AppInit.wireTeardown();
  if (AppInit && AppInit.boot) AppInit.boot();
})();