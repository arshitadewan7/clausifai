'use client'

import { useState } from 'react'
import type { ContractIntent } from '@/lib/pipeline/intent-parser'
import type { RiskAnalysis } from '@/lib/pipeline/risk-analyser'

interface SendForSignatureModalProps {
  contract: string
  intent: ContractIntent | null
  risk: RiskAnalysis | null
  onClose: () => void
}

type Expiry = '7' | '14' | '30'

export default function SendForSignatureModal({
  contract,
  intent,
  risk,
  onClose,
}: SendForSignatureModalProps) {
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [message, setMessage] = useState('')
  const [expiry, setExpiry] = useState<Expiry>('14')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [signingUrl, setSigningUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  async function send() {
    if (!recipientName.trim() || !recipientEmail.trim()) return
    setStatus('sending')

    try {
      const res = await fetch('/api/contracts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName,
          recipientEmail,
          message,
          expiryDays: parseInt(expiry),
          contractType: intent?.contractType,
          jurisdiction: intent?.jurisdiction,
          assembledDocument: contract,
          fairnessScore: risk?.fairnessScore,
          riskFlags: risk?.flaggedClauses,
          partyA: intent?.parties?.client,
          partyB: intent?.parties?.contractor,
          senderName: intent?.parties?.client?.name,
        }),
      })

      if (!res.ok) throw new Error('Send failed')
      const data = await res.json()
      setSigningUrl(data.signingUrl)
      setStatus('sent')
    } catch {
      setErrorMsg('Failed to send. Please try again.')
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-xl bg-white border border-[#0C0C0C] shadow-[8px_-8px_0_#D0000A] mb-0">
        {/* Header */}
        <div className="bg-[#0C0C0C] px-6 py-4 flex items-center justify-between">
          <span className="text-[12px] font-bold uppercase tracking-widest text-white/70">
            Send for Signature
          </span>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-[18px] font-black leading-none"
          >
            ×
          </button>
        </div>

        {status === 'sent' ? (
          <div className="px-6 py-8 text-center">
            <div className="text-[40px] mb-4">✓</div>
            <p className="text-[16px] font-black text-[#0C0C0C] mb-2">
              Sent to {recipientEmail}
            </p>
            <p className="text-[13px] text-[#656565] mb-6">Link expires in {expiry} days.</p>
            <div className="bg-[#F8F8F8] border border-[#EBEBEB] px-4 py-3 flex items-center gap-3 mb-6">
              <span className="text-[11px] text-[#656565] flex-1 truncate font-mono">
                {signingUrl}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(signingUrl)}
                className="text-[10px] font-black uppercase tracking-wider px-3 py-1.5 border border-[#0C0C0C] hover:bg-[#0C0C0C] hover:text-white transition-colors flex-shrink-0"
              >
                Copy
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-full bg-[#0C0C0C] text-white font-black text-[11px] uppercase tracking-widest py-3"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-6 space-y-5">
            {/* Recipient */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5">
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C] transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5">
                  Recipient Email
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C] transition-colors"
                />
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5">
                Message (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder="Please review and sign the attached agreement at your earliest convenience."
                className="w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C] resize-none transition-colors"
              />
            </div>

            {/* Expiry */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-2">
                Link Expiry
              </label>
              <div className="flex gap-2">
                {(['7', '14', '30'] as Expiry[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setExpiry(d)}
                    className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-wider border transition-colors ${
                      expiry === d
                        ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]'
                        : 'bg-white text-[#656565] border-[#DADADA] hover:border-[#0C0C0C]'
                    }`}
                  >
                    {d} days
                  </button>
                ))}
              </div>
            </div>

            {status === 'error' && (
              <p className="text-[12px] text-red-600 font-semibold">{errorMsg}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-3 text-[11px] font-black uppercase tracking-wider border border-[#DADADA] text-[#656565] hover:border-[#0C0C0C] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={status === 'sending' || !recipientName.trim() || !recipientEmail.trim()}
                className="flex-1 py-3 text-[11px] font-black uppercase tracking-wider bg-[#D0000A] text-white border border-[#0C0C0C] shadow-[3px_3px_0_#0C0C0C] hover:bg-[#A80008] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {status === 'sending' ? 'Sending...' : 'Send for Signature →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
