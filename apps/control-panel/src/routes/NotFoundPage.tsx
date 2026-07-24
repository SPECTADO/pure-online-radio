import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-slate-100 text-center">
      <h1 className="text-4xl font-semibold text-slate-900">404</h1>
      <p className="text-sm text-slate-500">This page doesn't exist.</p>
      <Link to="/" className="text-sm font-medium text-slate-700 underline">
        Back to dashboard
      </Link>
    </div>
  );
}
