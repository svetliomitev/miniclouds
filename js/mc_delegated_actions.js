/* mc_delegated_actions.js
   Delegated grid actions (share / download / link pill click + keyboard)
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initDelegatedActions = function initDelegatedActions(opts){
    opts = opts || {};

    var DOM = opts.DOM;
    var L = opts.L;

    var Links = opts.Links;

    var decName = opts.decName;

    function ensureVisibleSharedUrls(){
      if (Links && Links.ensureVisibleSharedUrls) Links.ensureVisibleSharedUrls();
    }

    function onLinkPillClick(pill){
      if (Links && Links.onLinkPillClick) return Links.onLinkPillClick(pill);
      return Promise.resolve();
    }

    function toggleShareByFilename(file){
      if (Links && Links.toggleShareByFilename) return Links.toggleShareByFilename(file);
      return Promise.resolve();
    }

    function downloadByFilename(file){
      if (Links && Links.downloadByFilename) return Links.downloadByFilename(file);
      return Promise.resolve();
    }

    function wire(){
      if (!DOM || !DOM.grid) return;

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

    return {
      wire: wire,
      ensureVisibleSharedUrls: ensureVisibleSharedUrls
    };
  };
})();