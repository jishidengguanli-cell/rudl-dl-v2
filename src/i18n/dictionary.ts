export type Locale = 'zh-TW' | 'zh-CN' | 'en';
export const DEFAULT_LOCALE: Locale = 'zh-TW';

type Dict = Record<string, string>;
export const dictionaries: Record<Locale, Dict> = {
  'zh-TW': {
    'app.name': 'DataruApp',
    'nav.home': '首頁',
    'nav.dashboard': '儀表板',
    'nav.bill': '扣點測試',

    'home.title': '歡迎回來',
    'home.desc': '這是 V2 的全新前端與分發系統。',

    'env.check': '環境檢查',
    'env.nextReact': 'Next.js 15 + React 19（App Router）',
    'env.adapter': '轉接器：@cloudflare/next-on-pages',
    'env.d1Binding': 'D1 綁定：',
    'env.r2Cdn': 'R2 以 CDN：',
    'env.linksCount': 'D1 links 計數：',
    'status.unreadable': '無法讀取',
    'status.empty': '沒有資料',
    'status.loading': '載入中…',

    'dashboard.title': 'Links（最近 50 筆）',

    'table.code': 'Code',
    'table.title': 'Title',
    'table.platform': 'Platform',
    'table.active': 'Active',
    'table.actions': '操作',

    'action.download': '下載',

    'bill.title': '扣點測試',
    'bill.account': '帳戶 ID',
    'bill.link': '連結 ID',
    'bill.platform': '平台',
    'bill.submit': '送出',
    'result.label': '結果',
  },

  'zh-CN': {
    'app.name': 'DataruApp',
    'nav.home': '首页',
    'nav.dashboard': '仪表盘',
    'nav.bill': '扣点测试',

    'home.title': '欢迎回来',
    'home.desc': '这是 V2 的全新前端与分发系统。',

    'env.check': '环境检查',
    'env.nextReact': 'Next.js 15 + React 19（App Router）',
    'env.adapter': '适配器：@cloudflare/next-on-pages',
    'env.d1Binding': 'D1 绑定：',
    'env.r2Cdn': 'R2 以 CDN：',
    'env.linksCount': 'D1 links 计数：',
    'status.unreadable': '无法读取',
    'status.empty': '暂无数据',
    'status.loading': '加载中…',

    'dashboard.title': 'Links（最近 50 条）',

    'table.code': 'Code',
    'table.title': 'Title',
    'table.platform': 'Platform',
    'table.active': 'Active',
    'table.actions': '操作',

    'action.download': '下载',

    'bill.title': '扣点测试',
    'bill.account': '账户 ID',
    'bill.link': '链接 ID',
    'bill.platform': '平台',
    'bill.submit': '提交',
    'result.label': '结果',
  },

  en: {
    'app.name': 'DataruApp',
    'nav.home': 'Home',
    'nav.dashboard': 'Dashboard',
    'nav.bill': 'Billing test',

    'home.title': 'Welcome back',
    'home.desc': 'This is the brand-new V2 distribution system.',

    'env.check': 'Environment checks',
    'env.nextReact': 'Next.js 15 + React 19 (App Router)',
    'env.adapter': 'Adapter: @cloudflare/next-on-pages',
    'env.d1Binding': 'D1 binding: ',
    'env.r2Cdn': 'R2 via CDN: ',
    'env.linksCount': 'D1 links count: ',
    'status.unreadable': 'unreadable',
    'status.empty': 'No data',
    'status.loading': 'Loading…',

    'dashboard.title': 'Links (latest 50)',

    'table.code': 'Code',
    'table.title': 'Title',
    'table.platform': 'Platform',
    'table.active': 'Active',
    'table.actions': 'Actions',

    'action.download': 'Download',

    'bill.title': 'Billing test',
    'bill.account': 'Account ID',
    'bill.link': 'Link ID',
    'bill.platform': 'Platform',
    'bill.submit': 'Submit',
    'result.label': 'Result',
  },
};
