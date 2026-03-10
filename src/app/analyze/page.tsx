"use client";

import { useState, useRef, DragEvent } from "react";
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// --- Types ---
interface ClauseDetail {
  present: boolean;
  score: number;
  notes: string;
}

interface Analysis {
  contractType: string;
  riskScore: number;
  fairnessScore: number;
  healthScore: number;
  riskLevel: "Low" | "Medium" | "High" | "Critical";
  recommendation: string;
  summary: string;
  keyRisks: { clause: string; issue: string }[];
  missingProtections: string[];
  possibleComplications: string[];
  clauseBreakdown: {
    paymentTerms: ClauseDetail;
    terminationClause: ClauseDetail;
    ipOwnership: ClauseDetail;
    confidentiality: ClauseDetail;
    liability: ClauseDetail;
    disputeResolution: ClauseDetail;
    scopeOfWork: ClauseDetail;
    jurisdiction: ClauseDetail;
  };
}

const CLAUSE_LABELS: Record<string, string> = {
  paymentTerms: "Payment Terms",
  terminationClause: "Termination Clause",
  ipOwnership: "IP Ownership",
  confidentiality: "Confidentiality",
  liability: "Liability",
  disputeResolution: "Dispute Resolution",
  scopeOfWork: "Scope of Work",
  jurisdiction: "Jurisdiction",
};

// --- Helpers ---
function scoreBarColor(score: number) {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#ca8a04";
  if (score >= 40) return "#ea580c";
  return "#D0021B";
}

function riskLevelColor(level: string) {
  const map: Record<string, string> = {
    Low: "#16a34a", Medium: "#ca8a04", High: "#ea580c", Critical: "#D0021B",
  };
  return map[level] ?? "#111";
}

// --- Extract text from files ---
async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "txt") {
    return await file.text();
  }

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
      text += content.items.filter((item): item is TextItem => 'str' in item).map(item => item.str).join(" ") + "\n";
    }
    return text;
  }

  throw new Error("Unsupported file type.");
}

// --- Sub-components ---
function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = scoreBarColor(score);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#aaa" }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
          {score}<span style={{ fontSize: 10, fontWeight: 400, color: "#555" }}>/100</span>
        </span>
      </div>
      <div style={{ height: 3, background: "#333", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 2, transition: "width 1s ease" }} />
      </div>
    </div>
  );
}

function ClauseRow({ name, detail, isRisk }: { name: string; detail: ClauseDetail; isRisk: boolean }) {
  return (
    <div style={{
      display: "flex", gap: 16, padding: "12px 0",
      borderBottom: "1px solid #f0f0f0",
      background: isRisk ? "#fff5f5" : "transparent",
      marginLeft: isRisk ? -16 : 0, marginRight: isRisk ? -16 : 0,
      paddingLeft: isRisk ? 16 : 0, paddingRight: isRisk ? 16 : 0,
    }}>
      <div style={{ paddingTop: 3, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: detail.present ? scoreBarColor(detail.score) : "#ccc" }}>●</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
            color: isRisk ? "#D0021B" : "#111",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {name}
            {isRisk && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: "0.1em",
                background: "#D0021B", color: "#fff", padding: "2px 6px", borderRadius: 2,
              }}>RISK</span>
            )}
          </span>
          {detail.present && (
            <span style={{ fontSize: 12, fontWeight: 800, color: scoreBarColor(detail.score) }}>{detail.score}</span>
          )}
        </div>
        <p style={{ fontSize: 12, color: "#777", margin: "4px 0 0", lineHeight: 1.5 }}>{detail.notes}</p>
      </div>
    </div>
  );
}

// --- Main Page ---
type InputMode = "paste" | "upload";

