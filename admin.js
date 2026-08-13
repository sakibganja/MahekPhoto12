const $=(s,c=document)=>c.querySelector(s), $$=(s,c=document)=>[...c.querySelectorAll(s)];
const state={csrf:"",admin:null,gallery:[],packages:[],services:[],bookings:[],blockedDates:[],bookingMonth:new Date(),enquiries:[],overview:null};
const api=async(url,options={})=>{
  options = { method: options.method || "GET", credentials: options.credentials ?? "same-origin", ...options };
  options.headers = { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(options.headers||{}) };
  if (state.csrf && !["GET","HEAD"].includes(options.method)) options.headers["X-CSRF-Token"] = state.csrf;
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = response.status === 204 || !text ? {} : JSON.parse(text); }
  catch (e) { data = { __raw: text }; }
  if (!response.ok) {
    const err = (data && (data.error || data.message)) || (typeof data === 'object' && data.__raw) || 'Request failed';
    throw new Error(err);
  }
  return data;
};
const toast=message=>{const el=$(".admin-toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2800)};
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const timeAgo=date=>{const seconds=Math.max(1,(Date.now()-new Date(date+"Z"))/1000);if(seconds<60)return"Just now";if(seconds<3600)return`${Math.floor(seconds/60)}m ago`;if(seconds<86400)return`${Math.floor(seconds/3600)}h ago`;return`${Math.floor(seconds/86400)}d ago`};

function showLogin(message=""){
  state.csrf="";state.admin=null;
  $("#adminShell").hidden=true;
  $("#loginScreen").hidden=false;
  $(".sidebar")?.classList.remove("open");
  const error=$(".login-error");
  if(error) error.textContent=message;
}
async function boot(){
  $("#adminShell").hidden=true;
  $("#loginScreen").hidden=true;
  try{const me=await api("/api/admin/me");state.csrf=me.csrfToken;state.admin=me.admin;showAdmin()}
  catch{showLogin()}
}
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();const button=$("button[type=submit]",e.target),error=$(".login-error");button.disabled=true;error.textContent="";
  try{const data=await api("/api/admin/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.csrf=data.csrfToken;state.admin=data.admin;showAdmin()}
  catch(err){error.textContent=err.message}finally{button.disabled=false}
});
$(".show-pass").onclick=()=>{const input=$('input[name="password"]');input.type=input.type==="password"?"text":"password";$(".show-pass").textContent=input.type==="password"?"Show":"Hide"};

async function showAdmin(){
  $("#loginScreen").hidden=true;$("#adminShell").hidden=false;
  $("#adminName").textContent=state.admin.name;$("#adminInitial").textContent=state.admin.name[0];$("#greetingName").textContent=state.admin.name.split(" ")[0]+".";
  $("#passwordAlert").hidden=!Boolean(state.admin.mustChangePassword||state.admin.must_change_password);
  const hour=new Date().getHours();$("#greeting").textContent=hour<12?"morning":hour<17?"afternoon":"evening";
  $("#todayDate").textContent=new Intl.DateTimeFormat("en-IN",{weekday:"short",day:"2-digit",month:"short",year:"numeric"}).format(new Date()).toUpperCase();
  await loadOverview();
}
async function switchView(view){
  $$(".admin-view").forEach(v=>v.classList.toggle("active",v.id===`${view}View`));
  $$(".sidebar nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $(".sidebar").classList.remove("open");scrollTo(0,0);
  if(view==="overview")await loadOverview();
  if(view==="gallery")await loadGallery();
  if(view==="bookings")await loadBookings();
  if(view==="services")await loadServices();
  if(view==="packages")await loadPackages();
  if(view==="enquiries")await loadEnquiries();
  if(view==="security")await loadSecurity();
  if(view==="settings")await loadSettings();
}
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$("#sideToggle").onclick=()=>$(".sidebar").classList.toggle("open");
$("#logoutBtn").onclick=async()=>{try{await api("/api/admin/logout",{method:"POST"})}finally{showLogin()}};

async function loadOverview(){
  state.overview=await api("/api/admin/overview");const {stats}=state.overview;
  $("#statUniques").textContent=stats.uniques30.toLocaleString("en-IN");$("#statViews").textContent=stats.views30.toLocaleString("en-IN");
  $("#statToday").textContent=stats.viewsToday.toLocaleString("en-IN");$("#statEnquiries").textContent=stats.enquiriesNew;$("#newEnquiryBadge").textContent=stats.enquiriesNew;
  renderChart(state.overview.trend);renderDevices(state.overview.devices);renderRank("#sourceList",state.overview.sources,"source","count");renderRank("#pageList",state.overview.pages,"path","views");
  $("#recentVisits").innerHTML=state.overview.recent.length?state.overview.recent.map(v=>`<tr><td>#${esc(v.visitor)}</td><td>${esc(v.path)}</td><td>${esc(v.device)} · ${esc(v.browser)}</td><td>${esc(v.city?`${v.city}, ${v.country}`:v.country)}</td><td>${esc(v.referrer||"Direct")}</td><td>${timeAgo(v.created_at)}</td></tr>`).join(""):`<tr><td colspan="6">Visits will appear here as people explore your website.</td></tr>`;
}
function renderChart(data){
  const w=760,h=220,pad=22,max=Math.max(1,...data.flatMap(x=>[x.views,x.visitors])),x=i=>pad+i*((w-pad*2)/(data.length-1)),y=v=>h-pad-v*((h-pad*2)/max);
  const pathFor=key=>data.map((d,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const labels=data.map((d,i)=>i%2===0?`<text x="${x(i)}" y="${h+2}" text-anchor="middle">${new Date(d.day+"T00:00").toLocaleDateString("en",{day:"numeric",month:"short"})}</text>`:"").join("");
  const grids=[0,.25,.5,.75,1].map(n=>`<line class="grid" x1="${pad}" y1="${y(max*n)}" x2="${w-pad}" y2="${y(max*n)}"/>`).join("");
  $("#reachChart").innerHTML=`<svg viewBox="0 0 ${w} ${h+10}" preserveAspectRatio="none"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b49358" stop-opacity=".22"/><stop offset="1" stop-color="#b49358" stop-opacity="0"/></linearGradient></defs>${grids}<path class="area" d="${pathFor("visitors")} L${x(data.length-1)},${h-pad} L${pad},${h-pad}Z"/><path class="view-line" d="${pathFor("views")}"/><path class="visitor-line" d="${pathFor("visitors")}"/>${labels}</svg>`;
}
function renderDevices(data){
  const colors=["#b49358","#292824","#d5cec1"],total=data.reduce((n,x)=>n+x.count,0),parts=[];let start=0;
  data.forEach((d,i)=>{const end=start+(d.count/Math.max(1,total))*100;parts.push(`${colors[i%3]} ${start}% ${end}%`);start=end});
  $("#deviceDonut").style.background=`conic-gradient(${parts.length?parts.join(","):"#e4ded4 0 100%"})`;$("#deviceDonut span").firstChild.textContent=total;
  $("#deviceLegend").innerHTML=data.map((d,i)=>`<div><i style="background:${colors[i%3]}"></i>${esc(d.device)} <b>${Math.round(d.count/Math.max(1,total)*100)}%</b></div>`).join("");
}
function renderRank(selector,data,label,value){$(selector).innerHTML=data.length?data.map((x,i)=>`<div class="rank-row"><i>0${i+1}</i><b title="${esc(x[label])}">${esc(x[label])}</b><span>${x[value]}</span></div>`).join(""):`<div class="rank-row"><b>No data yet</b></div>`}

async function loadGallery(){state.gallery=await api("/api/admin/gallery");renderGallery()}
function renderGallery(){
  const search=$("#gallerySearch").value.toLowerCase(),filter=$("#galleryFilter").value;
  const items=state.gallery.filter(x=>(filter==="all"||x.category===filter)&&x.title.toLowerCase().includes(search));
  $("#galleryAdminGrid").innerHTML=items.length?items.map(x=>`<form class="gallery-item gallery-editor" data-gallery-id="${x.id}"><div class="gallery-thumb"><img src="${esc(x.image_url)}" alt=""><span>${esc(x.category)}</span></div><div class="gallery-info"><label>Title<input name="title" value="${esc(x.title)}"></label><label>Location / year<input name="location" value="${esc(x.location)}"></label><label>Category<select name="category"><option value="weddings" ${x.category==="weddings"?"selected":""}>Weddings</option><option value="portraits" ${x.category==="portraits"?"selected":""}>Portraits</option><option value="films" ${x.category==="films"?"selected":""}>Films</option><option value="events" ${x.category==="events"?"selected":""}>Events</option></select></label><label>SEO image description<input name="altText" value="${esc(x.alt_text)}"></label><div class="form-two"><label>Display order<input type="number" name="sortOrder" value="${x.sort_order}"></label><label class="check-label"><input type="checkbox" name="featured" ${x.featured?"checked":""}> Featured</label></div></div><div class="gallery-actions"><button type="submit">Save photo</button><button type="button" data-delete-gallery="${x.id}">Delete</button></div></form>`).join(""):`<div class="empty-state"><h3>No stories found</h3><p>Upload a photograph or change your filters.</p></div>`;
  $$("[data-delete-gallery]").forEach(b=>b.onclick=()=>deleteGallery(b.dataset.deleteGallery));
  $$(".gallery-editor").forEach(form=>form.onsubmit=saveGallery);
}
$("#gallerySearch").oninput=renderGallery;$("#galleryFilter").onchange=renderGallery;
async function deleteGallery(id){if(!confirm("Remove this photograph from the live gallery?"))return;await api(`/api/admin/gallery/${id}`,{method:"DELETE"});toast("Photograph removed");loadGallery()}
async function saveGallery(e){
  e.preventDefault();const form=e.target,data=Object.fromEntries(new FormData(form));data.featured=form.featured.checked;
  await api(`/api/admin/gallery/${form.dataset.galleryId}`,{method:"PUT",body:JSON.stringify(data)});toast("Photograph details updated");loadGallery();
}
$("#openUpload").onclick=()=>$("#uploadOverlay").classList.add("open");$("#closeUpload").onclick=()=>$("#uploadOverlay").classList.remove("open");
$("#uploadOverlay").onclick=e=>{if(e.target===$("#uploadOverlay"))$("#uploadOverlay").classList.remove("open")};
$('input[type="file"]',$("#uploadForm")).onchange=e=>{const file=e.target.files[0];if(file){$(".drop-zone img").src=URL.createObjectURL(file);$(".drop-zone").classList.add("has-image")}};
$("#uploadForm").onsubmit=async e=>{
  e.preventDefault();const data=new FormData(e.target);data.set("featured",data.has("featured")?"true":"false");const button=$("button[type=submit]",e.target);button.disabled=true;
  try{await api("/api/admin/gallery",{method:"POST",body:data});toast("Photograph optimized and published");e.target.reset();$(".drop-zone").classList.remove("has-image");$("#uploadOverlay").classList.remove("open");loadGallery()}
  catch(err){toast(err.message)}finally{button.disabled=false}
};

function monthRange(date){
  const first=new Date(date.getFullYear(),date.getMonth(),1),last=new Date(date.getFullYear(),date.getMonth()+1,0);
  return {from:localYmd(first),to:localYmd(last),first,last};
}
function localYmd(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
async function loadBookings(){
  const {from,to}=monthRange(state.bookingMonth);
  const data=await api(`/api/admin/bookings?from=${from}&to=${to}`);
  state.bookings=data.bookings||[];state.blockedDates=data.blocked||[];
  renderBookingCalendar();renderBookingList();
}
function renderBookingCalendar(){
  const {first,last}=monthRange(state.bookingMonth),today=localYmd(new Date());
  $("#bookingMonthLabel").textContent=first.toLocaleDateString("en-IN",{month:"long",year:"numeric"});
  const startOffset=(first.getDay()+6)%7,cells=[];
  for(let i=0;i<startOffset;i++)cells.push(`<div class="cal-day muted"></div>`);
  for(let day=1;day<=last.getDate();day++){
    const date=localYmd(new Date(first.getFullYear(),first.getMonth(),day));
    const bookings=state.bookings.filter(x=>x.event_date===date),blocked=state.blockedDates.find(x=>x.date===date);
    cells.push(`<button class="cal-day ${date===today?"today":""} ${blocked?"blocked":""} ${bookings.length?"has-booking":""}" data-date="${date}" type="button"><b>${day}</b><span>${blocked?"Blocked":bookings.length?`${bookings.length} booking${bookings.length>1?"s":""}`:"Available"}</span></button>`);
  }
  $("#adminCalendar").innerHTML=cells.join("");
  $$(".cal-day[data-date]").forEach(day=>day.onclick=()=>{$("#bookingSearch").value=day.dataset.date;renderBookingList()});
  $("#blockedDateList").innerHTML=state.blockedDates.length?state.blockedDates.map(x=>`<div class="blocked-row"><span><b>${esc(x.date)}</b><small>${esc(x.reason||"Unavailable")}</small></span><button data-unblock="${esc(x.date)}">Remove</button></div>`).join(""):`<p>No blocked dates this month.</p>`;
  $$("[data-unblock]").forEach(b=>b.onclick=async()=>{await api(`/api/admin/blocked-dates/${b.dataset.unblock}`,{method:"DELETE"});toast("Date reopened");loadBookings()});
}
function renderBookingList(){
  const search=($("#bookingSearch")?.value||"").toLowerCase(),filter=$("#bookingFilter")?.value||"all";
  const items=state.bookings.filter(x=>(filter==="all"||x.status===filter)&&`${x.name} ${x.contact} ${x.service} ${x.event_date} ${x.location}`.toLowerCase().includes(search));
  $("#bookingList").innerHTML=items.length?items.map(x=>`<form class="booking-card" data-booking-id="${x.id}">
    <div class="booking-card-head"><span class="status-pill ${esc(x.status)}">${esc(x.status)}</span><strong>${esc(x.name)}</strong><a href="${x.contact.includes("@")?`mailto:${esc(x.contact)}`:`tel:${esc(x.contact)}`}">${esc(x.contact)}</a></div>
    <div class="booking-fields">
      <label>Service<input value="${esc(x.service)}" disabled></label>
      <label>Date<input type="date" name="eventDate" value="${esc(x.event_date)}" required></label>
      <label>Time<input type="time" name="eventTime" value="${esc(x.event_time)}"></label>
      <label>Status<select name="status"><option value="pending" ${x.status==="pending"?"selected":""}>Pending</option><option value="confirmed" ${x.status==="confirmed"?"selected":""}>Confirmed</option><option value="completed" ${x.status==="completed"?"selected":""}>Completed</option><option value="cancelled" ${x.status==="cancelled"?"selected":""}>Cancelled</option></select></label>
      <label>Duration<input name="duration" value="${esc(x.duration)}"></label>
      <label>Budget<input name="budget" value="${esc(x.budget)}"></label>
      <label class="wide">Location<input name="location" value="${esc(x.location)}"></label>
      <label class="wide">Admin note<textarea name="adminNote" rows="2">${esc(x.admin_note)}</textarea></label>
    </div>
    <p>${esc(x.message||"No extra message.")}</p>
    <button class="gold-btn compact" type="submit">Save booking</button>
  </form>`).join(""):`<div class="empty-state"><h3>No bookings found</h3><p>New booking requests from the website will appear here.</p></div>`;
  $$(".booking-card").forEach(form=>form.onsubmit=saveBooking);
}
async function saveBooking(e){
  e.preventDefault();
  const form=e.target,button=$("button[type=submit]",form),data=Object.fromEntries(new FormData(form));
  button.disabled=true;
  try{await api(`/api/admin/bookings/${form.dataset.bookingId}`,{method:"PUT",body:JSON.stringify(data)});$("#bookingSaveState").textContent="Booking updated ✓";toast("Booking updated");setTimeout(()=>$("#bookingSaveState").textContent="",2500);await loadBookings()}
  catch(err){toast(err.message)}finally{button.disabled=false}
}
$("#prevBookingMonth").onclick=()=>{state.bookingMonth=new Date(state.bookingMonth.getFullYear(),state.bookingMonth.getMonth()-1,1);loadBookings()};
$("#nextBookingMonth").onclick=()=>{state.bookingMonth=new Date(state.bookingMonth.getFullYear(),state.bookingMonth.getMonth()+1,1);loadBookings()};
$("#bookingSearch").oninput=renderBookingList;$("#bookingFilter").onchange=renderBookingList;
$("#blockDateForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/blocked-dates",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast("Date blocked");e.target.reset();loadBookings()}catch(err){toast(err.message)}};

async function loadPackages(){state.packages=await api("/api/admin/packages");$("#packageAdminGrid").innerHTML=state.packages.map(x=>`<form class="package-editor ${x.featured?"featured":""}" data-package="${x.id}"><label>Collection label<input name="label" value="${esc(x.label)}"></label><label>Package name<input name="name" value="${esc(x.name)}"></label><label>Description<textarea name="description" rows="4">${esc(x.description)}</textarea></label><label>Price shown publicly<input name="price" value="${esc(x.price)}"></label><label>Display order<input name="sortOrder" type="number" value="${x.sort_order}"></label><div class="editor-checks"><label><input type="checkbox" name="featured" ${x.featured?"checked":""}> Featured</label><label><input type="checkbox" name="active" ${x.active?"checked":""}> Visible</label></div><button class="gold-btn compact" type="submit">Save package</button></form>`).join("");$$(".package-editor").forEach(form=>form.onsubmit=savePackage)}
async function savePackage(e){e.preventDefault();const form=e.target,data=Object.fromEntries(new FormData(form));data.featured=form.featured.checked;data.active=form.active.checked;await api(`/api/admin/packages/${form.dataset.package}`,{method:"PUT",body:JSON.stringify(data)});$("#packageSaveState").textContent="Changes published ✓";toast("Package updated on live website");setTimeout(()=>$("#packageSaveState").textContent="",2500)}

async function loadServices(){
  state.services=await api("/api/admin/services");
  renderAdminServices();
}
function renderAdminServices(){
  const search=($("#serviceSearch")?.value||"").toLowerCase();
  const filter=$("#serviceAdminFilter")?.value||"all";
  const categories=["Photography","Films","Editing","Photo Printing","Documents"];
  const items=state.services.filter(x=>(filter==="all"||x.category===filter)&&`${x.name} ${x.description} ${x.price}`.toLowerCase().includes(search));
  $("#serviceAdminList").innerHTML=items.length?items.map(x=>`<form class="service-editor" data-service-id="${x.id}">
    <div class="service-editor-head"><span>${esc(x.category)}</span><label><input type="checkbox" name="active" ${x.active?"checked":""}> Visible</label></div>
    <div class="service-editor-fields">
      <label>Service name<input name="name" value="${esc(x.name)}" required></label>
      <label>Category<select name="category">${categories.map(c=>`<option ${x.category===c?"selected":""}>${c}</option>`).join("")}</select></label>
      <label class="wide">Description<textarea name="description" rows="2" required>${esc(x.description)}</textarea></label>
      <label class="wide">Inclusions <small>(one per line)</small><textarea name="features" rows="4">${esc((x.features||[]).join("\n"))}</textarea></label>
      <label>Price<input name="price" value="${esc(x.price)}" required></label>
      <label>Display order<input type="number" name="sortOrder" value="${x.sort_order}"></label>
    </div>
    <button class="dark-btn" type="submit">Save service</button>
  </form>`).join(""):`<div class="empty-state"><h3>No services found</h3><p>Try another search or category.</p></div>`;
  $$(".service-editor").forEach(form=>form.onsubmit=saveService);
}
async function saveService(e){
  e.preventDefault();
  const form=e.target,data=Object.fromEntries(new FormData(form));
  data.active=form.active.checked;
  data.features=String(data.features||"").split("\n").map(x=>x.trim()).filter(Boolean);
  const button=$("button[type=submit]",form);button.disabled=true;
  try{
    await api(`/api/admin/services/${form.dataset.serviceId}`,{method:"PUT",body:JSON.stringify(data)});
    $("#serviceSaveState").textContent="Service published ✓";
    toast("Service updated on live website");
    setTimeout(()=>$("#serviceSaveState").textContent="",2500);
    await loadServices();
  }catch(err){toast(err.message)}finally{button.disabled=false}
}
$("#serviceSearch").oninput=renderAdminServices;
$("#serviceAdminFilter").onchange=renderAdminServices;

let enquiryFilter="all";
async function loadEnquiries(){state.enquiries=await api("/api/admin/enquiries");renderEnquiries()}
function renderEnquiries(){
  const items=state.enquiries.filter(x=>enquiryFilter==="all"||x.status===enquiryFilter);
  $("#enquiryList").innerHTML=items.length?items.map(x=>`<article class="enquiry-card"><div><h3>${esc(x.name)}</h3><small>${new Date(x.created_at+"Z").toLocaleString("en-IN")}</small></div><div><a href="${x.contact.includes("@")?`mailto:${esc(x.contact)}`:`tel:${esc(x.contact)}`}">${esc(x.contact)}</a><p>${esc(x.service)}${x.event_date?` · ${esc(x.event_date)}`:""}</p></div><p>${esc(x.message||"No additional message.")}</p><select data-enquiry="${x.id}"><option value="new" ${x.status==="new"?"selected":""}>New</option><option value="contacted" ${x.status==="contacted"?"selected":""}>Contacted</option><option value="booked" ${x.status==="booked"?"selected":""}>Booked</option><option value="closed" ${x.status==="closed"?"selected":""}>Closed</option></select></article>`).join(""):`<div class="empty-state"><h3>No enquiries here</h3><p>New website enquiries will appear automatically.</p></div>`;
  $$("[data-enquiry]").forEach(s=>s.onchange=async()=>{await api(`/api/admin/enquiries/${s.dataset.enquiry}/status`,{method:"PUT",body:JSON.stringify({status:s.value})});toast("Enquiry status updated");loadEnquiries();loadOverview()});
}
$$(".enquiry-tabs button").forEach(b=>b.onclick=()=>{$$(".enquiry-tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");enquiryFilter=b.dataset.status;renderEnquiries()});

async function loadSettings(){const data=await api("/api/admin/settings");Object.entries(data).forEach(([key,value])=>{const el=$(`[name="${key}"]`,$("#studioForm"));if(el)el.value=value})}
async function loadSecurity(){
  const data=await api("/api/admin/security");
  $("#adminSessionList").innerHTML=(data.sessions||[]).length?(data.sessions||[]).map(x=>`<div class="security-row"><b>Admin session</b><span>Started ${timeAgo(x.created_at)} · Expires ${new Date(x.expires_at+"Z").toLocaleString("en-IN")}</span></div>`).join(""):`<div class="security-row"><b>No active session found</b><span>Sign in again if this looks wrong.</span></div>`;
  $("#securityEventList").innerHTML=(data.events||[]).length?(data.events||[]).map(x=>`<div class="security-row ${x.type.includes("failed")?"danger":""}"><b>${esc(x.type.replaceAll("_"," "))}</b><span>${esc(x.actor||"System")} · ${esc(x.detail||"")} · ${timeAgo(x.created_at)}</span></div>`).join(""):`<div class="security-row"><b>No events yet</b><span>Login activity will appear here.</span></div>`;
}
$("#studioForm").onsubmit=async e=>{e.preventDefault();await api("/api/admin/settings",{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast("Studio details published")};
$("#passwordForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/password",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.admin.mustChangePassword=false;$("#passwordAlert").hidden=true;e.target.reset();toast("Password changed securely")}catch(err){toast(err.message)}};
boot();
