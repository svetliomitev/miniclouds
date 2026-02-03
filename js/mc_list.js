/* MiniCloudS mc_list.js
   - List fetch owner (extracted from app.js)
   - Exposes: MC.initList(deps) -> List API
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initList = function initList(deps){
    deps = deps || {};

    var DOM = deps.DOM || {};
    var Net = deps.Net || {};
    var EP = deps.EP || {};
    var Toast = deps.Toast || {};
    var HardLock = deps.HardLock || {};

    var PAGE_SIZE = Number(deps.PAGE_SIZE || 20);

    var splitTerms = deps.splitTerms;
    var decName = deps.decName;

    var renderFiles = deps.renderFiles;
    var updateCounts = deps.updateCounts;

    var getQuery = deps.getQuery || function(){ return { q:'', from:'', to:'', flags:'all' }; };
    var pageState = deps.pageState || { offset: 0, total: 0, files: [] };

    // For preserving shared URLs across refresh loops
    var indexExistingUrlsByName = deps.indexExistingUrlsByName;
    var indexVisibleUrlsFromDom = deps.indexVisibleUrlsFromDom;

    var __mcNavigatingRef = deps.__mcNavigatingRef || { value:false };

    // Internal request state (was in app.js)
    var reqSeq = 0;
    var abortController = null;
    var silent = 0;
    var noAbort = 0;

    function queryKey(){
      var q = getQuery() || {};
      return 'q=' + (q.q||'') + '|from=' + (q.from||'') + '|to=' + (q.to||'') + '|flags=' + (q.flags||'all');
    }

    function truthyHasMore(v){
      return (v === true) || (v === 1) || (v === '1');
    }

    function getVisibleCountNow(){
      if (DOM.grid) {
        var cards = DOM.grid.querySelectorAll('[data-file-card]');
        if (cards && cards.length) return cards.length;
      }
      return (pageState && Array.isArray(pageState.files)) ? pageState.files.length : PAGE_SIZE;
    }

    function _indexExistingUrlsByName(){
      if (typeof indexExistingUrlsByName === 'function') return indexExistingUrlsByName();

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

    function _indexVisibleUrlsFromDom(){
      if (typeof indexVisibleUrlsFromDom === 'function') return indexVisibleUrlsFromDom();

      var map = Object.create(null);
      if (!DOM.grid) return map;

      var cards = DOM.grid.querySelectorAll('.file-card[data-shared="1"]');
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var wrapper = card.closest('[data-file-card]');
        if (!wrapper) continue;

        var key = String(wrapper.getAttribute('data-file-card') || '');
        var fn = decName ? decName(key) : key;
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

    function updateSearchToastForCurrentQuery(shownCount, totalCount, append, returnedNow){
      shownCount = Number(shownCount || 0);
      totalCount = Number(totalCount || 0);
      append = !!append;
      returnedNow = Number(returnedNow || 0);

      if (append && returnedNow > 0 && totalCount > 0) {
        if (Toast && Toast.showResults) {
          Toast.showResults(
            shownCount,
            totalCount,
            queryKey() + '|append|shown=' + shownCount + '|total=' + totalCount,
            { append:true, ttl:2000 }
          );
        }
        return;
      }

      var q = getQuery() || {};
      var hasFilter =
        ((q.q && String(q.q).trim()) || q.from || q.to || (q.flags && q.flags !== 'all'));

      if (hasFilter) {
        if (totalCount > 0) {
          if (Toast && Toast.showResults) {
            Toast.showResults(
              shownCount,
              totalCount,
              queryKey() + '|n=' + totalCount + '|shown=' + shownCount,
              { append:false, ttl:2000 }
            );
          }
        } else {
          if (Toast && Toast.hideSearch) Toast.hideSearch();
        }
      } else {
        if (Toast && Toast.hideSearch) Toast.hideSearch();
      }
    }

    function fetchList(offset, append, preserveUrlMap){
      offset = Number(offset || 0);
      append = !!append;

      var myReqId = ++reqSeq;

      // Abort previous in-flight list request unless we're in "no abort" mode
      if (!noAbort) {
        if (abortController) { try { abortController.abort(); } catch (e0) {} }
        abortController = (window.AbortController ? new AbortController() : null);
      } else {
        abortController = null;
      }

      var url;
      try { url = new URL(EP.index); }
      catch (e1) {
        url = new URL(String(EP.index || ''), String(document.baseURI || window.location.href || ''));
      }

      var q = getQuery() || {};

      url.searchParams.set('ajax', 'list');
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('limit', String(PAGE_SIZE));
      if (q.q) url.searchParams.set('q', q.q);
      if (q.from) url.searchParams.set('from', q.from);
      if (q.to) url.searchParams.set('to', q.to);
      url.searchParams.set('flags', q.flags || 'all');

      return Net.getJson(url.toString(), {
        signal: abortController ? abortController.signal : undefined
      })
      .then(function(r0){
        // normalize to the old internal shape used below
        var r = {
          ok: r0.ok,
          status: r0.status,
          data: r0.data,
          reqId: myReqId,
          raw: r0.txt
        };

        if (r.reqId !== reqSeq) return { ignored: true };

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
        var oldUrlMap = (preserveUrlMap && typeof preserveUrlMap === 'object')
          ? preserveUrlMap
          : _indexExistingUrlsByName();

        var domUrlMap = _indexVisibleUrlsFromDom();
        for (var k0 in domUrlMap) {
          if (Object.prototype.hasOwnProperty.call(domUrlMap, k0)) oldUrlMap[k0] = domUrlMap[k0];
        }

        if (append) pageState.files = pageState.files.concat(r.data.files);
        else pageState.files = r.data.files;

        var returned = r.data.files.length;
        pageState.offset = offset + returned;

        for (var k = 0; k < pageState.files.length; k++) {
          var row = pageState.files[k];
          if (!row) continue;
          var nm = String(row.name || '');
          if (!nm) continue;
          if (row.shared && (!row.url || String(row.url) === '') && oldUrlMap[nm]) row.url = oldUrlMap[nm];
        }

        if (!silent) {
          var terms = (typeof splitTerms === 'function') ? splitTerms((q.q || '')) : [];
          if (typeof updateCounts === 'function') updateCounts(pageState.files.length, pageState.total);

          updateSearchToastForCurrentQuery(pageState.files.length, pageState.total, append, returned);

          if (typeof renderFiles === 'function') {
            renderFiles(pageState.files, pageState.total, terms, truthyHasMore(r.data.has_more));
          }
        }

        return r.data;
      })
      .catch(function(e){
        if (e && (e.name === 'AbortError' || e.code === 20)) return { ignored:true };
        if (e && typeof e === 'object' && e.reqId == null) e.reqId = myReqId;
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
          if (rid === reqSeq && !(__mcNavigatingRef && __mcNavigatingRef.value)) {
            if (Toast && Toast.show) {
              Toast.show('warning', toastTitle || 'Index', toastMsg || 'Could not load list (network/server error).');
            }
          }
          return null;
        });
    }

    function refreshToDesiredCount(toastTitle, toastMsg){
      var desired = Math.max(PAGE_SIZE, Number(getVisibleCountNow() || 0));

      // Snapshot shared URLs BEFORE we wipe pageState/files (priority fix).
      // This is NOT a cache: it only survives inside this refresh run.
      var preserveUrlMap = _indexExistingUrlsByName();
      var preserveDom = _indexVisibleUrlsFromDom();
      for (var pk in preserveDom) {
        if (Object.prototype.hasOwnProperty.call(preserveDom, pk)) preserveUrlMap[pk] = preserveDom[pk];
      }

      silent++;
      noAbort++;

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

            lastHasMore = truthyHasMore(resp.has_more);

            if (pageState.files.length >= desired) return null;
            if (pageState.files.length >= Number(pageState.total || 0)) return null;
            if (!lastHasMore) return null;

            return loop();
          });
      }

      return loop()
        .finally(function(){
          silent = Math.max(0, silent - 1);
          noAbort = Math.max(0, noAbort - 1);
        })
        .then(function(){
          var q = getQuery() || {};
          var terms = (typeof splitTerms === 'function') ? splitTerms((q.q || '')) : [];
          if (typeof updateCounts === 'function') updateCounts(pageState.files.length, pageState.total);

          updateSearchToastForCurrentQuery(pageState.files.length, pageState.total, false, 0);

          if (typeof renderFiles === 'function') {
            renderFiles(pageState.files, pageState.total, terms, !!lastHasMore);
          }
          return null;
        });
    }

    function runQuery(reset, opts){
      reset = !!reset;
      opts = opts || {};

      // moved from app.js adapter: keep behavior identical
      if (HardLock && HardLock.isHard && HardLock.isHard() && !opts.allowHard) {
        return Promise.resolve(null);
      }

      if (reset) {
        if (DOM.showMoreWrap) DOM.showMoreWrap.classList.add('d-none');
        if (DOM.showMoreHint) DOM.showMoreHint.textContent = '';
        pageState.offset = 0;
        pageState.files = [];
      }

      return fetchListSafe(pageState.offset, !reset, 'Index', 'Could not load list (network/server error).');
    }

    return {
      fetchListSafe: fetchListSafe,
      refreshToDesiredCount: refreshToDesiredCount,
      runQuery: runQuery
    };
  };

})();