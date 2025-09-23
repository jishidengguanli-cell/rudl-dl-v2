export const metadata = { title: "RUDL Admin" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="max-w-6xl mx-auto p-6">
          <h1 className="text-2xl font-semibold">RUDL Admin</h1>
          <nav className="mt-4 mb-6 flex gap-4 text-zinc-300">
            <a href="/" className="hover:text-white">Dashboard</a>
            <a href="/list" className="hover:text-white">List & Edit</a>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
