'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────
type Country = 'AU' | 'IN'
type ContractTypeKey =
  | 'service_agreement'
  | 'nda'
  | 'employment'
  | 'independent_contractor'
  | 'sla'
  | 'ip_assignment'
  | 'vendor_supplier'
  | 'partnership'

type RateType = 'fixed' | 'hourly' | 'milestone'
type PaymentTerms = 'net7' | 'net14' | 'net30'
type IPOwner = 'you' | 'client' | 'shared'
type DisputeResolution = 'courts' | 'arbitration' | 'mediation'

interface ContractTypeOption {
  key: ContractTypeKey
  label: string
  description: string
  length: string
  complexity: 'Simple' | 'Standard' | 'Complex'
}

interface FormData {
  country: Country
  contractType: ContractTypeKey | null

  // Party A — from profile (not editable here)
  yourName: string
  yourBusiness: string
  yourEntityType: string
  yourBusinessId: string
  yourAcn: string
  yourAddress: string
  yourEmail: string
  yourPhone: string
  yourSignatoryName: string
  yourSignatoryTitle: string

  // Party B — other party
  clientName: string
  clientBusiness: string
  clientEntityType: string
  clientBusinessId: string
  clientStreetAddress: string
  clientCity: string
  clientState: string
  clientPostcode: string
  clientEmail: string
  clientPhone: string
  clientSignatoryName: string
  clientSignatoryTitle: string

  // Contract metadata
  jurisdiction: string
  effectiveDate: string
  disputeResolution: DisputeResolution

  // NDA
  ndaPurpose: string
  ndaDuration: string
  ndaProtecting: string
  ndaMutual: boolean

  // Service Agreement
  projectDescription: string
  deliverables: string
  startDate: string
  endDate: string
  rateType: RateType
  amount: string
  paymentTerms: PaymentTerms
  latePaymentFee: boolean
  ipOwner: IPOwner
  revisionRounds: string
  confidentiality: boolean
  nonCompete: boolean

  // Employment
  roleTitle: string
  salary: string
  payFrequency: string
  probationPeriod: string
  noticePeriod: string

  // Independent Contractor
  projectScope: string
  expenseReimbursement: boolean
}

// ── Contract type catalogue ───────────────────────────────────────────────────
const CONTRACT_TYPES: ContractTypeOption[] = [
  { key: 'service_agreement', label: 'Freelance Service Agreement', description: 'For project-based work with a client', length: '4–6 pages', complexity: 'Standard' },
  { key: 'nda', label: 'Non-Disclosure Agreement', description: 'Protect confidential information', length: '1–2 pages', complexity: 'Simple' },
  { key: 'employment', label: 'Fixed-Term Employment', description: 'Hire someone for a set period', length: '5–8 pages', complexity: 'Complex' },
  { key: 'independent_contractor', label: 'Independent Contractor', description: 'Engage a contractor for ongoing work', length: '3–5 pages', complexity: 'Standard' },
  { key: 'sla', label: 'Service Level Agreement', description: 'Define performance standards & KPIs', length: '3–5 pages', complexity: 'Standard' },
  { key: 'ip_assignment', label: 'IP Assignment', description: 'Transfer intellectual property rights', length: '2–3 pages', complexity: 'Simple' },
  { key: 'vendor_supplier', label: 'Vendor / Supplier Agreement', description: 'Terms for goods or ongoing supply', length: '4–6 pages', complexity: 'Standard' },
  { key: 'partnership', label: 'Partnership Agreement', description: 'Structure a business partnership', length: '6–10 pages', complexity: 'Complex' },
]

const COMPLEXITY_COLOURS: Record<string, string> = {
  Simple: 'bg-green-50 text-green-700 border-green-200',
  Standard: 'bg-amber-50 text-amber-700 border-amber-200',
  Complex: 'bg-red-50 text-[#D0000A] border-red-200',
}

const AU_JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'ACT', 'TAS', 'NT']
const IN_JURISDICTIONS = ['Maharashtra', 'Karnataka', 'Delhi', 'Tamil Nadu', 'Telangana', 'Gujarat', 'Other']

const ENTITY_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  sole_trader: 'Sole Trader',
  company: 'Company',
  trust: 'Trust',
  partnership: 'Partnership',
  freelancer: 'Freelancer / Sole Trader',
  small_business: 'Small Business',
  startup: 'Startup',
  other: 'Other',
}

