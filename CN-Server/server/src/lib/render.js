const { translate, supportedLocales } = require('./i18n');

const escapeHtml = (input) =>
  String(input ?? '').replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

const attr = (input) => escapeHtml(input).replace(/"/g, '&quot;');

const formatFileSize = (size) => {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return '-';
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (size >= GB) return `${(size / GB).toFixed(1)} GB`;
  if (size >= MB) return `${(size / MB).toFixed(1)} MB`;
  if (size >= KB) return `${(size / KB).toFixed(1)} KB`;
  return `${size} B`;
};

const formatVersionValue = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || '-';
};

const renderLanguageSwitcher = (code, currentLocale) => {
  const options = supportedLocales
    .map(
      (locale) =>
        `<option value="${attr(locale)}"${locale === currentLocale ? ' selected' : ''}>${escapeHtml(
          translate(currentLocale, `language.name.${locale}`)
        )}</option>`
    )
    .join('');

  return `
  <label class="lang-switch">
    <span>${escapeHtml(translate(currentLocale, 'downloadPage.language'))}</span>
    <select id="langSel">
      ${options}
    </select>
  </label>
  <script>
    (function(){
      var sel = document.getElementById('langSel');
      if(!sel) return;
      sel.addEventListener('change', function(){
        var url = new URL(location.href);
        url.searchParams.set('lang', this.value);
        location.href = url.toString();
      });
    })();
  </script>`;
};

