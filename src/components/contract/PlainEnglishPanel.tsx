'use client'

import { useState } from 'react'
import type { ClauseExplanation } from '@/lib/pipeline/plain-english'

interface PlainEnglishPanelProps {
  explanations: ClauseExplanation[]
  onClauseHover: (clause: string | null) => void
}

export default function PlainEnglishPanel({ explanations, onClauseHover }: PlainEnglishPanelProps) {
  const [open, setOpen] = useState<number | null>(null)

  if (explanations.length === 0) return null

  return (
    <div className="bg-white border border-[#0C0C0C]">
      <div className="bg-[#0C0C0C] px-5 py-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
          Plain English — clausifai<span className="text-[#D0000A]">.</span>
        </span>
      </div>

      <div className="divide-y divide-[#EBEBEB]">
        {explanations.map((item, i) => (
          <div
            key={i}
            onMouseEnter={() => onClauseHover(item.clause)}
            onMouseLeave={() => onClauseHover(null)}
          >
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-[#F8F8F8] transition-colors"
            >
              <span className="text-[13px] font-bold text-[#0C0C0C] truncate pr-4">
                {item.clause}
              </span>
              <span
                className={`text-[11px] font-black flex-shrink-0 transition-transform ${
                  open === i ? 'rotate-90' : ''
                }`}
              >
                →
              </span>
            </button>

            {open === i && (
              <div className="px-5 pb-4 bg-[#FAFAFA]">
                <p className="text-[13px] text-[#1C1C1C] leading-relaxed mb-3">
                  {item.explanation}
                </p>
                <div className="border-l-4 border-l-amber-400 bg-amber-50 px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block mb-1">
                    If breached
                  </span>
                  <p className="text-[12px] text-amber-800 leading-relaxed">{item.breach}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
