// src/app/api/contracts/list/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseServer();

    const { data: contracts, error } = await supabase
      .from("contracts")
      .select("id, version_number, label, source, fix_changelog, created_at, content")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch contracts." }, { status: 500 });
    }

    return NextResponse.json({ success: true, contracts });
  } catch (error) {
    console.error("List contracts error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}