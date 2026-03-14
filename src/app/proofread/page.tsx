"use client";

import { useState, useRef, useEffect, DragEvent } from "react";
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

interface AcceptedFix {
  span: string;
  suggestion: string;
  type: IssueType;
  severity: Severity;
  title: string;
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
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is TextItem => "str" in item);

      if (items.length === 0) continue;

      // Group items by their Y position (same line = within 2 units of each other)
      const lines: { y: number; texts: string[] }[] = [];
      for (const item of items) {
        const y = Math.round(item.transform[5]);
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - y) < 3) {
          last.texts.push(item.str);
        } else {
          lines.push({ y, texts: [item.str] });
        }
      }

      // Sort lines top-to-bottom (PDF y coords are bottom-up)
      lines.sort((a, b) => b.y - a.y);

      // Join each line, detect blank lines between groups
      let prevY: number | null = null;
      for (const line of lines) {
        const lineText = line.texts.join(" ").trim();
        if (!lineText) continue;

        // If gap between lines is large, insert a blank line
        if (prevY !== null && prevY - line.y > 20) {
          fullText += "\n";
        }
        fullText += lineText + "\n";
        prevY = line.y;
      }
      fullText += "\n"; // page break
    }
    return fullText;
  }
  throw new Error("Unsupported file type.");
}

// ── Smart contract formatter ──────────────────────────────────────────────────
// Detects structure and normalises text into readable paragraphs

type FormattedBlock =
  | { kind: "heading";   text: string }
  | { kind: "subheading"; text: string }
  | { kind: "clause";    text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "blank" };

function formatContractText(raw: string): FormattedBlock[] {
  // Normalise line endings, collapse excessive blank lines
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  const blocks: FormattedBlock[] = [];
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    const text = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraphBuffer = [];
  }

  // Heading patterns
  const isAllCaps       = (s: string) => s.length > 3 && s === s.toUpperCase() && /[A-Z]/.test(s);
  const isNumberedClause = (s: string) => /^(\d+\.|\d+\.\d+\.?|[a-z]\)|[ivxlIVXL]+\.)/.test(s.trim());
  const isSectionHeader  = (s: string) => /^(PART|SCHEDULE|CLAUSE|SECTION|ARTICLE)\s+[\dIVX]/i.test(s.trim());
  const isShortAllCaps   = (s: string) => isAllCaps(s.trim()) && s.trim().split(" ").length <= 8;
  const isTitleCase      = (s: string) => {
    const words = s.trim().split(" ");
    return words.length >= 2 && words.length <= 7 &&
      words.every((w) => !w || w[0] === w[0].toUpperCase()) &&
      s.trim().length < 60;
  };

  let consecutiveBlanks = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      consecutiveBlanks++;
      if (consecutiveBlanks === 1) {
        flushParagraph();
        blocks.push({ kind: "blank" });
      }
      continue;
    }
    consecutiveBlanks = 0;

    // Detect heading types
    if (isSectionHeader(trimmed)) {
      flushParagraph();
      blocks.push({ kind: "heading", text: trimmed });
      continue;
    }

    if (isShortAllCaps(trimmed) && trimmed.length < 80) {
      flushParagraph();
      // Distinguish top-level heading vs subheading by length
      if (trimmed.split(" ").length <= 4) {
        blocks.push({ kind: "heading", text: trimmed });
      } else {
        blocks.push({ kind: "subheading", text: trimmed });
      }
      continue;
    }

    if (isNumberedClause(trimmed)) {
      flushParagraph();
      // Check if it's a short clause label vs a full clause with content
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1 && colonIdx < 40 && trimmed.length > colonIdx + 2) {
        blocks.push({ kind: "clause", text: trimmed });
      } else if (trimmed.length < 80 && !trimmed.endsWith(".")) {
        blocks.push({ kind: "subheading", text: trimmed });
      } else {
        blocks.push({ kind: "clause", text: trimmed });
      }
      continue;
    }

    if (isTitleCase(trimmed) && trimmed.length < 60 && !trimmed.endsWith(",")) {
      // Likely a section title — only treat as heading if previous line was blank or heading
      const prev = blocks[blocks.length - 1];
      if (!prev || prev.kind === "blank" || prev.kind === "heading" || prev.kind === "subheading") {
        flushParagraph();
        blocks.push({ kind: "subheading", text: trimmed });
        continue;
      }
    }

    // Regular text — accumulate into paragraph
    // Split on sentence boundaries to avoid massive run-on paragraphs
    const sentences = trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sentences.length > 1) {
      flushParagraph();
      for (const sentence of sentences) {
        const s = sentence.trim();
        if (s) blocks.push({ kind: "paragraph", text: s });
      }
    } else {
      paragraphBuffer.push(trimmed);
    }
  }

  flushParagraph();

  // Remove trailing blanks
  while (blocks.length && blocks[blocks.length - 1].kind === "blank") blocks.pop();

  return blocks;
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

