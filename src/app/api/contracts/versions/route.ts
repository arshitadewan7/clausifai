// src/app/api/contracts/versions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

const cleanText = (str: string) => str.replace(/\u0000/g, "");

// ── POST — save a new version ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const body = await req.json();
    const {
      contractText,
      originalText,
      title,
      source = "proofread",
      fixChangelog = [],
      contractId,
      userId,
    } = body;

    if (!contractText || typeof contractText !== "string") {
      return NextResponse.json({ error: "contractText is required." }, { status: 400 });
    }

    let resolvedContractId = contractId;

    if (!resolvedContractId) {
      const { data: contract, error: contractError } = await supabase
        .from("contracts")
        .insert({
          prompt: title || "Uploaded contract",
          content: cleanText(originalText || contractText),
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

      if (originalText && originalText !== contractText) {
        await supabase.from("contract_versions").insert({
          contract_id: resolvedContractId,
          version_number: 1,
          label: "Original",
          content: cleanText(originalText),
          source: "uploaded",
          fix_changelog: null,
          is_reviewed: false,
        });
      }
    }

    const { data: latestVersion } = await supabase
      .from("contract_versions")
      .select("version_number")
      .eq("contract_id", resolvedContractId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;

    const { data: version, error: versionError } = await supabase
      .from("contract_versions")
      .insert({
        contract_id: resolvedContractId,
        version_number: nextVersionNumber,
        label: fixChangelog.length > 0
          ? `v${nextVersionNumber} — ${fixChangelog.length} fix${fixChangelog.length !== 1 ? "es" : ""} applied`
          : `v${nextVersionNumber}`,
        content: cleanText(contractText),
        source,
        fix_changelog: fixChangelog.length > 0 ? fixChangelog : null,
        is_reviewed: false,
      })
      .select("id, version_number, label, created_at")
      .single();

    if (versionError || !version) {
      console.error("Failed to save version:", versionError);
      return NextResponse.json({ error: "Failed to save version." }, { status: 500 });
    }

    return NextResponse.json({ success: true, contractId: resolvedContractId, version });
  } catch (error) {
    console.error("Versions API error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

// ── GET — fetch all versions for a contract ───────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get("contractId");

    if (!contractId) {
      return NextResponse.json({ error: "contractId is required." }, { status: 400 });
    }

    const { data: versions, error } = await supabase
      .from("contract_versions")
      .select("id, version_number, label, source, fix_changelog, created_at, content, is_reviewed")
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

// ── PATCH — mark a version as reviewed ───────────────────────────────────
// Body: { versionId, is_reviewed }
export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const { versionId, is_reviewed } = await req.json();

    if (!versionId) {
      return NextResponse.json({ error: "versionId is required." }, { status: 400 });
    }

    const { error } = await supabase
      .from("contract_versions")
      .update({ is_reviewed })
      .eq("id", versionId);

    if (error) {
      return NextResponse.json({ error: "Failed to update version." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Versions PATCH error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}