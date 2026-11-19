
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ========================================= CORS AND RESPONSE HELPERS ========================================= */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });
}

const env = (key: string) => Deno.env.get(key) || "";

function logError(stage: string, error: unknown) {
  console.error(stage, {
    message: error instanceof Error ? error.message : String(error),
  });
}

/* ========================================= PHONE NUMBER NORMALIZATION ========================================= */

function normalizePhone(raw: string) {
  let phone = raw.replace(/[^\d]/g, "");

  if (phone.startsWith("0")) {
    phone = "254" + phone.slice(1);
  } else if (phone.startsWith("7") || phone.startsWith("1")) {
    phone = "254" + phone;
  }

  if (!/^254[17]\d{8}$/.test(phone)) {
    throw new Error(
      "Enter a valid Kenyan mobile number, e.g. 0712345678."
    );
  }

  return phone;
}

/* ========================================= NAIROBI TIMESTAMP ========================================= */

function timestamp() {
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
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
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

/* ========================================= DARAJA CONFIGURATION ========================================= */

function getDarajaConfig() {
  const environment = env("DARAJA_ENV").trim().toLowerCase();

  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("DARAJA_ENV must be sandbox or production.");
  }

  const config = {
    consumerKey: env("DARAJA_CONSUMER_KEY").trim(),
    consumerSecret: env("DARAJA_CONSUMER_SECRET").trim(),
    shortcode: env("DARAJA_SHORTCODE").trim(),
    passkey: env("DARAJA_PASSKEY").trim(),
    callbackUrl: env("DARAJA_CALLBACK_URL")
      .trim()
      .replace(/^["']|["']$/g, ""),
    transactionType:
      env("DARAJA_TRANSACTION_TYPE").trim() ||
      "CustomerPayBillOnline",
    environment,
  };

  const missing = [];

  if (!config.consumerKey) missing.push("DARAJA_CONSUMER_KEY");
  if (!config.consumerSecret) missing.push("DARAJA_CONSUMER_SECRET");
  if (!config.shortcode) missing.push("DARAJA_SHORTCODE");
  if (!config.passkey) missing.push("DARAJA_PASSKEY");
  if (!config.callbackUrl) missing.push("DARAJA_CALLBACK_URL");

  if (missing.length) {
    throw new Error(
      "Missing M-Pesa configuration: " + missing.join(", ")
    );
  }

  /* Validate callback URL */

  let callback: URL;

  try {
    callback = new URL(config.callbackUrl);
  } catch {
    throw new Error(
      "DARAJA_CALLBACK_URL is not a valid URL. Check Supabase Secrets."
    );
  }

  if (
    callback.protocol !== "https:" ||
    callback.hostname !== "saubnyqwfwysldoenfmx.supabase.co" ||
    callback.pathname !== "/functions/v1/mpesa-callback"
  ) {
    throw new Error(
      "DARAJA_CALLBACK_URL must be your public Supabase HTTPS callback URL."
    );
  }

  console.log("STK: Configuration validated", {
    consumerKey: !!config.consumerKey,
    consumerSecret: !!config.consumerSecret,
    shortcode: !!config.shortcode,
    passkey: !!config.passkey,
    callbackUrl: callback.origin + callback.pathname,
    environment,
  });

  return config;
}

/* ========================================= SAFE HTTP RESPONSE READER ========================================= */

async function readResponse(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("Provider returned invalid response", {
      status: response.status,
    });

    throw new Error("Payment provider returned an invalid response.");
  }
}

/* ========================================= DARAJA ACCESS TOKEN ========================================= */

async function darajaToken( config: ReturnType<typeof getDarajaConfig> ) {
  const base =
    config.environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  const credentials = btoa(
    `${config.consumerKey}:${config.consumerSecret}`
  );

  const response = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    }
  );

  const result = await readResponse(response);

  console.log("STK: Daraja authentication", {
    httpStatus: response.status,
    authenticated: !!result.access_token,
    errorCode: result.errorCode || null,
  });

  if (!response.ok || !result.access_token) {
    throw new Error(
      "Unable to authenticate with M-Pesa. Check your Daraja credentials."
    );
  }

  return {
    token: result.access_token as string,
    base,
  };
}

