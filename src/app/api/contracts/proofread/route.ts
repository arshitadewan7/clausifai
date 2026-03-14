// src/app/api/contracts/proofread/route.ts
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseServer } from "@/lib/supabase";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are a senior Australian solicitor conducting a full due diligence review of a contract on behalf of the weaker party — typically a freelancer, contractor, small business owner, or tenant. Your job is to protect them.

## YOUR MANDATE
Conduct a thorough, adversarial review. Assume the other party drafted this contract to favour themselves. Your client is signing this and needs to know every risk before they do.

You must flag issues across four categories:
1. LEGAL RISKS — ambiguous, unenforceable, or legally dangerous clauses under Australian law
2. GRAMMAR & ERRORS — typos, grammatical errors, missing punctuation that could alter meaning
3. MISSING CLAUSES — standard protections a competent solicitor would insist on for this contract type
4. ONE-SIDED TERMS — clauses that unfairly favour the other party; anything a court might consider unconscionable

## AUSTRALIAN LEGAL STANDARDS — APPLY ALL THAT ARE RELEVANT
- Australian Consumer Law (ACL) — unfair contract terms, consumer guarantees
- Fair Work Act 2009 — if employment or contractor relationships are involved
- Privacy Act 1988 — if personal data is handled
- Competition and Consumer Act 2010
- Relevant state tenancy legislation if a lease is involved
- Common law principles: consideration, certainty of terms, capacity, unconscionability
- Limitation of liability clauses must comply with ACL s64 — they cannot exclude statutory guarantees
- Intellectual property — who owns work product must be explicit
- Termination clauses must be mutual and reasonable
- Dispute resolution — must specify jurisdiction and process

## WHAT TO FLAG — BE COMPREHENSIVE
Flag ALL of the following without exception:
- Any clause that could be void or unenforceable under Australian law
- Any indemnity that is broader than the party's actual liability
- Any IP assignment that transfers rights without clear consideration
- Any termination clause that allows termination without cause or notice
- Any payment clause that lacks a due date, late fee, or dispute process
- Any confidentiality clause with no time limit or overly broad scope
- Any limitation of liability clause that excludes statutory guarantees
- Any clause that prevents the weaker party from seeking legal remedy
- Any automatic renewal clause without notice requirement
- Any jurisdiction clause that is inconvenient or disadvantageous
- Any clause that is vague enough to be interpreted against your client
- Any missing clause that leaves your client unprotected (e.g. no dispute resolution, no IP ownership, no termination process)
- Grammar or punctuation errors that could change the legal meaning of a clause

## WHAT NOT TO FLAG
- Stylistic preferences or minor phrasing variations that do not affect legal meaning
- Issues you are not confident about — if uncertain, omit
- The same issue twice under different headings

## OUTPUT FORMAT
Return ONLY valid JSON. No preamble, no explanation, no markdown fences.

{
  "contractType": <string — detected contract type>,
  "issueCount": <integer — total issues>,
  "healthScore": <integer 0–100 — honest score; a contract with 3+ high issues must be below 55; a contract with no high issues and few mediums can be 75–85; a genuinely clean contract can be 90+>,
  "issues": [
    {
      "id": <integer starting from 1>,
      "type": <"grammar" | "legal" | "missing" | "risky">,
      "severity": <"high" | "medium" | "low">,
      "span": <exact 3–10 word phrase from the contract — verbatim, findable by case-insensitive search>,
      "title": <max 8 words — specific, not generic>,
      "detail": <2–3 sentences — plain English explanation for a non-lawyer Australian; explain the real-world risk>,
      "suggestion": <concrete fix starting with 'Replace with:', 'Add:', or 'Remove:'>
    }
  ]
}

## SPAN RULES — CRITICAL
- The span MUST exist verbatim in the contract — mentally verify before including
- 3–10 words only — no headings, section numbers, or labels
- For missing clause issues, use the span of the nearest existing clause that should have the protection nearby
- If you cannot find a valid span, omit the issue entirely

## SEVERITY GUIDE
- HIGH: Could cause significant financial loss, loss of rights, or legal liability
- MEDIUM: Unfair or risky but not immediately dangerous
- LOW: Minor issue, grammar error, or small improvement

