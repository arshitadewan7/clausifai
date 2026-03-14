"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Source = "generated" | "uploaded" | "proofread";
type RightMode = "diff" | "changelog" | "preview";

interface FixEntry {
  span: string;
  suggestion: string;
  type: "grammar" | "legal" | "missing" | "risky";
  severity: "high" | "medium" | "low";
  title: string;
}

interface Version {
  id: string;
  version_number: number;
  label: string;
  source: Source;
  fix_changelog: FixEntry[] | null;
  created_at: string;
  content: string;
  is_reviewed: boolean;
}

type DiffLine =
  | { type: "same";    text: string; lineA: number; lineB: number }
  | { type: "added";   text: string; lineB: number }
  | { type: "removed"; text: string; lineA: number };

const SOURCE_STYLES: Record<Source, { label: string; color: string; bg: string }> = {
  generated: { label: "Generated", color: "#2563eb", bg: "#eff6ff" },
  uploaded:  { label: "Uploaded",  color: "#666",    bg: "#f5f5f5" },
  proofread: { label: "Proofread", color: "#16a34a", bg: "#f0fff4" },
};

const TYPE_COLOR: Record<string, string> = {
  grammar: "#ca8a04",
  legal:   "#D0021B",
  missing: "#2563eb",
  risky:   "#ea580c",
};

const TYPE_LABEL: Record<string, string> = {
  grammar: "Grammar",
  legal:   "Legal Risk",
  missing: "Missing Clause",
  risky:   "One-sided",
};

const SEVERITY_COLOR: Record<string, string> = {
  high:   "#D0021B",
  medium: "#ca8a04",
  low:    "#999",
};

