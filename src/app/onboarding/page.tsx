'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { validateABN, formatABN, validateGSTIN, validatePAN } from '@/lib/validators'

type Country = 'AU' | 'IN'
type EntityType = 'individual' | 'sole_trader' | 'company' | 'trust' | 'partnership' | 'other'
type Industry = 'creative' | 'tech' | 'trades' | 'consulting' | 'other'

const AU_JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'ACT', 'TAS', 'NT']
const IN_JURISDICTIONS = ['Maharashtra', 'Karnataka', 'Delhi', 'Tamil Nadu', 'Telangana', 'Gujarat', 'Other']

const ENTITY_TYPES: { value: EntityType; label: string; hint: string }[] = [
  { value: 'individual', label: 'Individual', hint: 'Personal capacity, no business' },
  { value: 'sole_trader', label: 'Sole Trader', hint: 'Trading under your own ABN' },
  { value: 'company', label: 'Company', hint: 'Pty Ltd / Limited / Ltd' },
  { value: 'trust', label: 'Trust', hint: 'Family, unit or discretionary trust' },
  { value: 'partnership', label: 'Partnership', hint: 'General or limited partnership' },
  { value: 'other', label: 'Other', hint: 'Co-operative, association, etc.' },
]

const INDUSTRIES: { value: Industry; label: string }[] = [
  { value: 'creative', label: 'Creative' },
  { value: 'tech', label: 'Tech' },
  { value: 'trades', label: 'Trades' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'other', label: 'Other' },
]

// ABN lookup via ABR
async function lookupABN(abn: string): Promise<string | null> {
  const guid = process.env.NEXT_PUBLIC_ABR_GUID
  if (!guid) return null
  try {
    const clean = abn.replace(/\s/g, '')
    const res = await fetch(
      `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${clean}&guid=${guid}`,
    )
    const text = await res.text()
    const match = text.match(/\{.*\}/)
    if (!match) return null
    const data = JSON.parse(match[0])
    if (data.EntityName) return data.EntityName
    return null
  } catch {
    return null
  }
}

