/* mc_render.js
   File list renderer (cards + empty state + show-more hint)
*/
(function(){
  'use strict';

  var MC = (window.MC || (window.MC = {}));

  MC.initRender = function initRender(opts){
    opts = opts || {};

    var DOM = opts.DOM;
    var RenderLife = opts.RenderLife;

    var csrfToken = String(opts.csrfToken || '');

    var encName = opts.encName;
    var escapeHtml = opts.escapeHtml;
    var formatBytes = opts.formatBytes;
    var formatDate = opts.formatDate;
    var highlightText = opts.highlightText;

    function renderFiles(arr, totalMatches, highlightTerms, hasMore){
      arr = Array.isArray(arr) ? arr : [];
      totalMatches = Number(totalMatches || 0);

      if (!DOM || !DOM.grid || !DOM.empty) return;

      if (arr.length === 0) {
        DOM.grid.classList.add('d-none');
        DOM.empty.classList.remove('d-none');
        DOM.grid.innerHTML = '';
        if (DOM.showMoreWrap) DOM.showMoreWrap.classList.add('d-none');
        if (DOM.showMoreHint) DOM.showMoreHint.textContent = '';
        if (RenderLife && RenderLife.after) RenderLife.after();
        return;
      }

      DOM.empty.classList.add('d-none');
      DOM.grid.classList.remove('d-none');

      var html = [];
      for (var idx = 0; idx < arr.length; idx++) {
        var f = arr[idx] || {};
        var rawName = String(f.name || '');
        var key = encName(rawName);

        var nameHtml = highlightText(rawName, highlightTerms || []);
        var size = escapeHtml(formatBytes(f.size || 0));
        var mtime = escapeHtml(formatDate(f.mtime || 0));
        var altClass = (idx % 2 === 1) ? 'alt' : '';
        var isShared = !!f.shared;
        var sharedClass = isShared ? ' shared' : '';
        var sharedAttr = isShared ? '1' : '0';
        var url = String(f.url || '');

        var pillText = isShared ? (url ? escapeHtml(url) : 'loading...') : 'File entry not shared';
        var pillClickable = (isShared ? ' is-clickable' : '');
        var shareLabel = isShared ? 'Unshare' : 'Share';

        html.push(
          '<div class="col-12 col-md-6" data-file-card="' + escapeHtml(key) + '">' +
            '<div class="file-card ' + altClass + sharedClass + '"' +
              ' data-shared="' + sharedAttr + '"' +
              ' data-url="' + escapeHtml(url) + '">' +

              '<div class="file-name">' + nameHtml + '</div>' +

              '<div class="file-meta">' +
                '<div class="file-meta-row">' +
                  '<div><span class="text-body-secondary">Size:</span> ' + size + '</div>' +
                  '<div><span class="text-body-secondary">Date:</span> ' + mtime + '</div>' +
                '</div>' +
              '</div>' +

              '<div class="file-link-row">' +
                '<div class="file-link-pill' + pillClickable + '"' +
                  (isShared ? ' title="Click to copy link"' : '') +
                  ' role="' + (isShared ? 'button' : 'note') + '"' +
                  ' tabindex="' + (isShared ? '0' : '-1') + '"' +
                  ' data-link-pill' +
                  ' data-f="' + escapeHtml(key) + '">' +
                    '<span data-link-text>' + pillText + '</span>' +
                '</div>' +
              '</div>' +

              '<div class="file-actions">' +
                '<button class="btn btn-outline-secondary btn-sm" type="button"' +
                  ' data-f="' + escapeHtml(key) + '"' +
                  ' data-share-btn>' + shareLabel + '</button>' +

                '<button class="btn btn-outline-primary btn-sm" type="button"' +
                  ' data-f="' + escapeHtml(key) + '"' +
                  ' data-download-btn>Download</button>' +

                '<form method="post" class="js-ajax" data-confirm="Delete this file?">' +
                  '<input type="hidden" name="csrf" value="' + escapeHtml(csrfToken) + '">' +
                  '<input type="hidden" name="action" value="delete_one">' +
                  '<input type="hidden" name="name" value="' + escapeHtml(rawName) + '">' +
                  '<button class="btn btn-outline-danger btn-sm" type="submit">Delete</button>' +
                '</form>' +
              '</div>' +

            '</div>' +
          '</div>'
        );
      }

      DOM.grid.innerHTML = html.join('');

      if (DOM.showMoreWrap && DOM.buttons && DOM.buttons.showMore && DOM.showMoreHint) {
        if (hasMore) {
          DOM.showMoreWrap.classList.remove('d-none');
          DOM.showMoreHint.textContent = 'Showing ' + arr.length + ' of ' + totalMatches + ' match(es).';
        } else {
          DOM.showMoreWrap.classList.add('d-none');
          DOM.showMoreHint.textContent = '';
        }
      }

      if (RenderLife && RenderLife.after) RenderLife.after();
    }

    return { renderFiles: renderFiles };
  };
})();