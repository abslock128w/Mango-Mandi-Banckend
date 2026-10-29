"use client";

export function RetryButton() {
  return (
    <button type="button" onClick={() => window.location.reload()} className="press mt-6 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
      Try again
    </button>
  );
}
