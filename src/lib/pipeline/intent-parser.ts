import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { anthropic } from '@/lib/anthropic'

export const ContractIntentSchema = z.object({
  contractType: z.enum(['service_agreement', 'nda', 'sla', 'employment', 'partnership', 'lease']),
  parties: z.object({
    client: z.object({
      name: z.string(),
      role: z.string(),
      location: z.string().optional(),
    }),
    contractor: z.object({
      name: z.string(),
      role: z.string(),
      location: z.string().optional(),
    }),
  }),
  jurisdiction: z.string(),
  paymentAmount: z.number().optional(),
  paymentCurrency: z.string().default('AUD'),
  paymentTerms: z.string().optional(),
  duration: z.string().optional(),
  scope: z.string(),
  specialTerms: z.array(z.string()).default([]),
  confidentiality: z.boolean().default(false),
  ipOwnership: z.preprocess((v) => {
    if (typeof v !== 'string') return v
    const s = v.toLowerCase()
    if (s.includes('contractor') || s.includes('freelancer') || s.includes('service provider')) return 'contractor'
    if (s.includes('shared') || s.includes('joint') || s.includes('mutual')) return 'shared'
    return 'client'
  }, z.enum(['client', 'contractor', 'shared'])).default('client'),
})

export type ContractIntent = z.infer<typeof ContractIntentSchema>

export async function parseIntent(prompt: string): Promise<ContractIntent> {
  const response = await anthropic.beta.messages.parse({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: `You are a legal contract intent parser. Extract structured information from the user's natural language request for a contract. Be precise about jurisdiction, payment amounts, and party names. If information is missing, use sensible defaults for an Australian business context.`,
    messages: [{ role: 'user', content: prompt }],
    output_config: {
      format: zodOutputFormat(ContractIntentSchema),
    },
  })

  if (!response.parsed_output) throw new Error('Intent parsing returned null')
  return response.parsed_output
}
