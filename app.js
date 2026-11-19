/* Configure these two public values after creating your Supabase project.
   Never put a Supabase secret/service-role key or M-Pesa credentials here. */
const SUPABASE_URL = "https://saubnyqwfwysldoenfmx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TKSsoFuDTJ8cjECixGXlqg_LoI0xXNe";
const configured = !SUPABASE_URL.startsWith("YOUR_") && !SUPABASE_ANON_KEY.startsWith("YOUR_");
const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const $ = (id) => document.getElementById(id);
let authMode = "signin";
let activeFundraiser = null;
let activeContributionId = null;

function toast(message){const el=$("toast");if(!el){console.info(message);return}el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3000)}
function setHTML(id, html){const el=$(id);if(el)el.innerHTML=html;else console.warn("Missing page element:",id)}
function money(n){return "KSh "+Number(n||0).toLocaleString("en-KE")}
function showDialog(id){$(id).showModal()}
function closeDialog(id){$(id).close()}
function setAuthMode(mode){authMode=mode;$("authTitle").textContent=mode==="signup"?"Create teacher account":"Sign in";$("nameWrap").hidden=mode!=="signup";$("authSubmit").textContent=mode==="signup"?"Create account":"Sign in";$("toggleAuth").textContent=mode==="signup"?"Already registered? Sign in":"Create an account";$("password").autocomplete=mode==="signup"?"new-password":"current-password"}

