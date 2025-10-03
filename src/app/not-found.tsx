export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-gray-900">
      <h1 className="text-2xl font-semibold">Page Not Found</h1>
      <p className="text-sm text-gray-600">The page you are looking for does not exist.</p>
    </div>
  );
}