const renderDownloadPage = ({ meta, locale, publicBaseUrl }) => {
  const link = meta.link;
  const files = meta.files ?? [];
  const translator = (key) => translate(locale, key);
  const findFile = (platform) =>
    files.find((file) => (file.platform ?? '').toLowerCase() === platform) ?? null;
  const apkFile = findFile('apk');
  const ipaFile = findFile('ipa');
  const hasApk = Boolean(apkFile);
  const hasIpa = Boolean(ipaFile);
  const downloadHrefApk = hasApk ? `/dl/${encodeURIComponent(link.code)}?p=apk` : '';
  const recordHrefIpa = hasIpa ? `/dl/${encodeURIComponent(link.code)}?p=ipa&record=1` : '';
  const manifestUrl = `${publicBaseUrl}/m/${encodeURIComponent(link.code)}`;
  const iosInstallUrl = hasIpa
    ? `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`
    : '';

  const renderFileRow = (title, file) => {
    if (!file) {
      return `<div class="file-row file-row--empty">${escapeHtml(
        translator(title === 'Android APK' ? 'downloadPage.androidNone' : 'downloadPage.iosNone')
      )}</div>`;
    }
    return `<div class="file-row">
      <div class="file-row__meta">
        <div class="file-row__name">${escapeHtml(file.title ?? link.title ?? 'APP')}</div>
        <div class="file-row__details">
          ${escapeHtml(translator('downloadPage.versionLabel'))}: ${escapeHtml(
            formatVersionValue(file.version)
          )} · ${escapeHtml(translator('downloadPage.sizeLabel'))}: ${escapeHtml(
      formatFileSize(Number(file.size ?? 0))
    )}
        </div>
      </div>
    </div>`;
  };

  const switcher = renderLanguageSwitcher(link.code, locale);

  return `<!DOCTYPE html>
<html lang="${attr(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(link.title ?? 'App')} · ${escapeHtml(
    translator('downloadPage.download')
  )}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background:#0b1222; color:#f1f5f9; }
    .container { max-width: 640px; margin: 0 auto; padding: 2.5rem 1.5rem 3rem; }
    .card { background: #0f172a; border-radius: 18px; padding: 2rem; box-shadow: 0 30px 60px rgba(15,23,42,.55); }
    h1 { margin: 0 0 1rem; font-size: 2rem; }
    .meta { display:flex; flex-wrap:wrap; gap:1rem; color:#cbd5f5; }
    .file-group { margin-top: 2rem; }
    .file-row { padding: 1rem; background:#111b2f; border-radius:12px; margin-bottom:0.75rem; }
    .file-row--empty { color:#94a3b8; font-style:italic; text-align:center; }
    .actions { display:flex; flex-direction:column; gap:0.75rem; margin-top:1.5rem; }
    .btn { display:flex; justify-content:center; align-items:center; padding:0.9rem 1rem; border-radius:999px; font-weight:600; text-decoration:none; }
    .btn.primary { background:#38bdf8; color:#0f172a; }
    .btn.secondary { background:#1e293b; color:#e2e8f0; border:1px solid #334155; }
    .tip { margin-top:1.5rem; padding:0.9rem 1.2rem; border-radius:12px; background:#1e1b4b; color:#c7d2fe; }
    .lang-switch { display:flex; align-items:center; gap:0.75rem; margin-top:1.5rem; font-size:0.9rem; color:#cbd5f5; }
    .lang-switch select { background:#0b1222; border:1px solid #334155; color:#f8fafc; border-radius:10px; padding:0.4rem 0.8rem; }
    @media (min-width:640px) {
      .container { padding:3.5rem 0; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>${escapeHtml(link.title ?? ipaFile?.title ?? apkFile?.title ?? 'App')}</h1>
      <div class="meta">
        <div>${escapeHtml(translator('downloadPage.versionLabel'))}: ${escapeHtml(
          formatVersionValue(link.apkVersion || link.ipaVersion)
        )}</div>
        <div>${escapeHtml(translator('downloadPage.platform'))}: ${
          hasApk && hasIpa
            ? 'Android / iOS'
            : hasApk
            ? 'Android'
            : hasIpa
            ? 'iOS'
            : '—'
        }</div>
      </div>

      <div class="file-group">
        <h2>${escapeHtml(translator('downloadPage.androidApk'))}</h2>
        ${renderFileRow('Android APK', apkFile)}
        <div class="actions">
          <a class="btn primary${hasApk ? '' : ' disabled'}" href="${attr(
            downloadHrefApk
          )}" ${hasApk ? '' : 'aria-disabled="true"'}>${escapeHtml(
    translator('downloadPage.androidDownload')
  )}</a>
        </div>
      </div>

      <div class="file-group">
        <h2>${escapeHtml(translator('downloadPage.iosIpa'))}</h2>
        ${renderFileRow('iOS IPA', ipaFile)}
        <div class="actions">
          <a id="btn-ios" class="btn secondary${hasIpa ? '' : ' disabled'}" href="${attr(iosInstallUrl)}" ${
    hasIpa ? '' : 'aria-disabled="true"'
  } data-record="${attr(recordHrefIpa)}" data-install="${attr(iosInstallUrl)}">${escapeHtml(
    translator('downloadPage.iosInstall')
  )}</a>
        </div>
      </div>

      <div class="tip">${escapeHtml(translator('downloadPage.tip'))}</div>
      ${switcher}
    </div>
  </div>
  <script>
    (function(){
      var iosBtn = document.getElementById('btn-ios');
      if(!iosBtn) return;
      iosBtn.addEventListener('click', function(e){
        if(iosBtn.classList.contains('disabled')) return;
        var installUrl = iosBtn.getAttribute('data-install') || iosBtn.getAttribute('href');
        var recordUrl = iosBtn.getAttribute('data-record') || '';
        if(!installUrl){
          return;
        }
        e.preventDefault();
        var navigate = function(){
          if(installUrl) {
            window.location.href = installUrl;
          }
        };
        var fallback = setTimeout(navigate, 1500);
        if(!recordUrl){
          clearTimeout(fallback);
          navigate();
          return;
        }
        fetch(recordUrl, {
          method: 'GET',
          cache: 'no-store',
          keepalive: true,
          redirect: 'manual'
        })
          .catch(function(){})
          .finally(function(){
            clearTimeout(fallback);
            navigate();
          });
      });
    })();
  </script>
</body>
</html>`;
};

module.exports = {
  renderDownloadPage,
};
