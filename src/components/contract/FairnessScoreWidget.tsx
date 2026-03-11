'use client'

interface FairnessScoreWidgetProps {
  score: number
  summary: string
}

function scoreColour(score: number): string {
  if (score <= 3) return '#D0000A'
  if (score <= 6) return '#d97706'
  return '#16a34a'
}

function scoreLabel(score: number): string {
  if (score <= 3) return 'Favours other party'
  if (score <= 5) return 'Slightly unbalanced'
  if (score <= 7) return 'Balanced'
  return 'Favours you'
}

export default function FairnessScoreWidget({ score, summary }: FairnessScoreWidgetProps) {
  const colour = scoreColour(score)
  const label = scoreLabel(score)

  return (
    <div className="bg-white border border-[#0C0C0C] shadow-[5px_5px_0_#0C0C0C]">
      {/* Header */}
      <div className="bg-[#0C0C0C] px-5 py-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
          Fairness Score — clausifai<span className="text-[#D0000A]">.</span>
        </span>
      </div>

      <div className="px-5 py-5">
        {/* Score display */}
        <div className="flex items-end gap-3 mb-4">
          <span className="text-[64px] font-black leading-none" style={{ color: colour }}>
            {score.toFixed(1)}
          </span>
          <span className="text-[20px] font-bold text-[#ADADAD] mb-2">/10</span>
        </div>

        {/* Bar */}
        <div className="h-2 bg-[#EBEBEB] mb-3">
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${score * 10}%`, backgroundColor: colour }}
          />
        </div>

        {/* Label */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="text-[11px] font-black uppercase tracking-widest"
            style={{ color: colour }}
          >
            {label}
          </span>
          <div className="flex gap-1">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5"
                style={{ backgroundColor: i < Math.round(score) ? colour : '#EBEBEB' }}
              />
            ))}
          </div>
        </div>

        {/* Summary */}
        <p className="text-[12px] text-[#656565] leading-relaxed border-t border-[#EBEBEB] pt-3">
          {summary}
        </p>
      </div>
    </div>
  )
}
