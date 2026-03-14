"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contract {
  id: string;
  prompt: string;
  content: string | null;
  status: string;
  created_at: string;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchContracts() {
      try {
        const res = await fetch("/api/contracts/list");
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to fetch contracts.");
        setContracts(data.contracts);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load contracts.");
      } finally {
        setLoading(false);
      }
    }
    fetchContracts();
  }, []);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  return (
    <main style={{
      minHeight: "100vh", background: "#f5f5f5",
      backgroundImage: `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`,
      backgroundSize: "40px 40px",
      fontFamily: "var(--font-geist-sans, 'Helvetica Neue', Arial, sans-serif)",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Nav */}
      <nav style={{
        borderBottom: "2px solid #111", background: "#f5f5f5",
        padding: "0 32px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 52,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.03em", color: "#111" }}>clausifai</span>
          <span style={{ fontSize: 17, fontWeight: 900, color: "#D0021B" }}>.</span>
        </Link>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#999" }}>Contracts</span>
      </nav>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "52px 24px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 36 }}>
          <div>
            <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.04em", color: "#111", margin: "0 0 8px", lineHeight: 1 }}>
              Contracts<span style={{ color: "#D0021B" }}>.</span>
            </h1>
            <p style={{ fontSize: 13, color: "#999", margin: 0 }}>
              All your generated and uploaded contracts.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/proofread" style={{
              padding: "9px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
              background: "transparent", color: "#555", border: "1px solid #ddd", textDecoration: "none",
              display: "flex", alignItems: "center",
            }}>Proofread →</Link>
            <Link href="/contract/new" style={{
              padding: "9px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
              background: "#111", color: "#fff", textDecoration: "none",
              display: "flex", alignItems: "center",
            }}>+ New Contract</Link>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "40px 0" }}>
            <span style={{ width: 14, height: 14, border: "2px solid #ddd", borderTopColor: "#D0021B", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
            <span style={{ fontSize: 12, color: "#999" }}>Loading contracts...</span>
          </div>
        ) : error ? (
          <div style={{ padding: "16px 20px", background: "#fff0f0", borderLeft: "3px solid #D0021B", color: "#D0021B", fontSize: 13 }}>{error}</div>
        ) : contracts.length === 0 ? (
          <div style={{ padding: "80px 0", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 8 }}>No contracts yet</div>
            <div style={{ fontSize: 13, color: "#999", marginBottom: 24 }}>Generate or upload a contract to get started.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Link href="/contract/new" style={{ padding: "10px 20px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#111", color: "#fff", textDecoration: "none" }}>Generate Contract</Link>
              <Link href="/proofread" style={{ padding: "10px 20px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: "#555", border: "1px solid #ddd", textDecoration: "none" }}>Upload & Proofread</Link>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid #ddd", background: "#fff" }}>
            {/* Table header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 40px", padding: "10px 20px", borderBottom: "2px solid #111", background: "#fafafa" }}>
              {["Contract", "Status", "Created", ""].map((h) => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>{h}</span>
              ))}
            </div>

            {/* Rows */}
            {contracts.map((contract, i) => (
              <div key={contract.id} style={{
                display: "grid", gridTemplateColumns: "1fr 120px 120px 40px",
                padding: "16px 20px", borderBottom: i < contracts.length - 1 ? "1px solid #f0f0f0" : "none",
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 3 }}>
                    {contract.prompt.length > 60 ? contract.prompt.slice(0, 60) + "..." : contract.prompt}
                  </div>
                  <div style={{ fontSize: 10, color: "#bbb", fontFamily: "var(--font-geist-mono, monospace)" }}>
                    {contract.id.slice(0, 8)}...
                  </div>
                </div>
                <div>
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
                    padding: "3px 8px", borderRadius: 2,
                    background: contract.status === "active" ? "#f0fff4" : "#f5f5f5",
                    color: contract.status === "active" ? "#16a34a" : "#999",
                  }}>
                    {contract.status ?? "draft"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#999" }}>{formatDate(contract.created_at)}</div>
                <div>
                  <Link
                    href={`/contracts/${contract.id}/versions`}
                    style={{
                      fontSize: 10, fontWeight: 700, color: "#D0021B",
                      textDecoration: "none", letterSpacing: "0.04em",
                    }}
                  >
                    History →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}