import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchDistributionByCode } from '@/lib/distribution';
import { getCnDownloadBaseUrl } from '@/lib/cn-server';

import { createTranslator } from '@/i18n/helpers';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/dictionary';
import { languageCodes, tryNormalizeLanguageCode, type LangCode } from '@/lib/language';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  CN_DOWNLOAD_BASE_URL?: string;
};

type DownloadKey =
  | 'download'
  | 'version'
  | 'versionLabel'
  | 'sizeLabel'
  | 'platform'
  | 'androidApk'
  | 'androidNone'
  | 'iosIpa'
  | 'iosNone'
  | 'androidDownload'
  | 'iosInstall'
  | 'noFiles'
  | 'tip'
  | 'iosGuideTitle'
  | 'iosGuideDetecting'
  | 'step1'
  | 'step2'
  | 'step3a'
  | 'step3b'
  | 'step4'
  | 'copyDev'
  | 'tryOpenApp'
  | 'close'
  | 'trustOnce'
  | 'enterpriseDev'
  | 'path16'
  | 'path14'
  | 'pathOld'
  | 'detected'
  | 'language'
  | 'missingMetadata'
  | 'alertSafari'
  | 'alertPoints'
  | 'alertCheckFailed'
  | 'alertNetworkError';

const DEFAULT_APP_TITLE = 'App';
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return new Response('Missing D1 binding DB', {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const params = await context.params;
  const code = String(params?.code ?? '').trim();
  if (!code) return resp404('Invalid code');

  const link = await fetchDistributionByCode(DB, code);
  if (!link || !link.isActive) return resp404('Not Found');
  const url = new URL(request.url);
  if (link.networkArea === 'CN') {
    const cnBase = getCnDownloadBaseUrl(bindings);
    const target = `${cnBase}/d/${encodeURIComponent(link.code)}${url.search}`;
    return Response.redirect(target, 302);
  }

  const files = link.files ?? [];
  const findByPlatform = (platform: string) =>
    files.find(
      (file) => file.r2Key && (file.platform ?? '').toLowerCase() === platform
    ) ?? null;

  const apkFile = findByPlatform('apk');
  const ipaFile = findByPlatform('ipa');

  const hasApk = Boolean(apkFile);
  const hasIpa = Boolean(ipaFile);

  const displayTitle =
    link.title ?? ipaFile?.title ?? apkFile?.title ?? DEFAULT_APP_TITLE;
  const displayBundleId =
    link.bundleId ?? ipaFile?.bundleId ?? apkFile?.bundleId ?? '';

  const androidVersion = apkFile?.version ?? link.apkVersion ?? '';
  const iosVersion = ipaFile?.version ?? link.ipaVersion ?? '';

  const androidSizeValue = typeof apkFile?.size === 'number' ? apkFile.size : null;
  const iosSizeValue = typeof ipaFile?.size === 'number' ? ipaFile.size : null;

  const iosBundleId = ipaFile?.bundleId ?? link.bundleId ?? '';

  const missing: string[] = [];
  if (hasIpa) {
    if (!iosVersion) missing.push('Version');
    if (!iosBundleId) missing.push('Bundle ID');
  }
  const disableIos = !hasIpa || missing.length > 0;

  const qLocale = tryNormalizeLanguageCode(url.searchParams.get('lang'));
  const presetLocale = tryNormalizeLanguageCode(link.language);
  const pathLocale = (() => {
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length ? tryNormalizeLanguageCode(segments[0]) : null;
  })();
  const reqLocale = pickBestLocale(
    qLocale ?? presetLocale ?? pathLocale,
    request.headers.get('accept-language')
  );
  const translator = createTranslator(reqLocale);
  const dl = (key: DownloadKey) => translator(`downloadPage.${key}`);
  const switcher = renderLangSwitcher(link.code, reqLocale, translator);

  const missMsg = missing.length
    ? dl('missingMetadata').replace('{items}', missing.join(', '))
    : '';

  const hrefApk = hasApk ? `/dl/${encodeURIComponent(link.code)}?p=apk` : '';
  const manifestUrl = `${url.origin}/m/${encodeURIComponent(link.code)}`;
  const iosRecordHref = hasIpa ? `/dl/${encodeURIComponent(link.code)}?p=ipa` : '';
  const hrefIos = hasIpa
    ? `itms-services://?action=download-manifest&url=${encodeURIComponent(
        manifestUrl
      )}`
    : '';

  const developerName =
    ipaFile?.bundleId ??
    link.bundleId ??
    displayTitle ??
    dl('enterpriseDev');

  const buildVersionMarkup = () => {
    const segments: string[] = [];
    if (hasApk) {
      segments.push(
        `<div>${h(dl('androidApk'))}: ${h(formatVersionValue(androidVersion))}</div>`
      );
    }
    if (hasIpa) {
      segments.push(
        `<div>${h(dl('iosIpa'))}: ${h(formatVersionValue(iosVersion))}</div>`
      );
    }
    return segments.length ? segments.join('') : `<span class="muted">-</span>`;
  };

  const buildSizeMarkup = () => {
    const segments: string[] = [];
    if (hasApk) {
      segments.push(
        `<div>${h(dl('androidApk'))}: ${h(formatFileSize(androidSizeValue))}</div>`
      );
    }
    if (hasIpa) {
      segments.push(
        `<div>${h(dl('iosIpa'))}: ${h(formatFileSize(iosSizeValue))}</div>`
      );
    }
    return segments.length ? segments.join('') : `<span class="muted">-</span>`;
  };

  const versionMarkup = buildVersionMarkup();
  const sizeMarkup = buildSizeMarkup();

  const nowYear = new Date().getFullYear();
  const accountId = link.ownerId ?? '';
  const dataAttributes = accountId
    ? `data-account="${attr(accountId)}" data-link="${attr(link.id)}"`
    : `data-link="${attr(link.id)}"`;

  const html = `<!doctype html>
<html lang="${attr(htmlLang(reqLocale))}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${h(displayTitle)} - ${h(dl('download'))}</title>
  <meta name="robots" content="noindex,nofollow"/>
  <style>
    body{margin:0;background:#0f172a;color:#e5e7eb;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    header{background:#0b1222;border-bottom:1px solid #1f2937}
    .wrap{max-width:880px;margin:0 auto;padding:16px}
    a{color:#93c5fd;text-decoration:none}
    .card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:22px;margin-top:22px}
    .muted{color:#9ca3af}
    .row{display:flex;gap:14px;flex-wrap:wrap}
    .btn{padding:12px 16px;border-radius:12px;border:0;background:#3b82f6;color:#fff;cursor:pointer}
    .btn.secondary{background:#334155}
    .btn.ghost{background:#1e293b}
    .btn.red{background:#ef4444}
    .meta{display:grid;grid-template-columns:140px 1fr;gap:6px 10px;margin-top:8px}
    code,kbd{background:#0b1222;border:1px solid #334155;border-radius:8px;padding:2px 6px}
    .hero{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .hero h1{margin:0;font-size:22px}
    .btns{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
    .tip{margin-top:10px;font-size:14px;color:#9ca3af}
    .footer{color:#9ca3af;text-align:center;margin:18px 0}
    .lang{display:flex;align-items:center;gap:8px}
    .lang select{padding:.4rem .6rem;border-radius:10px;background:#0b1222;border:1px solid #334155;color:#e5e7eb}

    .guide-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;z-index:9999}
    .guide{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
      width:min(540px,92vw);background:#0b1220;color:#e5e7eb;border:1px solid #1f2937;border-radius:14px;
      box-shadow:0 10px 30px rgba(0,0,0,.4);padding:18px;z-index:10000}
    .guide h3{margin:0 0 8px}
    .guide .muted{color:#9ca3af}
    .guide .steps{margin:10px 0 0 18px}
    .guide .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    .guide .btn{padding:10px 12px;border-radius:10px;border:0;background:#3b82f6;color:#fff;font-size:14px}
    .guide .btn.ghost{background:#1e293b}
    .guide .btn.red{background:#ef4444}
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="lang">${switcher}</div>
    </div>
  </header>
  <main class="wrap">
    <section class="card">
      <div class="hero">
        <div>
          <h1>${h(displayTitle)}</h1>
          <div class="muted">${h(code)}</div>
        </div>
      </div>

      <div class="meta">
        <div class="muted">Bundle ID</div><div>${h(displayBundleId || '-')}</div>
        <div class="muted">${h(dl('versionLabel'))}</div><div>${versionMarkup}</div>
        <div class="muted">${h(dl('sizeLabel'))}</div><div>${sizeMarkup}</div>
      </div>

      <div class="btns">
        ${
          hasApk
            ? `<a class="btn" href="${attr(hrefApk)}" id="btn-android" data-platform="apk" ${dataAttributes}>${h(
                dl('androidDownload')
              )}</a>`
            : ''
        }
        ${
          hasIpa
            ? `<a class="btn" href="${
                attr(disableIos ? '#' : hrefIos)
              }" id="btn-ios" data-platform="ipa" ${dataAttributes} data-dev="${attr(
                developerName
              )}" data-missing="${attr(missMsg)}" data-dl="${attr(iosRecordHref)}" ${
                disableIos ? 'aria-disabled="true"' : ''
              }>${h(dl('iosInstall'))}</a>`
            : ''
        }
        ${
          !hasApk && !hasIpa
            ? `<span class="muted">${h(dl('noFiles'))}</span>`
            : ''
        }
      </div>

      <div class="tip">${h(dl('tip'))}</div>
    </section>
    <div class="footer">© ${nowYear} RU Download</div>
  </main>

  <div class="guide-mask" id="iosGuideMask"></div>
  <div class="guide" id="iosGuide" style="display:none" role="dialog" aria-modal="true" aria-labelledby="iosGuideTitle">
    <h3 id="iosGuideTitle">${h(dl('iosGuideTitle'))}</h3>
    <div class="muted" id="iosPath">${h(dl('iosGuideDetecting'))}</div>
    <ol class="steps" id="iosSteps">
      <li>${h(dl('step1'))}</li>
      <li>${h(dl('step2'))}</li>
      <li>${h(dl('step3a'))} <b><span id="devName">${h(developerName)}</span></b> ${h(dl('step3b'))}</li>
      <li>${h(dl('step4'))}</li>
    </ol>

    <div class="row">
      <button class="btn ghost" id="btnCopyDev" type="button">${h(dl('copyDev'))}</button>
      <button class="btn" id="btnOpenApp" type="button" data-scheme="">${h(dl('tryOpenApp'))}</button>
      <button class="btn red" id="btnCloseGuide" type="button">${h(dl('close'))}</button>
    </div>
    <div class="footer">
      <span class="muted">${h(dl('trustOnce'))}</span>
    </div>
  </div>

  <script>
  (function(){
    var installBtn = document.getElementById('btn-ios');
    var androidBtn = document.getElementById('btn-android');
    var code = (location.pathname.split('/').pop() || '').trim();
    var iosRecordUrl = installBtn ? (installBtn.getAttribute('data-dl') || '') : '';
    var iosRecordSent = false;

    function getBillingPayload(btn, platform){
      if (!btn) return null;
      var linkId = btn.getAttribute('data-link') || '';
      var accountId = btn.getAttribute('data-account') || '';
      if (!linkId || !accountId) return null;
      return JSON.stringify({ account_id: accountId, link_id: linkId, platform: platform });
    }

    if (installBtn) {
      var devName = installBtn.getAttribute('data-dev') || (window.__DEV_NAME__ || '${h(
        developerName
      )}');
      var devEl = document.getElementById('devName'); if (devEl) devEl.textContent = devName;

      var schemeFromGlobal = (window.__APP_SCHEME__ || '');
      var openBtn = document.getElementById('btnOpenApp');
      if (schemeFromGlobal) openBtn.setAttribute('data-scheme', schemeFromGlobal);
      if (!openBtn.getAttribute('data-scheme')) openBtn.style.display = 'none';

      var mask  = document.getElementById('iosGuideMask');
      var guide = document.getElementById('iosGuide');

      function isiOS(){ return /iP(hone|od|ad)/.test(navigator.userAgent); }
      function isSafari(){
        var ua = navigator.userAgent;
        return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
      }
      function iOSMajor(){ var m = navigator.userAgent.match(/OS (\\d+)_/i); return m ? parseInt(m[1],10) : null; }
      function setPath(){
        var v = iOSMajor() || 17;
        var path;
        if (v >= 16) path = '${h(dl('path16'))}';
        else if (v >= 14) path = '${h(dl('path14'))}';
        else path = '${h(dl('pathOld'))}';
        document.getElementById('iosPath').innerHTML = '${h(dl('detected'))} ' + v + '<br/>' + path;
      }
      function showGuide(){ setPath(); guide.style.display='block'; mask.style.display='block'; }
      function hideGuide(){ guide.style.display='none'; mask.style.display='none'; }

      document.getElementById('btnCopyDev').addEventListener('click', function(){ try { navigator.clipboard.writeText(devName); } catch(e){} });
      openBtn && openBtn.addEventListener('click', function(){ var s=openBtn.getAttribute('data-scheme')||''; if(s) location.href=s; });
      document.getElementById('btnCloseGuide').addEventListener('click', hideGuide);
      mask.addEventListener('click', hideGuide);

      var miss = installBtn && installBtn.getAttribute('data-missing');
      if (miss) {
        installBtn.addEventListener('click', function(e){
          e.preventDefault();
          alert(miss);
        });
      } else {
        installBtn.addEventListener('click', function(){
          if (!isiOS()) return;
          if (!isSafari()) {
            alert("${h(dl('alertSafari'))}");
          }
          var payload = getBillingPayload(installBtn, 'ipa');
          if (payload) {
            try {
              if (navigator.sendBeacon) {
                navigator.sendBeacon('/api/dl/bill', new Blob([payload], { type: 'application/json' }));
              } else {
                fetch('/api/dl/bill', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: payload,
                  credentials: 'include'
                }).catch(function(){});
              }
            } catch (_) {}
          }
          if (!iosRecordSent && iosRecordUrl) {
            iosRecordSent = true;
            try {
              fetch(iosRecordUrl, {
                method: 'GET',
                redirect: 'manual',
                cache: 'no-store',
                credentials: 'include'
              }).catch(function(){
                iosRecordSent = false;
              });
            } catch (_) {
              iosRecordSent = false;
            }
          }
          setTimeout(showGuide, 600);
        });
      }
    }

    if (androidBtn) {
      androidBtn.addEventListener('click', async function(e){
        e.preventDefault();
        var href = androidBtn.getAttribute('href');
        if (!href) return;
        var payload = getBillingPayload(androidBtn, 'apk');
        if (!payload) {
          location.href = href;
          return;
        }
        androidBtn.disabled = true; var ori = androidBtn.textContent; androidBtn.textContent = '...';
        try{
          const res = await fetch('/api/dl/bill', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload,
            credentials: 'include'
          });
          if (res.ok) {
            location.href = href;
            return;
          }
          if (res.status === 402) {
            alert("${h(dl('alertPoints'))}");
          } else {
            alert("${h(dl('alertCheckFailed'))}");
          }
        } catch(_){
          alert("${h(dl('alertNetworkError'))}");
        } finally {
          androidBtn.disabled = false;
          androidBtn.textContent = ori;
        }
      });
    }
  })();
  </script>
</body>
</html>`;

  const response = new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
  const cookieDirectives = `Path=/; Max-Age=31536000; SameSite=Lax`;
  response.headers.append('set-cookie', `lang=${reqLocale}; ${cookieDirectives}`);
  response.headers.append('set-cookie', `locale=${reqLocale}; ${cookieDirectives}`);
  return response;
}

