/* mc_search.js
   Search UI wiring (inputs, debounce, flags, reset, show-more)
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initSearch = function initSearch(opts){
    opts = opts || {};

    var DOM         = opts.DOM;
    var L           = opts.L;
    var Guard       = opts.Guard;
    var UI          = opts.UI;
    var HardLock    = opts.HardLock;
    var Toast       = opts.Toast;

    var PAGE_SIZE   = Number(opts.PAGE_SIZE || 20);
    var pageState   = opts.pageState;

    var setEnabled  = opts.setEnabled;
    var fetchListSafe = opts.fetchListSafe;
    var runQuery      = opts.runQuery;
    var RenderLife    = opts.RenderLife;

    var getQuery    = opts.getQuery;
    var setQuery    = opts.setQuery;

    function debounce(fn, ms){
      var t;
      return function(){
        clearTimeout(t);
        t = setTimeout(fn, ms);
      };
    }

    function setFlagsUI(value, silent){
      value = String(value || 'all');
      if (!DOM || !DOM.search || !DOM.search.flagsBtn || !DOM.search.flagsLabel) return;

      var prev = String(DOM.search.flagsBtn.getAttribute('data-value') || 'all');

      DOM.search.flagsBtn.setAttribute('data-value', value);
      DOM.search.flagsLabel.textContent = (value === 'shared') ? 'Shared only' : 'All files';

      if (silent) return;
      if (prev === value) return;

      if (HardLock && HardLock.isHard && HardLock.isHard()) return;

      readInputsIntoQuery();
      runQuery(true);
    }

    function readInputsIntoQuery(){
      var q = (typeof getQuery === 'function') ? (getQuery() || {}) : {};
      q.q = (DOM && DOM.search && DOM.search.q) ? String(DOM.search.q.value || '') : '';
      q.from = (DOM && DOM.search && DOM.search.from) ? String(DOM.search.from.value || '') : '';
      q.to = (DOM && DOM.search && DOM.search.to) ? String(DOM.search.to.value || '') : '';
      q.flags = (DOM && DOM.search && DOM.search.flagsBtn)
        ? String(DOM.search.flagsBtn.getAttribute('data-value') || 'all')
        : 'all';

      if (typeof setQuery === 'function') setQuery(q);
      return q;
    }

    function queryKey(){
      var q = (typeof getQuery === 'function') ? (getQuery() || {}) : {};
      return 'q=' + (q.q||'') + '|from=' + (q.from||'') + '|to=' + (q.to||'') + '|flags=' + (q.flags||'all');
    }

    function clearInputs(){
      if (DOM && DOM.search) {
        if (DOM.search.q) DOM.search.q.value = '';
        if (DOM.search.from) DOM.search.from.value = '';
        if (DOM.search.to) DOM.search.to.value = '';
      }

      setFlagsUI('all', true);

      var q = { q:'', from:'', to:'', flags:'all' };
      if (typeof setQuery === 'function') setQuery(q);
      return q;
    }

    function isExpanded(){
      return (pageState && Array.isArray(pageState.files) && pageState.files.length > PAGE_SIZE);
    }

    function hasAnyFilter(){
      return !!(
        (DOM && DOM.search && DOM.search.q && String(DOM.search.q.value || '').trim()) ||
        (DOM && DOM.search && DOM.search.from && String(DOM.search.from.value || '')) ||
        (DOM && DOM.search && DOM.search.to && String(DOM.search.to.value || '')) ||
        (DOM && DOM.search && DOM.search.flagsBtn &&
          String(DOM.search.flagsBtn.getAttribute('data-value') || 'all') !== 'all')
      );
    }

    // Conceptual: reset List/Search UI to the same baseline as clicking Reset.
    // silent=true => no toast
    function resetToInitial(silent){
      // no-op only when already baseline
      if (!hasAnyFilter() && !isExpanded()) return false;

      clearInputs();
      if (Toast && Toast.hideSearch) Toast.hideSearch();

      // reset=true => collapses back to first page and reloads
      runQuery(true, { allowHard:true });

      if (!silent && Toast && Toast.show) {
        Toast.show('success', 'Reset results', 'Results reset to initial state.', { ttl: 1600 });
      }
      return true;
    }

    function wire(){
      function runUserQueryFromInputs(){
        // uniform: same 3 calls everywhere
        if (Toast && Toast.noteUserQuery) Toast.noteUserQuery();
        readInputsIntoQuery();
        runQuery(true);
      }

      var onType = debounce(function(){
        if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;
        runUserQueryFromInputs();
      }, 160);

      if (DOM && DOM.search && DOM.search.q) L.on(DOM.search.q, 'input', onType);

      if (DOM && DOM.search && DOM.search.from) {
        L.on(DOM.search.from, 'change', function(){
          if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;
          runUserQueryFromInputs();
        });
      }

      if (DOM && DOM.search && DOM.search.to) {
        L.on(DOM.search.to, 'change', function(){
          if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;
          runUserQueryFromInputs();
        });
      }

      L.on(document, 'click', function(ev){
        var t = ev.target;
        if (!(t instanceof Element)) return;

        var item = t.closest('[data-flag]');
        if (!item) return;
        if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;

        var v = String(item.getAttribute('data-flag') || 'all');
        if (Toast && Toast.noteUserQuery) Toast.noteUserQuery();
        setFlagsUI(v, false);
      });

      if (DOM && DOM.buttons && DOM.buttons.searchClear) {
        L.on(DOM.buttons.searchClear, 'click', function(){
          if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;
          resetToInitial(false);
        });
      }

      if (DOM && DOM.buttons && DOM.buttons.showMore) {
        L.on(DOM.buttons.showMore, 'click', function(){
          if (Guard && Guard.blockIf && Guard.blockIf({ hard:true })) return;

          // Disable ONLY Show More while loading
          if (setEnabled) setEnabled(DOM.buttons.showMore, false);

          var nextOffset = Number((pageState && pageState.offset) || 0);

          fetchListSafe(nextOffset, true, 'Index', 'Could not load more items.')
            .finally(function(){
              // re-enable if still allowed
              if (UI && UI.getBusy && HardLock && HardLock.isHard) {
                if (!UI.getBusy() && !HardLock.isHard()) {
                  if (setEnabled) setEnabled(DOM.buttons.showMore, true);
                }
              }
              if (RenderLife && RenderLife.after) RenderLife.after();
            });
        });
      }

      // initial state
      setFlagsUI('all', true);
    }

    return {
      wire: wire,
      setFlagsUI: setFlagsUI,
      readInputsIntoQuery: readInputsIntoQuery,
      clearInputs: clearInputs,
      resetToInitial: resetToInitial,
      queryKey: queryKey
    };
  };
})();