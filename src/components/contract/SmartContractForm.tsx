'use client'

import { useState, useEffect } from 'react'

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

  // Common
  yourName: string
  yourBusiness: string
  businessId: string
  clientName: string
  clientBusiness: string
  jurisdiction: string
  effectiveDate: string

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

function defaultJurisdiction(country: Country): string {
  return country === 'AU' ? 'NSW' : 'Maharashtra'
}

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(f: FormData): string {
  const countryName = f.country === 'AU' ? 'Australia' : 'India'
  const currency = f.country === 'AU' ? 'AUD' : 'INR'
  const bizIdLabel = f.country === 'AU' ? 'ABN' : 'GSTIN/PAN'
  const bizId = f.businessId ? `, ${bizIdLabel} ${f.businessId}` : ''
  const yourParty = [f.yourName, f.yourBusiness ? `(${f.yourBusiness})` : '', bizId].filter(Boolean).join(' ')
  const clientParty = [f.clientName, f.clientBusiness ? `(${f.clientBusiness})` : ''].filter(Boolean).join(' ')
  const juris = `${f.jurisdiction}, ${countryName}`

  switch (f.contractType) {
    case 'nda':
      return `Generate an NDA between ${yourParty} and ${clientParty}. Purpose: ${f.ndaPurpose || 'sharing confidential business information'}. Duration: ${f.ndaDuration || '2'} years. Protecting: ${f.ndaProtecting || 'all confidential business information'}. ${f.ndaMutual ? 'This is a mutual NDA.' : 'One-way disclosure from the disclosing party.'} Effective: ${f.effectiveDate || 'the date of signing'}. Jurisdiction: ${juris}.`

    case 'service_agreement':
      return `Generate a Freelance Service Agreement between ${yourParty} (service provider) and ${clientParty} (client). Project: ${f.projectDescription || 'professional services'}. Key deliverables: ${f.deliverables || 'as agreed'}. Duration: ${f.startDate || 'commencement date'} to ${f.endDate || 'project completion'}. Payment: ${currency} ${f.amount || '0'} (${f.rateType}). Payment terms: ${f.paymentTerms?.replace('net', 'Net ')} days. ${f.latePaymentFee ? 'Late payment fee applies.' : ''} IP ownership: ${f.ipOwner === 'you' ? 'service provider retains IP' : f.ipOwner === 'client' ? 'client owns all IP' : 'shared IP'}. ${f.revisionRounds ? `${f.revisionRounds} revision rounds included.` : ''} ${f.confidentiality ? 'Confidentiality clause required.' : ''} ${f.nonCompete ? 'Non-compete clause required.' : ''} Jurisdiction: ${juris}.`

    case 'employment':
      return `Generate a Fixed-Term Employment Agreement between ${yourParty} (employer) and ${clientParty} (employee). Role: ${f.roleTitle || 'employee'}. Salary: ${currency} ${f.salary || '0'} per ${f.payFrequency || 'year'}. Probation period: ${f.probationPeriod || '3 months'}. Notice period: ${f.noticePeriod || '2 weeks'}. ${f.nonCompete ? 'Non-compete clause required.' : ''} Effective: ${f.effectiveDate || 'commencement date'}. Jurisdiction: ${juris}.`

    case 'independent_contractor':
      return `Generate an Independent Contractor Agreement between ${yourParty} (client) and ${clientParty} (contractor). Scope: ${f.projectScope || 'as agreed between the parties'}. Rate: ${currency} ${f.amount || '0'} (${f.rateType}). ${f.expenseReimbursement ? 'Reasonable expense reimbursement included.' : ''} IP ownership: ${f.ipOwner === 'you' ? 'client owns all IP' : f.ipOwner === 'client' ? 'contractor retains IP' : 'shared IP'}. ${f.nonCompete ? 'Non-compete clause required.' : ''} Jurisdiction: ${juris}.`

    case 'sla':
      return `Generate a Service Level Agreement between ${yourParty} (service provider) and ${clientParty} (client). Scope: ${f.projectDescription || 'ongoing services'}. Payment: ${currency} ${f.amount || '0'} (${f.rateType}). ${f.confidentiality ? 'Confidentiality clause required.' : ''} Jurisdiction: ${juris}.`

    case 'ip_assignment':
      return `Generate an IP Assignment Agreement between ${yourParty} (assignor) and ${clientParty} (assignee). Assignment of: ${f.projectDescription || 'all intellectual property created during the engagement'}. Consideration: ${currency} ${f.amount || '0'}. Jurisdiction: ${juris}.`

    case 'vendor_supplier':
      return `Generate a Vendor/Supplier Agreement between ${yourParty} (supplier) and ${clientParty} (buyer). Goods/services: ${f.projectDescription || 'as specified in purchase orders'}. Payment terms: ${f.paymentTerms?.replace('net', 'Net ')} days. ${f.confidentiality ? 'Confidentiality clause required.' : ''} Jurisdiction: ${juris}.`

    case 'partnership':
      return `Generate a Partnership Agreement between ${yourParty} and ${clientParty}. Business purpose: ${f.projectDescription || 'as mutually agreed'}. ${f.amount ? `Initial capital contribution: ${currency} ${f.amount}.` : ''} Jurisdiction: ${juris}.`

    default:
      return `Generate a contract between ${yourParty} and ${clientParty}. Jurisdiction: ${juris}.`
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
interface SmartContractFormProps {
  onSubmit: (prompt: string) => void
  disabled: boolean
  initialProfile?: {
    full_name?: string
    business_name?: string
    country?: string
    abn?: string
    gstin?: string
    pan?: string
    jurisdiction?: string
  } | null
}

export default function SmartContractForm({ onSubmit, disabled, initialProfile }: SmartContractFormProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [form, setForm] = useState<FormData>({
    country: (initialProfile?.country as Country) ?? 'AU',
    contractType: null,
    yourName: initialProfile?.full_name ?? '',
    yourBusiness: initialProfile?.business_name ?? '',
    businessId: initialProfile?.abn ?? initialProfile?.gstin ?? initialProfile?.pan ?? '',
    clientName: '',
    clientBusiness: '',
    jurisdiction: initialProfile?.jurisdiction ?? 'NSW',
    effectiveDate: '',
    ndaPurpose: '',
    ndaDuration: '2',
    ndaProtecting: '',
    ndaMutual: false,
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
    roleTitle: '',
    salary: '',
    payFrequency: 'year',
    probationPeriod: '3 months',
    noticePeriod: '2 weeks',
    projectScope: '',
    expenseReimbursement: false,
  })

  // Sync jurisdiction when country changes
  useEffect(() => {
    setForm((f) => ({ ...f, jurisdiction: defaultJurisdiction(f.country) }))
  }, [form.country])

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit() {
    const prompt = buildPrompt(form)
    onSubmit(prompt)
  }

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

        <div className="p-5 space-y-5 max-h-[600px] overflow-y-auto">
          {/* Your Details */}
          <Section label="Your Details">
            <Field label="Your Full Name">
              <input type="text" value={form.yourName} onChange={(e) => set('yourName', e.target.value)} placeholder="Maya Chen" className={inputCls} />
            </Field>
            <Field label="Your Business Name (optional)">
              <input type="text" value={form.yourBusiness} onChange={(e) => set('yourBusiness', e.target.value)} placeholder="Pixel Studio Pty Ltd" className={inputCls} />
            </Field>
            <Field label={bizIdLabel + ' (optional)'}>
              <input type="text" value={form.businessId} onChange={(e) => set('businessId', e.target.value)} placeholder={form.country === 'AU' ? '12 345 678 901' : 'GSTIN or PAN'} className={inputCls} />
            </Field>
          </Section>

          {/* Client Details */}
          <Section label="Client / Other Party">
            <Field label="Their Name">
              <input type="text" value={form.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="Acme Corp" className={inputCls} />
            </Field>
            <Field label="Their Business Name (optional)">
              <input type="text" value={form.clientBusiness} onChange={(e) => set('clientBusiness', e.target.value)} placeholder="Acme Pty Ltd" className={inputCls} />
            </Field>
          </Section>

          {/* Project / Contract Details */}
          <Section label="Contract Details">
            <Field label="Jurisdiction">
              <select value={form.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} className={inputCls}>
                {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </Field>
            <Field label="Effective Date">
              <input type="date" value={form.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} className={inputCls} />
            </Field>
          </Section>

          {/* NDA fields */}
          {form.contractType === 'nda' && (
            <Section label="NDA Details">
              <Field label="Disclosure Purpose">
                <input type="text" value={form.ndaPurpose} onChange={(e) => set('ndaPurpose', e.target.value)} placeholder="Evaluating a potential business partnership" className={inputCls} />
              </Field>
              <Field label="What is being protected">
                <input type="text" value={form.ndaProtecting} onChange={(e) => set('ndaProtecting', e.target.value)} placeholder="Trade secrets, client lists, product roadmap" className={inputCls} />
              </Field>
              <Field label="Duration (years)">
                <input type="number" min="1" max="10" value={form.ndaDuration} onChange={(e) => set('ndaDuration', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Disclosure Type">
                <ToggleRow
                  left="One-way (you disclose)"
                  right="Mutual"
                  value={form.ndaMutual}
                  onChange={(v) => set('ndaMutual', v)}
                />
              </Field>
            </Section>
          )}

          {/* Service Agreement / SLA / IP / Vendor / Partnership */}
          {['service_agreement', 'sla', 'ip_assignment', 'vendor_supplier', 'partnership'].includes(form.contractType ?? '') && (
            <Section label="Project Details">
              <Field label="Project / Service Description">
                <textarea rows={2} value={form.projectDescription} onChange={(e) => set('projectDescription', e.target.value)} placeholder="Describe the work or services..." className={`${inputCls} resize-none`} />
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
              {['service_agreement', 'vendor_supplier'].includes(form.contractType ?? '') && (
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
              <Field label="Role Title">
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
              <Field label="Project Scope">
                <textarea rows={2} value={form.projectScope} onChange={(e) => set('projectScope', e.target.value)} placeholder="Describe the ongoing work or project scope..." className={`${inputCls} resize-none`} />
              </Field>
              <Field label="Expense Reimbursement">
                <ToggleRow left="No" right="Yes" value={form.expenseReimbursement} onChange={(v) => set('expenseReimbursement', v)} />
              </Field>
            </Section>
          )}

          {/* Ownership & Extras */}
          {['service_agreement', 'ip_assignment', 'independent_contractor'].includes(form.contractType ?? '') && (
            <Section label="Ownership & Extras">
              <Field label="IP Ownership">
                <div className="flex gap-2">
                  {(['you', 'client', 'shared'] as IPOwner[]).map((o) => (
                    <button key={o} onClick={() => set('ipOwner', o)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider border transition-colors ${form.ipOwner === o ? 'bg-[#0C0C0C] text-white border-[#0C0C0C]' : 'border-[#DADADA] text-[#656565] hover:border-[#0C0C0C]'}`}>
                      {o === 'you' ? 'You' : o === 'client' ? 'Client' : 'Shared'}
                    </button>
                  ))}
                </div>
              </Field>
              {form.contractType === 'service_agreement' && (
                <Field label="Revision Rounds">
                  <input type="number" min="0" max="10" value={form.revisionRounds} onChange={(e) => set('revisionRounds', e.target.value)} placeholder="2" className={inputCls} />
                </Field>
              )}
            </Section>
          )}

          {/* Clauses toggles */}
          {['service_agreement', 'sla', 'vendor_supplier', 'employment', 'independent_contractor'].includes(form.contractType ?? '') && (
            <Section label="Clauses">
              {['service_agreement', 'sla', 'vendor_supplier'].includes(form.contractType ?? '') && (
                <Field label="Confidentiality">
                  <ToggleRow left="Not required" right="Required" value={form.confidentiality} onChange={(v) => set('confidentiality', v)} />
                </Field>
              )}
              <Field label="Non-Compete">
                <ToggleRow left="Not required" right="Required" value={form.nonCompete} onChange={(v) => set('nonCompete', v)} />
              </Field>
            </Section>
          )}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={() => setStep(3)}
            disabled={!form.yourName.trim() || !form.clientName.trim()}
            className="w-full bg-[#D0000A] text-white font-black text-[12px] uppercase tracking-widest py-4 border border-[#0C0C0C] shadow-[3px_3px_0_#0C0C0C] hover:bg-[#A80008] disabled:opacity-40 disabled:cursor-not-allowed transition-all mt-2"
          >
            Review & Generate →
          </button>
        </div>
      </div>
    )
  }

  // ── Step 3 — Review ──
  const prompt = buildPrompt(form)
  const ct = CONTRACT_TYPES.find((x) => x.key === form.contractType)

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
          {[
            ['Type', ct?.label ?? ''],
            ['Country', form.country === 'AU' ? '🇦🇺 Australia' : '🇮🇳 India'],
            ['Jurisdiction', form.jurisdiction],
            ['Your Party', [form.yourName, form.yourBusiness].filter(Boolean).join(' / ')],
            ['Other Party', [form.clientName, form.clientBusiness].filter(Boolean).join(' / ')],
            form.effectiveDate ? ['Effective', form.effectiveDate] : null,
            form.businessId ? ['Business ID', form.businessId] : null,
          ]
            .filter((r): r is [string, string] => r !== null && !!r[1])
            .map(([label, value]) => (
              <div key={label} className="px-4 py-2.5 grid grid-cols-[110px_1fr] gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#656565]">{label}</span>
                <span className="text-[12px] font-semibold text-[#0C0C0C]">{value}</span>
              </div>
            ))}
        </div>

        {/* Constructed prompt preview */}
        <div className="bg-[#F8F8F8] border border-[#EBEBEB] px-4 py-3 mb-4">
          <div className="text-[9px] font-bold uppercase tracking-widest text-[#ADADAD] mb-1.5">Prompt</div>
          <p className="text-[11px] text-[#656565] leading-relaxed">{prompt}</p>
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
