import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/anthropic'

export async function POST(req: NextRequest) {
  try {
    const { contract, clauseRef, suggestion } = await req.json()

    if (!contract || !clauseRef || !suggestion) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: `You are a legal contract editor. You will receive a full contract in markdown format, a clause reference number, and a suggested edit. Your job is to apply the suggested edit to that specific clause only.

Rules:
- Only modify the clause identified by the clause reference
- Preserve all markdown formatting exactly
- Do not change any other part of the contract
- Do not add commentary or explanation — return only the updated contract markdown
- Keep the clause heading exactly as-is unless the suggestion explicitly requires changing it`,
      messages: [{
        role: 'user',
        content: `Contract:\n\n${contract}\n\n---\n\nClause to edit: ${clauseRef}\n\nSuggested change: ${suggestion}\n\nReturn the complete updated contract with only clause ${clauseRef} modified.`,
      }],
    })

    const fixedContract = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    return NextResponse.json({ fixedContract })
  } catch (error) {
    console.error('Quickfix error:', error)
    return NextResponse.json({ error: 'Failed to apply fix' }, { status: 500 })
  }
}