function findSpanInText(text: string, span: string): { start: number; end: number } | null {
  if (!span || !span.trim()) return null;
  const lowerText = text.toLowerCase();
  const lowerSpan = span.toLowerCase().trim();
  const idx = lowerText.indexOf(lowerSpan);
  if (idx !== -1) return { start: idx, end: idx + lowerSpan.length };

  const collapsedToOrig: number[] = [];
  let collapsed = "";
  let prevWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (!prevWasSpace) { collapsedToOrig.push(i); collapsed += " "; }
      prevWasSpace = true;
    } else {
      collapsedToOrig.push(i);
      collapsed += ch.toLowerCase();
      prevWasSpace = false;
    }
  }
  const collapsedSpan = lowerSpan.replace(/\s+/g, " ").trim();
  const collapsedIdx = collapsed.indexOf(collapsedSpan);
  if (collapsedIdx === -1) return null;

  const realStart = collapsedToOrig[collapsedIdx];
  let origPos = realStart;
  let collapsedPos = collapsedIdx;
  while (collapsedPos < collapsedIdx + collapsedSpan.length && origPos < text.length) {
    const isSpace = /\s/.test(text[origPos]);
    if (isSpace) {
      while (origPos < text.length && /\s/.test(text[origPos])) origPos++;
      collapsedPos++;
    } else { origPos++; collapsedPos++; }
  }
  return { start: realStart, end: origPos };
}