Issues must be ordered: high → medium → low.`;

// ── Similarity helpers ────────────────────────────────────────────────────

function normalise(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function isSimilarTitle(a: string, b: string): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = new Set(na.split(" "));
  const wordsB = nb.split(" ");
  const overlap = wordsB.filter((w) => wordsA.has(w)).length;
  return overlap / Math.max(wordsA.size, wordsB.length) >= 0.5;
}

function isSimilarSpan(a: string, b: string): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contractText, sourceContractId } = body;

    if (!contractText || typeof contractText !== "string") {
      return NextResponse.json(
        { error: "contractText is required and must be a string." },
        { status: 400 }
      );
    }

    if (contractText.trim().length < 100) {
      return NextResponse.json(
        { error: "Contract text is too short to proofread. Please paste the full contract." },
        { status: 400 }
      );
    }

    // ── Fetch previously fixed issues ────────────────────────────────────
    type FixEntry = { title: string; span: string; type: string; severity: string };
    let allPreviousFixes: FixEntry[] = [];
    let roundNumber = 1;

    if (sourceContractId) {
      try {
        const supabase = getSupabaseServer();
        const { data: versions } = await supabase
          .from("contract_versions")
          .select("fix_changelog")
          .eq("contract_id", sourceContractId)
          .not("fix_changelog", "is", null);

        if (versions && versions.length > 0) {
          roundNumber = versions.length + 1;
          allPreviousFixes = versions.flatMap(
            (v: { fix_changelog: FixEntry[] | null }) => v.fix_changelog || []
          );
        }
      } catch (err) {
        console.warn("Could not fetch previous fixes:", err);
      }
    }

    // ── Inject previous fixes into prompt ────────────────────────────────
    let previousFixesSection = "";
    if (allPreviousFixes.length > 0) {
      previousFixesSection = `

## PREVIOUSLY FIXED ISSUES — DO NOT RE-FLAG
This is review round ${roundNumber}. The following issues were already identified and fixed. Do NOT flag these or anything closely similar:

${allPreviousFixes.map((f) => `- "${f.span}" — ${f.title}`).join("\n")}

Only flag issues clearly distinct from the above list.`;
    }

    const finalSystemPrompt = SYSTEM_PROMPT + previousFixesSection;

    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 6000,
      system: finalSystemPrompt,
      messages: [
        {
          role: "user",
          content: `Conduct a full due diligence review of the following contract. Flag every issue:\n\n${contractText}`,
        },
      ],
    });

    const rawText = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    let result;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Claude response:", rawText);
      return NextResponse.json(
        { error: "Failed to parse proofreading response. Please try again." },
        { status: 500 }
      );
    }

    // ── Strip hallucinated spans ──────────────────────────────────────────
    result.issues = result.issues.filter((issue: FixEntry) => {
      const found = contractText.toLowerCase().includes(issue.span.toLowerCase());
      if (!found) console.warn(`Stripped hallucinated span: "${issue.span}"`);
      return found;
    });

    // ── Server-side: strip previously fixed issues ────────────────────────
    if (allPreviousFixes.length > 0) {
      const before = result.issues.length;
      result.issues = result.issues.filter((issue: FixEntry) => {
        const alreadyFixed = allPreviousFixes.some(
          (prev) =>
            isSimilarTitle(issue.title, prev.title) ||
            isSimilarSpan(issue.span, prev.span)
        );
        if (alreadyFixed) console.log(`Suppressed: "${issue.title}"`);
        return !alreadyFixed;
      });
      console.log(`Round ${roundNumber}: suppressed ${before - result.issues.length}, ${result.issues.length} remain`);
    }

    // ── Recalculate healthScore server-side ───────────────────────────────
    const fixBonus     = Math.min(40, allPreviousFixes.length * 3);
    const highCount    = result.issues.filter((i: FixEntry) => i.severity === "high").length;
    const medCount     = result.issues.filter((i: FixEntry) => i.severity === "medium").length;
    const lowCount     = result.issues.filter((i: FixEntry) => i.severity === "low").length;
    const penalty      = highCount * 9 + medCount * 4 + lowCount * 1;
    result.healthScore = Math.min(100, Math.max(0, 100 - penalty + fixBonus));
    result.issueCount  = result.issues.length;

    // Re-number IDs
    result.issues = result.issues.map((issue: FixEntry & { id: number }, idx: number) => ({
      ...issue,
      id: idx + 1,
    }));

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Proofread API error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}