export default function AnalyzePage() {
  const [mode, setMode] = useState<InputMode>("paste");
  const [contractText, setContractText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED = ".pdf,.docx,.txt";

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

  async function handleAnalyze() {
    if (!contractText.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await fetch("/api/contracts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setAnalysis(data.analysis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const isDisabled = loading || extracting || !contractText.trim();

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
          Analyze
        </span>
      </nav>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "52px 24px 80px" }}>

        {/* Heading */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 48, fontWeight: 900, letterSpacing: "-0.04em", color: "#111", margin: "0 0 10px", lineHeight: 1 }}>
            Risk Assessment<span style={{ color: "#D0021B" }}>.</span>
          </h1>
          <p style={{ fontSize: 14, color: "#777", margin: 0, lineHeight: 1.6 }}>
            Paste or upload any contract. Get an instant score on risk, fairness, and health.
          </p>
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", marginBottom: 0, borderBottom: "2px solid #111" }}>
          {(["paste", "upload"] as InputMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); clearFile(); setAnalysis(null); setError(null); }}
              style={{
                padding: "9px 20px",
                fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                background: mode === m ? "#111" : "transparent",
                color: mode === m ? "#fff" : "#999",
                border: "none", cursor: "pointer",
                fontFamily: "inherit",
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
              display: "flex", justifyContent: "space-between", alignItems: "center"
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
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#111", margin: "0 0 4px" }}>
                    Drop your contract here
                  </p>
                  <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>
                    or click to browse — PDF, DOCX, TXT
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED}
                  onChange={handleFileInput}
                  style={{ display: "none" }}
                />
              </div>
            ) : (
              <div style={{ padding: "20px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
                      {extracting
                        ? "Extracting text..."
                        : `${contractText.length.toLocaleString()} characters extracted`
                      }
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
                >
                  Remove
                </button>
              </div>
            )}

            {extractError && (
              <div style={{
                margin: "0 16px 16px", padding: "10px 14px",
                background: "#fff0f0", borderLeft: "3px solid #D0021B",
                color: "#D0021B", fontSize: 12,
              }}>
                {extractError}
              </div>
            )}
          </div>
        )}

        {/* Analyze button */}
        <button
          onClick={handleAnalyze}
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
              Analyzing...
            </>
          ) : "Analyze Contract →"}
        </button>

        {/* API Error */}
        {error && (
          <div style={{
            padding: "12px 16px", background: "#fff0f0",
            borderLeft: "3px solid #D0021B", color: "#D0021B",
            fontSize: 13, marginBottom: 32,
          }}>
            {error}
          </div>
        )}

        {/* Results */}
        {analysis && (
          <div>
            {/* Score panel */}
            <div style={{ background: "#111", padding: "24px 28px", borderTop: "3px solid #D0021B" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#555" }}>
                  Assessment Scores
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "3px 10px", borderRadius: 2,
                  border: `1px solid ${riskLevelColor(analysis.riskLevel)}`,
                  color: riskLevelColor(analysis.riskLevel),
                }}>
                  {analysis.riskLevel} Risk
                </span>
              </div>
              <ScoreBar label="Risk Score" score={analysis.riskScore} />
              <ScoreBar label="Fairness Score" score={analysis.fairnessScore} />
              <ScoreBar label="Health Score" score={analysis.healthScore} />
            </div>

            {/* Summary */}
            <div style={{
              background: "#fff", padding: "20px 24px",
              borderLeft: "3px solid #D0021B",
              border: "1px solid #e5e5e5",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>
                  Summary
                </span>
                {analysis.contractType && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
                    padding: "2px 8px", background: "#f3f4f6", color: "#555", borderRadius: 2,
                  }}>
                    {analysis.contractType}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 14, color: "#333", lineHeight: 1.7, margin: "0 0 12px" }}>{analysis.summary}</p>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#111", margin: 0 }}>→ {analysis.recommendation}</p>
            </div>

            {/* Key Risks */}
            {analysis.keyRisks.length > 0 && (
              <div style={{
                background: "#fff8f8", padding: "20px 24px",
                border: "1px solid #f0d5d5", borderTop: "none",
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#D0021B", display: "block", marginBottom: 14 }}>
                  Key Risks
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {analysis.keyRisks.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 10 }}>
                      <span style={{ color: "#D0021B", fontSize: 10, flexShrink: 0, marginTop: 3 }}>●</span>
                      <p style={{ margin: 0, fontSize: 13, color: "#444", lineHeight: 1.5 }}>
                        <strong style={{ color: "#111" }}>{r.clause}:</strong> {r.issue}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Missing + Complications */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid #e5e5e5", borderTop: "none" }}>
              <div style={{ padding: "20px 20px", borderRight: "1px solid #e5e5e5", background: "#fff" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", display: "block", marginBottom: 14 }}>
                  Missing Protections
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {analysis.missingProtections.length === 0
                    ? <p style={{ fontSize: 12, color: "#ccc", margin: 0 }}>None found.</p>
                    : analysis.missingProtections.map((p, i) => (
                      <div key={i} style={{ display: "flex", gap: 8 }}>
                        <span style={{ color: "#ca8a04", fontSize: 11, flexShrink: 0, marginTop: 1 }}>⚠</span>
                        <p style={{ margin: 0, fontSize: 12, color: "#666", lineHeight: 1.5 }}>{p}</p>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div style={{ padding: "20px 20px", background: "#fff" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", display: "block", marginBottom: 14 }}>
                  Complications
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {analysis.possibleComplications.length === 0
                    ? <p style={{ fontSize: 12, color: "#ccc", margin: 0 }}>None found.</p>
                    : analysis.possibleComplications.map((c, i) => (
                      <div key={i} style={{ display: "flex", gap: 8 }}>
                        <span style={{ color: "#aaa", fontSize: 11, flexShrink: 0, marginTop: 1 }}>→</span>
                        <p style={{ margin: 0, fontSize: 12, color: "#666", lineHeight: 1.5 }}>{c}</p>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* Clause Breakdown */}
            <div style={{
              background: "#fff", padding: "20px 24px",
              border: "1px solid #e5e5e5", borderTop: "none", borderBottom: "3px solid #111",
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", display: "block", marginBottom: 4 }}>
                Clause Breakdown
              </span>
              {Object.entries(analysis.clauseBreakdown).map(([key, detail]) => (
                <ClauseRow
                  key={key}
                  name={CLAUSE_LABELS[key] ?? key}
                  detail={detail}
                  isRisk={detail.present && detail.score < 60}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}