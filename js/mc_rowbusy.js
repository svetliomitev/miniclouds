/* mc_rowbusy.js
   - Per-row busy lock owner (extracted from app.js)
   - Exposes: MC.initRowBusy(deps) -> RowBusy API
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initRowBusy = function initRowBusy(deps){
    deps = deps || {};
    var DOM = deps.DOM || {};
    var encName = deps.encName;
    var cssEscape = deps.cssEscape;

    var map = Object.create(null);

    function set(filename, busy){
      filename = String(filename || '');
      if (!filename) return;

      if (busy) map[filename] = 1;
      else delete map[filename];

      if (!DOM.grid) return;
      if (typeof encName !== 'function' || typeof cssEscape !== 'function') return;

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

    return { set:set, isBusy:isBusy, reapplyAll:reapplyAll };
  };
})();