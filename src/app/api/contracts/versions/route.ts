// src/app/api/contracts/versions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ── POST — save a new version ─────────────────────────────────────────────
// Body: { contractText, title, source, fixChangelog?, contractId? }
// - If contractId is provided, saves a new version on an existing contract
// - If not, creates the contract first (v1 = original, v2 = fixed)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      contractText,       // the fixed contract text
      originalText,       // the original contract text before fixes (only needed when creating new)
      title,              // user-provided name for this contract
      source = "proofread",
      fixChangelog = [],  // array of accepted fixes
      contractId,         // if provided, adds a version to existing contract
      userId,
    } = body;

    if (!contractText || typeof contractText !== "string") {
      return NextResponse.json({ error: "contractText is required." }, { status: 400 });
    }

    let resolvedContractId = contractId;

    if (!resolvedContractId) {
      // Create the contract row first
      const { data: contract, error: contractError } = await supabase
        .from("contracts")
        .insert({
          prompt: title || "Uploaded contract",
          content: originalText || contractText,
          status: "active",
          user_id: userId || null,
        })
        .select("id")
        .single();

      if (contractError || !contract) {
        console.error("Failed to create contract:", contractError);
        return NextResponse.json({ error: "Failed to save contract." }, { status: 500 });
      }

      resolvedContractId = contract.id;

      // Save v1 — the original unedited contract
      if (originalText && originalText !== contractText) {
        await supabase.from("contract_versions").insert({
          contract_id: resolvedContractId,
          version_number: 1,
          label: "Original",
          content: originalText,
          source: "uploaded",
          fix_changelog: null,
        });
      }
    }

    // Get the latest version number for this contract
    const { data: latestVersion } = await supabase
      .from("contract_versions")
      .select("version_number")
      .eq("contract_id", resolvedContractId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;

    // Save the new version
    const { data: version, error: versionError } = await supabase
      .from("contract_versions")
      .insert({
        contract_id: resolvedContractId,
        version_number: nextVersionNumber,
        label: fixChangelog.length > 0
          ? `v${nextVersionNumber} — ${fixChangelog.length} fix${fixChangelog.length !== 1 ? "es" : ""} applied`
          : `v${nextVersionNumber}`,
        content: contractText,
        source,
        fix_changelog: fixChangelog.length > 0 ? fixChangelog : null,
      })
      .select("id, version_number, label, created_at")
      .single();

    if (versionError || !version) {
      console.error("Failed to save version:", versionError);
      return NextResponse.json({ error: "Failed to save version." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      contractId: resolvedContractId,
      version,
    });
  } catch (error) {
    console.error("Versions API error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

// ── GET — fetch all versions for a contract ───────────────────────────────
// Query params: ?contractId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get("contractId");

    if (!contractId) {
      return NextResponse.json({ error: "contractId is required." }, { status: 400 });
    }

    const { data: versions, error } = await supabase
      .from("contract_versions")
      .select("id, version_number, label, source, fix_changelog, created_at")
      .eq("contract_id", contractId)
      .order("version_number", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch versions." }, { status: 500 });
    }

    return NextResponse.json({ success: true, versions });
  } catch (error) {
    console.error("Versions GET error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}