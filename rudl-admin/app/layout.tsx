export const metadata = { title: "RUDL Admin" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="max-w-5xl mx-auto p-6">
          <h1 className="text-2xl font-semibold mb-6">RUDL Admin</h1>
          {children}
        </div>
      </body>
    </html>
  );
}
