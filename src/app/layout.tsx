export const metadata = { title: "DataruApp V2", description: "Next + Cloudflare Pages" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-5xl p-6">
          <header className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold">DataruApp V2</h1>
            <nav className="space-x-4 text-sm">
              <a className="underline" href="/">Home</a>
              <a className="underline" href="/dashboard">Dashboard</a>
              <a className="underline" href="/playground/bill">Bill Test</a>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="mt-10 text-xs text-gray-500">© {new Date().getFullYear()} DataruApp</footer>
        </div>
      </body>
    </html>
  );
}