$("authButton").onclick=()=>showDialog("authDialog");
$("signupBtn").onclick=()=>{setAuthMode("signup");showDialog("authDialog")};
$("joinSchoolBtn").onclick=()=>{if(!sb){toast("Connect Supabase first.");return}showDialog("schoolDialog")};
$("toggleAuth").onclick=()=>setAuthMode(authMode==="signup"?"signin":"signup");
$("authForm").addEventListener("submit",async e=>{
 e.preventDefault();if(!sb)return $("authMessage").textContent="Add your Supabase URL and publishable key in app.js first.";
 const email=$("email").value.trim(),password=$("password").value;
 $("authMessage").textContent="Please wait…";
 try{
  if(authMode==="signup"){
   const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:$("fullName").value.trim()}}});if(error)throw error;
   $("authMessage").textContent=data.session?"Account created.":"Check your email to confirm your account, then sign in.";
  }else{const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;closeDialog("authDialog");toast("Signed in successfully.");await loadAll()}
 }catch(err){$("authMessage").textContent=err.message}
});
$("schoolForm").addEventListener("submit",async e=>{
 e.preventDefault();const {data:{user}}=await sb.auth.getUser();if(!user)return $("schoolMessage").textContent="Please sign in first.";
 const {error}=await sb.from("schools").insert({name:$("newSchoolName").value.trim(),county:$("newSchoolCounty").value.trim(),sub_county:$("newSchoolSubcounty").value.trim(),level:$("newSchoolLevel").value,created_by:user.id,status:"approved"});
 $("schoolMessage").textContent=error?error.message:"School added successfully. It is now visible in the school directory.";
 if(!error)e.target.reset();
});
async function loadAll(){if(!sb)return;
 await Promise.all([loadStats(),loadFundraisers(),loadSchools(),loadDirectorySchools()]);
 const {data:{user}}=await sb.auth.getUser();$("authButton").textContent=user?"My account":"Sign in";
}
async function loadStats(){
 const [f,s,c]=await Promise.all([
  sb.from("fundraisers").select("id",{count:"exact",head:true}).eq("status","active"),
  sb.from("schools").select("id",{count:"exact",head:true}).eq("status","approved"),
  sb.from("contributions").select("amount",{head:false}).eq("payment_status","paid")
 ]);
 $("statFundraisers").textContent=f.count??"—";$("statSchools").textContent=s.count??"—";
 $("statTotal").textContent=money((c.data||[]).reduce((a,x)=>a+Number(x.amount||0),0));
}
async function loadFundraisers(){
 const {data,error}=await sb.from("fundraisers").select("id,title,mission,beneficiary_names,target_amount,closes_at,status").eq("status","active").order("created_at",{ascending:false});
 const host=$("fundraiserList");if(!host)return;if(error){host.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
 if(!data?.length){host.innerHTML='<div class="empty">There are no active fundraisers yet.</div>';return}
 host.innerHTML=data.map(f=>`<article class="fund-card"><span class="pill">ACTIVE FUNDRAISER</span><h3>${escapeHtml(f.title)}</h3><p>${escapeHtml(f.beneficiary_names||"Community welfare")}</p><p>${escapeHtml(f.mission||"Support this welfare cause.")}</p><div class="fund-meta"><span>Target ${money(f.target_amount)}</span><span>${f.closes_at?new Date(f.closes_at).toLocaleDateString():"Open-ended"}</span></div><button class="btn btn-primary contribute-btn" data-id="${f.id}" data-title="${escapeAttr(f.title)}">Contribute</button></article>`).join("");
 host.querySelectorAll(".contribute-btn").forEach(b=>b.onclick=()=>openContribution(b.dataset.id,b.dataset.title));
}
async function loadSchools(){
 const q=$("schoolSearch").value.trim();
 let query=sb.from("schools").select("id,name,county,level").eq("status","approved").order("name").limit(100);
 if(q)query=query.ilike("name",`%${q}%`);
 const {data,error}=await query;const host=$("schoolList");if(!host)return;
 if(error){host.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
 host.innerHTML=data?.length?data.map(s=>`<div class="school-item"><div><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.county)} • ${escapeHtml(s.level)}</small></div><div class="school-actions"><button class="btn btn-outline join-school" data-id="${s.id}">Join</button><button class="btn btn-outline remove-school" data-id="${s.id}" data-name="${escapeAttr(s.name)}">Delete</button></div></div>`).join(""):'<div class="empty">No schools found. Add the first school.</div>';
 host.querySelectorAll(".remove-school").forEach(b=>b.onclick=async()=>{
  const {data:{user}}=await sb.auth.getUser();
  if(!user){setAuthMode("signin");showDialog("authDialog");$("authMessage").textContent="Sign in to manage the school directory.";return}
  if(!confirm(`Remove ${b.dataset.name} from the public directory? Historical contributions are preserved.`))return;
  const {error}=await sb.from("schools").update({status:"suspended"}).eq("id",b.dataset.id);
  if(error)toast(error.message);else{toast("School removed from the directory. Historical records are preserved.");await loadAll()}
 });
 host.querySelectorAll(".join-school").forEach(b=>b.onclick=async()=>{
  const {data:{user}}=await sb.auth.getUser();
  if(!user){setAuthMode("signin");showDialog("authDialog");$("authMessage").textContent="Create an account or sign in before joining a school.";return}
  const {data:existing}=await sb.from("school_memberships").select("id,membership_status").eq("school_id",b.dataset.id).eq("user_id",user.id).maybeSingle();
  if(existing?.membership_status==="active"){toast("You are already a member of this school.");return}
  if(existing){toast("A membership record already exists. Contact the central administrator.");return}
  const {error}=await sb.from("school_memberships").insert({school_id:b.dataset.id,user_id:user.id,position_title:"Teacher",membership_status:"active"});
  if(error)toast(error.message);else{toast("You joined the school. You can now help manage its teacher list.");await loadAll()}
 });
}
$("searchSchoolsBtn").onclick=loadSchools;$("schoolSearch").addEventListener("keydown",e=>{if(e.key==="Enter")loadSchools()});
async function openContribution(id,title){
 const {data:{user}}=await sb.auth.getUser();
 if(!user){setAuthMode("signin");showDialog("authDialog");$("authMessage").textContent="Sign in before making a contribution.";return}
 activeFundraiser=id;activeContributionId=null;
 $("contributeDetails").textContent=title;
 $("paymentMessage").textContent="";
 $("checkPaymentBtn").hidden=true;
 $("payContributionBtn").disabled=false;
 const [{data:memberships,error:memberError},{data:profile},{data:fund}] = await Promise.all([
  sb.from("school_memberships").select("school_id,schools(id,name)").eq("user_id",user.id).eq("membership_status","active"),
  sb.from("profiles").select("full_name,phone,school_id").eq("id",user.id).maybeSingle(),
  sb.from("fundraisers").select("default_amount").eq("id",id).single()
 ]);
 if(memberError)return toast("Could not load your school. Please try again.");
 const joined=(memberships||[]).filter(x=>x.schools);
 // Older accounts may have a school_id on the profile without a membership row.
 if(profile?.school_id && !joined.some(x=>x.school_id===profile.school_id)){
  const {data:school}=await sb.from("schools").select("id,name").eq("id",profile.school_id).eq("status","approved").maybeSingle();
  if(school)joined.push({school_id:school.id,schools:school});
 }
 if(!joined.length){
  closeDialog("contributeDialog");
  toast("First join your school: find it under Schools and tap Join. Then come back to contribute.");
  $("schools").scrollIntoView({behavior:"smooth"});
  return;
 }
 $("contributeSchool").innerHTML=joined.map(x=>`<option value="${x.school_id}">${escapeHtml(x.schools.name)}</option>`).join("");
 if(profile?.school_id && joined.some(x=>x.school_id===profile.school_id))$("contributeSchool").value=profile.school_id;
 $("mpesaPhone").value=profile?.phone||"";
 $("contributeAmount").value=fund?.default_amount||200;
 showDialog("contributeDialog");
}

// Suggested amounts simply fill the amount field; teachers can still enter any amount.
document.querySelectorAll(".amount-presets [data-amount]").forEach(button=>{
 button.addEventListener("click",()=>{
  $("contributeAmount").value=button.dataset.amount;
  document.querySelectorAll(".amount-presets button").forEach(x=>x.classList.toggle("selected",x===button));
 });
});

$("contributeAmount").addEventListener("input",()=>document.querySelectorAll(".amount-presets button").forEach(x=>x.classList.remove("selected")));

$("contributeForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const {data:{session}}=await sb.auth.getSession();
 if(!session)return $("paymentMessage").textContent="Please sign in again.";
 const amount=Number($("contributeAmount").value),phone=$("mpesaPhone").value.trim(),school_id=$("contributeSchool").value;
 if(!school_id)return $("paymentMessage").textContent="Choose your school.";
 if(!Number.isInteger(amount)||amount<1||amount>150000)return $("paymentMessage").textContent="Enter an amount between KSh 1 and KSh 150,000.";
 $("paymentMessage").textContent="Sending payment request… Please wait.";
 $("payContributionBtn").disabled=true;
 try{
  const {data,error}=await sb.functions.invoke("start-stk-push",{body:{fundraiser_id:activeFundraiser,school_id,amount,phone,public_name_consent:$("publicConsent").checked}});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  activeContributionId=data?.contributionId||null;
  $("paymentMessage").textContent=data?.customerMessage||"Payment request sent. Check your phone and enter your M-Pesa PIN.";
  $("checkPaymentBtn").hidden=!activeContributionId;
 }catch(err){
  $("paymentMessage").textContent=err.message||"Could not start payment. Please check your details and try again.";
 }finally{$("payContributionBtn").disabled=false;}
});

$("checkPaymentBtn").addEventListener("click",async()=>{
 if(!activeContributionId)return;
 $("paymentMessage").textContent="Checking payment status…";
 const {data:{user}}=await sb.auth.getUser();
 const {data,error}=await sb.from("contributions").select("payment_status,mpesa_receipt_number,paid_at").eq("id",activeContributionId).eq("user_id",user.id).maybeSingle();
 if(error)return $("paymentMessage").textContent="Could not check status. Please try again.";
 if(!data)return $("paymentMessage").textContent="Payment record not found. Contact the welfare team before trying again.";
 if(data.payment_status==="paid"){
  $("paymentMessage").textContent=`Payment confirmed${data.mpesa_receipt_number?". M-Pesa receipt: "+data.mpesa_receipt_number:"."} Thank you for your support.`;
  await loadStats();
 }else if(data.payment_status==="failed"||data.payment_status==="reversed"){
  $("paymentMessage").textContent="M-Pesa did not complete this payment. You can try again or contact the welfare team.";
 }else{
  $("paymentMessage").textContent="Payment is still awaiting M-Pesa confirmation. If you have entered your PIN, wait a little and check again.";
 }
});

async function loadDirectorySchools(){
 const select=$("directorySchool");if(!select)return;
 const {data:{user}}=await sb.auth.getUser();
 if(!user){select.innerHTML='<option value="">Sign in first</option>';return}
 const {data,error}=await sb.from("school_memberships").select("school_id,schools(id,name)").eq("user_id",user.id).eq("membership_status","active");
 if(error){$("directoryMessage").textContent=error.message;return}
 const rows=(data||[]).filter(x=>x.schools);
 select.innerHTML='<option value="">Choose your school</option>'+rows.map(x=>`<option value="${x.school_id}">${escapeHtml(x.schools.name)}</option>`).join("");
}
if($("loadDirectoryBtn"))$("loadDirectoryBtn").onclick=loadTeacherDirectory;
if($("teacherAddForm"))$("teacherAddForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const schoolId=$("directorySchool").value;
 const {data:{user}}=await sb.auth.getUser();
 if(!user)return $("directoryMessage").textContent="Please sign in first.";
 if(!schoolId)return $("directoryMessage").textContent="Choose your school first.";
 const payload={school_id:schoolId,full_name:$("directoryTeacherName").value.trim(),phone:$("directoryTeacherPhone").value.trim()||null,position_title:$("directoryTeacherPosition").value,institution_section:$("directoryTeacherSection").value,added_by:user.id};
 const {error}=await sb.from("school_teachers").insert(payload);
 $("directoryMessage").textContent=error?error.message:"Teacher added to the shared school list.";
 if(!error){e.target.reset();await loadTeacherDirectory()}
});
async function loadTeacherDirectory(){
 const schoolId=$("directorySchool").value;
 if(!schoolId)return $("directoryMessage").textContent="Choose your school first.";
 const {data,error}=await sb.from("school_teachers").select("id,full_name,phone,position_title,institution_section").eq("school_id",schoolId).order("full_name");
 const host=$("teacherDirectoryList");if(!host)return;
 if(error){host.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
 if(!data?.length){host.innerHTML='<div class="empty">No teachers have been added yet. Add the first teacher above.</div>';return}
 host.innerHTML=data.map(t=>`<div class="teacher-row"><div><b>${escapeHtml(t.full_name)}</b><small>${escapeHtml(t.position_title)} • ${escapeHtml(t.institution_section)}${t.phone?' • '+escapeHtml(t.phone):''}</small></div><div class="teacher-actions"><button type="button" data-edit="${t.id}">Edit</button><button type="button" class="remove-teacher" data-remove="${t.id}">Remove</button></div></div>`).join("");
 host.querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{
  const t=data.find(x=>x.id===b.dataset.edit);
  const name=prompt("Edit teacher's full name:",t.full_name);if(name===null)return;
  const phone=prompt("Edit phone number:",t.phone||"");if(phone===null)return;
  const position=prompt("Position:",t.position_title);if(position===null)return;
  const section=prompt("Section (ECDE, Primary, Junior School, Secondary):",t.institution_section);if(section===null)return;
  if(!["ECDE","Primary","Junior School","Secondary"].includes(section))return alert("Choose ECDE, Primary, Junior School or Secondary.");
  const {error}=await sb.from("school_teachers").update({full_name:name.trim(),phone:phone.trim()||null,position_title:position.trim(),institution_section:section}).eq("id",t.id);
  $("directoryMessage").textContent=error?error.message:"Teacher record updated.";
  await loadTeacherDirectory();
 });
 host.querySelectorAll("[data-remove]").forEach(b=>b.onclick=async()=>{
  if(!confirm("Remove this teacher from the school's directory?"))return;
  const {error}=await sb.from("school_teachers").delete().eq("id",b.dataset.remove);
  $("directoryMessage").textContent=error?error.message:"Teacher removed from the school directory.";
  await loadTeacherDirectory();
 });
}

function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escapeAttr(v){return escapeHtml(v)}
if(sb){
 sb.auth.onAuthStateChange((_event,session)=>{if(session)loadAll().catch(err=>{console.error(err);toast(err.message||"Could not load account data.")})});
 loadAll().catch(err=>{console.error(err);toast(err.message||"Could not connect to Supabase.")});
}else{toast("Setup required: connect your Supabase project in app.js.");}
