/* MiniCloudS mc_endpoints.js
   - Base-safe endpoints resolver (extracted from app.js)
   - Exposes: MC.EP.init() -> { index, link }
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.EP = MC.EP || {};

  MC.EP.init = function initEndpoints(){
    function baseDirUrl(){
      // Stable directory base even when current URL is "/subdir" (no trailing slash)
      // or "/subdir?..." etc.
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
  };

})();