function computeDiff(oldText: string, newText: string): DiffLine[] {
  if (!oldText || !newText) return [];
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const MAX = 800;
  const oL = oldLines.slice(0, MAX);
  const nL = newLines.slice(0, MAX);
  const om = oL.length, nm = nL.length;

  const dp: number[][] = Array.from({ length: om + 1 }, () => new Array(nm + 1).fill(0));
  for (let i = 1; i <= om; i++)
    for (let j = 1; j <= nm; j++)
      dp[i][j] = oL[i-1] === nL[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

  const result: DiffLine[] = [];
  let i = om, j = nm;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oL[i-1] === nL[j-1]) {
      result.unshift({ type: "same", text: oL[i-1], lineA: i, lineB: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.unshift({ type: "added", text: nL[j-1], lineB: j });
      j--;
    } else {
      result.unshift({ type: "removed", text: oL[i-1], lineA: i });
      i--;
    }
  }
  oldLines.slice(MAX).forEach((l, idx) => result.push({ type: "removed", text: l, lineA: MAX + idx + 1 }));
  newLines.slice(MAX).forEach((l, idx) => result.push({ type: "added",   text: l, lineB: MAX + idx + 1 }));

  const CONTEXT = 5;
  const collapsed: (DiffLine | { type: "hunk"; count: number })[] = [];
  let sameRun: DiffLine[] = [];
  function flushSame() {
    if (sameRun.length <= CONTEXT * 2 + 1) { collapsed.push(...sameRun); }
    else {
      collapsed.push(...sameRun.slice(0, CONTEXT));
      collapsed.push({ type: "hunk", count: sameRun.length - CONTEXT * 2 });
      collapsed.push(...sameRun.slice(-CONTEXT));
    }
    sameRun = [];
  }
  for (const line of result) {
    if (line.type === "same") { sameRun.push(line); } else { flushSame(); collapsed.push(line); }
  }
  flushSame();
  return collapsed as DiffLine[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).length;
}

function goToProofread(content: string, versionNumber: number, label: string, contractId: string) {
  sessionStorage.setItem("clausifai_proofread_text", content);
  sessionStorage.setItem("clausifai_proofread_label", `v${versionNumber} — ${label}`);
  sessionStorage.setItem("clausifai_proofread_contractId", contractId);
  window.location.href = "/proofread";
}

export default function VersionsPage() {
  const params = useParams();
  const contractId = params.id as string;

  const [versions, setVersions]       = useState<Version[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selectedA, setSelectedA]     = useState<Version | null>(null);
  const [selectedB, setSelectedB]     = useState<Version | null>(null);
  const [rightMode, setRightMode]     = useState<RightMode>("diff");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFix, setExpandedFix] = useState<string | null>(null);
  const [showOnlyChanges, setShowOnlyChanges] = useState(false);

  // Re-proofread warning modal
  const [showReproofreadWarning, setShowReproofreadWarning] = useState(false);
  const [pendingProofreadVersion, setPendingProofreadVersion] = useState<Version | null>(null);

  // Mark as reviewed
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const diffRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const res  = await fetch(`/api/contracts/versions?contractId=${contractId}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error ?? "Failed.");
        const vs: Version[] = data.versions;
        setVersions(vs);
        if (vs.length >= 2) { setSelectedB(vs[0]); setSelectedA(vs[1]); }
        else if (vs.length === 1) { setSelectedB(vs[0]); }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [contractId]);

  // ── Mark as reviewed ──────────────────────────────────────────────────

  async function handleMarkReviewed(version: Version) {
    setReviewingId(version.id);
    try {
      const res = await fetch("/api/contracts/versions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id, is_reviewed: !version.is_reviewed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error("Failed to update.");
      setVersions((prev) =>
        prev.map((v) => v.id === version.id ? { ...v, is_reviewed: !version.is_reviewed } : v)
      );
      // Update selectedA/B if they match
      if (selectedA?.id === version.id) setSelectedA((v) => v ? { ...v, is_reviewed: !version.is_reviewed } : v);
      if (selectedB?.id === version.id) setSelectedB((v) => v ? { ...v, is_reviewed: !version.is_reviewed } : v);
    } catch {
      // silently fail
    } finally {
      setReviewingId(null);
    }
  }

  // ── Re-proofread flow ────────────────────────────────────────────────

  function requestProofread(v: Version) {
    // Check if any previous version has been reviewed — if so, warn
    const hasReviewedVersions = versions.some((ver) => ver.is_reviewed);
    const isAlreadyReviewed = v.is_reviewed;
    if (hasReviewedVersions || isAlreadyReviewed) {
      setPendingProofreadVersion(v);
      setShowReproofreadWarning(true);
    } else {
      goToProofread(v.content, v.version_number, v.label, contractId);
    }
  }

  function confirmProofread() {
    if (pendingProofreadVersion) {
      goToProofread(pendingProofreadVersion.content, pendingProofreadVersion.version_number, pendingProofreadVersion.label, contractId);
    }
    setShowReproofreadWarning(false);
    setPendingProofreadVersion(null);
  }

  // ── Diff ─────────────────────────────────────────────────────────────

  const rawDiff      = selectedA && selectedB ? computeDiff(selectedA.content, selectedB.content) : null;
  const fullDiff     = rawDiff ?? [];
  const visibleDiff  = showOnlyChanges ? fullDiff.filter((l) => l.type !== "same") : fullDiff;
  const addedLines   = fullDiff.filter((l) => l.type === "added").length;
  const removedLines = fullDiff.filter((l) => l.type === "removed").length;
  const totalChanges = addedLines + removedLines;
  const barAdded     = totalChanges ? Math.round((addedLines / totalChanges) * 100) : 50;
  const barRemoved   = 100 - barAdded;

  function handleVersionClick(v: Version) {
    if (!selectedB) { setSelectedB(v); return; }
    if (selectedB.id === v.id) { setSelectedB(selectedA); setSelectedA(null); return; }
    if (!selectedA) {
      if (v.version_number < selectedB.version_number) { setSelectedA(v); }
      else { setSelectedA(selectedB); setSelectedB(v); }
      return;
    }
    if (selectedA.id === v.id) { setSelectedA(null); return; }
    if (v.version_number > selectedB.version_number) { setSelectedA(selectedB); setSelectedB(v); }
    else if (v.version_number < selectedA.version_number) { setSelectedA(v); }
    else if (v.version_number > selectedA.version_number) { setSelectedB(v); }
    else { setSelectedA(v); }
    setRightMode("diff");
  }

  const filteredVersions = versions.filter((v) =>
    !searchQuery || v.label.toLowerCase().includes(searchQuery.toLowerCase()) || v.source.includes(searchQuery.toLowerCase())
  );

  return (
    <main style={{
      minHeight: "100vh", background: "#f5f5f5",
      backgroundImage: `linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)`,
      backgroundSize: "32px 32px",
      fontFamily: "var(--font-geist-sans, 'Helvetica Neue', Arial, sans-serif)",
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        .vcard { transition: background 0.12s; }
        .vcard:hover { background: #f9f9f9 !important; }
        .vcard-selected-b { border-left: 3px solid #16a34a !important; background: #f0fff4 !important; }
        .vcard-selected-a { border-left: 3px solid #D0021B !important; background: #fff8f8 !important; }
        .diff-row { display: grid; grid-template-columns: 40px 40px 1fr; min-height: 22px; }
        .diff-row:hover { filter: brightness(0.97); }
        .diff-added   { background: #f0fff4; }
        .diff-removed { background: #fff0f0; }
        .diff-same    { background: #fff; }
        .diff-hunk    { background: #f5f5f5; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
        .diff-ln { display:flex; align-items:center; justify-content:flex-end; padding: 0 8px; font-size: 10px; color: #ccc; font-family: var(--font-geist-mono, monospace); user-select:none; border-right: 1px solid #eee; }
        .diff-code { padding: 0 16px; font-size: 11px; font-family: var(--font-geist-mono, monospace); line-height: 22px; white-space: pre-wrap; color: #333; }
        .diff-added .diff-code   { color: #166534; }
        .diff-removed .diff-code { color: #991b1b; }
        .diff-hunk .diff-code    { color: #999; font-style: italic; }
        .diff-prefix { width: 16px; display:inline-block; color: #aaa; }
        .diff-added .diff-prefix   { color: #16a34a; }
        .diff-removed .diff-prefix { color: #D0021B; }
        .fix-card { transition: all 0.15s; cursor: pointer; }
        .fix-card:hover { border-color: #ccc !important; }
        .tab-btn { transition: all 0.1s; }
        .tab-btn:hover { color: #111 !important; }
        .proofread-btn:hover { background: #333 !important; }
        .scroll-area::-webkit-scrollbar { width: 6px; }
        .scroll-area::-webkit-scrollbar-track { background: transparent; }
        .scroll-area::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
      `}</style>

      {/* Nav */}
      <nav style={{ borderBottom: "2px solid #111", background: "#111", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.03em", color: "#fff" }}>clausifai</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: "#D0021B" }}>.</span>
          </Link>
          <span style={{ color: "#444" }}>/</span>
          <Link href="/contracts" style={{ fontSize: 11, color: "#888", textDecoration: "none", fontWeight: 600 }}>contracts</Link>
          <span style={{ color: "#444" }}>/</span>
          <span style={{ fontSize: 11, color: "#ccc", fontFamily: "var(--font-geist-mono, monospace)" }}>{contractId.slice(0, 8)}...</span>
          <span style={{ color: "#444" }}>/</span>
          <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>versions</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#555" }}>
            {versions.length} version{versions.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={() => {
              const latest = versions[0];
              if (latest) requestProofread(latest);
              else window.location.href = "/proofread";
            }}
            style={{ padding: "6px 14px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#D0021B", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            + New Version
          </button>
        </div>
      </nav>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "70vh", gap: 12 }}>
          <span style={{ width: 18, height: 18, border: "2px solid #ddd", borderTopColor: "#D0021B", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
          <span style={{ fontSize: 12, color: "#999" }}>Loading version history...</span>
        </div>
      ) : error ? (
        <div style={{ maxWidth: 600, margin: "80px auto", padding: "20px 24px", background: "#fff0f0", borderLeft: "3px solid #D0021B", color: "#D0021B", fontSize: 13 }}>{error}</div>
      ) : (
        <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>

          {/* LEFT: Version list */}
          <div className="scroll-area" style={{ width: 300, background: "#fff", borderRight: "2px solid #111", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>

            <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #eee", position: "sticky", top: 0, background: "#fff", zIndex: 5 }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111", marginBottom: 10 }}>Version History</div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter versions..."
                style={{ width: "100%", padding: "6px 10px", fontSize: 11, border: "1px solid #ddd", background: "#fafafa", color: "#111", outline: "none", fontFamily: "var(--font-geist-mono, monospace)", boxSizing: "border-box" }}
              />
              {versions.length >= 2 && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#999", lineHeight: 1.5 }}>
                  Click to select <span style={{ fontWeight: 800, color: "#D0021B" }}>A</span> (old) and <span style={{ fontWeight: 800, color: "#16a34a" }}>B</span> (new) to compare
                </div>
              )}
            </div>

            {filteredVersions.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#bbb", fontSize: 12 }}>No versions found.</div>
            ) : filteredVersions.map((v) => {
              const isA   = selectedA?.id === v.id;
              const isB   = selectedB?.id === v.id;
              const s     = SOURCE_STYLES[v.source];
              const fixes = v.fix_changelog?.length ?? 0;
              return (
                <div
                  key={v.id}
                  className={`vcard ${isB ? "vcard-selected-b" : isA ? "vcard-selected-a" : ""}`}
                  style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0", cursor: "pointer", borderLeft: "3px solid transparent", animation: "fadeIn 0.2s ease" }}
                  onClick={() => handleVersionClick(v)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {isB && <span style={{ fontSize: 9, fontWeight: 900, background: "#16a34a", color: "#fff", padding: "2px 6px" }}>B NEW</span>}
                      {isA && <span style={{ fontSize: 9, fontWeight: 900, background: "#D0021B", color: "#fff", padding: "2px 6px" }}>A OLD</span>}
                      <span style={{ fontSize: 13, fontWeight: 900, color: "#111", fontFamily: "var(--font-geist-mono, monospace)" }}>v{v.version_number}</span>
                      {/* Reviewed badge */}
                      {v.is_reviewed && (
                        <span style={{ fontSize: 9, fontWeight: 800, background: "#111", color: "#fff", padding: "2px 6px", letterSpacing: "0.06em" }}>✓ FINAL</span>
                      )}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: s.bg, color: s.color, padding: "2px 7px" }}>
                      {s.label}
                    </span>
                  </div>

                  <div style={{ fontSize: 11, color: "#333", fontWeight: 600, marginBottom: 4, lineHeight: 1.4 }}>{v.label}</div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: (isA || isB) ? 10 : 0 }}>
                    <span style={{ fontSize: 10, color: "#bbb", fontFamily: "var(--font-geist-mono, monospace)" }}>{formatRelative(v.created_at)}</span>
                    {fixes > 0 && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#16a34a", background: "#f0fff4", padding: "1px 6px" }}>
                        ✓ {fixes} fix{fixes !== 1 ? "es" : ""}
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: "#ddd" }}>·</span>
                    <span style={{ fontSize: 10, color: "#ccc" }}>{wordCount(v.content).toLocaleString()} words</span>
                  </div>

                  {(isA || isB) && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="proofread-btn"
                        onClick={(e) => { e.stopPropagation(); requestProofread(v); }}
                        style={{ flex: 1, padding: "7px", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#111", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                      >
                        Proofread →
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMarkReviewed(v); }}
                        disabled={reviewingId === v.id}
                        style={{
                          padding: "7px 10px", fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
                          background: v.is_reviewed ? "#16a34a" : "transparent",
                          color: v.is_reviewed ? "#fff" : "#999",
                          border: `1px solid ${v.is_reviewed ? "#16a34a" : "#ddd"}`,
                          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                        }}
                      >
                        {reviewingId === v.id ? "..." : v.is_reviewed ? "✓ Final" : "Mark Final"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ marginTop: "auto", padding: "14px 16px", borderTop: "2px solid #111", display: "flex", flexDirection: "column", gap: 8 }}>
              <Link href="/contracts" style={{ display: "block", padding: "9px", textAlign: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: "#999", border: "1px solid #ddd", textDecoration: "none" }}>
                ← All Contracts
              </Link>
            </div>
          </div>

          {/* RIGHT: Main panel */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

            <div style={{ background: "#fff", borderBottom: "2px solid #111", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 0, height: "100%", alignItems: "center" }}>
                {(["diff", "changelog", "preview"] as RightMode[]).map((m) => (
                  <button key={m} className="tab-btn" onClick={() => setRightMode(m)} style={{
                    height: "100%", padding: "0 18px", fontSize: 11, fontWeight: 800,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                    color: rightMode === m ? "#111" : "#bbb",
                    borderBottom: rightMode === m ? "2px solid #D0021B" : "2px solid transparent",
                    marginBottom: -2,
                  }}>
                    {m === "diff" ? "Diff" : m === "changelog" ? "Changelog" : "Preview"}
                  </button>
                ))}
              </div>

              {rightMode === "diff" && selectedA && selectedB && (
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a" }}>+{addedLines}</span>
                    <div style={{ width: 60, height: 6, background: "#eee", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${barAdded}%`, background: "#16a34a" }} />
                      <div style={{ width: `${barRemoved}%`, background: "#D0021B" }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#D0021B" }}>−{removedLines}</span>
                  </div>
                  <span style={{ fontSize: 10, color: "#ddd" }}>|</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 900, background: "#D0021B", color: "#fff", padding: "2px 6px" }}>A v{selectedA.version_number}</span>
                    <span style={{ fontSize: 11, color: "#bbb" }}>→</span>
                    <span style={{ fontSize: 9, fontWeight: 900, background: "#16a34a", color: "#fff", padding: "2px 6px" }}>B v{selectedB.version_number}</span>
                  </div>
                  <span style={{ fontSize: 10, color: "#ddd" }}>|</span>
                  <button onClick={() => setShowOnlyChanges(!showOnlyChanges)} style={{ fontSize: 10, fontWeight: 700, background: showOnlyChanges ? "#111" : "transparent", color: showOnlyChanges ? "#fff" : "#999", border: "1px solid #ddd", padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.06em" }}>
                    {showOnlyChanges ? "Show All" : "Changes Only"}
                  </button>
                </div>
              )}

              {rightMode === "preview" && selectedB && (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 10, color: "#bbb" }}>Viewing v{selectedB.version_number} · {wordCount(selectedB.content).toLocaleString()} words</span>
                  <button
                    className="proofread-btn"
                    onClick={() => requestProofread(selectedB)}
                    style={{ padding: "6px 14px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#D0021B", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Proofread This Version →
                  </button>
                  <button
                    onClick={() => handleMarkReviewed(selectedB)}
                    disabled={reviewingId === selectedB.id}
                    style={{
                      padding: "6px 14px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                      background: selectedB.is_reviewed ? "#16a34a" : "transparent",
                      color: selectedB.is_reviewed ? "#fff" : "#555",
                      border: `1px solid ${selectedB.is_reviewed ? "#16a34a" : "#ddd"}`,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {reviewingId === selectedB.id ? "..." : selectedB.is_reviewed ? "✓ Marked Final" : "Mark as Final"}
                  </button>
                </div>
              )}

              {rightMode === "changelog" && (
                <span style={{ fontSize: 10, color: "#bbb", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>
                  {versions.filter(v => v.fix_changelog?.length).length} versions with fixes
                </span>
              )}
            </div>

            <div ref={diffRef} className="scroll-area" style={{ flex: 1, overflowY: "auto", background: "#f5f5f5" }}>

              {/* DIFF VIEW */}
              {rightMode === "diff" && (
                <div style={{ padding: "24px 32px", animation: "fadeIn 0.2s ease" }}>
                  {!selectedB ? (
                    <div style={{ textAlign: "center", padding: "80px 0", color: "#bbb" }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>⊕</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#ccc", marginBottom: 6 }}>Select a version to start</div>
                      <div style={{ fontSize: 12, color: "#ddd" }}>Click any version in the sidebar</div>
                    </div>
                  ) : !selectedA ? (
                    <div>
                      <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fff", border: "1px solid #ddd", borderLeft: "3px solid #2563eb", fontSize: 12, color: "#555" }}>
                        Showing <strong>v{selectedB.version_number}</strong> in full — select a second version to compare
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #ddd", borderTop: "3px solid #111" }}>
                        {selectedB.content.split("\n").map((line, i) => (
                          <div key={i} className="diff-row diff-same">
                            <div className="diff-ln">{i + 1}</div>
                            <div className="diff-ln">{i + 1}</div>
                            <div className="diff-code"><span className="diff-prefix"> </span>{line || " "}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: 16, background: "#fff", border: "1px solid #ddd", borderTop: "3px solid #111", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#D0021B", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>A — Older</div>
                            <div style={{ fontSize: 13, fontWeight: 900, color: "#111" }}>v{selectedA.version_number} <span style={{ fontSize: 11, fontWeight: 400, color: "#999" }}>{selectedA.label}</span></div>
                            <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>{formatDate(selectedA.created_at)}</div>
                          </div>
                          <div style={{ color: "#ddd", fontSize: 20 }}>→</div>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#16a34a", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>B — Newer</div>
                            <div style={{ fontSize: 13, fontWeight: 900, color: "#111" }}>v{selectedB.version_number} <span style={{ fontSize: 11, fontWeight: 400, color: "#999" }}>{selectedB.label}</span></div>
                            <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>{formatDate(selectedB.created_at)}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "#111", marginBottom: 4 }}>{totalChanges} line{totalChanges !== 1 ? "s" : ""} changed</div>
                          <div style={{ fontSize: 10, color: "#16a34a", fontWeight: 700 }}>+{addedLines} added</div>
                          <div style={{ fontSize: 10, color: "#D0021B", fontWeight: 700 }}>−{removedLines} removed</div>
                        </div>
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #ddd", overflow: "hidden" }}>
                        {visibleDiff.length === 0 ? (
                          <div style={{ padding: "40px", textAlign: "center", color: "#bbb", fontSize: 12 }}>No differences found.</div>
                        ) : visibleDiff.map((line, i) => {
                          if ((line as { type: string; count?: number }).type === "hunk") {
                            const h = line as unknown as { type: string; count: number };
                            return (
                              <div key={i} className="diff-row diff-hunk">
                                <div className="diff-ln" style={{ gridColumn: "1/3" }}>···</div>
                                <div className="diff-code" style={{ color: "#999" }}>@@ {h.count} unchanged lines hidden @@</div>
                              </div>
                            );
                          }
                          const dl = line as DiffLine;
                          const lineA = dl.type !== "added"   ? (dl as { lineA: number }).lineA : undefined;
                          const lineB = dl.type !== "removed" ? (dl as { lineB: number }).lineB : undefined;
                          return (
                            <div key={i} className={`diff-row diff-${dl.type}`}>
                              <div className="diff-ln">{lineA ?? ""}</div>
                              <div className="diff-ln">{lineB ?? ""}</div>
                              <div className="diff-code">
                                <span className="diff-prefix">{dl.type === "added" ? "+" : dl.type === "removed" ? "−" : " "}</span>
                                {dl.text || " "}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CHANGELOG VIEW */}
              {rightMode === "changelog" && (
                <div style={{ padding: "24px 32px", animation: "fadeIn 0.2s ease" }}>
                  {versions.filter(v => v.fix_changelog?.length).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "80px 0", color: "#bbb" }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#ccc", marginBottom: 6 }}>No changelog entries yet</div>
                      <div style={{ fontSize: 12, color: "#ddd" }}>Proofread a contract and accept fixes to see them here</div>
                    </div>
                  ) : versions.filter(v => v.fix_changelog?.length).map((v) => (
                    <div key={v.id} style={{ marginBottom: 40 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
                        <span style={{ fontSize: 15, fontWeight: 900, color: "#111", fontFamily: "var(--font-geist-mono, monospace)" }}>v{v.version_number}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", background: SOURCE_STYLES[v.source].bg, color: SOURCE_STYLES[v.source].color, padding: "2px 8px" }}>{SOURCE_STYLES[v.source].label}</span>
                        {v.is_reviewed && <span style={{ fontSize: 9, fontWeight: 800, background: "#111", color: "#fff", padding: "2px 8px" }}>✓ FINAL</span>}
                        <span style={{ fontSize: 11, color: "#bbb" }}>{formatDate(v.created_at)}</span>
                        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, color: "#16a34a", background: "#f0fff4", padding: "3px 10px" }}>
                          {v.fix_changelog!.length} fix{v.fix_changelog!.length !== 1 ? "es" : ""} applied
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {v.fix_changelog!.map((fix, fi) => {
                          const key = `${v.id}-${fi}`;
                          const expanded = expandedFix === key;
                          return (
                            <div key={fi} className="fix-card" style={{ background: "#fff", border: "1px solid #eee", borderLeft: `3px solid ${TYPE_COLOR[fix.type] ?? "#ddd"}` }} onClick={() => setExpandedFix(expanded ? null : key)}>
                              <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: TYPE_COLOR[fix.type] }}>{TYPE_LABEL[fix.type] ?? fix.type}</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, color: SEVERITY_COLOR[fix.severity], textTransform: "uppercase" }}>{fix.severity}</span>
                                  <span style={{ fontSize: 12, fontWeight: 800, color: "#111" }}>{fix.title}</span>
                                </div>
                                <span style={{ fontSize: 11, color: "#bbb", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
                              </div>
                              {expanded && (
                                <div style={{ padding: "0 16px 14px", borderTop: "1px solid #f5f5f5", animation: "fadeIn 0.15s ease" }}>
                                  <div style={{ padding: "8px 12px", background: "#f9f9f9", borderLeft: "2px solid #ddd", marginTop: 10, marginBottom: 10 }}>
                                    <span style={{ fontSize: 11, color: "#777", fontFamily: "var(--font-geist-mono, monospace)", fontStyle: "italic" }}>"{fix.span}"</span>
                                  </div>
                                  <div style={{ fontSize: 11, color: "#16a34a", lineHeight: 1.65 }}>{fix.suggestion}</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* PREVIEW VIEW */}
              {rightMode === "preview" && (
                <div style={{ padding: "24px 32px", animation: "fadeIn 0.2s ease" }}>
                  {!selectedB ? (
                    <div style={{ textAlign: "center", padding: "80px 0", color: "#bbb" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#ccc" }}>Select a version to preview</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>Viewing:</span>
                        {versions.map((v) => (
                          <button key={v.id} onClick={() => setSelectedB(v)} style={{
                            padding: "5px 12px", fontSize: 10, fontWeight: 800,
                            background: selectedB.id === v.id ? "#111" : "transparent",
                            color: selectedB.id === v.id ? "#fff" : "#999",
                            border: "1px solid #ddd", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.06em",
                          }}>
                            v{v.version_number}{v.is_reviewed ? " ✓" : ""}
                          </button>
                        ))}
                      </div>
                      {selectedB.is_reviewed && (
                        <div style={{ marginBottom: 16, padding: "10px 16px", background: "#111", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 16 }}>✓</span>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>FINAL VERSION</div>
                            <div style={{ fontSize: 10, color: "#888" }}>This version has been marked as the final reviewed copy.</div>
                          </div>
                        </div>
                      )}
                      <div style={{ background: "#fff", border: "1px solid #ddd", borderTop: "3px solid #111", padding: "48px 56px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
                          <span>Version {selectedB.version_number} · {selectedB.label}</span>
                          <span>{wordCount(selectedB.content).toLocaleString()} words</span>
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 2, color: "#111", whiteSpace: "pre-wrap", fontFamily: "var(--font-geist-mono, monospace)" }}>
                          {selectedB.content}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Re-proofread warning modal ──────────────────────────────────────── */}
      {showReproofreadWarning && pendingProofreadVersion && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowReproofreadWarning(false); setPendingProofreadVersion(null); } }}
        >
          <div style={{ background: "#fff", border: "2px solid #111", width: 460, maxWidth: "90vw", padding: 0 }}>
            <div style={{ padding: "16px 20px", borderBottom: "2px solid #111", background: "#111", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚠</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>Re-proofread Warning</span>
            </div>
            <div style={{ padding: "24px" }}>
              <p style={{ fontSize: 13, color: "#333", lineHeight: 1.7, margin: "0 0 12px" }}>
                You are about to proofread <strong>v{pendingProofreadVersion.version_number}</strong> again. This contract has already been reviewed.
              </p>
              <p style={{ fontSize: 13, color: "#555", lineHeight: 1.7, margin: "0 0 20px" }}>
                Re-proofreading may surface minor issues that were intentionally left unfixed. Previously fixed issues will be suppressed, but new low-severity findings may appear.
              </p>
              <div style={{ padding: "12px 16px", background: "#fafafa", border: "1px solid #eee", borderLeft: "3px solid #ca8a04", marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#ca8a04", marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>Recommendation</div>
                <div style={{ fontSize: 12, color: "#555", lineHeight: 1.6 }}>
                  If you are satisfied with this version, mark it as <strong>Final</strong> instead of re-proofreading. Use re-proofread only if you have made manual edits to the contract text.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={confirmProofread} style={{ flex: 1, padding: "11px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#111", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                  Continue Anyway →
                </button>
                <button
                  onClick={() => {
                    handleMarkReviewed(pendingProofreadVersion);
                    setShowReproofreadWarning(false);
                    setPendingProofreadVersion(null);
                  }}
                  style={{ flex: 1, padding: "11px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#16a34a", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                >
                  ✓ Mark as Final
                </button>
                <button onClick={() => { setShowReproofreadWarning(false); setPendingProofreadVersion(null); }} style={{ padding: "11px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: "#999", border: "1px solid #ddd", cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}