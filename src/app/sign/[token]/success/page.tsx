export default function SigningSuccessPage() {
  return (
    <div className="min-h-screen bg-[#F8F8F8] font-sans">
      <header className="bg-white border-b border-[#0C0C0C] px-8 py-4">
        <span className="text-xl font-black tracking-tight">
          clausifai<span className="text-[#D0000A]">.</span>
        </span>
      </header>
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="text-[80px] font-black text-green-600/20 mb-6">✓</div>
        <h1 className="text-[28px] font-black text-[#0C0C0C] tracking-tight mb-3">
          Contract signed<span className="text-[#D0000A]">.</span>
        </h1>
        <p className="text-[14px] text-[#656565] leading-relaxed">
          Your signature has been recorded. Both parties will receive a confirmation. You can now close this window.
        </p>
      </div>
    </div>
  )
}
