// Daraja callback receiver. Configure this function as the CallbackURL.
// Callback endpoints are public; validate the payload shape and only update a matching pending checkout.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({
      ResultCode: 1,
      ResultDesc: "Method not allowed",
    });
  }

  try {
    const body = await req.json();
    const callback = body?.Body?.stkCallback;

    // Confirm that this is an STK callback.
    if (
      !callback ||
      typeof callback.CheckoutRequestID !== "string" ||
      callback.CheckoutRequestID.trim() === "" ||
      callback.ResultCode === undefined ||
      callback.ResultCode === null
    ) {
      console.warn("Invalid or incomplete M-Pesa callback received.");

      return json({
        ResultCode: 0,
        ResultDesc: "Callback received",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase server configuration.");
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const checkoutId = callback.CheckoutRequestID.trim();
    const resultCode = String(callback.ResultCode);

    const items = Array.isArray(callback.CallbackMetadata?.Item)
      ? callback.CallbackMetadata.Item
      : [];

    const getValue = (name: string) =>
      items.find(
        (item: { Name?: string }) => item?.Name === name
      )?.Value;

    const update: Record<string, unknown> = {
      result_code: resultCode,
      result_description:
        typeof callback.ResultDesc === "string"
          ? callback.ResultDesc
          : "",
      payment_status: resultCode === "0" ? "paid" : "failed",
    };

    // Save receipt details only for successful payments.
    if (resultCode === "0") {
      const receipt = getValue("MpesaReceiptNumber");

      if (typeof receipt === "string" && receipt.trim() !== "") {
        update.mpesa_receipt_number = receipt.trim();
      }

      update.paid_at = new Date().toISOString();

      const amount = getValue("Amount");
      if (typeof amount === "number" && Number.isFinite(amount)) {
        update.amount_paid = amount;
      }

      const phone = getValue("PhoneNumber");
      if (typeof phone === "number" || typeof phone === "string") {
        update.mpesa_phone = String(phone);
      }
    }

    // Only update a contribution that matches this checkout
    // and is still pending.
    const { data, error } = await admin
      .from("contributions")
      .update(update)
      .eq("checkout_request_id", checkoutId)
      .eq("payment_status", "pending")
      .select("checkout_request_id")
      .maybeSingle();

    if (error) {
      console.error("Contribution update failed:", error.message);
      throw error;
    }

    if (!data) {
      console.warn(
        "No pending contribution matched checkout:",
        checkoutId
      );
    } else {
      console.log("M-Pesa callback processed:", checkoutId);
    }

    return json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (error) {
    console.error("M-Pesa callback error:", error);

    // Acknowledge receipt to avoid unnecessary callback retries.
    return json({
      ResultCode: 0,
      ResultDesc: "Received",
    });
  }
});
