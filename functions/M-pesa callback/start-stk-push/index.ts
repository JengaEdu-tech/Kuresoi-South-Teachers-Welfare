// Supabase Edge Function: authenticated STK Push initiation.
// Configure secrets in Supabase Edge Function Secrets; never put them in app.js.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type":"application/json" } });
const env = (k:string) => Deno.env.get(k) || "";

function normalizePhone(raw:string) {
  let p=raw.replace(/[^\d]/g,"");
  if(p.startsWith("0")) p="254"+p.slice(1);
  if(p.startsWith("7")||p.startsWith("1")) p="254"+p;
  if(!/^254[17]\d{8}$/.test(p)) throw new Error("Enter a valid Kenyan Safaricom number, e.g. 0712345678.");
  return p;
}
function timestamp(){const d=new Date();return d.getFullYear()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")+String(d.getHours()).padStart(2,"0")+String(d.getMinutes()).padStart(2,"0")+String(d.getSeconds()).padStart(2,"0")}
async function darajaToken(){
 const key=env("DARAJA_CONSUMER_KEY"),secret=env("DARAJA_CONSUMER_SECRET");
 const auth=btoa(`${key}:${secret}`);
 const base=env("DARAJA_ENV")==="production"?"https://api.safaricom.co.ke":"https://sandbox.safaricom.co.ke";
 const r=await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${auth}`}});
 const j=await r.json();if(!r.ok||!j.access_token)throw new Error("Unable to authenticate with M-Pesa.");return {token:j.access_token,base};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const auth=req.headers.get("Authorization");if(!auth)return json({error:"Sign in required"},401);
  const userClient=createClient(env("SUPABASE_URL"),env("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userErr}=await userClient.auth.getUser();if(userErr||!user)return json({error:"Invalid session"},401);
  const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
  const body=await req.json();const amount=Math.round(Number(body.amount));
  if(!body.fundraiser_id||!body.school_id||!Number.isInteger(amount)||amount<1||amount>150000)return json({error:"Check fundraiser, school and amount."},400);
  const {data:fund,error:fundErr}=await admin.from("fundraisers").select("id,status,default_amount,closes_at").eq("id",body.fundraiser_id).single();
  if(fundErr||fund.status!=="active"||(fund.closes_at&&new Date(fund.closes_at)<new Date()))return json({error:"This fundraiser is not open."},400);
  const {data:school}=await admin.from("schools").select("id,status").eq("id",body.school_id).single();
  if(!school||school.status!=="approved")return json({error:"Choose an approved school."},400);
  const {data:membership}=await admin.from("school_memberships").select("id").eq("school_id",body.school_id).eq("user_id",user.id).eq("membership_status","active").maybeSingle();
  const {data:profile}=await admin.from("profiles").select("school_id").eq("id",user.id).single();
  if(!membership&&profile?.school_id!==body.school_id)return json({error:"Join this school before contributing."},403);
  const phone=normalizePhone(String(body.phone||""));
  const {token,base}=await darajaToken();const shortcode=env("DARAJA_SHORTCODE"),passkey=env("DARAJA_PASSKEY"),ts=timestamp();
  const password=btoa(`${shortcode}${passkey}${ts}`);
  const payload={BusinessShortCode:shortcode,Password:password,Timestamp:ts,TransactionType:env("DARAJA_TRANSACTION_TYPE")||"CustomerPayBillOnline",Amount:amount,PartyA:phone,PartyB:shortcode,PhoneNumber:phone,CallBackURL:env("DARAJA_CALLBACK_URL"),AccountReference:"TEACHER-WELFARE",TransactionDesc:"Welfare contribution"};
  const {data:contribution,error:insertErr}=await admin.from("contributions").insert({fundraiser_id:body.fundraiser_id,school_id:body.school_id,user_id:user.id,amount,phone,public_name_consent:!!body.public_name_consent,payment_status:"pending"}).select("id").single();
  if(insertErr)throw insertErr;
  const response=await fetch(`${base}/mpesa/stkpush/v1/processrequest`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok||result.ResponseCode!=="0"){
    await admin.from("contributions").update({payment_status:"failed",result_description:result.errorMessage||result.ResponseDescription||"STK request failed"}).eq("id",contribution.id);
    return json({error:result.errorMessage||result.ResponseDescription||"M-Pesa request failed."},400);
  }
  await admin.from("contributions").update({checkout_request_id:result.CheckoutRequestID,merchant_request_id:result.MerchantRequestID}).eq("id",contribution.id);
  return json({ok:true,customerMessage:"M-Pesa prompt sent. Enter your M-Pesa PIN to complete payment."});
 }catch(e){return json({error:e instanceof Error?e.message:"Unexpected payment error"},500)}
});
