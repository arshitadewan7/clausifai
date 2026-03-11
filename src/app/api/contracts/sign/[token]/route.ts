import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const formData = await req.formData()
  const signerName = formData.get('signerName') as string
  const signerEmail = formData.get('signerEmail') as string

  if (!signerName || !signerEmail) {
    return NextResponse.redirect(new URL(`/sign/${token}?error=missing`, req.url))
  }

  const { data: contract } = await supabaseAdmin
    .from('contracts')
    .select('signing_expires_at, signed_at')
    .eq('signing_token', token)
    .single()

  if (!contract) {
    return NextResponse.redirect(new URL('/sign/not-found', req.url))
  }

  if (contract.signed_at) {
    return NextResponse.redirect(new URL(`/sign/${token}`, req.url))
  }

  if (contract.signing_expires_at && new Date(contract.signing_expires_at) < new Date()) {
    return NextResponse.redirect(new URL(`/sign/${token}`, req.url))
  }

  await supabaseAdmin
    .from('contracts')
    .update({
      signed_at: new Date().toISOString(),
      status: 'signed',
      party_b: { name: signerName, email: signerEmail },
    })
    .eq('signing_token', token)

  return NextResponse.redirect(new URL(`/sign/${token}/success`, req.url))
}
