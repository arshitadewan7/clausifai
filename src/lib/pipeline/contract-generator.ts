import { anthropic } from '@/lib/anthropic'
import type { ContractIntent } from './intent-parser'
import type { RetrievedClause } from './clause-retriever'

function buildSystemPrompt(intent: ContractIntent, clauses: RetrievedClause[]): string {
  const clauseContext =
    clauses.length > 0
      ? `\n\nSOURCE CLAUSES — all legal provisions MUST be derived from the following:\n${clauses
          .map((c, i) => `[SOURCE-${i + 1}] (${c.clause_type.toUpperCase()})\n${c.content}`)
          .join('\n\n')}`
      : '\n\n[WARNING: No source clauses were retrieved. You MUST still follow the grounding rules below — do not invent legal provisions.]'

  return `You are a legal contract drafter. Assemble a professional ${intent.contractType.replace('_', ' ')} under ${intent.jurisdiction} law.

GROUNDING RULES — MANDATORY, NO EXCEPTIONS:
1. ALL substantive legal provisions (obligations, rights, liabilities, IP ownership, payment terms, termination conditions, dispute resolution, warranties, indemnities, confidentiality) MUST come verbatim or near-verbatim from the SOURCE CLAUSES listed below. You may only substitute variable details within clause text: party names, dates, monetary amounts, locations, jurisdiction references, and scope-of-work descriptions.
2. You MAY write the following structural elements without a source clause: contract title, section headings, party identification block, recitals ("NOW THEREFORE IN CONSIDERATION OF..."), and the signature block. These are structural, not substantive.
3. You MUST NOT invent, paraphrase, or extend any legal clause, obligation, right, defined term, or standard of liability beyond what is stated in the SOURCE CLAUSES.
4. If a required section has NO matching source clause, write exactly this placeholder — do NOT fabricate content: [PROVISION UNAVAILABLE — no verified source clause for this section]
5. Do NOT cite statutes, acts, regulations, or case law unless they appear verbatim in a SOURCE CLAUSE.

FORMAT RULES:
- Use # for the contract title (e.g. # FREELANCE SERVICE AGREEMENT)
- Use ## for major sections (e.g. ## 1. DEFINITIONS, ## 2. SERVICES)
- Use ### for sub-sections where needed
- Number all clauses inline within paragraphs (1.1, 1.2, 2.1, etc.)
- Use **bold** for defined terms, party names, and key obligations
- Use > blockquote for any clause that carries notable risk to one party
- Never use code blocks, bullet points for clauses, or tables for contract body
- Include a signature block at the end as a Markdown table
${clauseContext}`
}

function buildUserMessage(intent: ContractIntent): string {
  return `Draft a ${intent.contractType.replace('_', ' ')} with the following details:

Parties:
- Client: ${intent.parties.client.name} (${intent.parties.client.role})${intent.parties.client.location ? `, ${intent.parties.client.location}` : ''}
- Contractor: ${intent.parties.contractor.name} (${intent.parties.contractor.role})${intent.parties.contractor.location ? `, ${intent.parties.contractor.location}` : ''}

Scope: ${intent.scope}
Jurisdiction: ${intent.jurisdiction}
${intent.paymentAmount ? `Payment: ${intent.paymentCurrency} ${intent.paymentAmount.toLocaleString()}` : ''}
${intent.paymentTerms ? `Payment Terms: ${intent.paymentTerms}` : ''}
${intent.duration ? `Duration: ${intent.duration}` : ''}
IP Ownership: ${intent.ipOwnership}
Confidentiality: ${intent.confidentiality ? 'Required' : 'Not required'}
${intent.specialTerms.length ? `Special Terms:\n${intent.specialTerms.map((t) => `- ${t}`).join('\n')}` : ''}

Generate the complete contract now.`
}

export async function generateContract(
  intent: ContractIntent,
  clauses: RetrievedClause[],
  onToken: (token: string) => void,
): Promise<string> {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: buildSystemPrompt(intent, clauses),
    messages: [{ role: 'user', content: buildUserMessage(intent) }],
  })

  stream.on('text', onToken)

  const final = await stream.finalMessage()
  const textBlock = final.content.find((b) => b.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text : ''
}
