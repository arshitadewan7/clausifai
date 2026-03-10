import { openai } from '@/lib/openai'
import { supabase } from '@/lib/supabase'
import type { ContractIntent } from './intent-parser'

export interface RetrievedClause {
  id: string
  clause_type: string
  content: string
  similarity: number
}

async function embedQuery(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

export async function retrieveClauses(intent: ContractIntent): Promise<RetrievedClause[]> {
  const query = [
    intent.contractType.replace('_', ' '),
    intent.scope,
    intent.jurisdiction,
    intent.paymentTerms ?? '',
    intent.specialTerms.join(', '),
  ]
    .filter(Boolean)
    .join('. ')

  const embedding = await embedQuery(query)

  const { data, error } = await supabase.rpc('match_clauses', {
    query_embedding: embedding,
    contract_type_filter: intent.contractType,
    match_threshold: 0.5,
    match_count: 12,
  })

  if (error) {
    console.error('Clause retrieval error:', error)
    return []
  }

  return (data as RetrievedClause[]) ?? []
}
