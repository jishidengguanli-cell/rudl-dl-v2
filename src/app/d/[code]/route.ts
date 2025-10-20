import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchDistributionByCode } from '@/lib/distribution';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

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
  const missMsg = missing.length
    ? `Missing metadata: ${missing.join(', ')}`
    : '';
  const disableIos = !hasIpa || missing.length > 0;

  const url = new URL(request.url);
  const qlang = normLang(url.searchParams.get('lang'));
  const reqLang = pickBestLang(qlang, request.headers.get('accept-language'));
  const t = (key: string) =>
    LOCALES[reqLang]?.[key] ?? LOCALES['zh-TW'][key] ?? key;
  const switcher = renderLangSwitcher(link.code, reqLang);

  const hrefApk = hasApk ? `/dl/${encodeURIComponent(link.code)}?p=apk` : '';
  const manifestUrl = `${url.origin}/m/${encodeURIComponent(link.code)}`;
  const hrefIos = hasIpa
    ? `itms-services://?action=download-manifest&url=${encodeURIComponent(
        manifestUrl
      )}`
    : '';

  const developerName =
    ipaFile?.bundleId ??
    link.bundleId ??
    displayTitle ??
    t('enterpriseDev');

  const buildVersionMarkup = () => {
    const segments: string[] = [];
    if (hasApk) {
      segments.push(
        `<div>${h(t('androidApk'))}: ${h(formatVersionValue(androidVersion))}</div>`
      );
    }
    if (hasIpa) {
      segments.push(
        `<div>${h(t('iosIpa'))}: ${h(formatVersionValue(iosVersion))}</div>`
      );
    }
    return segments.length ? segments.join('') : `<span class="muted">-</span>`;
  };

  const buildSizeMarkup = () => {
    const segments: string[] = [];
    if (hasApk) {
      segments.push(
        `<div>${h(t('androidApk'))}: ${h(formatFileSize(androidSizeValue))}</div>`
      );
    }
    if (hasIpa) {
      segments.push(
        `<div>${h(t('iosIpa'))}: ${h(formatFileSize(iosSizeValue))}</div>`
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
<html lang="${attr(htmlLang(reqLang))}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${h(displayTitle)} - ${h(t('download'))}</title>
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
        <div class="muted">${h(t('versionLabel'))}</div><div>${versionMarkup}</div>
        <div class="muted">${h(t('sizeLabel'))}</div><div>${sizeMarkup}</div>
      </div>

      <div class="btns">
        ${
          hasApk
            ? `<a class="btn" href="${attr(hrefApk)}" id="btn-android" data-platform="apk" ${dataAttributes}>${h(
                t('androidDownload')
              )}</a>`
            : ''
        }
        ${
          hasIpa
            ? `<a class="btn" href="${
                attr(disableIos ? '#' : hrefIos)
              }" id="btn-ios" data-platform="ipa" ${dataAttributes} data-dev="${attr(
                developerName
              )}" data-missing="${attr(missMsg)}" ${
                disableIos ? 'aria-disabled="true"' : ''
              }>${h(t('iosInstall'))}</a>`
            : ''
        }
        ${
          !hasApk && !hasIpa
            ? `<span class="muted">${h(t('noFiles'))}</span>`
            : ''
        }
      </div>

      <div class="tip">${h(t('tip'))}</div>
    </section>
    <div class="footer">© ${nowYear} RU Download</div>
  </main>

  <div class="guide-mask" id="iosGuideMask"></div>
  <div class="guide" id="iosGuide" style="display:none" role="dialog" aria-modal="true" aria-labelledby="iosGuideTitle">
    <h3 id="iosGuideTitle">${h(t('iosGuideTitle'))}</h3>
    <div class="muted" id="iosPath">${h(t('iosGuideDetecting'))}</div>
    <ol class="steps" id="iosSteps">
      <li>${h(t('step1'))}</li>
      <li>${h(t('step2'))}</li>
      <li>${h(t('step3a'))} <b><span id="devName">${h(developerName)}</span></b> ${h(t('step3b'))}</li>
      <li>${h(t('step4'))}</li>
    </ol>

    <div class="row">
      <button class="btn ghost" id="btnCopyDev" type="button">${h(t('copyDev'))}</button>
      <button class="btn" id="btnOpenApp" type="button" data-scheme="">${h(t('tryOpenApp'))}</button>
      <button class="btn red" id="btnCloseGuide" type="button">${h(t('close'))}</button>
    </div>
    <div class="footer">
      <span class="muted">${h(t('trustOnce'))}</span>
    </div>
  </div>

  <script>
  (function(){
    var installBtn = document.getElementById('btn-ios');
    var androidBtn = document.getElementById('btn-android');
    var code = (location.pathname.split('/').pop() || '').trim();

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
        if (v >= 16) path = '${h(t('path16'))}';
        else if (v >= 14) path = '${h(t('path14'))}';
        else path = '${h(t('pathOld'))}';
        document.getElementById('iosPath').innerHTML = '${h(t('detected'))} ' + v + '<br/>' + path;
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
            alert('Please use Safari to install this iOS app.');
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
            alert('Insufficient points. Please recharge.');
          } else {
            alert('Download check failed. Please retry later.');
          }
        } catch(_){
          alert('Network error. Please retry later.');
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

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
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

const LOCALES: Record<string, Record<string, string>> = {
  'zh-TW': {
    download: '下載',
    version: '版本',
    versionLabel: '版本',
    sizeLabel: '檔案大小',
    platform: '平台',
    androidApk: 'Android',
    androidNone: 'Android（無）',
    iosIpa: 'iOS',
    iosNone: 'iOS（無）',
    androidDownload: 'Android 下載',
    iosInstall: 'iOS 安裝',
    noFiles: '尚未上傳可供下載的檔案。',
    tip: '提醒：第一次安裝企業 App，請至「設定」→「一般」→「VPN 與裝置管理 / 描述檔與裝置管理」信任開發者。',
    iosGuideTitle: '下一步：啟用企業 App',
    iosGuideDetecting: '正在偵測 iOS 版本…',
    step1: '安裝完成後，暫時不要開啟 App。',
    step2: '開啟「設定」→「一般」→「VPN 與裝置管理 / 描述檔與裝置管理」。',
    step3a: '在「開發者 App」中選擇',
    step3b: '並點擊「信任」→「確認」。',
    step4: '返回主畫面並開啟 App。',
    copyDev: '複製開發者名稱',
    tryOpenApp: '嘗試開啟 App',
    close: '關閉',
    trustOnce: '＊只需信任一次即可。',
    enterpriseDev: '企業開發者',
    path16: '設定 → 一般 → VPN 與裝置管理 → 開發者 App → 信任',
    path14: '設定 → 一般 → 描述檔與裝置管理 → 開發者 App → 信任',
    pathOld: '設定 → 一般 → 裝置管理 / 描述檔 → 開發者 App → 信任',
    detected: '偵測到 iOS',
    language: '語言',
  },
  en: {
    download: 'Download',
    version: 'Version',
    versionLabel: 'Version',
    sizeLabel: 'File Size',
    platform: 'Platform',
    androidApk: 'Android',
    androidNone: 'Android (none)',
    iosIpa: 'iOS',
    iosNone: 'iOS (none)',
    androidDownload: 'Download for Android',
    iosInstall: 'Install on iOS',
    noFiles: 'No downloadable files uploaded yet.',
    tip: 'Tip: For the first enterprise app install, go to Settings → General → VPN & Device Management / Profiles & Device Management to trust the developer.',
    iosGuideTitle: 'Next step: Enable the enterprise app',
    iosGuideDetecting: 'Detecting iOS version…',
    step1: 'After installation, do not open the app immediately.',
    step2: 'Open Settings → General → VPN & Device Management / Profiles & Device Management.',
    step3a: 'Under “Developer App”, select',
    step3b: 'then tap “Trust” → “Verify”.',
    step4: 'Return to the home screen and launch the app.',
    copyDev: 'Copy developer name',
    tryOpenApp: 'Try opening the app',
    close: 'Close',
    trustOnce: '*You only need to trust this developer once.',
    enterpriseDev: 'Enterprise Developer',
    path16: 'Settings → General → VPN & Device Management → Developer App → Trust',
    path14: 'Settings → General → Profiles & Device Management → Developer App → Trust',
    pathOld: 'Settings → General → Device Management / Profiles → Developer App → Trust',
    detected: 'Detected iOS',
    language: 'Language',
  },
  'zh-CN': {
    download: '下载',
    version: '版本',
    versionLabel: '版本',
    sizeLabel: '文件大小',
    platform: '平台',
    androidApk: 'Android',
    androidNone: 'Android（无）',
    iosIpa: 'iOS',
    iosNone: 'iOS（无）',
    androidDownload: 'Android 下载',
    iosInstall: 'iOS 安装',
    noFiles: '尚未上传可下载的文件。',
    tip: '提示：首次安装企业 App，请前往“设置”→“通用”→“VPN 与设备管理 / 描述文件与设备管理”信任开发者。',
    iosGuideTitle: '下一步：启用企业 App',
    iosGuideDetecting: '正在检测 iOS 版本…',
    step1: '安装完成后，请先不要打开 App。',
    step2: '打开“设置”→“通用”→“VPN 与设备管理 / 描述文件与设备管理”。',
    step3a: '在“开发者 App”中选择',
    step3b: '并点击“信任”→“确认”。',
    step4: '返回主屏幕并打开 App。',
    copyDev: '复制开发者名称',
    tryOpenApp: '尝试打开 App',
    close: '关闭',
    trustOnce: '＊只需信任一次即可。',
    enterpriseDev: '企业开发者',
    path16: '设置 → 通用 → VPN 与设备管理 → 开发者 App → 信任',
    path14: '设置 → 通用 → 描述文件与设备管理 → 开发者 App → 信任',
    pathOld: '设置 → 通用 → 设备管理 / 描述文件 → 开发者 App → 信任',
    detected: '检测到 iOS',
    language: '语言',
  },
  ru: {
    download: 'Скачать',
    version: 'Версия',
    versionLabel: 'Версия',
    sizeLabel: 'Размер файла',
    platform: 'Платформа',
    androidApk: 'Android',
    androidNone: 'Android (нет)',
    iosIpa: 'iOS',
    iosNone: 'iOS (нет)',
    androidDownload: 'Скачать для Android',
    iosInstall: 'Установить на iOS',
    noFiles: 'Файлы для скачивания ещё не загружены.',
    tip: 'Совет: при первой установке корпоративного приложения откройте Настройки → Основные → VPN и управление устройством / Профили и управление устройством и подтвердите разработчика.',
    iosGuideTitle: 'Следующий шаг: активируйте корпоративное приложение',
    iosGuideDetecting: 'Определяем версию iOS…',
    step1: 'После установки не запускайте приложение сразу.',
    step2: 'Откройте Настройки → Основные → VPN и управление устройством / Профили и управление устройством.',
    step3a: 'В разделе “Developer App” выберите',
    step3b: 'и нажмите “Доверять” → “Подтвердить”.',
    step4: 'Вернитесь на главный экран и откройте приложение.',
    copyDev: 'Скопировать имя разработчика',
    tryOpenApp: 'Попробовать открыть приложение',
    close: 'Закрыть',
    trustOnce: '*Подтвердить разработчика нужно лишь один раз.',
    enterpriseDev: 'Корпоративный разработчик',
    path16: 'Настройки → Основные → VPN и управление устройством → Developer App → Доверять',
    path14: 'Настройки → Основные → Профили и управление устройством → Developer App → Доверять',
    pathOld: 'Настройки → Основные → Управление устройством / Профили → Developer App → Доверять',
    detected: 'Обнаружена iOS',
    language: 'Язык',
  },
  vi: {
    download: 'Tải xuống',
    version: 'Phiên bản',
    versionLabel: 'Phiên bản',
    sizeLabel: 'Dung lượng',
    platform: 'Nền tảng',
    androidApk: 'Android',
    androidNone: 'Android (không có)',
    iosIpa: 'iOS',
    iosNone: 'iOS (không có)',
    androidDownload: 'Tải cho Android',
    iosInstall: 'Cài trên iOS',
    noFiles: 'Chưa có tệp nào để tải xuống.',
    tip: 'Mẹo: Lần đầu cài ứng dụng doanh nghiệp, vào Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị / Hồ sơ & Quản lý thiết bị để tin cậy nhà phát triển.',
    iosGuideTitle: 'Bước tiếp theo: kích hoạt ứng dụng doanh nghiệp',
    iosGuideDetecting: 'Đang xác định phiên bản iOS…',
    step1: 'Sau khi cài đặt, chưa mở ứng dụng ngay.',
    step2: 'Mở Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị / Hồ sơ & Quản lý thiết bị.',
    step3a: 'Trong “Developer App”, chọn',
    step3b: 'và nhấn “Tin cậy” → “Xác minh”.',
    step4: 'Quay lại màn hình chính và mở ứng dụng.',
    copyDev: 'Sao chép tên nhà phát triển',
    tryOpenApp: 'Thử mở ứng dụng',
    close: 'Đóng',
    trustOnce: '*Chỉ cần tin cậy nhà phát triển một lần.',
    enterpriseDev: 'Nhà phát triển doanh nghiệp',
    path16: 'Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → Developer App → Tin cậy',
    path14: 'Cài đặt → Cài đặt chung → Hồ sơ & Quản lý thiết bị → Developer App → Tin cậy',
    pathOld: 'Cài đặt → Cài đặt chung → Quản lý thiết bị / Hồ sơ → Developer App → Tin cậy',
    detected: 'Đã phát hiện iOS',
    language: 'Ngôn ngữ',
  },
};

function renderLangSwitcher(code: string, cur: string) {
  const options: Array<{ v: string; label: string }> = [
    { v: 'en', label: 'English' },
    { v: 'ru', label: 'Русский' },
    { v: 'vi', label: 'Tiếng Việt' },
    { v: 'zh-TW', label: '繁體中文' },
    { v: 'zh-CN', label: '简体中文' },
  ];

  const langLabel = LOCALES[cur]?.language ?? LOCALES['zh-TW'].language ?? 'Language';
  const items = options
    .map((item) => `<option value="${h(item.v)}"${item.v === cur ? ' selected' : ''}>${h(item.label)}</option>`)
    .join('');

  return `
  <label style="display:inline-flex;align-items:center;gap:.5rem">
    <span style="opacity:.75">${h(langLabel)}</span>
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

function normLang(value?: string | null) {
  if (!value) return '';
  const s = value.trim();
  if (s === 'zh' || s === 'zh-Hant') return 'zh-TW';
  if (s === 'zh-Hans') return 'zh-CN';
  if (s === 'en-US' || s === 'en-GB') return 'en';
  return ['zh-TW', 'en', 'zh-CN', 'ru', 'vi'].includes(s) ? s : '';
}

function pickBestLang(primary: string, accept: string | null) {
  if (primary) return primary;
  const header = (accept || '').toLowerCase();
  if (/zh\-tw|zh\-hant/.test(header)) return 'zh-TW';
  if (/zh|hans|cn/.test(header)) return 'zh-CN';
  if (/ru/.test(header)) return 'ru';
  if (/vi/.test(header)) return 'vi';
  if (/en/.test(header)) return 'en';
  return 'zh-TW';
}

function htmlLang(value: string) {
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