function defaultJurisdiction(country: Country): string {
  return country === 'AU' ? 'NSW' : 'Maharashtra'
}

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(f: FormData): string {
  const countryName = f.country === 'AU' ? 'Australia' : 'India'
  const currency = f.country === 'AU' ? 'AUD' : 'INR'
  const bizIdLabel = f.country === 'AU' ? 'ABN' : 'GSTIN/PAN'

  // Build full party A string
  const partyAIdParts: string[] = []
  if (f.yourBusinessId) partyAIdParts.push(`${bizIdLabel} ${f.yourBusinessId}`)
  if (f.yourAcn) partyAIdParts.push(`ACN ${f.yourAcn}`)
  const partyAId = partyAIdParts.length ? ` (${partyAIdParts.join(', ')})` : ''
  const partyAEntity = f.yourEntityType && f.yourEntityType !== 'individual' ? ` [${ENTITY_TYPE_LABELS[f.yourEntityType] ?? f.yourEntityType}]` : ''
  const partyAName = f.yourBusiness
    ? `${f.yourBusiness}${partyAId}${partyAEntity}, represented by ${f.yourSignatoryName || f.yourName}${f.yourSignatoryTitle ? ` (${f.yourSignatoryTitle})` : ''}`
    : `${f.yourName}${partyAId}${partyAEntity}`
  const partyAAddress = f.yourAddress ? `, of ${f.yourAddress}` : ''
  const partyAContact = f.yourEmail ? `. Contact: ${f.yourEmail}${f.yourPhone ? `, ${f.yourPhone}` : ''}` : ''
  const partyAFull = `${partyAName}${partyAAddress}${partyAContact}`

  // Build full party B string
  const partyBIdParts: string[] = []
  if (f.clientBusinessId) partyBIdParts.push(`${bizIdLabel} ${f.clientBusinessId}`)
  const partyBId = partyBIdParts.length ? ` (${partyBIdParts.join(', ')})` : ''
  const partyBEntityLabel = f.clientEntityType ? ENTITY_TYPE_LABELS[f.clientEntityType] ?? f.clientEntityType : ''
  const partyBEntity = partyBEntityLabel ? ` [${partyBEntityLabel}]` : ''
  const partyBName = f.clientBusiness
    ? `${f.clientBusiness}${partyBId}${partyBEntity}${f.clientSignatoryName ? `, represented by ${f.clientSignatoryName}${f.clientSignatoryTitle ? ` (${f.clientSignatoryTitle})` : ''}` : ''}`
    : `${f.clientName}${partyBId}${partyBEntity}`
  const partyBAddressParts = [f.clientStreetAddress, f.clientCity, f.clientState, f.clientPostcode, countryName].filter(Boolean)
  const partyBAddress = partyBAddressParts.length > 1 ? `, of ${partyBAddressParts.join(', ')}` : ''
  const partyBContact = f.clientEmail ? `. Contact: ${f.clientEmail}${f.clientPhone ? `, ${f.clientPhone}` : ''}` : ''
  const partyBFull = `${partyBName}${partyBAddress}${partyBContact}`

  const juris = `${f.jurisdiction}, ${countryName}`
  const disputeClause = f.disputeResolution === 'courts'
    ? `Disputes to be resolved in the courts of ${f.jurisdiction}, ${countryName}.`
    : f.disputeResolution === 'arbitration'
    ? `Disputes to be resolved by binding arbitration in ${f.jurisdiction}, ${countryName}.`
    : `Disputes to be resolved by mediation, then arbitration if unresolved, in ${f.jurisdiction}, ${countryName}.`

  switch (f.contractType) {
    case 'nda':
      return `Generate an NDA between Party A: ${partyAFull} and Party B: ${partyBFull}. Purpose: ${f.ndaPurpose || 'sharing confidential business information'}. Duration: ${f.ndaDuration || '2'} years. Protecting: ${f.ndaProtecting || 'all confidential business information'}. ${f.ndaMutual ? 'This is a mutual NDA.' : 'One-way disclosure from Party A to Party B.'} Effective: ${f.effectiveDate || 'the date of signing'}. Jurisdiction: ${juris}. ${disputeClause}`

    case 'service_agreement':
      return `Generate a Freelance Service Agreement between Party A: ${partyAFull} (service provider) and Party B: ${partyBFull} (client). Project: ${f.projectDescription || 'professional services'}. Key deliverables: ${f.deliverables || 'as agreed'}. Duration: ${f.startDate || 'commencement date'} to ${f.endDate || 'project completion'}. Payment: ${currency} ${f.amount || '0'} (${f.rateType}). Payment terms: ${f.paymentTerms?.replace('net', 'Net ')} days. ${f.latePaymentFee ? 'Late payment fee applies.' : ''} IP ownership: ${f.ipOwner === 'you' ? 'service provider retains all IP' : f.ipOwner === 'client' ? 'client owns all IP upon full payment' : 'IP shared equally between parties'}. ${f.revisionRounds ? `${f.revisionRounds} revision rounds included.` : ''} ${f.confidentiality ? 'Mutual confidentiality clause required.' : ''} ${f.nonCompete ? 'Non-compete clause required.' : ''} Jurisdiction: ${juris}. ${disputeClause}`

    case 'employment':
      return `Generate a Fixed-Term Employment Agreement between Party A: ${partyAFull} (employer) and Party B: ${partyBFull} (employee). Role: ${f.roleTitle || 'employee'}. Salary: ${currency} ${f.salary || '0'} per ${f.payFrequency || 'year'}. Probation period: ${f.probationPeriod || '3 months'}. Notice period: ${f.noticePeriod || '2 weeks'}. ${f.nonCompete ? 'Non-compete clause required.' : ''} Effective: ${f.effectiveDate || 'commencement date'}. Jurisdiction: ${juris}. ${disputeClause} Include statutory entitlements applicable under ${countryName} law.`

    case 'independent_contractor':
      return `Generate an Independent Contractor Agreement between Party A: ${partyAFull} (principal/client) and Party B: ${partyBFull} (independent contractor). Scope: ${f.projectScope || 'as agreed between the parties'}. Rate: ${currency} ${f.amount || '0'} (${f.rateType}). Payment terms: ${f.paymentTerms?.replace('net', 'Net ')} days. ${f.expenseReimbursement ? 'Reasonable pre-approved expenses reimbursable.' : ''} IP ownership: ${f.ipOwner === 'you' ? 'client owns all IP upon full payment' : f.ipOwner === 'client' ? 'contractor retains IP' : 'IP shared equally'}. ${f.nonCompete ? 'Non-compete clause required.' : ''} The contractor is engaged as an independent contractor, not an employee. Jurisdiction: ${juris}. ${disputeClause}`

    case 'sla':
      return `Generate a Service Level Agreement between Party A: ${partyAFull} (service provider) and Party B: ${partyBFull} (client). Scope: ${f.projectDescription || 'ongoing services'}. Payment: ${currency} ${f.amount || '0'} (${f.rateType}). Payment terms: ${f.paymentTerms?.replace('net', 'Net ')} days. ${f.confidentiality ? 'Confidentiality clause required.' : ''} Include service credits and remedies for SLA breaches. Jurisdiction: ${juris}. ${disputeClause}`

    case 'ip_assignment':
      return `Generate an IP Assignment Agreement between Party A: ${partyAFull} (assignor) and Party B: ${partyBFull} (assignee). Assignment of: ${f.projectDescription || 'all intellectual property created during the engagement'}. Consideration: ${currency} ${f.amount || '0'}. Assignment is permanent and irrevocable upon payment. Include moral rights waiver where applicable. Jurisdiction: ${juris}. ${disputeClause}`

    case 'vendor_supplier':
      return `Generate a Vendor/Supplier Agreement between Party A: ${partyAFull} (supplier) and Party B: ${partyBFull} (buyer/client). Goods/services: ${f.projectDescription || 'as specified in purchase orders'}. Payment terms: ${f.paymentTerms?.replace('net', 'Net ')} days. ${f.latePaymentFee ? 'Late payment fee applies.' : ''} ${f.confidentiality ? 'Mutual confidentiality clause required.' : ''} Include warranty, liability, and indemnification provisions. Jurisdiction: ${juris}. ${disputeClause}`

    case 'partnership':
      return `Generate a Partnership Agreement between Party A: ${partyAFull} and Party B: ${partyBFull}. Business purpose: ${f.projectDescription || 'as mutually agreed'}. ${f.amount ? `Initial capital contribution: ${currency} ${f.amount} per partner.` : ''} Include profit/loss sharing, decision-making authority, dispute resolution between partners, and exit provisions. Jurisdiction: ${juris}. ${disputeClause}`

    default:
      return `Generate a contract between Party A: ${partyAFull} and Party B: ${partyBFull}. Jurisdiction: ${juris}.`
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export interface ProfileData {
  full_name?: string
  business_name?: string
  entity_type?: string
  country?: string
  abn?: string
  acn?: string
  gstin?: string
  pan?: string
  street_address?: string
  city?: string
  postcode?: string
  address?: string
  jurisdiction?: string
  email?: string
  phone?: string
  signatory_name?: string
  signatory_title?: string
}

interface SmartContractFormProps {
  onSubmit: (prompt: string) => void
  disabled: boolean
  initialProfile?: ProfileData | null
}

export default function SmartContractForm({ onSubmit, disabled, initialProfile }: SmartContractFormProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Build derived address from structured fields or fall back to legacy address
  const derivedAddress = initialProfile
    ? [
        initialProfile.street_address,
        initialProfile.city,
        initialProfile.jurisdiction,
        initialProfile.postcode,
      ].filter(Boolean).join(', ') || initialProfile.address || ''
    : ''

  const [form, setForm] = useState<FormData>({
    country: (initialProfile?.country as Country) ?? 'AU',
    contractType: null,

    // Party A from profile
    yourName: initialProfile?.full_name ?? '',
    yourBusiness: initialProfile?.business_name ?? '',
    yourEntityType: initialProfile?.entity_type ?? '',
    yourBusinessId: initialProfile?.abn ?? initialProfile?.gstin ?? initialProfile?.pan ?? '',
    yourAcn: initialProfile?.acn ?? '',
    yourAddress: derivedAddress,
    yourEmail: initialProfile?.email ?? '',
    yourPhone: initialProfile?.phone ?? '',
    yourSignatoryName: initialProfile?.signatory_name ?? initialProfile?.full_name ?? '',
    yourSignatoryTitle: initialProfile?.signatory_title ?? '',

    // Party B
    clientName: '',
    clientBusiness: '',
    clientEntityType: '',
    clientBusinessId: '',
    clientStreetAddress: '',
    clientCity: '',
    clientState: '',
    clientPostcode: '',
    clientEmail: '',
    clientPhone: '',
    clientSignatoryName: '',
    clientSignatoryTitle: '',

    // Contract metadata
    jurisdiction: initialProfile?.jurisdiction ?? 'NSW',
    effectiveDate: '',
    disputeResolution: 'courts',

    // NDA
    ndaPurpose: '',
    ndaDuration: '2',
    ndaProtecting: '',
    ndaMutual: false,

    // Service Agreement
    projectDescription: '',
    deliverables: '',
    startDate: '',
    endDate: '',
    rateType: 'fixed',
    amount: '',
    paymentTerms: 'net14',
    latePaymentFee: false,
    ipOwner: 'client',
    revisionRounds: '',
    confidentiality: true,
    nonCompete: false,

    // Employment
    roleTitle: '',
    salary: '',
    payFrequency: 'year',
    probationPeriod: '3 months',
    noticePeriod: '2 weeks',

    // Independent Contractor
    projectScope: '',
    expenseReimbursement: false,
  })

  // Sync jurisdiction when country changes
  useEffect(() => {
    setForm((f) => ({ ...f, jurisdiction: defaultJurisdiction(f.country) }))
  }, [form.country])

  // Sync party A from profile when initialProfile changes
  useEffect(() => {
    if (!initialProfile) return
    const addr = [
      initialProfile.street_address,
      initialProfile.city,
      initialProfile.jurisdiction,
      initialProfile.postcode,
    ].filter(Boolean).join(', ') || initialProfile.address || ''
    setForm((f) => ({
      ...f,
      yourName: initialProfile.full_name ?? f.yourName,
      yourBusiness: initialProfile.business_name ?? f.yourBusiness,
      yourEntityType: initialProfile.entity_type ?? f.yourEntityType,
      yourBusinessId: initialProfile.abn ?? initialProfile.gstin ?? initialProfile.pan ?? f.yourBusinessId,
      yourAcn: initialProfile.acn ?? f.yourAcn,
      yourAddress: addr || f.yourAddress,
      yourEmail: initialProfile.email ?? f.yourEmail,
      yourPhone: initialProfile.phone ?? f.yourPhone,
      yourSignatoryName: initialProfile.signatory_name ?? initialProfile.full_name ?? f.yourSignatoryName,
      yourSignatoryTitle: initialProfile.signatory_title ?? f.yourSignatoryTitle,
      country: (initialProfile.country as Country) ?? f.country,
      jurisdiction: initialProfile.jurisdiction ?? f.jurisdiction,
    }))
  }, [initialProfile]) // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit() {
    const prompt = buildPrompt(form)
    onSubmit(prompt)
  }

  const profileIncomplete = !form.yourName || !form.yourAddress

  // ── Step 1 ──
  if (step === 1) {
    return (
      <div className="bg-white border border-[#0C0C0C] shadow-[5px_5px_0_#0C0C0C]">
        <div className="bg-[#0C0C0C] px-5 py-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#D0000A]" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">
            Step 1 of 3 — Contract Type
          </span>
        </div>

        <div className="p-5">
          {/* Country toggle */}
          <div className="mb-5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-2">
              Country
            </label>
            <div className="flex">
              {(['AU', 'IN'] as Country[]).map((c) => (
                <button
                  key={c}
                  onClick={() => set('country', c)}
                  className={`flex-1 py-2.5 text-[12px] font-black uppercase tracking-wider border transition-colors ${
                    form.country === c
                      ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]'
                      : 'bg-white text-[#656565] border-[#DADADA] hover:border-[#0C0C0C]'
                  }`}
                >
                  {c === 'AU' ? '🇦🇺 Australia' : '🇮🇳 India'}
                </button>
              ))}
            </div>
          </div>

          {/* Contract type grid */}
          <div className="mb-5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-2">
              Contract Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CONTRACT_TYPES.map((ct) => (
                <button
                  key={ct.key}
                  onClick={() => set('contractType', ct.key)}
                  className={`text-left p-3 border transition-all ${
                    form.contractType === ct.key
                      ? 'border-[#0C0C0C] bg-[#0C0C0C] text-white shadow-[3px_3px_0_#D0000A]'
                      : 'border-[#DADADA] hover:border-[#0C0C0C] bg-white'
                  }`}
                >
                  <div className={`text-[12px] font-black leading-tight mb-1 ${form.contractType === ct.key ? 'text-white' : 'text-[#0C0C0C]'}`}>
                    {ct.label}
                  </div>
                  <div className={`text-[10px] leading-relaxed mb-2 ${form.contractType === ct.key ? 'text-white/70' : 'text-[#656565]'}`}>
                    {ct.description}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${
                      form.contractType === ct.key
                        ? 'border-white/30 text-white/70 bg-white/10'
                        : COMPLEXITY_COLOURS[ct.complexity]
                    }`}>
                      {ct.complexity}
                    </span>
                    <span className={`text-[9px] ${form.contractType === ct.key ? 'text-white/50' : 'text-[#ADADAD]'}`}>
                      {ct.length}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!form.contractType}
            className="w-full bg-[#D0000A] text-white font-black text-[12px] uppercase tracking-widest py-4 border border-[#0C0C0C] shadow-[3px_3px_0_#0C0C0C] hover:bg-[#A80008] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next — Fill Details →
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2 ──
  if (step === 2) {
    const jurisdictions = form.country === 'AU' ? AU_JURISDICTIONS : IN_JURISDICTIONS
    const bizIdLabel = form.country === 'AU' ? 'ABN' : 'GSTIN / PAN'
    const currency = form.country === 'AU' ? 'AUD' : 'INR'
    const ct = CONTRACT_TYPES.find((x) => x.key === form.contractType)

    return (
      <div className="bg-white border border-[#0C0C0C] shadow-[5px_5px_0_#0C0C0C]">
        <div className="bg-[#0C0C0C] px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#D0000A]" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">
              Step 2 of 3 — {ct?.label}
            </span>
          </div>
          <button
            onClick={() => setStep(1)}
            className="text-white/40 hover:text-white text-[10px] font-bold uppercase tracking-wider"
          >
            ← Back
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[700px] overflow-y-auto">

          {/* ── Party A: Your Details (pre-filled from profile) ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-[#EBEBEB]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565]">Your Details (Party A)</span>
              <Link href="/onboarding" className="text-[10px] text-[#D0000A] font-bold hover:underline">
                Edit Profile →
              </Link>
            </div>

            {profileIncomplete ? (
              <div className="border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-[12px] text-amber-800 font-semibold mb-1">Profile incomplete</p>
                <p className="text-[11px] text-amber-700">Your legal name and address are required for a valid contract.</p>
                <Link href="/onboarding" className="inline-block mt-2 text-[10px] font-black uppercase tracking-wider text-[#D0000A] hover:underline">
                  Complete Profile →
                </Link>
              </div>
            ) : (
              <div className="border border-[#EBEBEB] divide-y divide-[#EBEBEB] bg-[#FAFAFA]">
                <ProfileRow label="Legal Name" value={form.yourBusiness ? `${form.yourBusiness}` : form.yourName} />
                {form.yourBusiness && <ProfileRow label="Represented by" value={`${form.yourSignatoryName}${form.yourSignatoryTitle ? `, ${form.yourSignatoryTitle}` : ''}`} />}
                {form.yourEntityType && <ProfileRow label="Entity Type" value={ENTITY_TYPE_LABELS[form.yourEntityType] ?? form.yourEntityType} />}
                {form.yourBusinessId && <ProfileRow label={bizIdLabel} value={form.yourBusinessId} />}
                {form.yourAcn && <ProfileRow label="ACN" value={form.yourAcn} />}
                <ProfileRow label="Address" value={form.yourAddress} />
                {form.yourEmail && <ProfileRow label="Email" value={form.yourEmail} />}
                {form.yourPhone && <ProfileRow label="Phone" value={form.yourPhone} />}
              </div>
            )}
          </div>

          {/* ── Party B: Other Party ── */}
          <Section label="Other Party (Party B)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Legal Name / Full Name *">
                <input type="text" value={form.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="John Smith" className={inputCls} />
              </Field>
              <Field label="Company / Business Name">
                <input type="text" value={form.clientBusiness} onChange={(e) => set('clientBusiness', e.target.value)} placeholder="Acme Corp Pty Ltd" className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Entity Type">
                <select value={form.clientEntityType} onChange={(e) => set('clientEntityType', e.target.value)} className={inputCls}>
                  <option value="">— Select —</option>
                  <option value="individual">Individual</option>
                  <option value="sole_trader">Sole Trader</option>
                  <option value="company">Company (Pty Ltd / Ltd)</option>
                  <option value="trust">Trust</option>
                  <option value="partnership">Partnership</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label={`${bizIdLabel} / Company No. (optional)`}>
                <input type="text" value={form.clientBusinessId} onChange={(e) => set('clientBusinessId', e.target.value)} placeholder={form.country === 'AU' ? '12 345 678 901' : 'GSTIN or PAN'} className={inputCls} />
              </Field>
            </div>

            <Field label="Street Address *">
              <input type="text" value={form.clientStreetAddress} onChange={(e) => set('clientStreetAddress', e.target.value)} placeholder="100 George Street" className={inputCls} />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="City / Suburb *">
                <input type="text" value={form.clientCity} onChange={(e) => set('clientCity', e.target.value)} placeholder="Melbourne" className={inputCls} />
              </Field>
              <Field label="State / Province">
                <input type="text" value={form.clientState} onChange={(e) => set('clientState', e.target.value)} placeholder="VIC" className={inputCls} />
              </Field>
              <Field label="Postcode">
                <input type="text" value={form.clientPostcode} onChange={(e) => set('clientPostcode', e.target.value)} placeholder="3000" className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Email Address *">
                <input type="email" value={form.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} placeholder="john@acme.com" className={inputCls} />
                <p className="text-[10px] text-[#ADADAD] mt-1">Used to send signing link</p>
              </Field>
              <Field label="Phone (optional)">
                <input type="tel" value={form.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} placeholder="+61 3 xxxx xxxx" className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Signatory Full Name">
                <input type="text" value={form.clientSignatoryName} onChange={(e) => set('clientSignatoryName', e.target.value)} placeholder="Jane Doe" className={inputCls} />
                <p className="text-[10px] text-[#ADADAD] mt-1">Person authorised to sign</p>
              </Field>
              <Field label="Signatory Title / Role">
                <input type="text" value={form.clientSignatoryTitle} onChange={(e) => set('clientSignatoryTitle', e.target.value)} placeholder="CEO / Director" className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* ── Contract Metadata ── */}
          <Section label="Contract Details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Jurisdiction (Governing Law)">
                <select value={form.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} className={inputCls}>
                  {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
                </select>
              </Field>
              <Field label="Effective Date *">
                <input type="date" value={form.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Dispute Resolution">
              <div className="flex gap-2">
                {([
                  ['courts', 'Courts'],
                  ['mediation', 'Mediation'],
                  ['arbitration', 'Arbitration'],
                ] as [DisputeResolution, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => set('disputeResolution', val)}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${form.disputeResolution === val ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#ADADAD] mt-1">
                {form.disputeResolution === 'courts' && 'Disputes resolved in the courts of the governing jurisdiction.'}
                {form.disputeResolution === 'mediation' && 'Mediation first, then arbitration if unresolved.'}
                {form.disputeResolution === 'arbitration' && 'Binding arbitration — faster and private, but no court appeal.'}
              </p>
            </Field>
          </Section>

          {/* NDA fields */}
          {form.contractType === 'nda' && (
            <Section label="NDA Details">
              <Field label="Disclosure Purpose *">
                <input type="text" value={form.ndaPurpose} onChange={(e) => set('ndaPurpose', e.target.value)} placeholder="Evaluating a potential business partnership" className={inputCls} />
              </Field>
              <Field label="What is being protected *">
                <input type="text" value={form.ndaProtecting} onChange={(e) => set('ndaProtecting', e.target.value)} placeholder="Trade secrets, client lists, product roadmap, source code" className={inputCls} />
              </Field>
              <Field label="Duration (years)">
                <input type="number" min="1" max="10" value={form.ndaDuration} onChange={(e) => set('ndaDuration', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Disclosure Type">
                <ToggleRow
                  left="One-way (Party A discloses)"
                  right="Mutual"
                  value={form.ndaMutual}
                  onChange={(v) => set('ndaMutual', v)}
                />
              </Field>
            </Section>
          )}

          {/* Service Agreement / SLA / IP / Vendor / Partnership */}
          {['service_agreement', 'sla', 'ip_assignment', 'vendor_supplier', 'partnership'].includes(form.contractType ?? '') && (
            <Section label="Project / Service Details">
              <Field label="Project / Service Description *">
                <textarea rows={3} value={form.projectDescription} onChange={(e) => set('projectDescription', e.target.value)} placeholder="Describe the work, goods, or services in detail..." className={`${inputCls} resize-none`} />
              </Field>
              {form.contractType === 'service_agreement' && (
                <>
                  <Field label="Key Deliverables">
                    <textarea rows={2} value={form.deliverables} onChange={(e) => set('deliverables', e.target.value)} placeholder="Final designs, source files, 3 rounds of revisions..." className={`${inputCls} resize-none`} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Start Date">
                      <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="End Date">
                      <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                </>
              )}
            </Section>
          )}

          {/* Payment */}
          {['service_agreement', 'sla', 'ip_assignment', 'vendor_supplier', 'partnership', 'independent_contractor'].includes(form.contractType ?? '') && (
            <Section label={`Payment (${currency})`}>
              <Field label="Rate Type">
                <div className="flex gap-2">
                  {(['fixed', 'hourly', 'milestone'] as RateType[]).map((r) => (
                    <button key={r} onClick={() => set('rateType', r)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${form.rateType === r ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={`Amount (${currency})`}>
                <input type="number" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="8500" className={inputCls} />
              </Field>
              {['service_agreement', 'vendor_supplier', 'independent_contractor'].includes(form.contractType ?? '') && (
                <>
                  <Field label="Payment Terms">
                    <div className="flex gap-2">
                      {(['net7', 'net14', 'net30'] as PaymentTerms[]).map((t) => (
                        <button key={t} onClick={() => set('paymentTerms', t)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${form.paymentTerms === t ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}>
                          {t.replace('net', 'Net ')}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Late Payment Fee">
                    <ToggleRow left="No" right="Yes" value={form.latePaymentFee} onChange={(v) => set('latePaymentFee', v)} />
                  </Field>
                </>
              )}
            </Section>
          )}

          {/* Employment fields */}
          {form.contractType === 'employment' && (
            <Section label="Employment Details">
              <Field label="Role / Position Title *">
                <input type="text" value={form.roleTitle} onChange={(e) => set('roleTitle', e.target.value)} placeholder="Senior Designer" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Salary (annual)">
                  <input type="number" value={form.salary} onChange={(e) => set('salary', e.target.value)} placeholder="90000" className={inputCls} />
                </Field>
                <Field label="Pay Frequency">
                  <select value={form.payFrequency} onChange={(e) => set('payFrequency', e.target.value)} className={inputCls}>
                    <option value="year">Annually</option>
                    <option value="month">Monthly</option>
                    <option value="fortnight">Fortnightly</option>
                    <option value="week">Weekly</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Probation Period">
                  <input type="text" value={form.probationPeriod} onChange={(e) => set('probationPeriod', e.target.value)} placeholder="3 months" className={inputCls} />
                </Field>
                <Field label="Notice Period">
                  <input type="text" value={form.noticePeriod} onChange={(e) => set('noticePeriod', e.target.value)} placeholder="2 weeks" className={inputCls} />
                </Field>
              </div>
            </Section>
          )}

          {/* Independent Contractor fields */}
          {form.contractType === 'independent_contractor' && (
            <Section label="Contractor Details">
              <Field label="Project Scope *">
                <textarea rows={3} value={form.projectScope} onChange={(e) => set('projectScope', e.target.value)} placeholder="Describe the ongoing work or project scope in detail..." className={`${inputCls} resize-none`} />
              </Field>
              <Field label="Expense Reimbursement">
                <ToggleRow left="No" right="Yes (pre-approved expenses)" value={form.expenseReimbursement} onChange={(v) => set('expenseReimbursement', v)} />
              </Field>
            </Section>
          )}

          {/* IP & Ownership */}
          {['service_agreement', 'ip_assignment', 'independent_contractor'].includes(form.contractType ?? '') && (
            <Section label="Ownership & IP">
              <Field label="IP Ownership">
                <div className="flex gap-2">
                  {(['you', 'client', 'shared'] as IPOwner[]).map((o) => (
                    <button key={o} onClick={() => set('ipOwner', o)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${form.ipOwner === o ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}>
                      {o === 'you' ? 'You retain' : o === 'client' ? 'Client owns' : 'Shared'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#ADADAD] mt-1">
                  {form.ipOwner === 'you' && 'You retain all IP. Client gets a licence to use the deliverables.'}
                  {form.ipOwner === 'client' && 'Client owns all IP upon full payment. You retain no rights.'}
                  {form.ipOwner === 'shared' && 'Both parties jointly own all IP created under this agreement.'}
                </p>
              </Field>
              {form.contractType === 'service_agreement' && (
                <Field label="Revision Rounds Included">
                  <input type="number" min="0" max="10" value={form.revisionRounds} onChange={(e) => set('revisionRounds', e.target.value)} placeholder="2" className={inputCls} />
                </Field>
              )}
            </Section>
          )}

          {/* Clauses toggles */}
          {['service_agreement', 'sla', 'vendor_supplier', 'employment', 'independent_contractor'].includes(form.contractType ?? '') && (
            <Section label="Additional Clauses">
              {['service_agreement', 'sla', 'vendor_supplier'].includes(form.contractType ?? '') && (
                <Field label="Confidentiality / NDA Clause">
                  <ToggleRow left="Not required" right="Required" value={form.confidentiality} onChange={(v) => set('confidentiality', v)} />
                </Field>
              )}
              <Field label="Non-Compete Clause">
                <ToggleRow left="Not required" right="Required" value={form.nonCompete} onChange={(v) => set('nonCompete', v)} />
              </Field>
            </Section>
          )}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={() => setStep(3)}
            disabled={!form.yourName.trim() || !form.clientName.trim() || !form.clientEmail.trim() || !form.clientStreetAddress.trim() || !form.clientCity.trim()}
            className="w-full bg-[#D0000A] text-white font-black text-[12px] uppercase tracking-widest py-4 border border-[#0C0C0C] shadow-[3px_3px_0_#0C0C0C] hover:bg-[#A80008] disabled:opacity-40 disabled:cursor-not-allowed transition-all mt-2"
          >
            Review & Generate →
          </button>
          {(!form.clientEmail.trim() || !form.clientStreetAddress.trim() || !form.clientCity.trim()) && form.clientName.trim() && (
            <p className="text-[10px] text-[#ADADAD] text-center mt-2">
              Party B email and address are required for a legally complete contract
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Step 3 — Review ──
  const prompt = buildPrompt(form)
  const ct = CONTRACT_TYPES.find((x) => x.key === form.contractType)
  const bizIdLabel = form.country === 'AU' ? 'ABN' : 'GSTIN/PAN'

  return (
    <div className="bg-white border border-[#0C0C0C] shadow-[5px_5px_0_#0C0C0C]">
      <div className="bg-[#0C0C0C] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#D0000A] animate-pulse" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">
            Step 3 of 3 — Review
          </span>
        </div>
        <button onClick={() => setStep(2)} className="text-white/40 hover:text-white text-[10px] font-bold uppercase tracking-wider">
          ← Back
        </button>
      </div>

      <div className="p-5">
        {/* Summary */}
        <div className="divide-y divide-[#EBEBEB] border border-[#EBEBEB] mb-4">
          <div className="px-4 py-2 bg-[#F8F8F8]">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#ADADAD]">Party A (You)</span>
          </div>
          {[
            ['Name', form.yourBusiness || form.yourName],
            form.yourBusiness ? ['Signatory', `${form.yourSignatoryName}${form.yourSignatoryTitle ? `, ${form.yourSignatoryTitle}` : ''}`] : null,
            form.yourBusinessId ? [bizIdLabel, form.yourBusinessId] : null,
            ['Address', form.yourAddress],
            form.yourEmail ? ['Email', form.yourEmail] : null,
          ].filter((r): r is [string, string] => r !== null && !!r[1]).map(([label, value]) => (
            <div key={label} className="px-4 py-2.5 grid grid-cols-[110px_1fr] gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565]">{label}</span>
              <span className="text-[12px] font-semibold text-[#0C0C0C]">{value}</span>
            </div>
          ))}

          <div className="px-4 py-2 bg-[#F8F8F8]">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#ADADAD]">Party B (Other Party)</span>
          </div>
          {[
            ['Name', form.clientBusiness || form.clientName],
            form.clientSignatoryName ? ['Signatory', `${form.clientSignatoryName}${form.clientSignatoryTitle ? `, ${form.clientSignatoryTitle}` : ''}`] : null,
            form.clientBusinessId ? [bizIdLabel, form.clientBusinessId] : null,
            ['Address', [form.clientStreetAddress, form.clientCity, form.clientState, form.clientPostcode].filter(Boolean).join(', ')],
            ['Email', form.clientEmail],
          ].filter((r): r is [string, string] => r !== null && !!r[1]).map(([label, value]) => (
            <div key={label} className="px-4 py-2.5 grid grid-cols-[110px_1fr] gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565]">{label}</span>
              <span className="text-[12px] font-semibold text-[#0C0C0C]">{value}</span>
            </div>
          ))}

          <div className="px-4 py-2 bg-[#F8F8F8]">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#ADADAD]">Contract</span>
          </div>
          {[
            ['Type', ct?.label ?? ''],
            ['Jurisdiction', form.jurisdiction],
            form.effectiveDate ? ['Effective', form.effectiveDate] : null,
            ['Disputes', form.disputeResolution.charAt(0).toUpperCase() + form.disputeResolution.slice(1)],
          ].filter((r): r is [string, string] => r !== null && !!r[1]).map(([label, value]) => (
            <div key={label} className="px-4 py-2.5 grid grid-cols-[110px_1fr] gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565]">{label}</span>
              <span className="text-[12px] font-semibold text-[#0C0C0C]">{value}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={disabled}
          className="w-full bg-[#D0000A] text-white font-black text-[12px] uppercase tracking-widest py-4 border border-[#0C0C0C] shadow-[3px_3px_0_#0C0C0C] hover:bg-[#A80008] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {disabled ? 'Generating...' : 'Generate Contract →'}
        </button>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────
const inputCls =
  'w-full border border-[#DADADA] px-3 py-2.5 text-[13px] text-[#0C0C0C] bg-white outline-none focus:border-[#0C0C0C] transition-colors'

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 grid grid-cols-[100px_1fr] gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#ADADAD]">{label}</span>
      <span className="text-[12px] text-[#0C0C0C]">{value}</span>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#656565] mb-2.5 pb-1.5 border-b border-[#EBEBEB]">
        {label}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-[#656565] block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function ToggleRow({
  left,
  right,
  value,
  onChange,
}: {
  left: string
  right: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onChange(false)}
        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${!value ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}
      >
        {left}
      </button>
      <button
        onClick={() => onChange(true)}
        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${value ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}
      >
        {right}
      </button>
    </div>
  )
}
