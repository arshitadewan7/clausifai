import { openai } from '@/lib/openai'
import { z } from 'zod'

export const RiskAnalysisSchema = z.object({
  fairnessScore: z.number().min(0).max(10),
  healthScore: z.number().min(0).max(10),
  overallRisk: z.enum(['low', 'medium', 'high']),
  flaggedClauses: z.array(
    z.object({
      clauseRef: z.string(),
      riskLevel: z.enum(['low', 'medium', 'high']),
      issue: z.string(),
      suggestion: z.string(),
    }),
  ),
  missingClauses: z.array(z.string()),
  summary: z.string(),
})

export type RiskAnalysis = z.infer<typeof RiskAnalysisSchema>

export async function analyseRisk(contractText: string): Promise<RiskAnalysis> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a legal risk analyst. Analyse the contract and return a JSON object matching this exact schema:
{
  "fairnessScore": number (0-10, 10 = perfectly balanced),
  "healthScore": number (0-10, 10 = fully complete and enforceable),
  "overallRisk": "low" | "medium" | "high",
  "flaggedClauses": [
    {
      "clauseRef": "clause number e.g. 3.2",
      "riskLevel": "low" | "medium" | "high",
      "issue": "plain English explanation of the risk",
      "suggestion": "specific wording or approach to fix it"
    }
  ],
  "missingClauses": ["list of important clauses that are absent"],
  "summary": "2-3 sentence plain English summary of the overall risk profile"
}

Be specific with clause references. Flag anything that heavily favours one party, has vague language around payment, IP, or liability, or is missing standard protections.`,
      },
      {
        role: 'user',
        content: `Analyse this contract:\n\n${contractText}`,
      },
    ],
  })

  const raw = JSON.parse(response.choices[0].message.content ?? '{}')
  return RiskAnalysisSchema.parse(raw)
}
