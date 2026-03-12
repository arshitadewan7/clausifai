"use client";

import { useState, useRef, DragEvent } from "react";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// ── Types ────────────────────────────────────────────────────────────────────

type IssueType = "grammar" | "legal" | "missing" | "risky";
type Severity = "high" | "medium" | "low";
type InputMode = "paste" | "upload";

interface Issue {
  id: number;
  type: IssueType;
  severity: Severity;
  span: string;
  title: string;
  detail: string;
  suggestion: string;
}

interface ProofreadResult {
  contractType: string;
  issueCount: number;
  healthScore: number;
  issues: Issue[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const ISSUE_STYLES: Record<IssueType, { underline: string; bg: string; label: string; dot: string }> = {
  grammar: { underline: "#ca8a04", bg: "rgba(254,243,199,0.6)", label: "Grammar",        dot: "#ca8a04" },
  legal:   { underline: "#D0021B", bg: "rgba(255,240,240,0.7)", label: "Legal Risk",     dot: "#D0021B" },
  missing: { underline: "#2563eb", bg: "rgba(219,234,254,0.6)", label: "Missing Clause", dot: "#2563eb" },
  risky:   { underline: "#ea580c", bg: "rgba(255,237,213,0.6)", label: "One-sided",      dot: "#ea580c" },
};

const SEVERITY_COLOR: Record<Severity, string> = {
  high:   "#D0021B",
  medium: "#ca8a04",
  low:    "#999",
};

const FILTER_OPTIONS: { key: string; label: string }[] = [
  { key: "all",     label: "All Issues" },
  { key: "risky",   label: "One-sided" },
  { key: "legal",   label: "Legal Risk" },
  { key: "missing", label: "Missing Clause" },
  { key: "grammar", label: "Grammar" },
];

const ACCEPTED = ".pdf,.docx,.txt";

// ── File extraction ───────────────────────────────────────────────────────────

async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "txt") return await file.text();

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  if (ext === "pdf") {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text +=
        content.items
          .filter((item): item is TextItem => "str" in item)
          .map((item) => item.str)
          .join(" ") + "\n";
    }
    return text;
  }

  throw new Error("Unsupported file type.");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 70) return "#16a34a";
  if (score >= 50) return "#ca8a04";
  return "#D0021B";
}

type Segment =
  | { type: "text"; text: string }
  | { type: "highlight"; text: string; issue: Issue };

