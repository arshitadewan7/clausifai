import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resend } from '@/lib/resend'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const {
    recipientName,
    recipientEmail,
    message,
    expiryDays,
    contractType,
    jurisdiction,
    country,
    assembledDocument,
    fairnessScore,
    riskFlags,
    partyA,
    partyB,
    senderName,
  } = await req.json()

  if (!recipientEmail || !assembledDocument) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + (expiryDays ?? 14))

  const { data: contract, error } = await supabaseAdmin
    .from('contracts')
    .insert({
      contract_type: contractType,
      jurisdiction,
      country,
      status: 'sent',
      party_a: partyA,
      party_b: partyB,
      assembled_document: assembledDocument,
      fairness_score: fairnessScore,
      risk_flags: riskFlags,
      signing_expires_at: expiresAt.toISOString(),
      sent_at: new Date().toISOString(),
    })
    .select('signing_token')
    .single()

  if (error || !contract) {
    return NextResponse.json({ error: 'Failed to save contract' }, { status: 500 })
  }

  const signingUrl = `${process.env.NEXT_PUBLIC_APP_URL}/sign/${contract.signing_token}`

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F8F8F8; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: white; border: 1px solid #0C0C0C; }
    .header { background: #0C0C0C; padding: 24px 32px; }
    .logo { font-size: 20px; font-weight: 900; color: white; letter-spacing: -0.5px; }
    .logo span { color: #D0000A; }
    .body { padding: 40px 32px; }
    h2 { font-size: 22px; font-weight: 900; color: #0C0C0C; margin: 0 0 16px; }
    p { font-size: 15px; color: #656565; line-height: 1.6; margin: 0 0 16px; }
    .message-box { border-left: 4px solid #D0000A; background: #FFF5F5; padding: 16px; margin: 24px 0; font-size: 14px; color: #0C0C0C; }
    .cta { display: inline-block; background: #D0000A; color: white; font-weight: 900; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; padding: 16px 32px; text-decoration: none; border: 1px solid #0C0C0C; }
    .footer { border-top: 1px solid #EBEBEB; padding: 20px 32px; font-size: 12px; color: #ADADAD; }
    .expiry { background: #F8F8F8; border: 1px solid #EBEBEB; padding: 12px 16px; margin-top: 24px; font-size: 13px; color: #656565; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">clausifai<span>.</span></div>
    </div>
    <div class="body">
      <h2>${senderName ?? 'Someone'} has sent you a contract to review</h2>
      <p>Hi ${recipientName},</p>
      <p>You've received a <strong>${contractType?.replace(/_/g, ' ') ?? 'contract'}</strong> for your review and signature.</p>
      ${message ? `<div class="message-box">"${message}"</div>` : ''}
      <p>Click the button below to review the document and add your signature.</p>
      <a href="${signingUrl}" class="cta">Review &amp; Sign Contract →</a>
      <div class="expiry">⏱ This link expires on ${expiresAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </div>
    <div class="footer">
      Powered by clausifai. — AI-powered legal document management. If you did not expect this email, you can safely ignore it.
    </div>
  </div>
</body>
</html>`

  try {
    await resend.emails.send({
      from: 'clausifai. <noreply@clausifai.com>',
      to: recipientEmail,
      subject: `${senderName ?? 'Someone'} has sent you a contract to review`,
      html: emailHtml,
    })
  } catch {
    // email failed but contract is saved — don't block
  }

  return NextResponse.json({ signingUrl, token: contract.signing_token })
}
