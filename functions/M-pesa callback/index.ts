// Daraja callback receiver. Configure this function as the CallbackURL.
// Callback endpoints are public; validate the payload shape and only update a matching pending checkout.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const json=(b:unknown)=>new Response(JSON.stringify(b),{headers:{"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({ResultCode:1,ResultDesc:"Method not allowed"});
 try{
  const body=await req.json();const cb=body?.Body?.stkCallback;
  if(!cb?.CheckoutRequestID)return json({ResultCode:0,ResultDesc:"Accepted"});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const resultCode=String(cb.ResultCode);
  const items=cb.CallbackMetadata?.Item||[];
  const val=(name:string)=>items.find((x:any)=>x.Name===name)?.Value;
  const update:any={result_code:resultCode,result_description:cb.ResultDesc||"",payment_status:resultCode==="0"?"paid":"failed"};
  if(resultCode==="0"){update.mpesa_receipt_number=val("MpesaReceiptNumber")||null;update.paid_at=new Date().toISOString()}
  const {error}=await admin.from("contributions").update(update).eq("checkout_request_id",cb.CheckoutRequestID).eq("payment_status","pending");
  if(error)throw error;
  return json({ResultCode:0,ResultDesc:"Accepted"});
 }catch(_){return json({ResultCode:0,ResultDesc:"Received"})}
});
