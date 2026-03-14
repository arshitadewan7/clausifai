'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ContractIntent } from '@/lib/pipeline/intent-parser'
import type { RiskAnalysis } from '@/lib/pipeline/risk-analyser'
import type { GroundingResult } from '@/lib/pipeline/clause-grounding-validator'
import type { ClauseExplanation } from '@/lib/pipeline/plain-english'
import SmartContractForm, { type ProfileData } from '@/components/contract/SmartContractForm'
import { supabase } from '@/lib/supabase'
import SendForSignatureModal from '@/components/contract/SendForSignatureModal'

type Stage =
  | 'idle'
  | 'parsing'
  | 'retrieval'
  | 'generation'
  | 'grounding'
  | 'risk'
  | 'plain_english'
  | 'complete'
  | 'error'

const STAGE_LABELS: Record<string, string> = {
  parsing: 'Understanding your request',
  retrieval: 'Retrieving relevant clauses',
  generation: 'Drafting your contract',
  grounding: 'Verifying clause grounding',
  risk: 'Analysing risks',
  plain_english: 'Writing plain English summaries',
}


type ProfileShape = ProfileData | null

export default function ContractBuilder() {
  const [stage, setStage] = useState<Stage>('idle')
  const [stageMessage, setStageMessage] = useState('')
  const [intent, setIntent] = useState<ContractIntent | null>(null)
  const [contract, setContract] = useState('')
  const [clauseCount, setClauseCount] = useState(0)
  const [grounding, setGrounding] = useState<GroundingResult | null>(null)
  const [risk, setRisk] = useState<RiskAnalysis | null>(null)
  const [plainEnglish, setPlainEnglish] = useState<ClauseExplanation[]>([])
  const [error, setError] = useState('')
  const [highlightedClause, setHighlightedClause] = useState<string | null>(null)
  const [showSignModal, setShowSignModal] = useState(false)
  const [profile, setProfile] = useState<ProfileShape>(null)
  const [activeTab, setActiveTab] = useState<'analysis' | 'plain_english' | 'details'>('analysis')
  const contractRef = useRef<HTMLDivElement>(null)

  // Load profile — authenticated users from Supabase, fallback to localStorage
  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data } = await supabase
            .from('profiles')
            .select('full_name,business_name,entity_type,country,abn,acn,gstin,pan,street_address,city,postcode,address,jurisdiction,email,phone,signatory_name,signatory_title')
            .eq('id', user.id)
            .single()
          if (data) {
            // Merge auth email in case it's not stored in profile yet
            setProfile({ ...data, email: data.email || user.email })
            return
          }
        }
        // Fallback to localStorage for unauthenticated / demo users
        const raw = localStorage.getItem('clausifai_profile')
        if (raw) setProfile(JSON.parse(raw))
      } catch {
        try {
          const raw = localStorage.getItem('clausifai_profile')
          if (raw) setProfile(JSON.parse(raw))
        } catch { /* ignore */ }
      }
    }
    loadProfile()
  }, [])

  function scrollToClause(clauseRef: string) {
    const needle = clauseRef.replace(/^(clause|section)\s*/i, '').trim().toLowerCase()
    if (!needle) return
    setHighlightedClause(needle)
    if (!contractRef.current) return
    const container = contractRef.current

    // Search h2 and h3 — risk flags often reference sub-clauses (e.g. "3.2") that are h3
    const headings = container.querySelectorAll<HTMLElement>('h2, h3')
    let target: HTMLElement | null = null

    // 1. Exact includes match
    for (const el of headings) {
      if ((el.textContent || '').toLowerCase().includes(needle)) {
        target = el
        break
      }
    }

    // 2. Fallback: match top-level number only (e.g. "3" from "3.2")
    if (!target) {
      const topLevel = needle.split('.')[0]
      for (const el of headings) {
        const t = (el.textContent || '').toLowerCase()
        if (t.startsWith(topLevel + '.') || t.startsWith(topLevel + ' ')) {
          target = el
          break
        }
      }
    }

    if (target) {
      const containerRect = container.getBoundingClientRect()
      const elRect = target.getBoundingClientRect()
      const scrollTarget = container.scrollTop + (elRect.top - containerRect.top) - 80
      container.scrollTo({ top: scrollTarget, behavior: 'smooth' })
    }
  }

  async function generate(overridePrompt: string) {
    if (!overridePrompt.trim()) return
    setStage('parsing')
    setStageMessage('Understanding your request...')
    setIntent(null)
    setContract('')
    setGrounding(null)
    setRisk(null)
    setPlainEnglish([])
    setError('')

    const res = await fetch('/api/contracts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: overridePrompt }),
    })

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))

          if (event.type === 'stage') {
            setStage(event.stage)
            setStageMessage(event.message)
          } else if (event.type === 'intent') {
            setIntent(event.data)
          } else if (event.type === 'clauses') {
            setClauseCount(event.count)
          } else if (event.type === 'token') {
            setContract((prev) => {
              const updated = prev + event.content
              requestAnimationFrame(() =>
                contractRef.current?.scrollTo({
                  top: contractRef.current.scrollHeight,
                  behavior: 'smooth',
                }),
              )
              return updated
            })
          } else if (event.type === 'grounding') {
            setGrounding(event.data)
          } else if (event.type === 'risk') {
            setRisk(event.data)
          } else if (event.type === 'plain_english') {
            setPlainEnglish(event.data)
          } else if (event.type === 'complete') {
            setStage('complete')
          } else if (event.type === 'error') {
            setError(event.message)
            setStage('error')
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  }

  const isRunning = stage !== 'idle' && stage !== 'complete' && stage !== 'error'
  const stages = ['parsing', 'retrieval', 'generation', 'grounding', 'risk', 'plain_english'] as const
  const currentStageIndex = stages.indexOf(stage as typeof stages[number])

  return (
    <div className="min-h-screen bg-[#F8F8F8] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-[#0C0C0C] px-8 py-4 flex items-center justify-between">
        <span className="text-xl font-black tracking-tight">
          clausifai<span className="text-[#D0000A]">.</span>
        </span>
        <span className="text-xs font-bold uppercase tracking-widest text-[#656565]">Contract Generator</span>
      </header>

      <div className="max-w-7xl mx-auto px-8 py-10 grid grid-cols-1 xl:grid-cols-[480px_1fr] gap-8">
        {/* Left panel */}
        <div className="flex flex-col gap-6">
          {/* Smart form */}
          <SmartContractForm
            onSubmit={generate}
            disabled={isRunning}
            initialProfile={profile}
          />

          {/* Pipeline — only while running */}
          {isRunning && (
            <div className="bg-white border border-[#0C0C0C]">
              <div className="px-5 py-3 border-b border-[#0C0C0C]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#656565]">Pipeline</span>
              </div>
              <div className="divide-y divide-[#EBEBEB]">
                {stages.map((s, i) => {
                  const done = currentStageIndex > i
                  const active = s === stage
                  return (
                    <div key={s} className={`px-5 py-3 flex items-center gap-3 ${active ? 'bg-[#FFF5F5]' : ''}`}>
                      <div
                        className={`w-5 h-5 flex items-center justify-center text-[10px] font-black border flex-shrink-0 ${
                          done
                            ? 'bg-[#0C0C0C] border-[#0C0C0C] text-white'
                            : active
                            ? 'bg-[#D0000A] border-[#D0000A] text-white'
                            : 'border-[#DADADA] text-[#ADADAD]'
                        }`}
                      >
                        {done ? '✓' : i + 1}
                      </div>
                      <div>
                        <div
                          className={`text-[13px] font-bold ${
                            active ? 'text-[#D0000A]' : done ? 'text-[#0C0C0C]' : 'text-[#ADADAD]'
                          }`}
                        >
                          {STAGE_LABELS[s]}
                        </div>
                        {active && stageMessage && (
                          <div className="text-[11px] text-[#656565] mt-0.5">{stageMessage}</div>
                        )}
                        {s === 'retrieval' && done && clauseCount > 0 && (
                          <div className="text-[11px] text-[#656565] mt-0.5">
                            {clauseCount} clauses retrieved
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Analysis tabs — shown after generation completes */}
          {stage === 'complete' && (risk || plainEnglish.length > 0 || intent) && (
            <div className="bg-white border border-[#0C0C0C]">
              {/* Tab bar */}
              <div className="flex border-b border-[#0C0C0C]">
                {(
                  [
                    ['analysis', 'Analysis'],
                    ['plain_english', 'Plain English'],
                    ['details', 'Details'],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-colors border-r last:border-r-0 border-[#0C0C0C] ${
                      activeTab === tab
                        ? 'bg-[#0C0C0C] text-white'
                        : 'bg-white text-[#656565] hover:bg-[#F8F8F8]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Analysis tab ── */}
              {activeTab === 'analysis' && risk && (
                <div>
                  {/* Fairness Score */}
                  <div className="px-5 py-5 border-b border-[#EBEBEB]">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#656565] mb-4">
                      Fairness Score
                    </div>
                    <div className="flex items-end gap-2 mb-3">
                      <span
                        className="text-[52px] font-black leading-none"
                        style={{
                          color:
                            risk.fairnessScore <= 3
                              ? '#D0000A'
                              : risk.fairnessScore <= 6
                              ? '#d97706'
                              : '#16a34a',
                        }}
                      >
                        {risk.fairnessScore.toFixed(1)}
                      </span>
                      <span className="text-[18px] font-bold text-[#ADADAD] mb-1.5">/10</span>
                    </div>
                    <div className="h-2 bg-[#EBEBEB] mb-2">
                      <div
                        className="h-full transition-all duration-700"
                        style={{
                          width: `${risk.fairnessScore * 10}%`,
                          backgroundColor:
                            risk.fairnessScore <= 3
                              ? '#D0000A'
                              : risk.fairnessScore <= 6
                              ? '#d97706'
                              : '#16a34a',
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className="text-[10px] font-black uppercase tracking-widest"
                        style={{
                          color:
                            risk.fairnessScore <= 3
                              ? '#D0000A'
                              : risk.fairnessScore <= 6
                              ? '#d97706'
                              : '#16a34a',
                        }}
                      >
                        {risk.fairnessScore <= 3
                          ? 'Favours other party'
                          : risk.fairnessScore <= 5
                          ? 'Slightly unbalanced'
                          : risk.fairnessScore <= 7
                          ? 'Balanced'
                          : 'Favours you'}
                      </span>
                      <span
                        className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 ${
                          risk.overallRisk === 'high'
                            ? 'bg-red-100 text-red-700 border border-red-200'
                            : risk.overallRisk === 'medium'
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : 'bg-green-100 text-green-700 border border-green-200'
                        }`}
                      >
                        {risk.overallRisk} risk
                      </span>
                    </div>
                    <p className="text-[12px] text-[#656565] leading-relaxed">{risk.summary}</p>
                  </div>

                  {/* Risk Flags */}
                  {risk.flaggedClauses.length > 0 && (
                    <div className="border-b border-[#EBEBEB]">
                      <div className="px-5 py-2.5 bg-[#F8F8F8]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#656565]">
                          Risk Flags
                        </span>
                      </div>
                      <div className="divide-y divide-[#EBEBEB]">
                        {risk.flaggedClauses.map((fc, i) => (
                          <div
                            key={i}
                            className={`border-l-4 ${
                              fc.riskLevel === 'high'
                                ? 'border-l-red-500'
                                : fc.riskLevel === 'medium'
                                ? 'border-l-amber-400'
                                : 'border-l-green-500'
                            }`}
                          >
                            {/* Clickable header — scrolls to clause */}
                            <button
                              onClick={() => scrollToClause(fc.clauseRef)}
                              className="w-full px-5 py-3 flex items-start gap-3 text-left hover:bg-[#F8F8F8] transition-colors group"
                            >
                              <span className="flex-shrink-0 text-[14px] mt-0.5">
                                {fc.riskLevel === 'high' ? '🔴' : fc.riskLevel === 'medium' ? '🟡' : '🟢'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span
                                    className={`text-[9px] font-black uppercase tracking-wider ${
                                      fc.riskLevel === 'high'
                                        ? 'text-red-600'
                                        : fc.riskLevel === 'medium'
                                        ? 'text-amber-600'
                                        : 'text-green-600'
                                    }`}
                                  >
                                    {fc.riskLevel}
                                  </span>
                                  <span className="text-[11px] font-black text-[#0C0C0C]">
                                    Clause {fc.clauseRef}
                                  </span>
                                </div>
                                <p className="text-[12px] text-[#656565] leading-relaxed">{fc.issue}</p>
                              </div>
                              <span className="text-[10px] font-black text-[#ADADAD] group-hover:text-[#D0000A] flex-shrink-0 mt-0.5 transition-colors">
                                View →
                              </span>
                            </button>

                            {/* Edit suggestion */}
                            <div className="mx-5 mb-3 bg-[#F8F8F8] border border-[#EBEBEB] px-4 py-3">
                              <span className="text-[9px] font-black uppercase tracking-widest text-[#656565] block mb-1.5">
                                Suggested edit
                              </span>
                              <p className="text-[12px] text-[#0C0C0C] leading-relaxed font-medium">
                                {fc.suggestion}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Missing Clauses */}
                  {risk.missingClauses.length > 0 && (
                    <div className="px-5 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-[#656565] mb-2.5">
                        Missing Clauses
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {risk.missingClauses.map((m) => (
                          <span
                            key={m}
                            className="text-[10px] font-semibold px-2.5 py-1 border border-[#DADADA] text-[#656565] bg-[#F8F8F8]"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Health score */}
                  <div className="px-5 py-4 border-t border-[#EBEBEB] bg-[#F8F8F8]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#656565]">
                        Contract Health
                      </span>
                      <span className="text-[13px] font-black text-[#0C0C0C]">
                        {risk.healthScore}
                        <span className="text-[10px] text-[#ADADAD] font-semibold">/10</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#EBEBEB]">
                      <div
                        className="h-full bg-[#0C0C0C]"
                        style={{ width: `${risk.healthScore * 10}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Plain English tab ── */}
              {activeTab === 'plain_english' && (
                <div>
                  {plainEnglish.length === 0 ? (
                    <div className="px-5 py-8 text-center text-[13px] text-[#ADADAD]">
                      No explanations available.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#EBEBEB]">
                      {plainEnglish.map((item, i) => (
                        <PlainEnglishItem
                          key={i}
                          item={item}
                          onHover={setHighlightedClause}
                          defaultOpen={i === 0}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Details tab ── */}
              {activeTab === 'details' && (
                <div>
                  {/* Parsed Intent */}
                  {intent && (
                    <div className="border-b border-[#EBEBEB]">
                      <div className="px-5 py-2.5 bg-[#F8F8F8]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#656565]">
                          Parsed Intent
                        </span>
                      </div>
                      <div className="divide-y divide-[#EBEBEB]">
                        {(
                          [
                            ['Type', intent.contractType.replace('_', ' ')],
                            ['Client', intent.parties.client.name],
                            ['Contractor', intent.parties.contractor.name],
                            ['Jurisdiction', intent.jurisdiction],
                            intent.paymentAmount
                              ? ['Payment', `${intent.paymentCurrency} ${intent.paymentAmount.toLocaleString()}`]
                              : null,
                            intent.paymentTerms ? ['Terms', intent.paymentTerms] : null,
                            intent.duration ? ['Duration', intent.duration] : null,
                            ['IP', intent.ipOwnership],
                          ] as ([string, string] | null)[]
                        )
                          .filter((x): x is [string, string] => x !== null)
                          .map(([label, value]) => (
                            <div key={label} className="px-5 py-2.5 grid grid-cols-[90px_1fr] gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[#ADADAD]">
                                {label}
                              </span>
                              <span className="text-[12px] font-semibold text-[#0C0C0C] capitalize">
                                {value}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Clause Grounding */}
                  {grounding && (
                    <div>
                      <div className="px-5 py-2.5 bg-[#F8F8F8] border-b border-[#EBEBEB] flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#656565]">
                          Clause Grounding
                        </span>
                        <span
                          className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 ${
                            grounding.verdict === 'clean'
                              ? 'bg-green-100 text-green-700 border border-green-200'
                              : grounding.verdict === 'minor_issues'
                              ? 'bg-amber-100 text-amber-700 border border-amber-200'
                              : 'bg-red-100 text-red-700 border border-red-200'
                          }`}
                        >
                          {grounding.verdict === 'clean'
                            ? 'Fully Grounded'
                            : grounding.verdict === 'minor_issues'
                            ? 'Minor Issues'
                            : 'Major Issues'}
                        </span>
                      </div>
                      <div className="px-5 py-4 border-b border-[#EBEBEB]">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex-1 h-1.5 bg-[#EBEBEB]">
                            <div
                              className={`h-full ${
                                grounding.groundednessScore >= 90
                                  ? 'bg-green-500'
                                  : grounding.groundednessScore >= 70
                                  ? 'bg-amber-400'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${grounding.groundednessScore}%` }}
                            />
                          </div>
                          <span className="text-[13px] font-black flex-shrink-0">
                            {grounding.groundednessScore}
                            <span className="text-[10px] text-[#656565] font-semibold">%</span>
                          </span>
                        </div>
                        <p className="text-[12px] text-[#656565] leading-relaxed">{grounding.summary}</p>
                      </div>
                      {grounding.hallucinatedSections.length > 0 ? (
                        <div className="divide-y divide-[#EBEBEB]">
                          {grounding.hallucinatedSections.map((h, i) => (
                            <div key={i} className="px-5 py-3 border-l-4 border-l-red-500">
                              <div className="text-[11px] font-black text-[#0C0C0C] mb-1">{h.section}</div>
                              <p className="text-[11px] text-[#656565] leading-relaxed mb-1">{h.reason}</p>
                              {h.content && (
                                <p className="text-[10px] text-[#ADADAD] font-mono truncate">{h.content}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-5 py-3 bg-green-50 flex items-center gap-2">
                          <span className="text-green-600 text-[11px] font-bold">✓</span>
                          <span className="text-[11px] text-green-700 font-semibold">
                            All provisions verified against legal database
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="border border-red-300 bg-red-50 px-5 py-4 text-[13px] text-red-700 font-semibold">
              {error}
            </div>
          )}
        </div>

        {/* Right panel — contract output */}
        <div
          className={`bg-white border border-[#0C0C0C] shadow-[8px_8px_0_#D0000A] flex flex-col h-[calc(100vh-120px)] sticky top-6 transition-all ${
            highlightedClause ? 'ring-2 ring-amber-300' : ''
          }`}
        >
          <div className="bg-[#D0000A] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <span className="text-[12px] font-bold uppercase tracking-widest text-white/80">
              {contract ? intent?.contractType.replace('_', ' ') ?? 'Contract' : 'Contract Preview'}
            </span>
            {contract && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 bg-white/20 text-white/70">
                  AI Generated
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(markdownToPlainText(contract))}
                  className="text-[10px] font-black uppercase tracking-wider px-3 py-1 border border-white/40 text-white hover:bg-white/10 transition-colors"
                >
                  Copy
                </button>
                <button
                  onClick={() => downloadPDF(contract, intent?.contractType.replace('_', ' ') ?? 'contract')}
                  className="text-[10px] font-black uppercase tracking-wider px-3 py-1 border border-white/40 text-white hover:bg-white/10 transition-colors"
                >
                  Download PDF
                </button>
                <button
                  onClick={() => setShowSignModal(true)}
                  disabled={stage !== 'complete'}
                  className="text-[11px] font-black uppercase tracking-wider px-4 py-2 bg-white text-[#D0000A] border-2 border-white hover:bg-white/90 transition-colors shadow-[3px_3px_0_#0C0C0C] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  Send for Signature →
                </button>
              </div>
            )}
          </div>

          <div ref={contractRef} className="flex-1 overflow-y-auto">
            {!contract && stage === 'idle' && (
              <div className="h-full flex items-center justify-center text-center p-8">
                <div>
                  <div className="text-6xl font-black text-[#0C0C0C]/5 mb-4">clausifai.</div>
                  <p className="text-[14px] text-[#ADADAD] font-medium">
                    Fill in the form on the left to get started.
                  </p>
                </div>
              </div>
            )}

            {(contract || isRunning) && (
              <div className="px-16 py-12 max-w-[860px] mx-auto">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-[22px] font-black text-[#0C0C0C] text-center tracking-tight mb-1 mt-0 uppercase">
                        {children}
                      </h1>
                    ),
                    h2: ({ node, children, ...props }) => {
                      // node is the mdast node — reliably extract plain text from it
                      const text = (node?.children ?? [])
                        .map((c: any) => c.value ?? '')
                        .join('')
                      const isHighlighted =
                        highlightedClause &&
                        text.toLowerCase().includes(highlightedClause.toLowerCase())
                      return (
                        <h2
                          {...props}
                          data-clause={text}
                          className={`text-[13px] font-black text-[#0C0C0C] uppercase tracking-widest mt-10 mb-3 pb-2 border-b transition-colors ${
                            isHighlighted
                              ? 'border-b-amber-400 bg-amber-50 px-2 -mx-2'
                              : 'border-[#DADADA]'
                          }`}
                        >
                          {children}
                        </h2>
                      )
                    },
                    h3: ({ children }) => (
                      <h3 className="text-[14px] font-black text-[#0C0C0C] mt-6 mb-2">
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => (
                      <p className="text-[14px] text-[#1C1C1C] leading-[1.85] mb-4 font-normal">
                        {children}
                      </p>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-black text-[#0C0C0C]">{children}</strong>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-none mb-4 space-y-2">{children}</ol>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-none mb-4 space-y-2">{children}</ul>
                    ),
                    li: ({ children }) => (
                      <li className="text-[14px] text-[#1C1C1C] leading-[1.85] pl-4 border-l-2 border-[#EBEBEB]">
                        {children}
                      </li>
                    ),
                    hr: () => <hr className="border-[#DADADA] my-8" />,
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-[#D0000A] bg-[#FFF5F5] pl-4 py-2 my-4 text-[13px] text-[#656565] italic">
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <table className="w-full border-collapse text-[13px] mb-6">{children}</table>
                    ),
                    th: ({ children }) => (
                      <th className="text-left font-black text-[10px] uppercase tracking-wider text-[#656565] border-b border-[#DADADA] pb-2 pr-4">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="text-[#1C1C1C] border-b border-[#F0F0F0] py-2 pr-4">
                        {children}
                      </td>
                    ),
                  }}
                >
                  {contract}
                </ReactMarkdown>
                {stage === 'generation' && (
                  <span className="inline-block w-2 h-5 bg-[#D0000A] ml-0.5 animate-pulse align-middle" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Send for Signature modal */}
      {showSignModal && (
        <SendForSignatureModal
          contract={contract}
          intent={intent}
          risk={risk}
          onClose={() => setShowSignModal(false)}
        />
      )}
    </div>
  )
}

// ── Strip markdown to plain text for clipboard copy ──────────────────────────
function markdownToPlainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')          // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')       // bold
    .replace(/\*(.+?)\*/g, '$1')           // italic
    .replace(/^>\s+/gm, '')               // blockquotes
    .replace(/^[-*_]{3,}\s*$/gm, '---')   // horizontal rules
    .replace(/\|.+\|/g, (row) =>          // table rows → space-separated
      row.split('|').map((c) => c.trim()).filter(Boolean).join('   '))
    .replace(/^[-| :]+$/gm, '')           // table separator rows
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')   // links → label only
    .replace(/`(.+?)`/g, '$1')            // inline code
    .replace(/\n{3,}/g, '\n\n')           // collapse excess blank lines
    .trim()
}

// ── Convert markdown to print-ready HTML and open print dialog ───────────────
function downloadPDF(md: string, filename: string) {
  // Convert markdown to HTML
  let html = md
    // Headings
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    // Bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Blockquotes — strip the marker, treat as normal paragraph text in the PDF
    .replace(/^> (.+)$/gm, '$1')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '<hr>')
    // Tables — wrap in <table>
    .replace(/(\|.+\|\n)+/g, (block) => {
      const rows = block.trim().split('\n').filter((r) => !/^[\s|:-]+$/.test(r))
      const [head, ...body] = rows
      const th = (head ?? '').split('|').filter(Boolean).map((c) => `<th>${c.trim()}</th>`).join('')
      const trs = body.map((r) =>
        '<tr>' + r.split('|').filter(Boolean).map((c) => `<td>${c.trim()}</td>`).join('') + '</tr>'
      ).join('')
      return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
    })
    // Paragraphs — wrap non-tag lines
    .split('\n\n')
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      if (/^<(h[1-6]|blockquote|hr|table|ul|ol)/.test(trimmed)) return trimmed
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .join('\n')

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${filename}</title>
  <style>
    @page { margin: 25mm 20mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 11pt;
      line-height: 1.7;
      color: #000;
      max-width: 170mm;
      margin: 0 auto;
    }
    h1 {
      font-size: 14pt;
      font-weight: 700;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 24pt;
      padding-bottom: 8pt;
      border-bottom: 2px solid #000;
    }
    h2 {
      font-size: 10pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 20pt 0 6pt;
      padding-bottom: 3pt;
      border-bottom: 1px solid #ccc;
    }
    h3 {
      font-size: 11pt;
      font-weight: 700;
      margin: 12pt 0 4pt;
    }
    p { margin: 0 0 8pt; }
    strong { font-weight: 700; }
    hr { border: none; border-top: 1px solid #ccc; margin: 16pt 0; }
    table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 10pt; }
    th { font-weight: 700; text-align: left; border-bottom: 1.5px solid #000; padding: 4pt 6pt; }
    td { border-bottom: 1px solid #ddd; padding: 4pt 6pt; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>${html}</body>
</html>`)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print() }, 250)
}

// ── Inline Plain English accordion item (used inside the tab panel) ──────────
function PlainEnglishItem({
  item,
  onHover,
  defaultOpen = false,
}: {
  item: ClauseExplanation
  onHover: (clause: string | null) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      onMouseEnter={() => onHover(item.clause)}
      onMouseLeave={() => onHover(null)}
      className={open ? 'bg-white' : ''}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-[#F8F8F8] transition-colors"
      >
        <span className="text-[12px] font-black text-[#0C0C0C] uppercase tracking-wide pr-4">
          {item.clause}
        </span>
        <span className="text-[10px] flex-shrink-0 text-[#ADADAD]">
          {open ? '▼' : '▶'}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5">
          {/* Explanation */}
          <div className="border-l-2 border-[#0C0C0C] pl-4 mb-4">
            <p className="text-[13px] text-[#1C1C1C] leading-relaxed">
              &ldquo;{item.explanation}&rdquo;
            </p>
          </div>

          {/* If breached */}
          <div className="bg-amber-50 border border-amber-200 px-4 py-3 flex gap-3">
            <span className="text-[16px] flex-shrink-0 mt-0.5">⚠</span>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block mb-1">
                If breached
              </span>
              <p className="text-[12px] text-amber-900 leading-relaxed">{item.breach}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
