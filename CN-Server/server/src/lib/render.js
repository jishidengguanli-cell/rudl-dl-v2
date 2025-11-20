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
  const downloadHrefIpa = hasIpa ? `/dl/${encodeURIComponent(link.code)}?p=ipa` : '';
  const developerName =
    ipaFile?.bundleId || link.bundleId || apkFile?.bundleId || link.title || translator('downloadPage.enterpriseDev');
  const currentYear = new Date().getFullYear();

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
    .btn.ghost { background:#192235; color:#cbd5e1; border:none; }
    .btn.red { background:#ef4444; color:#fff; border:none; }
    .tip { margin-top:1.5rem; padding:0.9rem 1.2rem; border-radius:12px; background:#1e1b4b; color:#c7d2fe; }
    .lang-switch { display:flex; align-items:center; gap:0.75rem; margin-top:1.5rem; font-size:0.9rem; color:#cbd5f5; }
    .lang-switch select { background:#0b1222; border:1px solid #334155; color:#f8fafc; border-radius:10px; padding:0.4rem 0.8rem; }
    .muted { color:#94a3b8; }
    .guide-mask { position:fixed; inset:0; background:rgba(0,0,0,.55); display:none; z-index:9999; }
    .guide { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(540px,92vw); background:#0b1220; color:#e5e7eb; border:1px solid #1f2937; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.4); padding:18px; z-index:10000; display:none; }
    .guide h3 { margin:0 0 8px; }
    .guide .steps { margin:10px 0 0 18px; padding:0; }
    .guide .row { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
    .guide .footer { display:flex; justify-content:space-between; align-items:center; margin-top:12px; gap:8px; font-size:0.85rem; }
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
          <a id="btn-ios" class="btn secondary${hasIpa ? '' : ' disabled'}" href="${attr(downloadHrefIpa)}" ${
    hasIpa ? '' : 'aria-disabled="true"'
  } data-dev="${attr(developerName)}">${escapeHtml(translator('downloadPage.iosInstall'))}</a>
        </div>
      </div>

      <div class="tip">${escapeHtml(translator('downloadPage.tip'))}</div>
      ${switcher}
    </div>
  </div>
  <div class="guide-mask" id="iosGuideMask" style="display:none"></div>
  <div class="guide" id="iosGuide" style="display:none" role="dialog" aria-modal="true" aria-labelledby="iosGuideTitle">
    <h3 id="iosGuideTitle">${escapeHtml(translator('downloadPage.iosGuideTitle'))}</h3>
    <div class="muted" id="iosPath">${escapeHtml(translator('downloadPage.iosGuideDetecting'))}</div>
    <ol class="steps" id="iosSteps">
      <li>${escapeHtml(translator('downloadPage.step1'))}</li>
      <li>${escapeHtml(translator('downloadPage.step2'))}</li>
      <li>${escapeHtml(translator('downloadPage.step3a'))} <b><span id="devName">${escapeHtml(
        developerName
      )}</span></b></li>
      <li>${escapeHtml(translator('downloadPage.step4'))}</li>
    </ol>

    <div class="row">
      <button class="btn ghost" id="btnCopyDev" type="button">${escapeHtml(translator('downloadPage.copyDev'))}</button>
      <button class="btn" id="btnOpenApp" type="button" data-scheme="">${escapeHtml(
        translator('downloadPage.tryOpenApp')
      )}</button>
      <button class="btn red" id="btnCloseGuide" type="button">${escapeHtml(translator('downloadPage.close'))}</button>
    </div>
    <div class="footer">
      <span class="muted">${escapeHtml(translator('downloadPage.trustOnce'))}</span>
      <span class="muted">© ${currentYear}</span>
    </div>
  </div>
  <script>
    (function(){
      function isiOS(){ return /iP(hone|od|ad)/.test(navigator.userAgent); }
      function isSafari(){
        var ua = navigator.userAgent;
        return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
      }
      function iOSMajor(){
        var m = navigator.userAgent.match(/OS (\\d+)_/i);
        return m ? parseInt(m[1], 10) : null;
      }
      function setPath(){
        var v = iOSMajor() || 17;
        var path;
        if (v >= 16) path = '${escapeHtml(translator('downloadPage.path16'))}';
        else if (v >= 14) path = '${escapeHtml(translator('downloadPage.path14'))}';
        else path = '${escapeHtml(translator('downloadPage.pathOld'))}';
        var el = document.getElementById('iosPath');
        if (el) el.innerHTML = '${escapeHtml(translator('downloadPage.detected'))} ' + v + '<br/>' + path;
      }
      function showGuide(){
        setPath();
        if (guide) guide.style.display='block';
        if (mask) mask.style.display='block';
      }
      function hideGuide(){
        if (guide) guide.style.display='none';
        if (mask) mask.style.display='none';
      }

      var iosBtn = document.getElementById('btn-ios');
      var mask  = document.getElementById('iosGuideMask');
      var guide = document.getElementById('iosGuide');
      var openBtn = document.getElementById('btnOpenApp');
      var devName = iosBtn ? iosBtn.getAttribute('data-dev') || '${attr(developerName)}' : '${attr(developerName)}';
      var devLabel = document.getElementById('devName');
      if (devLabel) devLabel.textContent = devName;
      var copyBtn = document.getElementById('btnCopyDev');
      if (copyBtn) {
        copyBtn.addEventListener('click', function(){
          try { navigator.clipboard.writeText(devName); } catch(_) {}
        });
      }
      if (openBtn && window.__APP_SCHEME__) {
        openBtn.setAttribute('data-scheme', window.__APP_SCHEME__);
      }
      if (openBtn) {
        openBtn.addEventListener('click', function(){
          var scheme = openBtn.getAttribute('data-scheme') || '';
          if (scheme) location.href = scheme;
        });
      }
      var closeBtn = document.getElementById('btnCloseGuide');
      if (closeBtn) closeBtn.addEventListener('click', hideGuide);
      if (mask) mask.addEventListener('click', hideGuide);

      if(!iosBtn) return;
      iosBtn.addEventListener('click', function(){
        if(iosBtn.classList.contains('disabled')) return;
        if(!isiOS()) return;
        if(!isSafari()){
          alert('${escapeHtml(translator('downloadPage.alertSafari'))}');
        }
        setTimeout(showGuide, 600);
      });
    })();
  </script>
</body>
</html>`;
};

module.exports = {
  renderDownloadPage,
};
