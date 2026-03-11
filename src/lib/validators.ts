// ── ABN Validation (Australian Business Number) ─────────────────────────────
// ABN checksum: multiply each digit by a weight, sum, check divisible by 89
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]

export function validateABN(raw: string): boolean {
  const digits = raw.replace(/\s/g, '')
  if (!/^\d{11}$/.test(digits)) return false
  const nums = digits.split('').map(Number)
  nums[0] -= 1
  const sum = nums.reduce((acc, d, i) => acc + d * ABN_WEIGHTS[i], 0)
  return sum % 89 === 0
}

export function formatABN(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)} ${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
}

// ── GSTIN Validation (GST Identification Number) ─────────────────────────────
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export function validateGSTIN(raw: string): boolean {
  return GSTIN_REGEX.test(raw.trim().toUpperCase())
}

// ── PAN Validation (Permanent Account Number) ────────────────────────────────
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/

export function validatePAN(raw: string): boolean {
  return PAN_REGEX.test(raw.trim().toUpperCase())
}
