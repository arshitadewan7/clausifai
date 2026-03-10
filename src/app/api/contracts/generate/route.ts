import { NextRequest } from 'next/server'
import { parseIntent } from '@/lib/pipeline/intent-parser'
import { retrieveClauses } from '@/lib/pipeline/clause-retriever'
import { generateContract } from '@/lib/pipeline/contract-generator'
import { analyseRisk } from '@/lib/pipeline/risk-analyser'

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
  const { prompt } = await req.json()

  if (!prompt?.trim()) {
    return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(sseEvent(data)))

      try {
        // ── Stage 1: Intent Parsing ──────────────────────────────────────
        send({ type: 'stage', stage: 'parsing', message: 'Understanding your request...' })
        const intent = await parseIntent(prompt)
        send({ type: 'intent', data: intent })

        // ── Stage 2: Clause Retrieval ────────────────────────────────────
        send({ type: 'stage', stage: 'retrieval', message: 'Retrieving relevant clauses...' })
        const clauses = await retrieveClauses(intent)
        send({ type: 'clauses', count: clauses.length })

        // ── Stage 3: Contract Generation (streaming) ─────────────────────
        send({ type: 'stage', stage: 'generation', message: 'Drafting your contract...' })
        let fullContract = ''
        const contractText = await generateContract(intent, clauses, (token) => {
          fullContract += token
          send({ type: 'token', content: token })
        })

        // ── Stage 4: Risk Analysis ────────────────────────────────────────
        send({ type: 'stage', stage: 'risk', message: 'Analysing risks...' })
        const riskAnalysis = await analyseRisk(contractText || fullContract)
        send({ type: 'risk', data: riskAnalysis })

        // ── Done ──────────────────────────────────────────────────────────
        send({ type: 'complete' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred'
        send({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