function renderLangSwitcher(code: string, cur: Locale, translate: (key: string) => string) {
  const items = languageCodes
    .map((value) => {
      const label = translate(`language.name.${value}`);
      return `<option value="${h(value)}"${value === cur ? ' selected' : ''}>${h(label)}</option>`;
    })
    .join('');

  return `
  <label style="display:inline-flex;align-items:center;gap:.5rem">
    <span style="opacity:.75">${h(translate('downloadPage.language'))}</span>
    <select id="langSel"
            style="padding:.4rem .6rem;border-radius:10px;background:#0b1222;border:1px solid #334155;color:#e5e7eb">
      ${items}
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
}

function pickBestLocale(primary: LangCode | null, accept: string | null): Locale {
  if (primary) return primary;
  const header = (accept ?? '').toLowerCase();
  if (/zh\-tw|zh\-hant/.test(header)) return 'zh-TW';
  if (/zh|hans|cn/.test(header)) return 'zh-CN';
  if (/ru/.test(header)) return 'ru';
  if (/vi/.test(header)) return 'vi';
  if (/en/.test(header)) return 'en';
  return DEFAULT_LOCALE;
}

function formatVersionValue(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || '-';
}

function formatFileSize(size: number | null | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return '-';
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (size >= GB) return `${(size / GB).toFixed(1)} GB`;
  if (size >= MB) return `${(size / MB).toFixed(1)} MB`;
  if (size >= KB) return `${(size / KB).toFixed(1)} KB`;
  return `${size} B`;
}

function htmlLang(value: Locale) {
  if (value === 'zh-CN') return 'zh-Hans';
  if (value === 'zh-TW') return 'zh-Hant';
  return value;
}

function resp404(message: string) {
  return new Response(message || 'Not Found', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}

function h(input: unknown) {
  return String(input ?? '').replace(/[&<>"']/g, (match) => {
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
}

function attr(input: unknown) {
  return h(input).replace(/"/g, '&quot;');
}
