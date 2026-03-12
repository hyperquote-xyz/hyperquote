"use client";

const isDev = process.env.NODE_ENV === "development";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 40, fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h2>
      <p style={{ color: "#888", marginTop: 8 }}>
        {isDev ? error.message : "An unexpected error occurred. Please try again."}
      </p>
      {error.digest && (
        <p style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
          Error ID: {error.digest}
        </p>
      )}
      {isDev && error.stack && (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#888", marginTop: 16, padding: 12, background: "#111", borderRadius: 8, overflow: "auto" }}>
          {error.stack}
        </pre>
      )}
      <button
        onClick={() => reset()}
        style={{ marginTop: 16, padding: "8px 16px", borderRadius: 6, border: "1px solid #333", background: "#222", color: "#fff", cursor: "pointer" }}
      >
        Try again
      </button>
    </div>
  );
}
