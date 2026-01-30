/* MiniCloudS mc_toast.js
   - Toast owner (extracted from app.js)
   - Exposes: MC.initToast(deps) -> Toast
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initToast = function initToast(deps){
    deps = deps || {};
    var DOM = deps.DOM || {};
    var L = deps.L || {};
    var forceShow = deps.forceShow;
    var forceHide = deps.forceHide;

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
      if (DOM.toast && DOM.toast.el && forceHide) forceHide(DOM.toast.el);
    }

    function hideSearch(){
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0; }

      var st = DOM.searchToast || {};
      if (st.scope) {
        try { st.scope.dispose(); } catch (e0) {}
        st.scope = null;
      }
      st.keyLast = null;
      if (st.el && forceHide) forceHide(st.el);
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
      if (kind === 'success') {
        cls += ' text-bg-success';
      } else if (kind === 'danger') {
        cls += ' text-bg-danger';
      } else if (kind === 'warning') {
        cls += ' text-bg-warning';
      } else if (kind === 'info') {
        cls += ' text-bg-info';
      } else {
        cls += ' text-bg-secondary';
      }

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
      if (closable && t.close && L.scope) {
        mainScope = L.scope();
        mainScope.on(t.close, 'click', function(ev){
          ev.preventDefault();
          ev.stopPropagation();
          hideMain();
        });
      } else {
        mainScope = null;
      }

      if (t.el && forceShow) forceShow(t.el);
      t.el.classList.add('show');

      if (!opts.sticky) {
        mainTimer = setTimeout(function(){
          mainTimer = 0;
          hideMain();
        }, Number(opts.ttl || 2000));
      }
    }

    // Sticky “working” (Delete All / Rebuild)
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

      st.scope = (L.scope ? L.scope() : null);

      function hide(){ hideSearch(); }

      function scrollToResultsAndHide(){
        var target = DOM.filesSection;
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior:'smooth', block:'start' });
        hide();
      }

      if (st.scope && st.scope.on) {
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
      }

      if (st.el && forceShow) forceShow(st.el);
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
  };

})();