function buildSegments(text: string, issues: Issue[], dismissed: Set<number>): Segment[] {
  const active = issues.filter((i) => !dismissed.has(i.id));
  const spans = active
    .map((issue) => {
      const idx = text.indexOf(issue.span);
      if (idx === -1) return null;
      return { start: idx, end: idx + issue.span.length, issue };
    })
    .filter(Boolean)
    .sort((a, b) => a!.start - b!.start) as { start: number; end: number; issue: Issue }[];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    if (span.start > cursor) segments.push({ type: "text", text: text.slice(cursor, span.start) });
    segments.push({ type: "highlight", text: text.slice(span.start, span.end), issue: span.issue });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments;
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ProofreadPage() {
  // Input state
  const [mode, setMode] = useState<InputMode>("paste");
  const [contractText, setContractText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // API state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProofreadResult | null>(null);

  // Results UI state
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [filter, setFilter] = useState("all");
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  // ── CHANGE 1: ref map to track each highlight's DOM node ──────────────────
  const highlightRefs = useRef<Record<number, HTMLSpanElement | null>>({});

  // ── File handling ─────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext ?? "")) {
      setExtractError("Unsupported file type. Please upload a PDF, DOCX, or TXT file.");
      return;
    }
    setUploadedFile(file);
    setExtractError(null);
    setExtracting(true);
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) throw new Error("Could not extract text from this file.");
      setContractText(text);
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : "Failed to read file.");
      setUploadedFile(null);
    } finally {
      setExtracting(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function clearFile() {
    setUploadedFile(null);
    setContractText("");
    setExtractError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── API call ──────────────────────────────────────────────────────────────

  async function handleProofread() {
    if (!contractText.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setActiveIssue(null);
    setDismissed(new Set());
    setFilter("all");
    try {
      const res = await fetch("/api/contracts/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractText }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Something went wrong.");
      setResult(data.result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // ── CHANGE 2: selectIssue — sets active issue and scrolls to its span ─────
  function selectIssue(issue: Issue) {
    setActiveIssue(issue);
    setTimeout(() => {
      const el = highlightRefs.current[issue.id];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid #D0021B";
        el.style.outlineOffset = "2px";
        setTimeout(() => {
          el.style.outline = "none";
          el.style.outlineOffset = "0px";
        }, 1200);
      }
    }, 50);
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const isDisabled = loading || extracting || contractText.trim().length < 100;

  const visibleIssues = result
    ? result.issues.filter((i) => !dismissed.has(i.id) && (filter === "all" || i.type === filter))
    : [];

  const counts: Record<string, number> = result
    ? {
        all:     result.issues.filter((i) => !dismissed.has(i.id)).length,
        grammar: result.issues.filter((i) => !dismissed.has(i.id) && i.type === "grammar").length,
        legal:   result.issues.filter((i) => !dismissed.has(i.id) && i.type === "legal").length,
        missing: result.issues.filter((i) => !dismissed.has(i.id) && i.type === "missing").length,
        risky:   result.issues.filter((i) => !dismissed.has(i.id) && i.type === "risky").length,
      }
    : { all: 0, grammar: 0, legal: 0, missing: 0, risky: 0 };

  const segments = result ? buildSegments(contractText, visibleIssues, dismissed) : [];
  const highCount = visibleIssues.filter((i) => i.severity === "high").length;
  const liveScore = result ? Math.min(100, result.healthScore + dismissed.size * 5) : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={{
      minHeight: "100vh",
      background: "#f5f5f5",
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
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.03em", color: "#111" }}>clausifai</span>
          <span style={{ fontSize: 17, fontWeight: 900, color: "#D0021B" }}>.</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#999" }}>
          Proofread
        </span>
      </nav>

      {!result ? (
        // ── INPUT SCREEN ───────────────────────────────────────────────────
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "52px 24px 80px" }}>

          <div style={{ marginBottom: 36 }}>
            <h1 style={{ fontSize: 48, fontWeight: 900, letterSpacing: "-0.04em", color: "#111", margin: "0 0 10px", lineHeight: 1 }}>
              Proofread<span style={{ color: "#D0021B" }}>.</span>
            </h1>
            <p style={{ fontSize: 14, color: "#777", margin: 0, lineHeight: 1.6 }}>
              Paste or upload any contract. Get inline highlights for legal risks, grammar issues, missing clauses, and one-sided terms.
            </p>
          </div>

          {/* What we check strip */}
          <div style={{ display: "flex", gap: 0, marginBottom: 28, border: "1px solid #ddd", background: "#fff" }}>
            {(["legal", "grammar", "missing", "risky"] as IssueType[]).map((type, i) => (
              <div key={type} style={{
                flex: 1, padding: "10px 14px",
                borderRight: i < 3 ? "1px solid #eee" : "none",
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: ISSUE_STYLES[type].dot, flexShrink: 0, display: "inline-block" }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#555" }}>
                  {ISSUE_STYLES[type].label}
                </span>
              </div>
            ))}
          </div>

          {/* Mode toggle */}
          <div style={{ display: "flex", marginBottom: 0, borderBottom: "2px solid #111" }}>
            {(["paste", "upload"] as InputMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); clearFile(); setError(null); }}
                style={{
                  padding: "9px 20px",
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                  background: mode === m ? "#111" : "transparent",
                  color: mode === m ? "#fff" : "#999",
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  borderBottom: mode === m ? "2px solid #D0021B" : "none",
                  marginBottom: -2,
                }}
              >
                {m === "paste" ? "Paste Text" : "Upload File"}
              </button>
            ))}
          </div>

          {/* Paste mode */}
          {mode === "paste" && (
            <div style={{ background: "#fff", border: "1px solid #ddd", borderTop: "none" }}>
              <div style={{
                padding: "9px 14px", borderBottom: "1px solid #eee",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>
                  Contract Input
                </span>
                {contractText.length > 0 && (
                  <span style={{ fontSize: 10, color: "#ccc" }}>{contractText.length.toLocaleString()} chars</span>
                )}
              </div>
              <textarea
                value={contractText}
                onChange={(e) => setContractText(e.target.value)}
                placeholder="Paste your contract text here..."
                rows={10}
                style={{
                  width: "100%", padding: "14px 16px",
                  fontSize: 12, lineHeight: 1.8, border: "none", resize: "vertical",
                  background: "transparent", color: "#111",
                  fontFamily: "var(--font-geist-mono, monospace)",
                  outline: "none", boxSizing: "border-box", display: "block",
                }}
              />
            </div>
          )}

          {/* Upload mode */}
          {mode === "upload" && (
            <div style={{ background: "#fff", border: "1px solid #ddd", borderTop: "none" }}>
              {!uploadedFile ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "48px 24px",
                    border: `2px dashed ${isDragging ? "#D0021B" : "#ddd"}`,
                    margin: 16,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                    cursor: "pointer",
                    background: isDragging ? "#fff8f8" : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: 28 }}>↑</span>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#111", margin: "0 0 4px" }}>Drop your contract here</p>
                    <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>or click to browse — PDF, DOCX, TXT</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept={ACCEPTED} onChange={handleFileInput} style={{ display: "none" }} />
                </div>
              ) : (
                <div style={{ padding: "20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {extracting ? (
                      <span style={{
                        width: 14, height: 14, border: "2px solid #ddd",
                        borderTopColor: "#D0021B", borderRadius: "50%", display: "inline-block",
                        animation: "spin 0.7s linear infinite", flexShrink: 0,
                      }} />
                    ) : (
                      <span style={{ fontSize: 18 }}>📄</span>
                    )}
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#111" }}>{uploadedFile.name}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>
                        {extracting ? "Extracting text..." : `${contractText.length.toLocaleString()} characters extracted`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={clearFile}
                    style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                      background: "none", border: "1px solid #ddd", padding: "5px 10px",
                      color: "#999", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >Remove</button>
                </div>
              )}
              {extractError && (
                <div style={{
                  margin: "0 16px 16px", padding: "10px 14px",
                  background: "#fff0f0", borderLeft: "3px solid #D0021B",
                  color: "#D0021B", fontSize: 12,
                }}>{extractError}</div>
              )}
            </div>
          )}

          {/* Proofread button */}
          <button
            onClick={handleProofread}
            disabled={isDisabled}
            style={{
              width: "100%", padding: "13px 24px",
              fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
              background: isDisabled ? "#e0e0e0" : "#111",
              color: isDisabled ? "#aaa" : "#fff",
              border: "none", cursor: isDisabled ? "not-allowed" : "pointer",
              fontFamily: "inherit", marginBottom: 40,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            }}
          >
            {loading ? (
              <>
                <span style={{
                  width: 11, height: 11, border: "2px solid #555",
                  borderTopColor: "#fff", borderRadius: "50%", display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }} />
                Proofreading...
              </>
            ) : "Proofread Contract →"}
          </button>

          {error && (
            <div style={{
              padding: "12px 16px", background: "#fff0f0",
              borderLeft: "3px solid #D0021B", color: "#D0021B",
              fontSize: 13, marginBottom: 32,
            }}>{error}</div>
          )}
        </div>

      ) : (
        // ── RESULTS SCREEN ──────────────────────────────────────────────────
        <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>

          {/* Left sidebar */}
          <div style={{
            width: 220, background: "#fff", borderRight: "2px solid #111",
            display: "flex", flexDirection: "column", flexShrink: 0, overflow: "auto",
          }}>
            <div style={{ padding: "20px 18px", borderBottom: "1px solid #eee", background: "#111" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#555", marginBottom: 8 }}>
                Contract Health
              </div>
              <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.04em", color: scoreColor(liveScore) }}>
                {liveScore}<span style={{ fontSize: 14, fontWeight: 400, color: "#555" }}>/100</span>
              </div>
              <div style={{ height: 3, background: "#333", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${liveScore}%`, background: scoreColor(liveScore), borderRadius: 2 }} />
              </div>
              {highCount > 0 && (
                <div style={{ marginTop: 10, fontSize: 10, fontWeight: 700, color: "#D0021B", letterSpacing: "0.06em" }}>
                  ⚠ {highCount} HIGH RISK
                </div>
              )}
            </div>

            <div style={{ padding: "16px 18px 8px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", marginBottom: 10 }}>
                Filter Issues
              </div>
              {FILTER_OPTIONS.map(({ key, label }) => {
                const active = filter === key;
                const dotColor = key === "all" ? "#111" : ISSUE_STYLES[key as IssueType]?.dot;
                return (
                  <button
                    key={key}
                    onClick={() => { setFilter(key); setActiveIssue(null); }}
                    style={{
                      width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 10px", marginBottom: 3,
                      background: active ? "#111" : "transparent",
                      color: active ? "#fff" : "#555",
                      border: active ? "none" : "1px solid #eee",
                      cursor: "pointer", fontFamily: "inherit",
                      fontSize: 11, fontWeight: active ? 800 : 500,
                      letterSpacing: "0.04em",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? "#D0021B" : dotColor, flexShrink: 0, display: "inline-block" }} />
                      {label}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: active ? "#D0021B" : "#bbb" }}>
                      {counts[key] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: "auto", padding: "16px 18px", borderTop: "1px solid #eee" }}>
              <button
                onClick={() => {
                  setResult(null); setContractText(""); clearFile();
                  setError(null); setActiveIssue(null); setFilter("all"); setDismissed(new Set());
                }}
                style={{
                  width: "100%", padding: "9px",
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                  background: "transparent", color: "#999", border: "1px solid #ddd",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >← New Contract</button>
            </div>
          </div>

          {/* Centre — annotated contract */}
          <div
            style={{
              flex: 1, overflow: "auto", padding: "40px 48px",
              background: "#f5f5f5",
              backgroundImage: `linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)`,
              backgroundSize: "40px 40px",
            }}
            onClick={(e) => { if ((e.target as HTMLElement).tagName !== "SPAN") setActiveIssue(null); }}
          >
            <div style={{ maxWidth: 680, margin: "0 auto 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>
                {result.contractType}
              </span>
              <span style={{ fontSize: 10, color: "#ddd" }}>·</span>
              <span style={{ fontSize: 10, color: "#bbb" }}>{result.issueCount} issues found</span>
            </div>

            <div style={{
              maxWidth: 680, margin: "0 auto",
              background: "#fff", border: "1px solid #ddd", borderTop: "3px solid #111",
              padding: "48px 56px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}>
              <div style={{
                fontSize: 13, lineHeight: 2, color: "#111",
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-geist-mono, monospace)",
              }}>
                {segments.map((seg, i) => {
                  if (seg.type === "text") return <span key={i}>{seg.text}</span>;
                  const s = ISSUE_STYLES[seg.issue.type];
                  const isActive = activeIssue?.id === seg.issue.id;
                  return (
                    // ── CHANGE 3: ref attached to each highlight span ──────
                    <span
                      key={i}
                      ref={(el) => { highlightRefs.current[seg.issue.id] = el; }}
                      onClick={(e) => { e.stopPropagation(); setActiveIssue(isActive ? null : seg.issue); }}
                      style={{
                        background: isActive ? s.bg.replace("0.6", "1").replace("0.7", "1") : s.bg,
                        borderBottom: `2px solid ${s.underline}`,
                        cursor: "pointer", padding: "1px 0",
                      }}
                    >{seg.text}</span>
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div style={{ maxWidth: 680, margin: "16px auto 0", display: "flex", gap: 20, flexWrap: "wrap" }}>
              {(Object.entries(ISSUE_STYLES) as [IssueType, typeof ISSUE_STYLES[IssueType]][]).map(([type, s]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 18, height: 2, background: s.underline, display: "inline-block" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#999" }}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div style={{
            width: 300, borderLeft: "2px solid #111",
            background: "#fff", overflow: "auto", flexShrink: 0,
          }}>
            {activeIssue ? (
              <div>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                  <button
                    onClick={() => setActiveIssue(null)}
                    style={{
                      background: "none", border: "none", color: "#999", fontSize: 11,
                      fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer",
                      fontFamily: "inherit", padding: 0, textTransform: "uppercase",
                    }}
                  >← Back</button>
                </div>

                <div style={{ padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%",
                      background: SEVERITY_COLOR[activeIssue.severity], flexShrink: 0, display: "inline-block",
                    }} />
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                      background: activeIssue.type === "legal" ? "#fff0f0" : activeIssue.type === "risky" ? "#fff7ed" : activeIssue.type === "missing" ? "#eff6ff" : "#fefce8",
                      color: ISSUE_STYLES[activeIssue.type].dot,
                      padding: "2px 7px", borderRadius: 2,
                    }}>{ISSUE_STYLES[activeIssue.type].label}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
                      color: SEVERITY_COLOR[activeIssue.severity],
                    }}>{activeIssue.severity}</span>
                  </div>

                  <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "-0.02em", color: "#111", marginBottom: 12 }}>
                    {activeIssue.title}
                  </div>

                  <div style={{ padding: "10px 12px", background: "#f9f9f9", borderLeft: "3px solid #ddd", marginBottom: 14 }}>
                    <p style={{ margin: 0, fontSize: 11, color: "#777", lineHeight: 1.6, fontFamily: "var(--font-geist-mono, monospace)", fontStyle: "italic" }}>
                      "{activeIssue.span}"
                    </p>
                  </div>

                  <p style={{ fontSize: 13, color: "#444", lineHeight: 1.65, margin: "0 0 14px" }}>
                    {activeIssue.detail}
                  </p>

                  <div style={{ padding: "12px 14px", background: "#f0fff4", borderLeft: "3px solid #16a34a", marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#16a34a", marginBottom: 6 }}>
                      Suggested Fix
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "#166534", lineHeight: 1.65, fontStyle: "italic" }}>
                      {activeIssue.suggestion}
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => { setDismissed((d) => new Set([...d, activeIssue.id])); setActiveIssue(null); }}
                      style={{
                        flex: 1, padding: "10px",
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                        background: "#111", color: "#fff", border: "none",
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >✓ Accept</button>
                    <button
                      onClick={() => { setDismissed((d) => new Set([...d, activeIssue.id])); setActiveIssue(null); }}
                      style={{
                        flex: 1, padding: "10px",
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                        background: "transparent", color: "#999", border: "1px solid #ddd",
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >Dismiss</button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #eee" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>
                    Issues · click to inspect
                  </span>
                </div>
                {visibleIssues.length === 0 ? (
                  <div style={{ padding: "40px 20px", textAlign: "center", color: "#bbb", fontSize: 12 }}>
                    No issues in this category.
                  </div>
                ) : visibleIssues.map((issue) => (
                  // ── CHANGE 4: onClick now calls selectIssue instead of setActiveIssue ──
                  <button
                    key={issue.id}
                    onClick={() => selectIssue(issue)}
                    style={{
                      width: "100%", textAlign: "left", padding: "13px 16px",
                      borderBottom: "1px solid #f3f3f3",
                      borderLeft: `3px solid ${ISSUE_STYLES[issue.type].dot}`,
                      background: "transparent", cursor: "pointer", fontFamily: "inherit",
                      display: "block", border: "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: SEVERITY_COLOR[issue.severity], flexShrink: 0, display: "inline-block",
                      }} />
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ISSUE_STYLES[issue.type].dot }}>
                        {ISSUE_STYLES[issue.type].label}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: SEVERITY_COLOR[issue.severity] }}>
                        {issue.severity}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#111", marginBottom: 3 }}>
                      {issue.title}
                    </div>
                    <div style={{
                      fontSize: 11, color: "#999", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                      fontFamily: "var(--font-geist-mono, monospace)",
                    }}>
                      "{issue.span}"
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}