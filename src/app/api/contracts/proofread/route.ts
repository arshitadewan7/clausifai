// src/app/api/contracts/proofread/route.ts
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are a specialist legal contract proofreading engine for Clausifai, a platform that helps freelancers, startups, and small businesses in Australia understand and assess contracts.

## YOUR ROLE
Proofread the provided contract and identify every issue across four categories:
1. Legal language & clause issues — ambiguous, unenforceable, or legally problematic wording
2. Grammar & spelling — typos, grammatical errors, punctuation issues
3. Missing standard clauses — protections or clauses that are absent but expected in this type of contract
4. Risky or one-sided terms — clauses that unfairly favour the other party over the contractor/freelancer

## LEGAL CONTEXT
Apply Australian legal standards where applicable, including:
- Australian Consumer Law (ACL)
- Common law contract principles under Australian jurisdiction

## OUTPUT FORMAT
Return ONLY valid JSON. No preamble, no explanation, no markdown fences, no commentary.

Exact structure:

{
  "contractType": <detected contract type as a string>,
  "issueCount": <total number of issues found as integer>,
  "healthScore": <integer 0–100 reflecting overall contract quality; deduct ~8–10 per high-severity issue, ~4–5 per medium, ~1–2 per low>,
  "issues": [
    {
      "id": <integer, starting from 1>,
      "type": <"grammar" | "legal" | "missing" | "risky">,
      "severity": <"high" | "medium" | "low">,
      "span": <the exact verbatim substring from the contract that contains the issue — must be a direct quote from the contract text, keep it short, 3–12 words>,
      "title": <short title for the issue, max 8 words>,
      "detail": <2–3 sentence explanation of why this is a problem, written in plain English for a non-lawyer Australian freelancer>,
      "suggestion": <specific suggested replacement text or clause, beginning with 'Replace with:' or 'Add:' or 'Remove:'>
    }
  ]
}

## RULES
- "span" must be an exact verbatim substring that appears in the contract — do not paraphrase or shorten it; it is used to locate and highlight the text
- Every issue must have a span that can be found via exact string match in the contract
- For "missing" type issues, use the nearest related clause heading or phrase as the span
- Issues must be ordered by severity: high first, then medium, then low
- Never fabricate issues that are not genuinely present
- Grammar issues should only be flagged if they are real errors, not stylistic preferences
- Risky terms must be assessed from the contractor/freelancer's perspective
- All fields are required for every issue`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contractText } = body;

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

    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Proofread the following contract and return all issues:\n\n${contractText}`,
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

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Proofread API error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}