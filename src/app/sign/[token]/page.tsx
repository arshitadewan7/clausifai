import { createClient } from '@supabase/supabase-js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { notFound } from 'next/navigation'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function SignPage({ params }: PageProps) {
  const { token } = await params

  const { data: contract } = await supabaseAdmin
    .from('contracts')
    .select('*')
    .eq('signing_token', token)
    .single()

  if (!contract) return notFound()

  const expired =
    contract.signing_expires_at && new Date(contract.signing_expires_at) < new Date()

  // Mark as opened if not already
  if (!contract.opened_at && !expired) {
    await supabaseAdmin
      .from('contracts')
      .update({ opened_at: new Date().toISOString() })
      .eq('signing_token', token)
  }

  return (
    <div className="min-h-screen bg-[#F8F8F8] font-sans">
      <header className="bg-white border-b border-[#0C0C0C] px-8 py-4 flex items-center justify-between">
        <span className="text-xl font-black tracking-tight">
          clausifai<span className="text-[#D0000A]">.</span>
        </span>
        <span className="text-xs font-bold uppercase tracking-widest text-[#656565]">
          {expired ? 'Expired' : 'Review & Sign'}
        </span>
      </header>

      {expired ? (
        <div className="max-w-2xl mx-auto px-6 py-20 text-center">
          <div className="text-[60px] font-black text-[#0C0C0C]/10 mb-4">⏱</div>
          <h1 className="text-[22px] font-black text-[#0C0C0C] mb-3">This link has expired</h1>
          <p className="text-[14px] text-[#656565]">
            The signing link is no longer valid. Please ask the sender to generate a new one.
          </p>
        </div>
      ) : contract.signed_at ? (
        <div className="max-w-2xl mx-auto px-6 py-20 text-center">
          <div className="text-[60px] font-black text-green-600/20 mb-4">✓</div>
          <h1 className="text-[22px] font-black text-[#0C0C0C] mb-3">Already signed</h1>
          <p className="text-[14px] text-[#656565]">
            This contract was signed on{' '}
            {new Date(contract.signed_at).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            .
          </p>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto px-6 py-10">
          {/* Info bar */}
          <div className="bg-white border border-[#0C0C0C] px-6 py-4 mb-6 flex items-center justify-between shadow-[3px_3px_0_#0C0C0C]">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#656565] mb-1">
                {contract.contract_type?.replace(/_/g, ' ') ?? 'Contract'} — for review
              </div>
              <div className="text-[13px] font-semibold text-[#0C0C0C]">
                Review the document below, then sign at the bottom.
              </div>
            </div>
            {contract.signing_expires_at && (
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#656565] text-right">
                <span className="block">Expires</span>
                {new Date(contract.signing_expires_at).toLocaleDateString('en-AU', {
                  day: 'numeric',
                  month: 'short',
                })}
              </div>
            )}
          </div>

          {/* Contract */}
          <div className="bg-white border border-[#0C0C0C] shadow-[8px_8px_0_#D0000A] mb-6">
            <div className="bg-[#D0000A] px-6 py-4">
              <span className="text-[12px] font-bold uppercase tracking-widest text-white/80">Contract Document</span>
            </div>
            <div className="px-16 py-12 max-w-[860px] mx-auto">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-[22px] font-black text-[#0C0C0C] text-center tracking-tight mb-1 mt-0 uppercase">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-[13px] font-black text-[#0C0C0C] uppercase tracking-widest mt-10 mb-3 pb-2 border-b border-[#DADADA]">{children}</h2>
                  ),
                  p: ({ children }) => (
                    <p className="text-[14px] text-[#1C1C1C] leading-[1.85] mb-4">{children}</p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-black text-[#0C0C0C]">{children}</strong>
                  ),
                  table: ({ children }) => (
                    <table className="w-full border-collapse text-[13px] mb-6">{children}</table>
                  ),
                  th: ({ children }) => (
                    <th className="text-left font-black text-[10px] uppercase tracking-wider text-[#656565] border-b border-[#DADADA] pb-2 pr-4">{children}</th>
                  ),
                  td: ({ children }) => (
                    <td className="text-[#1C1C1C] border-b border-[#F0F0F0] py-2 pr-4">{children}</td>
                  ),
                }}
              >
                {contract.assembled_document ?? ''}
              </ReactMarkdown>
            </div>
          </div>

          {/* Signing form */}
          <SigningForm token={token} />
        </div>
      )}
    </div>
  )
}

// Client component for the signature form
function SigningForm({ token }: { token: string }) {
  return (
    <div
      id="signing-form"
      className="bg-white border border-[#0C0C0C] shadow-[5px_5px_0_#0C0C0C] p-6"
      suppressHydrationWarning
    >
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#656565] mb-4">
        Electronic Signature
      </div>
      <div className="bg-amber-50 border border-amber-200 px-4 py-3 mb-5 text-[12px] text-amber-800">
        By typing your full name below and clicking &quot;Sign Contract&quot;, you agree this constitutes your legal electronic signature and that you have read and agree to the terms above.
      </div>
      <SigningClient token={token} />
    </div>
  )
}

// Inline client component — we need it separate for interactivity
// In a real app you'd split to a 'use client' file
// For now we embed the form action
function SigningClient({ token }: { token: string }) {
  return (
    <form
      action={`/api/contracts/sign/${token}`}
      method="POST"
      className="space-y-4"
    >
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5">
          Your Full Name (as it appears in the contract)
        </label>
        <input
          name="signerName"
          required
          placeholder="Type your full legal name"
          className="w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C]"
        />
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5">
          Your Email
        </label>
        <input
          name="signerEmail"
          type="email"
          required
          placeholder="your@email.com"
          className="w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C]"
        />
      </div>
      <button
        type="submit"
        className="w-full bg-[#D0000A] text-white font-black text-[12px] uppercase tracking-widest py-4 border border-[#0C0C0C] shadow-[3px_3px_0_#0C0C0C] hover:bg-[#A80008] transition-all"
      >
        Sign Contract →
      </button>
    </form>
  )
}