/* ========================================= MAIN EDGE FUNCTION ========================================= */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    console.log("STK: New payment request received");

    /* 1. SUPABASE CONFIGURATION */

    const supabaseUrl = env("SUPABASE_URL");
    const supabaseAnonKey = env("SUPABASE_ANON_KEY");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({
        error: "Server configuration is incomplete.",
      }, 500);
    }

    /* 2. AUTHENTICATE USER */

    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return json({ error: "Please sign in first." }, 401);
    }

    const userClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: { Authorization: authorization },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({
        error: "Invalid or expired session.",
      }, 401);
    }

    /* 3. ADMIN CLIENT */

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    /* 4. READ REQUEST */

    let body: Record<string, unknown>;

    try {
      const parsed = await req.json();

      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return json({ error: "Invalid payment request." }, 400);
      }

      body = parsed;
    } catch {
      return json({ error: "Invalid JSON request." }, 400);
    }

    const rawAmount = Number(body.amount);

    if (
      typeof body.fundraiser_id !== "string" ||
      !body.fundraiser_id ||
      typeof body.school_id !== "string" ||
      !body.school_id ||
      !Number.isSafeInteger(rawAmount) ||
      rawAmount < 1 ||
      rawAmount > 150000
    ) {
      return json({
        error: "Check fundraiser, school and amount. Amount must be between KES 1 and KES 150,000.",
      }, 400);
    }

    const amount = rawAmount;

    let phone: string;

    try {
      phone = normalizePhone(String(body.phone || ""));
    } catch (error) {
      return json({
        error: error instanceof Error
          ? error.message
          : "Invalid phone number.",
      }, 400);
    }

    /* 5. VERIFY FUNDRAISER */

    const { data: fund, error: fundError } = await admin
      .from("fundraisers")
      .select("id,status,default_amount,closes_at")
      .eq("id", body.fundraiser_id)
      .maybeSingle();

    if (fundError) {
      logError("Fundraiser lookup failed", fundError);

      return json({
        error: "Unable to verify fundraiser.",
      }, 500);
    }

    if (
      !fund ||
      fund.status !== "active" ||
      (fund.closes_at && new Date(fund.closes_at) < new Date())
    ) {
      return json({
        error: "This fundraiser is not open.",
      }, 400);
    }

    /* 6. VERIFY SCHOOL */

    const { data: school, error: schoolError } = await admin
      .from("schools")
      .select("id,status")
      .eq("id", body.school_id)
      .maybeSingle();

    if (schoolError) {
      logError("School lookup failed", schoolError);

      return json({
        error: "Unable to verify school.",
      }, 500);
    }

    if (!school || school.status !== "approved") {
      return json({
        error: "Choose an approved school.",
      }, 400);
    }

    /* 7. VERIFY SCHOOL MEMBERSHIP */

    const { data: membership, error: membershipError } = await admin
      .from("school_memberships")
      .select("id")
      .eq("school_id", body.school_id)
      .eq("user_id", user.id)
      .eq("membership_status", "active")
      .maybeSingle();

    if (membershipError) {
      logError("Membership lookup failed", membershipError);

      return json({
        error: "Unable to verify school membership.",
      }, 500);
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("school_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      logError("Profile lookup failed", profileError);

      return json({
        error: "Unable to verify your profile.",
      }, 500);
    }

    if (!membership && profile?.school_id !== body.school_id) {
      return json({
        error: "Join this school before contributing.",
      }, 403);
    }

    /* 8. VALIDATE DARAJA CONFIGURATION */

    let config: ReturnType<typeof getDarajaConfig>;

    try {
      config = getDarajaConfig();
    } catch (error) {
      logError("STK configuration error", error);

      return json({
        error: error instanceof Error
          ? error.message
          : "M-Pesa configuration error.",
      }, 500);
    }

    /* 9. GENERATE ACCESS TOKEN */

    let tokenData: Awaited<ReturnType<typeof darajaToken>>;

    try {
      tokenData = await darajaToken(config);
    } catch (error) {
      logError("Token generation failed", error);

      return json({
        error: error instanceof Error
          ? error.message
          : "M-Pesa authentication failed.",
      }, 502);
    }

    /* 10. CREATE CONTRIBUTION */

    const { data: contribution, error: insertError } = await admin
      .from("contributions")
      .insert({
        fundraiser_id: body.fundraiser_id,
        school_id: body.school_id,
        user_id: user.id,
        amount,
        phone,
        public_name_consent: body.public_name_consent === true,
        payment_status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !contribution) {
      logError("Contribution insertion failed", insertError);

      return json({
        error: "Unable to create contribution record.",
      }, 500);
    }

    const contributionId = contribution.id;

    /* 11. PREPARE STK PUSH */

    const ts = timestamp();

    const password = btoa(
      `${config.shortcode}${config.passkey}${ts}`
    );

    const payload = {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: config.transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: config.callbackUrl,
      AccountReference: "TEACHER-WELFARE",
      TransactionDesc: "Welfare contribution",
    };

    console.log("STK: Sending request to Safaricom", {
      amount,
      environment: config.environment,
      transactionType: config.transactionType,
    });

    /* 12. SEND STK PUSH */

    const response = await fetch(
      `${tokenData.base}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await readResponse(response);

    console.log("STK: Safaricom response", {
      httpStatus: response.status,
      responseCode: result.ResponseCode ?? null,
      responseDescription: result.ResponseDescription ?? null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
    });

    /* 13. HANDLE FAILED PAYMENT REQUEST */

    if (!response.ok || String(result.ResponseCode) !== "0") {
      const failureMessage =
        result.errorMessage ||
        result.ResponseDescription ||
        "M-Pesa rejected the payment request.";

      const { error: updateError } = await admin
        .from("contributions")
        .update({
          payment_status: "failed",
          result_description: String(failureMessage).slice(0, 500),
        })
        .eq("id", contributionId);

      if (updateError) {
        logError("Failed to update contribution", updateError);
      }

      return json({
        error: failureMessage,
        paymentStatus: "failed",
      }, 400);
    }

    /* 14. VERIFY CHECKOUT REFERENCES */

    if (!result.CheckoutRequestID || !result.MerchantRequestID) {
      return json({
        error: "M-Pesa response did not include checkout identifiers.",
      }, 502);
    }

    /* 15. SAVE CHECKOUT REFERENCES */

    const { error: updateError } = await admin
      .from("contributions")
      .update({
        checkout_request_id: result.CheckoutRequestID,
        merchant_request_id: result.MerchantRequestID,
      })
      .eq("id", contributionId);

    if (updateError) {
      logError("Unable to save checkout identifiers", updateError);

      return json({
        error: "Payment prompt may have been sent, but its reference could not be saved. Contact support before retrying.",
      }, 500);
    }

    /* 16. SUCCESS */

    console.log("STK: Payment prompt successfully initiated", {
      contributionId,
      checkoutRequestId: result.CheckoutRequestID,
    });

    return json({
      ok: true,
      contributionId,
      customerMessage:
        "M-Pesa prompt sent. Enter your M-Pesa PIN to complete payment.",
    });

  } catch (error) {
    logError("Unexpected STK function error", error);

    return json({
      error: "An unexpected payment error occurred. Please try again later.",
    }, 500);
  }
});
