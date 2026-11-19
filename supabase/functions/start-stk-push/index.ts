import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Supabase secret: ${name}`);
  return value;
}

function normalizePhone(value: string): string {
  let phone = value.replace(/[\s+()-]/g, "");

  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  if (phone.startsWith("7") || phone.startsWith("1")) {
    phone = "254" + phone;
  }

  if (!/^254[71]\d{8}$/.test(phone)) {
    throw new Error("Enter a valid Kenyan M-Pesa phone number.");
  }

  return phone;
}

function getNairobiTimestamp(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const values: Record<string, string> = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return (
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second
  );
}

async function saveTransaction(data: Record<string, unknown>) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const result = await fetch(
    `${supabaseUrl}/rest/v1/mpesa_transactions?on_conflict=checkout_request_id`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(data),
    },
  );

  if (!result.ok) {
    throw new Error(`Transaction database error: ${await result.text()}`);
  }
}

async function handleCallback(body: any) {
  const callback = body?.Body?.stkCallback;

  if (!callback) {
    return response({ error: "Invalid M-Pesa callback." }, 400);
  }

  const items = callback.CallbackMetadata?.Item || [];
  const metadata: Record<string, unknown> = {};

  for (const item of items) {
    metadata[item.Name] = item.Value;
  }

  const successful = Number(callback.ResultCode) === 0;

  try {
    await saveTransaction({
      checkout_request_id: callback.CheckoutRequestID,
      merchant_request_id: callback.MerchantRequestID || null,
      result_code: Number(callback.ResultCode),
      result_description: callback.ResultDesc || "",
      status: successful ? "SUCCESS" : "FAILED",
      mpesa_receipt_number:
        metadata.MpesaReceiptNumber?.toString() || null,
      amount: metadata.Amount ?? null,
      phone_number: metadata.PhoneNumber?.toString() || null,
      transaction_date: metadata.TransactionDate?.toString() || null,
      updated_at: new Date().toISOString(),
    });

    return response({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("Callback saving error:", error);
    return response({ ResultCode: 0, ResultDesc: "Received" });
  }
}

async function verifyUser(req: Request): Promise<boolean> {
  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) return false;

  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");

  const result = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authorization,
    },
  });

  return result.ok;
}

async function initiateSTKPush(req: Request) {
  // Only authenticated school users may initiate payments.
  if (!(await verifyUser(req))) {
    return response(
      { success: false, error: "Please sign in before initiating payment." },
      401,
    );
  }

  const body = await req.json();

  const phone = normalizePhone(String(body.phone || body.phoneNumber || ""));
  const amount = Number(body.amount);

  if (!Number.isSafeInteger(amount) || amount < 1) {
    return response(
      { success: false, error: "Enter a valid payment amount." },
      400,
    );
  }

  const accountReference = String(
    body.accountReference || body.admissionNumber || "SCHOOLFEES",
  ).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);

  const description = String(
    body.transactionDesc || "School Fees",
  ).slice(0, 13);

  const consumerKey = getEnv("MPESA_CONSUMER_KEY");
  const consumerSecret = getEnv("MPESA_CONSUMER_SECRET");
  const shortcode = getEnv("MPESA_SHORTCODE");
  const passkey = getEnv("MPESA_PASSKEY");

  const environment = Deno.env.get("MPESA_ENV") || "sandbox";

  const baseUrl =
    environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  const callbackUrl =
    Deno.env.get("MPESA_CALLBACK_URL") ||
    `${getEnv("SUPABASE_URL")}/functions/v1/start-stk-push`;

  const timestamp = getNairobiTimestamp();

  // Generate Daraja STK password.
  const password = btoa(shortcode + passkey + timestamp);

  // Obtain Daraja access token.
  const tokenResponse = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization:
          "Basic " + btoa(consumerKey + ":" + consumerSecret),
      },
    },
  );

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error("Daraja authentication failed:", tokenData);

    return response(
      { success: false, error: "Could not authenticate with M-Pesa." },
      502,
    );
  }

  // Initiate STK Push.
  const stkResponse = await fetch(
    `${baseUrl}/mpesa/stkpush/v1/processrequest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: description,
      }),
    },
  );

  const stkData = await stkResponse.json();

  if (!stkResponse.ok || stkData.ResponseCode !== "0") {
    console.error("STK Push error:", stkData);

    return response(
      {
        success: false,
        error: stkData.errorMessage ||
          stkData.ResponseDescription ||
          "M-Pesa STK Push failed.",
        details: stkData,
      },
      502,
    );
  }

  // Record the pending payment.
  try {
    await saveTransaction({
      checkout_request_id: stkData.CheckoutRequestID,
      merchant_request_id: stkData.MerchantRequestID,
      phone_number: phone,
      amount,
      account_reference: accountReference,
      result_code: null,
      result_description: "STK Push initiated",
      status: "PENDING",
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Could not save pending transaction:", error);
  }

  return response({
    success: true,
    message: "STK Push sent successfully. Check your phone.",
    checkoutRequestID: stkData.CheckoutRequestID,
    merchantRequestID: stkData.MerchantRequestID,
    customerMessage: stkData.CustomerMessage,
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.clone().json();

    // Safaricom sends callbacks without a Supabase login token.
    if (body?.Body?.stkCallback) {
      return await handleCallback(body);
    }

    return await initiateSTKPush(req);
  } catch (error) {
    console.error("STK Push function error:", error);

    return response(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "An unexpected payment error occurred.",
      },
      500,
    );
  }
});
