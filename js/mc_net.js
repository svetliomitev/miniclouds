/* MiniCloudS mc_net.js
   - Unified fetch + JSON parsing (extracted from app.js)
   - Exposes: MC.Net
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.Net = (function(){
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

})();