import "./globals.css";

export const metadata = { title: "RUDL Web" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900">
        <div className="max-w-4xl mx-auto p-6">
          <header className="mb-6 border-b pb-4 flex items-center gap-4">
            <a href="/dashboard" className="font-bold">RUDL</a>
            <nav className="text-sm flex gap-3">
              <a href="/dashboard">Dashboard</a>
              <a href="/distributions">Distributions</a>
              <a href="/login" className="ml-auto">Login</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