export default function OnboardingPage() {
  const router = useRouter()

  // Identity
  const [country, setCountry] = useState<Country>('AU')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [entityType, setEntityType] = useState<EntityType>('sole_trader')
  const [industry, setIndustry] = useState<Industry>('creative')

  // Business IDs
  const [abn, setAbn] = useState('')
  const [acn, setAcn] = useState('')
  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')

  // Address
  const [streetAddress, setStreetAddress] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [jurisdiction, setJurisdiction] = useState('NSW')

  // Contact
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Signatory (who signs on behalf of the entity)
  const [signatoryName, setSignatoryName] = useState('')
  const [signatoryTitle, setSignatoryTitle] = useState('')

  // Validation states
  const [abnError, setAbnError] = useState('')
  const [abnVerified, setAbnVerified] = useState('')
  const [gstinError, setGstinError] = useState('')
  const [panError, setPanError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ABN guide state
  const [showAbnGuide, setShowAbnGuide] = useState(false)
  const [guideDob, setGuideDob] = useState('')
  const [guideActivity, setGuideActivity] = useState('')
  const [guideStartDate, setGuideStartDate] = useState('')
  const [guideGst, setGuideGst] = useState(false)
  const [guideHasAbn, setGuideHasAbn] = useState(false)
  const [guideAbnInput, setGuideAbnInput] = useState('')
  const [guideVerifying, setGuideVerifying] = useState(false)
  const [guideVerified, setGuideVerified] = useState('')

  // Pre-fill email from auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setEmail(user.email)
      if (user?.user_metadata?.full_name) setFullName(user.user_metadata.full_name)
    })
  }, [])

  // Default signatory to full name when it changes and signatory is blank
  useEffect(() => {
    if (!signatoryName && fullName) setSignatoryName(fullName)
  }, [fullName]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleCountryChange(c: Country) {
    setCountry(c)
    setJurisdiction(c === 'AU' ? 'NSW' : 'Maharashtra')
    setAbn('')
    setAcn('')
    setGstin('')
    setPan('')
    setAbnError('')
    setGstinError('')
    setPanError('')
    setAbnVerified('')
  }

  function handleAbnChange(raw: string) {
    const formatted = formatABN(raw)
    setAbn(formatted)
    setAbnError('')
    setAbnVerified('')
  }

  async function verifyAbn() {
    setAbnError('')
    const name = await lookupABN(abn)
    if (name) setAbnVerified(`Verified: ${name}`)
    else setAbnVerified('ABN lookup complete')
  }

  function handleGstinChange(raw: string) {
    const upper = raw.toUpperCase()
    setGstin(upper)
    if (upper && !validateGSTIN(upper)) setGstinError('Invalid GSTIN format')
    else setGstinError('')
  }

  function handlePanChange(raw: string) {
    const upper = raw.toUpperCase()
    setPan(upper)
    if (upper && !validatePAN(upper)) setPanError('Invalid PAN format (e.g. ABCDE1234F)')
    else setPanError('')
  }

  async function handleSave() {
    if (!fullName.trim()) { setError('Please enter your full legal name'); return }
    if (!streetAddress.trim()) { setError('Please enter your street address'); return }
    if (!city.trim()) { setError('Please enter your city / suburb'); return }
    // ABN validation is optional — any value is accepted
    if (country === 'IN' && gstin && !validateGSTIN(gstin)) { setError('Please fix your GSTIN'); return }
    if (country === 'IN' && pan && !validatePAN(pan)) { setError('Please fix your PAN'); return }

    setSaving(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()

    const payload = {
      full_name: fullName.trim(),
      business_name: businessName.trim() || null,
      entity_type: entityType,
      industry,
      country,
      abn: country === 'AU' ? abn.replace(/\s/g, '') || null : null,
      acn: country === 'AU' ? acn.trim() || null : null,
      gstin: country === 'IN' ? gstin || null : null,
      pan: country === 'IN' ? pan || null : null,
      street_address: streetAddress.trim(),
      city: city.trim(),
      postcode: postcode.trim() || null,
      jurisdiction,
      // Keep legacy address field populated for backward compat
      address: [streetAddress.trim(), city.trim(), jurisdiction, postcode.trim()].filter(Boolean).join(', '),
      email: email.trim() || null,
      phone: phone.trim() || null,
      signatory_name: signatoryName.trim() || fullName.trim(),
      signatory_title: signatoryTitle.trim() || null,
      onboarding_complete: true,
    }

    if (user) {
      const { error: dbError } = await supabase
        .from('profiles')
        .upsert({ id: user.id, ...payload })

      if (dbError) {
        setError(dbError.message)
        setSaving(false)
        return
      }
    } else {
      localStorage.setItem('clausifai_profile', JSON.stringify(payload))
    }

    router.push('/contract/new')
  }

  // ABN guide verify
  async function verifyGuideAbn() {
    const raw = guideAbnInput.replace(/\s/g, '')
    if (!validateABN(raw)) { setGuideVerified(''); return }
    setGuideVerifying(true)
    const name = await lookupABN(raw)
    setGuideVerifying(false)
    if (name) {
      setGuideVerified(`Verified: ${name}`)
      setAbn(formatABN(raw))
      setAbnVerified(`Verified: ${name}`)
    } else {
      setGuideVerified('Valid ABN format — saved!')
      setAbn(formatABN(raw))
    }
    setShowAbnGuide(false)
    setGuideHasAbn(false)
  }

  const needsSignatory = ['company', 'trust', 'partnership'].includes(entityType)

  return (
    <div className="min-h-screen bg-[#F8F8F8] font-sans">
      <header className="bg-white border-b border-[#0C0C0C] px-8 py-4 flex items-center justify-between">
        <span className="text-xl font-black tracking-tight">
          clausifai<span className="text-[#D0000A]">.</span>
        </span>
        <span className="text-xs font-bold uppercase tracking-widest text-[#656565]">Setup your profile</span>
      </header>

      <div className="max-w-xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-[28px] font-black text-[#0C0C0C] tracking-tight mb-2">
            Let&apos;s get you set up<span className="text-[#D0000A]">.</span>
          </h1>
          <p className="text-[14px] text-[#656565]">
            Your legal details will pre-fill every contract you generate. This information appears in binding legal documents — enter it exactly as it appears on your official registration.
          </p>
        </div>

        <div className="bg-white border border-[#0C0C0C] shadow-[5px_5px_0_#0C0C0C]">
          {/* ── Section: Country ── */}
          <SectionHeader label="Country & Jurisdiction" />
          <div className="p-6 space-y-5">
            <div>
              <label className={lbl}>Country *</label>
              <div className="flex">
                {(['AU', 'IN'] as Country[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => handleCountryChange(c)}
                    className={`flex-1 py-3 text-[12px] font-black uppercase tracking-wider border transition-colors ${country === c ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'bg-white text-[#656565] border-[#DADADA] hover:border-[#0C0C0C]'}`}
                  >
                    {c === 'AU' ? '🇦🇺 Australia' : '🇮🇳 India'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={lbl}>Default Jurisdiction (Governing Law) *</label>
              <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className={inp}>
                {(country === 'AU' ? AU_JURISDICTIONS : IN_JURISDICTIONS).map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
              <p className="text-[10px] text-[#ADADAD] mt-1">This sets the governing law for contracts you generate.</p>
            </div>
          </div>

          {/* ── Section: Legal Identity ── */}
          <SectionHeader label="Legal Identity" />
          <div className="p-6 space-y-5">
            <div>
              <label className={lbl}>Entity Type *</label>
              <div className="grid grid-cols-2 gap-2">
                {ENTITY_TYPES.map(({ value, label, hint }) => (
                  <button
                    key={value}
                    onClick={() => setEntityType(value)}
                    className={`text-left px-3 py-2.5 text-[11px] font-black uppercase tracking-wider border transition-colors ${entityType === value ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}
                  >
                    <div>{label}</div>
                    <div className={`text-[9px] font-normal normal-case tracking-normal mt-0.5 ${entityType === value ? 'text-white/60' : 'text-[#ADADAD]'}`}>{hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Full Legal Name *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Maya Chen" className={inp} />
                <p className="text-[10px] text-[#ADADAD] mt-1">As it appears on official ID / registration</p>
              </div>
              {entityType !== 'individual' && (
                <div>
                  <label className={lbl}>
                    {entityType === 'company' ? 'Registered Company Name *' : 'Business / Trading Name'}
                  </label>
                  <input
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder={entityType === 'company' ? 'Pixel Studio Pty Ltd' : 'Pixel Studio'}
                    className={inp}
                  />
                </div>
              )}
            </div>

            <div>
              <label className={lbl}>Industry</label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setIndustry(value)}
                    className={`px-3 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${industry === value ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Section: Business Registration ── */}
          <SectionHeader label="Business Registration" />
          <div className="p-6 space-y-5">
            {country === 'AU' ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={lbl}>ABN — Australian Business Number {entityType === 'individual' ? '(optional)' : '*'}</label>
                    <button
                      onClick={() => setShowAbnGuide(true)}
                      className="text-[10px] text-[#D0000A] font-bold hover:underline"
                    >
                      I don&apos;t have an ABN yet
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={abn}
                      onChange={(e) => handleAbnChange(e.target.value)}
                      placeholder="12 345 678 901"
                      className={`flex-1 ${inp}`}
                    />
                    <button
                      onClick={verifyAbn}
                      className="px-4 text-[10px] font-black uppercase tracking-wider border border-[#0C0C0C] hover:bg-[#0C0C0C] hover:text-white transition-colors flex-shrink-0"
                    >
                      Verify
                    </button>
                  </div>
                  {abnError && <p className="text-[11px] text-[#D0000A] mt-1">{abnError}</p>}
                  {abnVerified && <p className="text-[11px] text-green-600 font-semibold mt-1">✓ {abnVerified}</p>}
                </div>

                {entityType === 'company' && (
                  <div>
                    <label className={lbl}>ACN — Australian Company Number (optional)</label>
                    <input
                      value={acn}
                      onChange={(e) => setAcn(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder="123 456 789"
                      className={inp}
                    />
                    <p className="text-[10px] text-[#ADADAD] mt-1">9-digit number on your ASIC certificate. Required for Pty Ltd entities.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={lbl}>GSTIN (optional)</label>
                    <button onClick={() => setShowAbnGuide(true)} className="text-[10px] text-[#D0000A] font-bold hover:underline">
                      I don&apos;t have a GSTIN yet
                    </button>
                  </div>
                  <input value={gstin} onChange={(e) => handleGstinChange(e.target.value)} placeholder="22AAAAA0000A1Z5" className={inp} />
                  {gstinError && <p className="text-[11px] text-[#D0000A] mt-1">{gstinError}</p>}
                </div>
                <div>
                  <label className={lbl}>PAN — Permanent Account Number (optional)</label>
                  <input value={pan} onChange={(e) => handlePanChange(e.target.value)} placeholder="ABCDE1234F" className={inp} />
                  {panError && <p className="text-[11px] text-[#D0000A] mt-1">{panError}</p>}
                </div>
              </div>
            )}
          </div>

          {/* ── Section: Registered Address ── */}
          <SectionHeader label="Registered Address" />
          <div className="p-6 space-y-4">
            <p className="text-[11px] text-[#ADADAD] -mt-1">Your address as it appears on your ABN/company registration. This is used in contracts.</p>
            <div>
              <label className={lbl}>Street Address *</label>
              <input value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} placeholder="12 Smith Street" className={inp} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>City / Suburb *</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sydney" className={inp} />
              </div>
              <div>
                <label className={lbl}>Postcode / PIN</label>
                <input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder={country === 'AU' ? '2000' : '400001'} className={inp} />
              </div>
            </div>
            <div>
              <label className={lbl}>State (same as jurisdiction above)</label>
              <input value={jurisdiction} readOnly className={`${inp} bg-[#F8F8F8] text-[#ADADAD] cursor-not-allowed`} />
            </div>
          </div>

          {/* ── Section: Contact Details ── */}
          <SectionHeader label="Contact Details" />
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Email Address</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maya@pixelstudio.com" className={inp} />
                <p className="text-[10px] text-[#ADADAD] mt-1">Contact email shown in contracts</p>
              </div>
              <div>
                <label className={lbl}>Phone Number (optional)</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={country === 'AU' ? '+61 4xx xxx xxx' : '+91 98xxx xxxxx'} className={inp} />
              </div>
            </div>
          </div>

          {/* ── Section: Signatory ── */}
          <SectionHeader label="Authorised Signatory" />
          <div className="p-6 space-y-4">
            <p className="text-[11px] text-[#ADADAD] -mt-1">
              {needsSignatory
                ? 'The person authorised to sign contracts on behalf of the entity (e.g. Director, Trustee).'
                : 'The name that will appear above the signature line in contracts.'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Signatory Full Name *</label>
                <input value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder="Maya Chen" className={inp} />
              </div>
              <div>
                <label className={lbl}>Title / Role {needsSignatory ? '*' : '(optional)'}</label>
                <input
                  value={signatoryTitle}
                  onChange={(e) => setSignatoryTitle(e.target.value)}
                  placeholder={
                    entityType === 'company' ? 'Director' :
                    entityType === 'trust' ? 'Trustee' :
                    entityType === 'partnership' ? 'Partner' : 'Founder'
                  }
                  className={inp}
                />
              </div>
            </div>
            {needsSignatory && (
              <div className="border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[11px] text-amber-800">
                  <strong>Legal note:</strong> For {entityType === 'company' ? 'companies' : entityType + 's'}, the signatory must be duly authorised to execute contracts (e.g. a Director or authorised officer). Ensure this matches your company records.
                </p>
              </div>
            )}
          </div>

          {/* ── Save ── */}
          <div className="p-6 pt-0">
            {error && <p className="text-[12px] text-[#D0000A] font-semibold mb-4">{error}</p>}
            <button
              onClick={handleSave}
              disabled={saving || !fullName.trim() || !streetAddress.trim() || !city.trim()}
              className="w-full bg-[#D0000A] text-white font-black text-[12px] uppercase tracking-widest py-4 border border-[#0C0C0C] shadow-[3px_3px_0_#0C0C0C] hover:bg-[#A80008] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {saving ? 'Saving...' : 'Save & Continue →'}
            </button>
          </div>
        </div>
      </div>

      {/* ABN Guide Modal */}
      {showAbnGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl bg-white border border-[#0C0C0C] shadow-[8px_8px_0_#D0000A] max-h-[90vh] overflow-y-auto">
            <div className="bg-[#0C0C0C] px-6 py-4 flex items-center justify-between sticky top-0">
              <span className="text-[12px] font-bold uppercase tracking-widest text-white/70">
                {country === 'AU' ? "Let's get your ABN" : "Let's get your GSTIN"}
              </span>
              <button onClick={() => setShowAbnGuide(false)} className="text-white/60 hover:text-white text-[18px] font-black">×</button>
            </div>

            {!guideHasAbn ? (
              <div className="p-6 space-y-5">
                <p className="text-[13px] text-[#656565] leading-relaxed">
                  {country === 'AU'
                    ? "Fill in your details and we'll guide you through the ABR portal step by step."
                    : "Fill in your details and we'll guide you through the GST portal step by step."}
                </p>

                <div className="space-y-4">
                  <div>
                    <label className={lbl}>Legal Name</label>
                    <input value={fullName} readOnly className={`${inp} bg-[#F8F8F8]`} />
                  </div>
                  <div>
                    <label className={lbl}>Date of Birth</label>
                    <input type="date" value={guideDob} onChange={(e) => setGuideDob(e.target.value)} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Business Activity</label>
                    <input value={guideActivity} onChange={(e) => setGuideActivity(e.target.value)} placeholder={country === 'AU' ? 'e.g. Graphic design services' : 'e.g. Software development'} className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Business Start Date</label>
                    <input type="date" value={guideStartDate} onChange={(e) => setGuideStartDate(e.target.value)} className={inp} />
                  </div>
                  {country === 'AU' ? (
                    <div>
                      <label className={lbl}>Do you expect to earn over $75,000/year?</label>
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={() => setGuideGst(true)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${guideGst ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565]'}`}>Yes — include GST registration</button>
                        <button onClick={() => setGuideGst(false)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${!guideGst ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565]'}`}>No — skip GST</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className={lbl}>Do you expect revenue over ₹20 lakhs/year?</label>
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={() => setGuideGst(true)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${guideGst ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565]'}`}>Yes — register for GST</button>
                        <button onClick={() => setGuideGst(false)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${!guideGst ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565]'}`}>No</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border border-[#EBEBEB] divide-y divide-[#EBEBEB]">
                  <div className="px-4 py-3 bg-[#F8F8F8]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565]">
                      {country === 'AU' ? 'Your ABR Portal Cheat Sheet' : 'Your GST Portal Cheat Sheet'}
                    </span>
                  </div>
                  {[
                    ['Step 1', country === 'AU' ? 'Select "Apply for ABN"' : 'Click "Register" → "New Registration"'],
                    ['Step 2', `Choose entity type → ${entityType === 'sole_trader' ? 'Sole Trader' : entityType}`],
                    ['Step 3', 'Enter your details below — use copy buttons'],
                  ].map(([step, instruction]) => (
                    <div key={step} className="px-4 py-3 flex items-start gap-3">
                      <span className="text-[9px] font-black uppercase tracking-wider text-[#ADADAD] flex-shrink-0 mt-0.5">{step}</span>
                      <span className="text-[12px] text-[#0C0C0C] flex-1">{instruction}</span>
                    </div>
                  ))}
                  {[
                    ['Full name', fullName],
                    ['DOB', guideDob],
                    ['Address', [streetAddress, city, postcode].filter(Boolean).join(', ')],
                    ['Activity', guideActivity],
                    ['Start date', guideStartDate],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565] w-20 flex-shrink-0">{label}</span>
                      <span className="text-[12px] text-[#0C0C0C] flex-1">{value}</span>
                      <button onClick={() => navigator.clipboard.writeText(value)} className="text-[9px] font-black uppercase tracking-wider px-2 py-1 border border-[#DADADA] hover:border-[#0C0C0C] flex-shrink-0">
                        Copy
                      </button>
                    </div>
                  ))}
                </div>

                <a
                  href={country === 'AU' ? 'https://www.abr.gov.au/business-super-funds-charities/applying-abn' : 'https://reg.gst.gov.in/registration/'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-[#0C0C0C] text-white font-black text-[11px] uppercase tracking-widest py-3 border border-[#0C0C0C]"
                >
                  {country === 'AU' ? 'Open ABR Portal →' : 'Open GST Portal →'}
                </a>

                <button
                  onClick={() => setGuideHasAbn(true)}
                  className="w-full border border-[#DADADA] text-[#656565] font-black text-[11px] uppercase tracking-widest py-3 hover:border-[#0C0C0C] transition-colors"
                >
                  Got my {country === 'AU' ? 'ABN' : 'GSTIN'}? Enter it →
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <p className="text-[14px] font-black text-[#0C0C0C]">
                  Got your {country === 'AU' ? 'ABN' : 'GSTIN'}? Enter it here:
                </p>
                <input
                  value={guideAbnInput}
                  onChange={(e) => setGuideAbnInput(country === 'AU' ? formatABN(e.target.value) : e.target.value.toUpperCase())}
                  placeholder={country === 'AU' ? '12 345 678 901' : '22AAAAA0000A1Z5'}
                  className={inp}
                />
                {guideVerified && <p className="text-[12px] text-green-600 font-semibold">✓ {guideVerified}</p>}
                <div className="flex gap-3">
                  <button onClick={() => setGuideHasAbn(false)} className="flex-1 border border-[#DADADA] text-[#656565] font-black text-[10px] uppercase tracking-wider py-3 hover:border-[#0C0C0C]">
                    ← Back
                  </button>
                  <button
                    onClick={verifyGuideAbn}
                    disabled={guideVerifying || !guideAbnInput.trim()}
                    className="flex-1 bg-[#D0000A] text-white font-black text-[10px] uppercase tracking-widest py-3 border border-[#0C0C0C] disabled:opacity-40"
                  >
                    {guideVerifying ? 'Verifying...' : 'Validate & Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="bg-[#F8F8F8] border-t border-b border-[#EBEBEB] px-6 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#656565]">{label}</span>
    </div>
  )
}

const lbl = 'text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5'
const inp = 'w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C] transition-colors'
