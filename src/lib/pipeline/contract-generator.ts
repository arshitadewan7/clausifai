import { anthropic } from '@/lib/anthropic'
import type { ContractIntent } from './intent-parser'
import type { RetrievedClause } from './clause-retriever'

function buildTypeRules(intent: ContractIntent): string {
  switch (intent.contractType) {
    case 'nda':
      return `This is a MUTUAL Non-Disclosure Agreement. Both parties will simultaneously disclose and receive confidential information.
- Title it "MUTUAL NON-DISCLOSURE AGREEMENT" — never "one-way" or "unilateral"
- Both parties are defined as both Disclosing Party and Receiving Party at all times
- Confidentiality obligations are identical and symmetrical for both parties
- Derived works and improvements: each party retains ownership of its own pre-existing IP; any jointly developed work is jointly owned with equal rights to use without accounting to the other
- Permitted disclosure carve-outs apply equally to both parties: (a) information already public, (b) independently developed without reference to disclosed information, (c) received from a third party without restriction, (d) required by law (with prior written notice where legally permitted)
- Neither party may use the other's confidential information for any purpose outside the stated purpose of this agreement
- Both parties have equal right to seek injunctive relief for breach — not only the disclosing party
- Do NOT include any assignment of IP, inventions, or derived works to either party`

    case 'service_agreement':
    case 'sla':
      return `This is a bilateral service agreement. Both parties have equal standing.
- Payment obligations on the client are matched by delivery obligations on the service provider
- Service levels and remedies for breach apply proportionately to both parties
- Warranties are given by both parties (service provider warrants quality; client warrants authority to engage)`

    case 'employment':
      return `This is an employment contract. Apply ${intent.jurisdiction} employment law standards.
- Include statutory minimum entitlements — do not draft below the legal minimum
- Restraint of trade clauses must be reasonable in scope, geography, and duration to be enforceable
- Termination provisions must comply with statutory notice and unfair dismissal protections`

    case 'partnership':
      return `This is a partnership agreement. All partners have equal rights unless explicitly varied.
- Profit and loss sharing must be clearly stated
- Decision-making authority and voting thresholds must be defined
- Exit and buy-out mechanisms must be fair and symmetric for all partners`

    default:
      return `Apply balanced, mutual obligations appropriate for a ${intent.contractType.replace('_', ' ')} agreement.`
  }
}

function buildSystemPrompt(intent: ContractIntent, clauses: RetrievedClause[]): string {
  const clauseContext =
    clauses.length > 0
      ? `\n\nPREFERRED SOURCE CLAUSES — when drafting each section, prefer to use the language from these verified clauses. Adapt them to the specific parties and details. You may draw on your legal knowledge to complete sections where no matching clause is listed, but always keep the provided clauses as your primary reference:\n${clauses
          .map((c, i) => `[SOURCE-${i + 1}] (${c.clause_type.toUpperCase()})\n${c.content}`)
          .join('\n\n')}`
      : ''

  return `You are an expert legal contract drafter. Generate a professional, complete, and immediately executable ${intent.contractType.replace('_', ' ')} under ${intent.jurisdiction} law.

BALANCE MANDATE — this is your most important instruction:
Every obligation, right, and restriction must be genuinely mutual and proportionate. A contract is only enforceable and fair when both parties carry equivalent duties:
- Payment: client pays invoices within the agreed period; overdue amounts accrue interest at the ${intent.jurisdiction} statutory rate; both parties acknowledge their financial obligations in writing
- Termination: either party may terminate with 30 days written notice; on termination the client pays for all work completed to the termination date and the service provider delivers all completed work product
- IP: ownership transfers to the client upon receipt of full payment for the relevant deliverable; until then the service provider retains ownership and grants a limited licence for the client's use
- Liability: each party's total liability is capped at the total fees paid or payable under this agreement; neither party is liable to the other for indirect, consequential, or special loss
- Confidentiality: both parties keep each other's confidential information strictly confidential for 3 years; standard carve-outs apply (publicly available information, independent development, legally compelled disclosure)
- Scope changes: any change to the agreed scope requires a written change order signed by both parties before work begins
- Dispute resolution: parties first attempt good faith negotiation (14 days), then mediation (30 days), then litigation in ${intent.jurisdiction}
- General: include entire agreement, severability, no-waiver, and governing law clauses

CONTRACT-TYPE SPECIFIC RULES:
${buildTypeRules(intent)}

DRAFTING STANDARDS:
- Be precise and specific — use the actual party names, amounts, dates, and scope provided
- Never use placeholder text like "[insert date]" or "[TBD]" — derive all missing details from context or use a reasonable ${intent.jurisdiction} standard
- Every clause must be complete and immediately usable with no blanks
- Write in plain, unambiguous English — no unnecessary legalese
- Do not invent facts not provided, but always fill gaps with the most protective reasonable default

FORMAT RULES:
- Use # for the contract title (e.g. # FREELANCE SERVICE AGREEMENT)
- Use ## for major sections (e.g. ## 1. DEFINITIONS, ## 2. SERVICES)
- Use ### for sub-sections where needed
- Number all clauses inline within paragraphs (1.1, 1.2, 2.1, etc.)
- Use **bold** for defined terms, party names, and key obligations
- Never use blockquotes, code blocks, or bullet points in the contract body
- Include a signature block at the end as a Markdown table
- Always include sections appropriate to this contract type; for an NDA that means: Definitions, Confidential Information, Obligations of Confidentiality, Permitted Disclosures, IP Ownership, Term and Termination, Remedies, General Provisions; for a service agreement: Definitions, Services/Scope, Payment Terms, Intellectual Property, Confidentiality, Liability, Termination, Dispute Resolution, General Provisions
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
