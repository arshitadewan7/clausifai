import { anthropic } from '@/lib/anthropic'
import { z } from 'zod'

const ClauseExplanationSchema = z.object({
  clause: z.string(),
  explanation: z.string(),
  breach: z.string(),
})

export type ClauseExplanation = z.infer<typeof ClauseExplanationSchema>

export async function explainPlainEnglish(contractText: string): Promise<ClauseExplanation[]> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are explaining a legal contract to someone with no legal background. For each numbered clause or major section in the contract, write 2-3 plain English sentences explaining:
1. What it means in real life
2. What happens if it is breached

Never use legal jargon. Never give legal advice. Be specific to the actual clause content, not generic. Skip purely structural elements like titles and signature blocks.

Return ONLY a valid JSON array with no surrounding text, matching this exact structure:
[{ "clause": "string (clause number or section name)", "explanation": "string", "breach": "string" }]`,
    messages: [
      {
        role: 'user',
        content: `Explain each clause in plain English:\n\n${contractText}`,
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return []

  try {
    const cleaned = textBlock.text.replace(/```json|```/g, '').trim()
    const raw = JSON.parse(cleaned)
    return z.array(ClauseExplanationSchema).parse(raw)
  } catch {
    return []
  }
}
