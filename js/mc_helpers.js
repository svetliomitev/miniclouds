/* MiniCloudS mc_helpers.js
   - Generic helpers extracted from app.js
   - No app state, no BOOT/DOM/UI coupling
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));
  var H = (MC.h || (MC.h = {}));

  /* =========================
     CSP-SAFE PROGRESS WIDTH
     ========================= */
  // Sets progress width via CSS class mc-w-0..mc-w-100 (no inline style => CSP-safe)
  H.setPctClass = function setPctClass(el, pct){
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
  };

  /* =========================
     SMALL HELPERS
     ========================= */
  H.forceHide = function forceHide(el){
    if (!el) return;
    el.classList.remove('show');
    el.classList.remove('showing');

    // CSP-safe: use a class instead of inline style
    el.classList.add('d-none');

    el.setAttribute('aria-hidden', 'true');
  };

  H.forceShow = function forceShow(el){
    if (!el) return;

    // CSP-safe: remove class instead of inline style
    el.classList.remove('d-none');

    el.removeAttribute('aria-hidden');
  };

  H.setEnabled = function setEnabled(el, enabled){
    if (!el) return;
    el.disabled = !enabled;
    el.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  };

  H.escapeHtml = function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]);
    });
  };

  H.cssEscape = function cssEscape(s){
    s = String(s);
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return s.replace(/["\\#.;?&,+*~':"!^$[\]()=>|/@\s]/g, '\\$&');
  };

  // IMPORTANT: stable attribute representation for filenames
  H.encName = function encName(name){
    try {
      return encodeURIComponent(String(name || ''));
    } catch (e0) {
      return '';
    }
  };

  H.decName = function decName(s){
    try {
      return decodeURIComponent(String(s || ''));
    } catch (e1) {
      return String(s || '');
    }
  };

  H.startDownloadNoNav = function startDownloadNoNav(url){
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
  };

  H.formatBytes = function formatBytes(bytes){
    var units = ['B','KB','MB','GB','TB'];
    var v = Number(bytes) || 0;
    var i = 0;
    while (v >= 1024 && i < units.length - 1) { v = v / 1024; i++; }
    return (i === 0 ? String(Math.floor(v)) : v.toFixed(2)) + ' ' + units[i];
  };

  H.formatDate = function formatDate(ts){
    var d = new Date((Number(ts) || 0) * 1000);
    function pad(n){ return String(n).padStart(2,'0'); }
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  H.splitTerms = function splitTerms(q){
    q = String(q || '').trim();
    if (!q) return [];
    return q.split(/\s+/).filter(Boolean);
  };

  H.escapeRegExp = function escapeRegExp(s){
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  H.highlightText = function highlightText(original, terms){
    if (!terms || !terms.length) return H.escapeHtml(original);
    var parts = [];
    for (var i = 0; i < terms.length; i++) {
      var t = String(terms[i] || '').trim();
      if (t) parts.push(H.escapeRegExp(t));
    }
    if (!parts.length) return H.escapeHtml(original);

    var re;
    try { re = new RegExp('(' + parts.join('|') + ')', 'giu'); }
    catch (e) { return H.escapeHtml(original); }

    var out = '';
    var s = String(original || '');
    var last = 0;
    re.lastIndex = 0;

    var m;
    while ((m = re.exec(s)) !== null) {
      var start = m.index;
      var match = m[0];
      if (start > last) out += H.escapeHtml(s.slice(last, start));
      out += '<mark>' + H.escapeHtml(match) + '</mark>';
      last = start + match.length;
      if (re.lastIndex === start) re.lastIndex++;
    }
    if (last < s.length) out += H.escapeHtml(s.slice(last));
    return out;
  };

})();