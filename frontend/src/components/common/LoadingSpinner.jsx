import { Loader2 } from 'lucide-react';

export default function LoadingSpinner({ fullscreen = true }) {
  if (fullscreen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-3">
        <Loader2 size={28} className="animate-spin text-primary-500" />
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={22} className="animate-spin text-primary-500" />
    </div>
  );
}