function buildSegments(text: string, issues: Issue[], dismissed: Set<number>): Segment[] {
  const active = issues.filter((i) => !dismissed.has(i.id));
  const spans = active
    .map((issue) => {
      const match = findSpanInText(text, issue.span);
      if (!match) return null;
      return { start: match.start, end: match.end, issue };
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

// Render segments within a block of text — handles highlights + search
function renderSegmentsInText(
  blockText: string,
  allSegments: Segment[],
  blockStart: number,
  blockEnd: number,
  searchQuery: string,
  searchIndex: number,
  globalMatchCountRef: { value: number },
  activeIssue: Issue | null,
  setActiveIssue: (i: Issue | null) => void,
  highlightRefs: React.MutableRefObject<Record<number, HTMLSpanElement | null>>
): React.ReactNode[] {
  // Extract the relevant segments for this block
  const blockSegments: Segment[] = [];
  let pos = blockStart;

  for (const seg of allSegments) {
    // Find where this segment falls within our block
    const segStart = blockStart + blockText.indexOf(seg.text, pos - blockStart);
    if (segStart < blockStart || segStart >= blockEnd) continue;

    if (seg.type === "highlight") {
      const relStart = segStart - blockStart;
      const relEnd = relStart + seg.text.length;
      if (relStart > pos - blockStart) {
        blockSegments.push({ type: "text", text: blockText.slice(pos - blockStart, relStart) });
      }
      blockSegments.push(seg);
      pos = blockStart + relEnd;
    }
  }
  if (pos - blockStart < blockText.length) {
    blockSegments.push({ type: "text", text: blockText.slice(pos - blockStart) });
  }

  if (blockSegments.length === 0) blockSegments.push({ type: "text", text: blockText });

  return blockSegments.map((seg, i) => {
    if (seg.type === "text") {
      if (!searchQuery.trim()) return <span key={i}>{seg.text}</span>;
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const parts = seg.text.split(new RegExp(`(${escaped})`, "gi"));
      return (
        <span key={i}>
          {parts.map((part, j) => {
            if (part.toLowerCase() !== searchQuery.toLowerCase()) return <span key={j}>{part}</span>;
            const thisIndex = globalMatchCountRef.value++;
            const isActive = thisIndex === searchIndex;
            return (
              <mark key={j}
                ref={(el) => { if (isActive && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                style={{ background: isActive ? "#FDE68A" : "#FEF08A", color: "#111", padding: 0, outline: isActive ? "2px solid #D0021B" : "none" }}
              >{part}</mark>
            );
          })}
        </span>
      );
    }
    const s = ISSUE_STYLES[seg.issue.type];
    const isActive = activeIssue?.id === seg.issue.id;
    return (
      <span key={i}
        ref={(el) => { highlightRefs.current[seg.issue.id] = el; }}
        onClick={(e) => { e.stopPropagation(); setActiveIssue(isActive ? null : seg.issue); }}
        style={{ background: isActive ? s.bg.replace("0.6", "1").replace("0.7", "1") : s.bg, borderBottom: `2px solid ${s.underline}`, cursor: "pointer", padding: "1px 0" }}
      >{seg.text}</span>
    );
  });
}

function applyFixes(text: string, acceptedFixes: Map<number, AcceptedFix>): string {
  let result = text;
  const fixes = Array.from(acceptedFixes.values());
  const positioned = fixes
    .map((fix) => {
      const match = findSpanInText(result, fix.span);
      return match ? { ...fix, ...match } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.start - a!.start) as (AcceptedFix & { start: number; end: number })[];

  for (const fix of positioned) {
    const suggestion = fix.suggestion
      .replace(/^(Replace with:|Add:|Remove:)\s*/i, "")
      .trim();
    result = result.slice(0, fix.start) + suggestion + result.slice(fix.end);
  }
  return result;
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ProofreadPage() {
  const [mode, setMode] = useState<InputMode>("paste");
  const [contractText, setContractText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProofreadResult | null>(null);

  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [filter, setFilter] = useState("all");
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [acceptedFixes, setAcceptedFixes] = useState<Map<number, AcceptedFix>>(new Map());

  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportTitle, setExportTitle] = useState("");
  const [exportSaving, setExportSaving] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<{ contractId: string; versionNumber: number } | null>(null);

  const [preloadedLabel, setPreloadedLabel] = useState<string | null>(null);
  const [sourceContractId, setSourceContractId] = useState<string | null>(null);

  const highlightRefs = useRef<Record<number, HTMLSpanElement | null>>({});

  useEffect(() => {
    const savedText       = sessionStorage.getItem("clausifai_proofread_text");
    const savedLabel      = sessionStorage.getItem("clausifai_proofread_label");
    const savedContractId = sessionStorage.getItem("clausifai_proofread_contractId");
    if (savedText) {
      setContractText(savedText);
      setMode("paste");
      if (savedLabel)      setPreloadedLabel(savedLabel);
      if (savedContractId) setSourceContractId(savedContractId);
      sessionStorage.removeItem("clausifai_proofread_text");
      sessionStorage.removeItem("clausifai_proofread_label");
      sessionStorage.removeItem("clausifai_proofread_contractId");
    }
  }, []);

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
      setPreloadedLabel(null);
      setSourceContractId(null);
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
    setPreloadedLabel(null);
    setSourceContractId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleProofread() {
    if (!contractText.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setActiveIssue(null);
    setDismissed(new Set());
    setAcceptedFixes(new Map());
    setFilter("all");
    setSearchQuery("");
    setSearchIndex(0);
    setExportSuccess(null);
    try {
      const res = await fetch("/api/contracts/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractText,
          sourceContractId: sourceContractId || undefined,
        }),
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

  function selectIssue(issue: Issue) {
    setActiveIssue(issue);
    setTimeout(() => {
      const el = highlightRefs.current[issue.id];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid #D0021B";
        el.style.outlineOffset = "2px";
        setTimeout(() => { el.style.outline = "none"; el.style.outlineOffset = "0px"; }, 1200);
      }
    }, 50);
  }

  function acceptIssue(issue: Issue) {
    setAcceptedFixes((prev) => {
      const next = new Map(prev);
      next.set(issue.id, { span: issue.span, suggestion: issue.suggestion, type: issue.type, severity: issue.severity, title: issue.title });
      return next;
    });
    setDismissed((d) => new Set([...d, issue.id]));
    setActiveIssue(null);
  }

  function dismissIssue(issue: Issue) {
    setDismissed((d) => new Set([...d, issue.id]));
    setActiveIssue(null);
  }

  async function handleExport() {
    setExportSaving(true);
    setExportError(null);
    try {
      const fixedText = applyFixes(contractText, acceptedFixes);
      const changelog = Array.from(acceptedFixes.values());
      const res = await fetch("/api/contracts/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractText:  fixedText,
          originalText:  contractText,
          title:         exportTitle.trim() || result?.contractType || "Uploaded contract",
          source:        "proofread",
          fixChangelog:  changelog,
          contractId:    sourceContractId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to save.");
      setExportSuccess({ contractId: data.contractId, versionNumber: data.version.version_number });
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setExportSaving(false);
    }
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

  const segments  = result ? buildSegments(contractText, visibleIssues, dismissed) : [];
  const highCount = visibleIssues.filter((i) => i.severity === "high").length;
  const liveScore = result ? Math.min(100, result.healthScore + dismissed.size * 5) : 0;

  const totalSearchMatches = !searchQuery.trim()
    ? 0
    : segments.reduce((acc, seg) => {
        if (seg.type !== "text") return acc;
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return acc + (seg.text.match(new RegExp(escaped, "gi"))?.length ?? 0);
      }, 0);

  // ── Smart formatted contract renderer ────────────────────────────────────

  function renderFormattedContract() {
    const blocks = formatContractText(contractText);
    const globalMatchCountRef = { value: 0 };

    // We still need to render highlights — build a flat map of span positions
    // For formatted rendering we render each block's text and annotate with segments
    return blocks.map((block, bi) => {
      if (block.kind === "blank") {
        return <div key={bi} style={{ height: 12 }} />;
      }

      const text = (block as { kind: string; text: string }).text;

      // Find segments that overlap with this text
      const blockSegments: React.ReactNode[] = [];
      let remaining = text;
      let offset = 0;

      // Find matching segments for this block's text
      const matchingSegments = segments.filter((seg) => {
        const idx = text.toLowerCase().indexOf(seg.text.toLowerCase());
        return idx !== -1;
      });

      if (matchingSegments.length === 0) {
        // No highlights — just render text with search highlights
        if (!searchQuery.trim()) {
          blockSegments.push(<span key="t">{text}</span>);
        } else {
          const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const parts = text.split(new RegExp(`(${escaped})`, "gi"));
          parts.forEach((part, j) => {
            if (part.toLowerCase() !== searchQuery.toLowerCase()) {
              blockSegments.push(<span key={j}>{part}</span>);
            } else {
              const thisIndex = globalMatchCountRef.value++;
              const isActive = thisIndex === searchIndex;
              blockSegments.push(
                <mark key={j}
                  ref={(el) => { if (isActive && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                  style={{ background: isActive ? "#FDE68A" : "#FEF08A", color: "#111", padding: 0, outline: isActive ? "2px solid #D0021B" : "none" }}
                >{part}</mark>
              );
            }
          });
        }
      } else {
        // Render with highlight spans
        let cursor = 0;
        const sorted = [...matchingSegments].sort((a, b) => {
          return text.toLowerCase().indexOf(a.text.toLowerCase()) - text.toLowerCase().indexOf(b.text.toLowerCase());
        });
        for (const seg of sorted) {
          const idx = text.toLowerCase().indexOf(seg.text.toLowerCase(), cursor);
          if (idx === -1 || idx < cursor) continue;
          if (idx > cursor) blockSegments.push(<span key={`t-${cursor}`}>{text.slice(cursor, idx)}</span>);
          if (seg.type === "highlight") {
            const s = ISSUE_STYLES[seg.issue.type];
            const isActive = activeIssue?.id === seg.issue.id;
            blockSegments.push(
              <span key={`h-${idx}`}
                ref={(el) => { highlightRefs.current[seg.issue.id] = el; }}
                onClick={(e) => { e.stopPropagation(); setActiveIssue(isActive ? null : seg.issue); }}
                style={{ background: isActive ? s.bg.replace("0.6","1").replace("0.7","1") : s.bg, borderBottom: `2px solid ${s.underline}`, cursor: "pointer", padding: "1px 0" }}
              >{text.slice(idx, idx + seg.text.length)}</span>
            );
            cursor = idx + seg.text.length;
          }
        }
        if (cursor < text.length) blockSegments.push(<span key={`t-end`}>{text.slice(cursor)}</span>);
      }

      // Render block with appropriate styling
      if (block.kind === "heading") {
        return (
          <div key={bi} style={{ marginTop: 28, marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid #111" }}>
            <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111" }}>
              {blockSegments}
            </span>
          </div>
        );
      }

      if (block.kind === "subheading") {
        return (
          <div key={bi} style={{ marginTop: 18, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#333", letterSpacing: "0.02em" }}>
              {blockSegments}
            </span>
          </div>
        );
      }

      if (block.kind === "clause") {
        return (
          <div key={bi} style={{ marginBottom: 10, paddingLeft: 16, borderLeft: "2px solid #eee" }}>
            <span style={{ fontSize: 12, lineHeight: 1.8, color: "#333", fontFamily: "var(--font-geist-mono, monospace)" }}>
              {blockSegments}
            </span>
          </div>
        );
      }

      // paragraph
      return (
        <p key={bi} style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.85, color: "#333" }}>
          {blockSegments}
        </p>
      );
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={{
      minHeight: "100vh", background: "#f5f5f5",
      backgroundImage: `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`,
      backgroundSize: "40px 40px",
      fontFamily: "var(--font-geist-sans, 'Helvetica Neue', Arial, sans-serif)",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Nav */}
      <nav style={{ borderBottom: "2px solid #111", background: "#f5f5f5", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.03em", color: "#111" }}>clausifai</span>
          <span style={{ fontSize: 17, fontWeight: 900, color: "#D0021B" }}>.</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {sourceContractId && (
            <a href={`/contracts/${sourceContractId}/versions`} style={{ fontSize: 10, fontWeight: 700, color: "#555", textDecoration: "none", letterSpacing: "0.06em" }}>
              ← Version History
            </a>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#999" }}>Proofread</span>
        </div>
      </nav>

      {!result ? (
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "52px 24px 80px" }}>
          <div style={{ marginBottom: 36 }}>
            <h1 style={{ fontSize: 48, fontWeight: 900, letterSpacing: "-0.04em", color: "#111", margin: "0 0 10px", lineHeight: 1 }}>
              Proofread<span style={{ color: "#D0021B" }}>.</span>
            </h1>
            <p style={{ fontSize: 14, color: "#777", margin: 0, lineHeight: 1.6 }}>
              Paste or upload any contract. Get inline highlights for legal risks, grammar issues, missing clauses, and one-sided terms.
            </p>
          </div>

          <div style={{ display: "flex", gap: 0, marginBottom: 28, border: "1px solid #ddd", background: "#fff" }}>
            {(["legal", "grammar", "missing", "risky"] as IssueType[]).map((type, i) => (
              <div key={type} style={{ flex: 1, padding: "10px 14px", borderRight: i < 3 ? "1px solid #eee" : "none", display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: ISSUE_STYLES[type].dot, flexShrink: 0, display: "inline-block" }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#555" }}>{ISSUE_STYLES[type].label}</span>
              </div>
            ))}
          </div>

          {preloadedLabel && (
            <div style={{ padding: "10px 14px", background: "#f0fff4", borderLeft: "3px solid #16a34a", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#16a34a" }}>Loaded from version history</span>
                <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>{preloadedLabel}</div>
              </div>
              <button onClick={() => { setPreloadedLabel(null); setContractText(""); setSourceContractId(null); }} style={{ background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 14, padding: "4px 8px" }}>✕</button>
            </div>
          )}

          <div style={{ display: "flex", marginBottom: 0, borderBottom: "2px solid #111" }}>
            {(["paste", "upload"] as InputMode[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); if (m === "upload") clearFile(); setError(null); }} style={{
                padding: "9px 20px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                background: mode === m ? "#111" : "transparent", color: mode === m ? "#fff" : "#999",
                border: "none", cursor: "pointer", fontFamily: "inherit",
                borderBottom: mode === m ? "2px solid #D0021B" : "none", marginBottom: -2,
              }}>
                {m === "paste" ? "Paste Text" : "Upload File"}
              </button>
            ))}
          </div>

          {mode === "paste" && (
            <div style={{ background: "#fff", border: "1px solid #ddd", borderTop: "none" }}>
              <div style={{ padding: "9px 14px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>
                  {preloadedLabel ? "Contract (from version history)" : "Contract Input"}
                </span>
                {contractText.length > 0 && <span style={{ fontSize: 10, color: "#ccc" }}>{contractText.length.toLocaleString()} chars</span>}
              </div>
              <textarea value={contractText} onChange={(e) => setContractText(e.target.value)} placeholder="Paste your contract text here..." rows={10} style={{
                width: "100%", padding: "14px 16px", fontSize: 12, lineHeight: 1.8, border: "none", resize: "vertical",
                background: "transparent", color: "#111", fontFamily: "var(--font-geist-mono, monospace)",
                outline: "none", boxSizing: "border-box", display: "block",
              }} />
            </div>
          )}

          {mode === "upload" && (
            <div style={{ background: "#fff", border: "1px solid #ddd", borderTop: "none" }}>
              {!uploadedFile ? (
                <div onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} style={{
                  padding: "48px 24px", border: `2px dashed ${isDragging ? "#D0021B" : "#ddd"}`, margin: 16,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                  cursor: "pointer", background: isDragging ? "#fff8f8" : "transparent", transition: "all 0.15s",
                }}>
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
                    {extracting
                      ? <span style={{ width: 14, height: 14, border: "2px solid #ddd", borderTopColor: "#D0021B", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
                      : <span style={{ fontSize: 18 }}>📄</span>}
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#111" }}>{uploadedFile.name}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>{extracting ? "Extracting text..." : `${contractText.length.toLocaleString()} characters extracted`}</p>
                    </div>
                  </div>
                  <button onClick={clearFile} style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: "none", border: "1px solid #ddd", padding: "5px 10px", color: "#999", cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
                </div>
              )}
              {extractError && <div style={{ margin: "0 16px 16px", padding: "10px 14px", background: "#fff0f0", borderLeft: "3px solid #D0021B", color: "#D0021B", fontSize: 12 }}>{extractError}</div>}
            </div>
          )}

          <button onClick={handleProofread} disabled={isDisabled} style={{
            width: "100%", padding: "13px 24px", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
            background: isDisabled ? "#e0e0e0" : "#111", color: isDisabled ? "#aaa" : "#fff",
            border: "none", cursor: isDisabled ? "not-allowed" : "pointer", fontFamily: "inherit", marginBottom: 40,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            {loading
              ? <><span style={{ width: 11, height: 11, border: "2px solid #555", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />Proofreading...</>
              : "Proofread Contract →"}
          </button>

          {error && <div style={{ padding: "12px 16px", background: "#fff0f0", borderLeft: "3px solid #D0021B", color: "#D0021B", fontSize: 13, marginBottom: 32 }}>{error}</div>}
        </div>

      ) : (
        <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>

          {/* Left sidebar */}
          <div style={{ width: 220, background: "#fff", borderRight: "2px solid #111", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "auto" }}>
            <div style={{ padding: "20px 18px", borderBottom: "1px solid #eee", background: "#111" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#555", marginBottom: 8 }}>Contract Health</div>
              <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.04em", color: scoreColor(liveScore) }}>
                {liveScore}<span style={{ fontSize: 14, fontWeight: 400, color: "#555" }}>/100</span>
              </div>
              <div style={{ height: 3, background: "#333", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${liveScore}%`, background: scoreColor(liveScore), borderRadius: 2 }} />
              </div>
              {highCount > 0 && <div style={{ marginTop: 10, fontSize: 10, fontWeight: 700, color: "#D0021B", letterSpacing: "0.06em" }}>⚠ {highCount} HIGH RISK</div>}
            </div>

            {preloadedLabel && (
              <div style={{ padding: "10px 18px", background: "#f0fff4", borderBottom: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#16a34a", marginBottom: 2 }}>From Version History</div>
                <div style={{ fontSize: 10, color: "#166534" }}>{preloadedLabel}</div>
              </div>
            )}

            {acceptedFixes.size > 0 && (
              <div style={{ padding: "12px 18px", background: "#f0fff4", borderBottom: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#16a34a" }}>
                  ✓ {acceptedFixes.size} FIX{acceptedFixes.size !== 1 ? "ES" : ""} ACCEPTED
                </div>
              </div>
            )}

            <div style={{ padding: "16px 18px 8px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", marginBottom: 10 }}>Filter Issues</div>
              {FILTER_OPTIONS.map(({ key, label }) => {
                const active = filter === key;
                const dotColor = key === "all" ? "#111" : ISSUE_STYLES[key as IssueType]?.dot;
                return (
                  <button key={key} onClick={() => { setFilter(key); setActiveIssue(null); }} style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 10px", marginBottom: 3,
                    background: active ? "#111" : "transparent", color: active ? "#fff" : "#555",
                    border: active ? "none" : "1px solid #eee", cursor: "pointer", fontFamily: "inherit",
                    fontSize: 11, fontWeight: active ? 800 : 500, letterSpacing: "0.04em",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? "#D0021B" : dotColor, flexShrink: 0, display: "inline-block" }} />
                      {label}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: active ? "#D0021B" : "#bbb" }}>{counts[key] ?? 0}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: "auto", padding: "16px 18px", borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* View Version History — always shown when loaded from a contract */}
              {sourceContractId && (
                <a
                  href={`/contracts/${sourceContractId}/versions`}
                  style={{
                    display: "block", padding: "9px", textAlign: "center",
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                    background: "#f5f5f5", color: "#555", border: "1px solid #ddd",
                    textDecoration: "none",
                  }}
                >
                  ← Version History
                </a>
              )}
              {acceptedFixes.size > 0 && (
                <button
                  onClick={() => { setShowExportModal(true); setExportError(null); setExportSuccess(null); }}
                  style={{ width: "100%", padding: "10px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#D0021B", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Export Fixed Contract →
                </button>
              )}
              <button
                onClick={() => { setResult(null); setContractText(""); clearFile(); setError(null); setActiveIssue(null); setFilter("all"); setDismissed(new Set()); setAcceptedFixes(new Map()); setSearchQuery(""); setSearchIndex(0); setExportSuccess(null); setPreloadedLabel(null); setSourceContractId(null); }}
                style={{ width: "100%", padding: "9px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: "#999", border: "1px solid #ddd", cursor: "pointer", fontFamily: "inherit" }}
              >← New Contract</button>
            </div>
          </div>

          {/* Centre — annotated contract */}
          <div
            style={{ flex: 1, overflow: "auto", padding: "40px 48px", background: "#f5f5f5", backgroundImage: `linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)`, backgroundSize: "40px 40px" }}
            onClick={(e) => { if ((e.target as HTMLElement).tagName !== "SPAN") setActiveIssue(null); }}
          >
            <div style={{ maxWidth: 680, margin: "0 auto 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>{result.contractType}</span>
              <span style={{ fontSize: 10, color: "#ddd" }}>·</span>
              <span style={{ fontSize: 10, color: "#bbb" }}>{result.issueCount} issues found</span>
              {preloadedLabel && (
                <>
                  <span style={{ fontSize: 10, color: "#ddd" }}>·</span>
                  <span style={{ fontSize: 10, color: "#16a34a", fontWeight: 700 }}>{preloadedLabel}</span>
                </>
              )}
            </div>

            {/* Search bar */}
            <div style={{ maxWidth: 680, margin: "0 auto 20px" }}>
              <div style={{ display: "flex", alignItems: "center", border: "2px solid #111", background: "#fff" }}>
                <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setSearchIndex(0); }} placeholder="Search contract..." style={{ flex: 1, padding: "8px 12px", fontSize: 11, border: "none", color: "#111", background: "transparent", fontFamily: "var(--font-geist-mono, monospace)", outline: "none" }} />
                {searchQuery && (
                  <>
                    <span style={{ fontSize: 10, color: "#999", fontFamily: "var(--font-geist-mono, monospace)", paddingRight: 8 }}>
                      {totalSearchMatches > 0 ? `${Math.min(searchIndex + 1, totalSearchMatches)}/${totalSearchMatches}` : "0/0"}
                    </span>
                    <button onClick={() => setSearchIndex(i => Math.max(0, i - 1))} style={{ background: "none", border: "none", borderLeft: "1px solid #ddd", padding: "8px 10px", cursor: "pointer", fontSize: 12, color: "#555" }}>↑</button>
                    <button onClick={() => setSearchIndex(i => Math.min(totalSearchMatches - 1, i + 1))} style={{ background: "none", border: "none", borderLeft: "1px solid #ddd", padding: "8px 10px", cursor: "pointer", fontSize: 12, color: "#555" }}>↓</button>
                    <button onClick={() => { setSearchQuery(""); setSearchIndex(0); }} style={{ background: "none", border: "none", borderLeft: "1px solid #ddd", padding: "8px 10px", cursor: "pointer", fontSize: 12, color: "#999" }}>✕</button>
                  </>
                )}
              </div>
            </div>

            {/* Contract document — smart formatted */}
            <div style={{ maxWidth: 680, margin: "0 auto", background: "#fff", border: "1px solid #ddd", borderTop: "3px solid #111", padding: "48px 56px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              {renderFormattedContract()}
            </div>

            <div style={{ maxWidth: 680, margin: "16px auto 0", display: "flex", gap: 20, flexWrap: "wrap" }}>
              {(Object.entries(ISSUE_STYLES) as [IssueType, typeof ISSUE_STYLES[IssueType]][]).map(([type, s]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 18, height: 2, background: s.underline, display: "inline-block" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#999" }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div style={{ width: 300, borderLeft: "2px solid #111", background: "#fff", overflow: "auto", flexShrink: 0 }}>
            {activeIssue ? (
              <div>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                  <button onClick={() => setActiveIssue(null)} style={{ background: "none", border: "none", color: "#999", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer", fontFamily: "inherit", padding: 0, textTransform: "uppercase" }}>← Back</button>
                </div>
                <div style={{ padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: SEVERITY_COLOR[activeIssue.severity], flexShrink: 0, display: "inline-block" }} />
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: activeIssue.type === "legal" ? "#fff0f0" : activeIssue.type === "risky" ? "#fff7ed" : activeIssue.type === "missing" ? "#eff6ff" : "#fefce8", color: ISSUE_STYLES[activeIssue.type].dot, padding: "2px 7px", borderRadius: 2 }}>{ISSUE_STYLES[activeIssue.type].label}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: SEVERITY_COLOR[activeIssue.severity] }}>{activeIssue.severity}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "-0.02em", color: "#111", marginBottom: 12 }}>{activeIssue.title}</div>
                  <div style={{ padding: "10px 12px", background: "#f9f9f9", borderLeft: "3px solid #ddd", marginBottom: 14 }}>
                    <p style={{ margin: 0, fontSize: 11, color: "#777", lineHeight: 1.6, fontFamily: "var(--font-geist-mono, monospace)", fontStyle: "italic" }}>"{activeIssue.span}"</p>
                  </div>
                  <p style={{ fontSize: 13, color: "#444", lineHeight: 1.65, margin: "0 0 14px" }}>{activeIssue.detail}</p>
                  <div style={{ padding: "12px 14px", background: "#f0fff4", borderLeft: "3px solid #16a34a", marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#16a34a", marginBottom: 6 }}>Suggested Fix</div>
                    <p style={{ margin: 0, fontSize: 12, color: "#166534", lineHeight: 1.65, fontStyle: "italic" }}>{activeIssue.suggestion}</p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => acceptIssue(activeIssue)} style={{ flex: 1, padding: "10px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#111", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}>✓ Accept</button>
                    <button onClick={() => dismissIssue(activeIssue)} style={{ flex: 1, padding: "10px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: "#999", border: "1px solid #ddd", cursor: "pointer", fontFamily: "inherit" }}>Dismiss</button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #eee" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb" }}>
                    {visibleIssues.length === 0 ? "No issues remaining" : "Issues · click to inspect"}
                  </span>
                </div>
                {visibleIssues.length === 0 ? (
                  <div style={{ padding: "40px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 12 }}>✓</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#111", marginBottom: 6 }}>
                      {filter === "all" ? "No issues found" : "No issues in this category"}
                    </div>
                    <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.6, marginBottom: 20 }}>
                      {filter === "all"
                        ? "This contract looks clean. You can export it or mark it as final in version history."
                        : "Try switching to a different filter."}
                    </div>
                    {sourceContractId && filter === "all" && (
                      <a href={`/contracts/${sourceContractId}/versions`} style={{ display: "block", padding: "9px", textAlign: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#111", color: "#fff", textDecoration: "none" }}>
                        View Version History →
                      </a>
                    )}
                  </div>
                ) : visibleIssues.map((issue) => (
                  <button key={issue.id} onClick={() => selectIssue(issue)} style={{
                    width: "100%", textAlign: "left", padding: "13px 16px",
                    borderBottom: "1px solid #f3f3f3", borderLeft: `3px solid ${ISSUE_STYLES[issue.type].dot}`,
                    borderTop: "none", borderRight: "none",
                    background: "transparent", cursor: "pointer", fontFamily: "inherit", display: "block",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: SEVERITY_COLOR[issue.severity], flexShrink: 0, display: "inline-block" }} />
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ISSUE_STYLES[issue.type].dot }}>{ISSUE_STYLES[issue.type].label}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: SEVERITY_COLOR[issue.severity] }}>{issue.severity}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#111", marginBottom: 3 }}>{issue.title}</div>
                    <div style={{ fontSize: 11, color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-geist-mono, monospace)" }}>"{issue.span}"</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowExportModal(false); }}
        >
          <div style={{ background: "#fff", border: "2px solid #111", width: 480, maxWidth: "90vw", padding: 0 }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: "-0.02em", color: "#111" }}>Export Fixed Contract</span>
                {sourceContractId && <div style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, marginTop: 2 }}>↳ Will be saved as a new version on this contract</div>}
              </div>
              <button onClick={() => setShowExportModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#999" }}>✕</button>
            </div>

            {exportSuccess ? (
              <div style={{ padding: "32px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: "#111", marginBottom: 8 }}>Saved successfully</div>
                <div style={{ fontSize: 12, color: "#777", marginBottom: 4 }}>Version {exportSuccess.versionNumber} created</div>
                <div style={{ fontSize: 11, color: "#bbb", fontFamily: "var(--font-geist-mono, monospace)", marginBottom: 24 }}>{exportSuccess.contractId}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowExportModal(false)} style={{ flex: 1, padding: "10px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "#111", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Done</button>
                  <a href={`/contracts/${exportSuccess.contractId}/versions`} style={{ flex: 1, padding: "10px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: "#111", border: "1px solid #ddd", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>View History →</a>
                </div>
              </div>
            ) : (
              <div style={{ padding: "20px 24px" }}>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", marginBottom: 10 }}>
                    {acceptedFixes.size} Fix{acceptedFixes.size !== 1 ? "es" : ""} to Apply
                  </div>
                  <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid #eee" }}>
                    {Array.from(acceptedFixes.values()).map((fix, i) => (
                      <div key={i} style={{ padding: "8px 12px", borderBottom: "1px solid #f5f5f5", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: ISSUE_STYLES[fix.type].dot, flexShrink: 0, marginTop: 4, display: "inline-block" }} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#111" }}>{fix.title}</div>
                          <div style={{ fontSize: 10, color: "#999", fontFamily: "var(--font-geist-mono, monospace)" }}>"{fix.span}"</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#bbb", display: "block", marginBottom: 6 }}>Contract Title</label>
                  <input type="text" value={exportTitle} onChange={(e) => setExportTitle(e.target.value)} placeholder={result?.contractType || "e.g. Freelance Services Agreement"} style={{ width: "100%", padding: "9px 12px", fontSize: 12, border: "2px solid #111", background: "#fff", color: "#111", fontFamily: "var(--font-geist-mono, monospace)", outline: "none", boxSizing: "border-box" }} />
                </div>
                {exportError && <div style={{ padding: "10px 12px", background: "#fff0f0", borderLeft: "3px solid #D0021B", color: "#D0021B", fontSize: 12, marginBottom: 16 }}>{exportError}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleExport} disabled={exportSaving} style={{
                    flex: 1, padding: "11px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                    background: exportSaving ? "#999" : "#D0021B", color: "#fff", border: "none",
                    cursor: exportSaving ? "not-allowed" : "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    {exportSaving ? <><span style={{ width: 10, height: 10, border: "2px solid #fff8", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />Saving...</> : "Save to Clausifai →"}
                  </button>
                  <button onClick={() => setShowExportModal(false)} style={{ padding: "11px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: "#999", border: "1px solid #ddd", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}