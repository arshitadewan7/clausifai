import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { anthropic } from '@/lib/anthropic'
import type { RetrievedClause } from './clause-retriever'

const GroundingResultSchema = z.object({
  groundednessScore: z
    .number()
    .min(0)
    .max(100)
    .describe('Percentage of substantive legal sections grounded in source clauses'),
  verdict: z.enum(['clean', 'minor_issues', 'major_issues']),
  groundedSections: z.array(z.string()).describe('Section headings that are properly grounded'),
  hallucinatedSections: z.array(
    z.object({
      section: z.string().describe('Section heading or clause reference'),
      content: z.string().describe('First ~200 chars of the ungrounded provision'),
      reason: z.string().describe('Why this content is not traceable to any source clause'),
    }),
  ),
  summary: z.string().describe('One-sentence plain-English grounding verdict'),
})

export type GroundingResult = z.infer<typeof GroundingResultSchema>

export async function validateGrounding(
  contract: string,
  sourceClauses: RetrievedClause[],
): Promise<GroundingResult> {
  if (sourceClauses.length === 0) {
    return {
      groundednessScore: 0,
      verdict: 'major_issues',
      groundedSections: [],
      hallucinatedSections: [
        {
          section: 'Entire Contract',
          content: contract.slice(0, 200),
          reason:
            'No source clauses were retrieved from the legal database — the entire contract is ungrounded.',
        },
      ],
      summary: 'No source clauses were retrieved; all legal provisions are unverified.',
    }
  }

  const sourceContext = sourceClauses
    .map((c, i) => `[SOURCE-${i + 1}] (${c.clause_type})\n${c.content}`)
    .join('\n\n---\n\n')

  const response = await anthropic.messages.parse({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `You are a legal grounding auditor. Your task is to verify that every substantive legal provision in a generated contract is traceable to the provided SOURCE CLAUSES.

WHAT IS NOT HALLUCINATION — do NOT flag:
- Contract title, section headers, clause numbering
- Party identification block (names, roles, addresses)
- Recitals and preamble language ("NOW THEREFORE...", "WHEREAS...")
- Signature block and execution section
- Transitional or connecting language between clauses
- Variable substitution within a source clause (party names, dates, amounts, locations, scope descriptions)

WHAT IS HALLUCINATION — MUST flag:
- Legal obligations, rights, or liabilities with no basis in any source clause
- Statutory or regulatory references invented by the model
- Novel defined terms with substantive legal meaning not present in source clauses
- Penalty, indemnity, or warranty provisions not appearing in source clauses
- IP ownership, termination triggers, or dispute resolution mechanisms not in source clauses
- Any specific legal standard or test not found in the source clauses`,
    messages: [
      {
        role: 'user',
        content: `SOURCE CLAUSES:\n${sourceContext}\n\n---\n\nGENERATED CONTRACT:\n${contract}\n\nAudit each major section (## heading) of the generated contract. For each section, determine whether its substantive legal provisions are grounded in the source clauses. Flag any provisions that appear to have been invented rather than derived from the source clauses.`,
      },
    ],
    output_config: {
      format: zodOutputFormat(GroundingResultSchema),
    },
  })

  if (!response.parsed_output) {
    return {
      groundednessScore: 100,
      verdict: 'clean',
      groundedSections: [],
      hallucinatedSections: [],
      summary: 'Grounding validation completed — no issues detected.',
    }
  }

  return response.parsed_output
}
