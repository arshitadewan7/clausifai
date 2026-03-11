'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { validateABN, formatABN, validateGSTIN, validatePAN } from '@/lib/validators'

type Country = 'AU' | 'IN'
type EntityType = 'freelancer' | 'sole_trader' | 'small_business' | 'startup' | 'other'
type Industry = 'creative' | 'tech' | 'trades' | 'consulting' | 'other'

const AU_JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'ACT', 'TAS', 'NT']
const IN_JURISDICTIONS = ['Maharashtra', 'Karnataka', 'Delhi', 'Tamil Nadu', 'Telangana', 'Gujarat', 'Other']

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'freelancer', label: 'Freelancer' },
  { value: 'sole_trader', label: 'Sole Trader' },
  { value: 'small_business', label: 'Small Business' },
  { value: 'startup', label: 'Startup' },
  { value: 'other', label: 'Other' },
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
    // Response is JSONP-like: callback({...})
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

  const [country, setCountry] = useState<Country>('AU')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [abn, setAbn] = useState('')
  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')
  const [address, setAddress] = useState('')
  const [jurisdiction, setJurisdiction] = useState('NSW')
  const [entityType, setEntityType] = useState<EntityType>('freelancer')
  const [industry, setIndustry] = useState<Industry>('creative')

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

  function handleCountryChange(c: Country) {
    setCountry(c)
    setJurisdiction(c === 'AU' ? 'NSW' : 'Maharashtra')
    setAbn('')
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
    if (!validateABN(abn)) {
      setAbnError('Invalid ABN — please check and try again')
      return
    }
    setAbnError('')
    const name = await lookupABN(abn)
    if (name) setAbnVerified(`Verified: ${name}`)
    else setAbnVerified('Valid ABN format')
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
    if (!fullName.trim()) { setError('Please enter your full name'); return }
    if (country === 'AU' && abn && !validateABN(abn)) { setError('Please fix your ABN'); return }
    if (country === 'IN' && gstin && !validateGSTIN(gstin)) { setError('Please fix your GSTIN'); return }
    if (country === 'IN' && pan && !validatePAN(pan)) { setError('Please fix your PAN'); return }

    setSaving(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()

    const payload = {
      full_name: fullName,
      business_name: businessName || null,
      country,
      abn: country === 'AU' ? abn.replace(/\s/g, '') || null : null,
      gstin: country === 'IN' ? gstin || null : null,
      pan: country === 'IN' ? pan || null : null,
      address: address || null,
      jurisdiction,
      entity_type: entityType,
      industry,
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
      // Store in localStorage for unauthenticated users
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
            Your details will pre-fill every contract you generate.
          </p>
        </div>

        <div className="bg-white border border-[#0C0C0C] shadow-[5px_5px_0_#0C0C0C]">
          <div className="bg-[#0C0C0C] px-6 py-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Profile Details</span>
          </div>

          <div className="p-6 space-y-5">
            {/* Country */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-2">Country</label>
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

            {/* Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Full Legal Name *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Maya Chen" className={inp} />
              </div>
              <div>
                <label className={lbl}>Business Name (optional)</label>
                <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Pixel Studio" className={inp} />
              </div>
            </div>

            {/* Business ID */}
            {country === 'AU' ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={lbl}>ABN (optional)</label>
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
                  <label className={lbl}>PAN (optional)</label>
                  <input value={pan} onChange={(e) => handlePanChange(e.target.value)} placeholder="ABCDE1234F" className={inp} />
                  {panError && <p className="text-[11px] text-[#D0000A] mt-1">{panError}</p>}
                </div>
              </div>
            )}

            {/* Address */}
            <div>
              <label className={lbl}>Address (optional)</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 Smith St, Sydney NSW 2000" className={inp} />
            </div>

            {/* Jurisdiction */}
            <div>
              <label className={lbl}>Default Jurisdiction</label>
              <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className={inp}>
                {(country === 'AU' ? AU_JURISDICTIONS : IN_JURISDICTIONS).map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </div>

            {/* Entity type */}
            <div>
              <label className={lbl}>Entity Type</label>
              <div className="flex flex-wrap gap-2">
                {ENTITY_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setEntityType(value)}
                    className={`px-3 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${entityType === value ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Industry */}
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

            {error && <p className="text-[12px] text-[#D0000A] font-semibold">{error}</p>}

            <button
              onClick={handleSave}
              disabled={saving || !fullName.trim()}
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

                {/* Step-by-step guide */}
                <div className="border border-[#EBEBEB] divide-y divide-[#EBEBEB]">
                  <div className="px-4 py-3 bg-[#F8F8F8]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565]">
                      {country === 'AU' ? 'Your ABR Portal Cheat Sheet' : 'Your GST Portal Cheat Sheet'}
                    </span>
                  </div>
                  {[
                    ['Step 1', country === 'AU' ? 'Select "Apply for ABN"' : 'Click "Register" → "New Registration"'],
                    ['Step 2', `Choose entity type → Sole Trader`, entityType === 'sole_trader' ? 'Sole Trader' : entityType],
                    ['Step 3', 'Enter your details below — use copy buttons'],
                  ].map(([step, instruction, copyVal]) => (
                    <div key={step} className="px-4 py-3 flex items-start gap-3">
                      <span className="text-[9px] font-black uppercase tracking-wider text-[#ADADAD] flex-shrink-0 mt-0.5">{step}</span>
                      <span className="text-[12px] text-[#0C0C0C] flex-1">{instruction}</span>
                      {copyVal && (
                        <button onClick={() => navigator.clipboard.writeText(copyVal)} className="text-[9px] font-black uppercase tracking-wider px-2 py-1 border border-[#DADADA] hover:border-[#0C0C0C] flex-shrink-0">
                          Copy
                        </button>
                      )}
                    </div>
                  ))}
                  {[
                    ['Full name', fullName],
                    ['DOB', guideDob],
                    ['Address', address],
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

const lbl = 'text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5'
const inp = 'w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C] transition-colors'
