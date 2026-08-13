const qs=(s,c=document)=>c.querySelector(s),qsa=(s,c=document)=>[...c.querySelectorAll(s)];
let contentLoaded=false,customer=null,customerCsrf="",favoriteIds=[];

window.addEventListener("load",()=>setTimeout(()=>qs(".loader").classList.add("done"),1800));
const nav=qs(".nav"),topBtn=qs(".back-top");
window.addEventListener("scroll",()=>{nav.classList.toggle("scrolled",scrollY>40);topBtn.classList.toggle("show",scrollY>700)},{passive:true});
topBtn.onclick=()=>scrollTo({top:0,behavior:"smooth"});

const menu=qs(".mobile-menu");
qs(".menu-toggle").onclick=()=>menu.classList.add("open");
qs(".menu-close").onclick=()=>menu.classList.remove("open");
qsa("a",menu).forEach(a=>a.onclick=()=>menu.classList.remove("open"));

const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");observer.unobserve(e.target)}}),{threshold:.12});
const observeReveals=()=>qsa(".reveal:not(.visible)").forEach(el=>observer.observe(el));
observeReveals();

function bindPortfolio(){
  qsa(".filters button").forEach(btn=>btn.onclick=()=>{
    qsa(".filters button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");
    qsa(".work-card").forEach(card=>card.classList.toggle("hidden",btn.dataset.filter!=="all"&&!card.dataset.category.includes(btn.dataset.filter)));
  });
  const lightbox=qs(".lightbox");
  qsa(".work-card").forEach(card=>card.onclick=e=>{
    if(e.target.closest(".favorite-work"))return;
    qs("img",lightbox).src=card.dataset.image;qs("p",lightbox).textContent=qs(".work-meta span",card).textContent;
    lightbox.classList.add("open");lightbox.setAttribute("aria-hidden","false");
  });
  qsa(".favorite-work").forEach(button=>button.onclick=()=>toggleFavorite(button));
}
bindPortfolio();
qs(".lightbox-close").onclick=()=>qs(".lightbox").classList.remove("open");
qs(".lightbox").onclick=e=>{if(e.target===qs(".lightbox"))qs(".lightbox").classList.remove("open")};

qsa(".timeline li").forEach(li=>li.onclick=()=>{qsa(".timeline li").forEach(x=>x.classList.remove("active"));li.classList.add("active")});
const modal=qs("#serviceModal");
qsa(".service-list button").forEach(btn=>btn.onclick=()=>{qs("h2",modal).textContent=btn.dataset.service;qs("p",modal).textContent=btn.dataset.desc;modal.classList.add("open")});
qs(".modal-close").onclick=()=>modal.classList.remove("open");qs("a",modal).onclick=()=>modal.classList.remove("open");
modal.onclick=e=>{if(e.target===modal)modal.classList.remove("open")};

qs(".theme-toggle").onclick=()=>document.body.classList.toggle("light");
let soundOn=false,audioContext;
qs(".sound-toggle").onclick=()=>{
  soundOn=!soundOn;qs(".sound-toggle span").textContent=soundOn?"♫":"♪";
  if(soundOn){audioContext??=new(window.AudioContext||window.webkitAudioContext)();const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.frequency.value=220;gain.gain.setValueAtTime(.035,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.8);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.8)}
};
const showToast=message=>{const toast=qs(".toast");toast.textContent=message;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),4000)};

async function apiFetch(url, options={}){
  options = { method: options.method || 'GET', credentials: options.credentials ?? 'same-origin', ...options };
  options.headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers||{}) };
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = response.status === 204 || !text ? {} : JSON.parse(text); }
  catch (e) { data = { __raw: text }; }
  if (!response.ok) throw new Error((data && (data.error || data.message)) || (data && data.__raw) || 'Request failed');
  return data;
}

async function loadManagedContent(){
  try{
    const {gallery,packages,services,settings,authenticated} = await apiFetch("/api/content");
    if(gallery?.length){
      qs(".masonry").innerHTML=gallery.map((item,index)=>`<article class="work-card ${index%3===0?"tall":"wide"} reveal" data-category="${safe(item.category)}" data-image="${safe(item.image_url)}"><img src="${safe(item.image_url)}" alt="${safe(item.alt_text||item.title)}" loading="lazy"><div class="work-meta"><span>${safe(item.title).toUpperCase()}</span><small>${safe(item.location)}</small></div><button class="favorite-work ${favoriteIds.includes(item.id)?"saved":""}" data-gallery-id="${item.id}" aria-label="Save photograph">${favoriteIds.includes(item.id)?"♥":"♡"}</button><button class="view-work" aria-label="View image">↗</button></article>`).join("");
      bindPortfolio();observeReveals();
    }
    if(packages?.length){
      qs(".package-grid").innerHTML=packages.map(item=>`<article class="${item.featured?"featured":""} reveal">${item.featured?"<div>MOST LOVED</div>":""}<small>${safe(item.label)}</small><h3>${safe(item.name)}</h3><p>${safe(item.description)}</p><b>${item.price_locked?"Members see complete pricing":safe(item.price)}</b>${item.price_locked?'<button class="package-unlock">Sign in to explore →</button>':'<a href="#booking">Start an enquiry →</a>'}</article>`).join("");
      observeReveals();
    }
    if(services?.length)renderServices(services);
    qs("#bookingLock").classList.toggle("unlocked",authenticated);
    qsa(".package-unlock").forEach(button=>button.onclick=openAccount);
    if(settings){
      if(settings.hero_title){const words=settings.hero_title.trim().split(" ");const last=words.pop();qs(".split-title").innerHTML=`<span>${safe(words.slice(0,2).join(" "))}</span><span>${safe(words.slice(2).join(" "))} <em>${safe(last)}</em></span>`}
      if(settings.hero_subtitle)qs(".hero-sub").textContent=settings.hero_subtitle;
      qsa(".contact-details span")[0].textContent=settings.email||"";
      qsa(".contact-details span")[1].textContent=settings.phone||"";
    }
    contentLoaded=true;
  }catch(error){console.warn("Managed content unavailable; showing cached website content.", error)}
}
let allServices=[];
function renderServices(services,filter="all"){
  allServices=services;
  const visible=filter==="all"?services:services.filter(item=>item.category===filter);
  qs("#serviceCatalog").innerHTML=visible.map((item,index)=>`<article class="service-card reveal"><div class="service-number">${String(index+1).padStart(2,"0")}</div><small>${safe(item.category)}</small><h3>${safe(item.name)}</h3><p>${safe(item.description)}</p><ul>${item.features.map(feature=>`<li>${safe(feature)}</li>`).join("")}</ul><div class="service-card-foot"><b>${safe(item.price)}</b><button data-service="${safe(item.name)}" data-desc="${safe(item.description)}">Enquire ↗</button></div></article>`).join("");
  qsa(".service-card button").forEach(button=>button.onclick=()=>{qs("h2",modal).textContent=button.dataset.service;qs("p",modal).textContent=button.dataset.desc;modal.classList.add("open")});
  observeReveals();
}
qsa("[data-service-filter]").forEach(button=>button.onclick=()=>{
  qsa("[data-service-filter]").forEach(x=>x.classList.toggle("active",x===button));
  renderServices(allServices,button.dataset.serviceFilter);
});
function safe(value){const el=document.createElement("div");el.textContent=String(value??"");return el.innerHTML}
async function bootCustomer(){
  try{const data = await apiFetch("/api/account/me");customer=data.customer;customerCsrf=data.csrfToken;favoriteIds=data.favorites||[];renderCustomer(data)}
  catch{customer=null;customerCsrf="";favoriteIds=[]}
  await loadManagedContent();
}
bootCustomer();

async function loadAvailabilityForDate(date){
  const box=qs("#availabilityList"); if(!box||!date)return;
  box.textContent="Checking calendar...";
  try{
    const data = await apiFetch(`/api/availability?from=${date}&to=${date}`);
    const blocked=(data.blocked||[]).find(x=>x.date===date);
    if(blocked){box.innerHTML=`<b class="slot-busy">Unavailable</b><span>${safe(blocked.reason||"This date is blocked by the studio.")}</span>`;return}
    const taken=new Set((data.bookings||[]).filter(x=>x.event_date===date).map(x=>x.event_time));
    const slots=["09:00","11:00","13:00","15:00","17:00","19:00"];
    box.innerHTML=slots.map(slot=>`<button type="button" class="${taken.has(slot)?"busy":"free"}" data-slot="${slot}" ${taken.has(slot)?"disabled":""}>${slot} ${taken.has(slot)?"Booked":"Available"}</button>`).join("");
    qsa("[data-slot]",box).forEach(button=>button.onclick=()=>{qs('#bookingForm [name="time"]').value=button.dataset.slot;qsa("[data-slot]",box).forEach(x=>x.classList.remove("picked"));button.classList.add("picked")});
  }catch{box.textContent="Availability could not be loaded. You can still send a request."}
}
qs('#bookingForm [name="date"]').onchange=e=>loadAvailabilityForDate(e.target.value);
qs("#bookingForm").onsubmit=async e=>{
  e.preventDefault();const button=qs('button[type="submit"]',e.target);button.disabled=true;
  try{await apiFetch("/api/enquiries",{method:"POST",headers:{"X-CSRF-Token":customerCsrf},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});showToast("Your booking request is now in the studio calendar.");e.target.reset();qs("#availabilityList").textContent="Select a date to check available slots.";await refreshCustomer()}
  catch(error){showToast(error.message||"We could not send your enquiry. Please try WhatsApp.")}finally{button.disabled=false}
};
qs(".newsletter form").onsubmit=async e=>{
  e.preventDefault();const email=qs("input",e.target).value;
  try{await apiFetch("/api/subscribe",{method:"POST",body:JSON.stringify({email})});showToast("Welcome to the Mahek Letter.");e.target.reset()}catch(error){showToast(error.message)};
};
qs(".floating-whatsapp").onclick=()=>window.open("https://wa.me/919904488899?text=Hello%20Mahek%20Photo%2C%20I%27d%20like%20to%20plan%20a%20shoot.","_blank","noopener");
qs("#showMore").onclick=()=>showToast("You are viewing our complete published collection.");
document.addEventListener("keydown",e=>{if(e.key==="Escape"){modal.classList.remove("open");qs(".lightbox").classList.remove("open");menu.classList.remove("open")}});
window.addEventListener("scroll",()=>{const hero=qs(".hero-media");if(scrollY<innerHeight)hero.style.transform=`translateY(${scrollY*.16}px) scale(1.01)`},{passive:true});

function id(key){let value=localStorage.getItem(key);if(!value){value=crypto.randomUUID();localStorage.setItem(key,value)}return value}
const visitorId=id("mahek_visitor_id"),sessionKey="mahek_session_id";
let sessionId=sessionStorage.getItem(sessionKey);if(!sessionId){sessionId=crypto.randomUUID();sessionStorage.setItem(sessionKey,sessionId)}
apiFetch("/api/track",{method:"POST",body:JSON.stringify({visitorId,sessionId,path:location.pathname+location.hash,referrer:document.referrer})}).catch(()=>{});

const accountModal=qs("#accountModal");
function openAccount(){accountModal.classList.add("open");accountModal.setAttribute("aria-hidden","false");menu.classList.remove("open")}
function closeAccount(){accountModal.classList.remove("open");accountModal.setAttribute("aria-hidden","true")}
qs(".profile-button").onclick=openAccount;qs(".mobile-profile").onclick=openAccount;qs(".account-close").onclick=closeAccount;
qsa(".open-account").forEach(button=>button.onclick=openAccount);
accountModal.onclick=e=>{if(e.target===accountModal)closeAccount()};
qsa("[data-account-tab]").forEach(button=>button.onclick=()=>{
  qsa("[data-account-tab]").forEach(x=>x.classList.toggle("active",x===button));
  qsa(".account-form").forEach(form=>form.classList.toggle("active",form.id===(button.dataset.accountTab==="login"?"customerLogin":"customerRegister")));
  qs(".account-error").textContent="";
});
async function accountSubmit(form,url){
  const button=qs('button[type="submit"]',form);button.disabled=true;qs(".account-error").textContent="";
    try{const data=await apiFetch(url,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(form)))});customer=data.customer;customerCsrf=data.csrfToken;form.reset();await refreshCustomer();await loadManagedContent();showToast(`Welcome, ${customer.name.split(" ")[0]}. Complete pricing is now unlocked.`)}
  catch(error){qs(".account-error").textContent=error.message}finally{button.disabled=false}
}
qs("#customerLogin").onsubmit=e=>{e.preventDefault();accountSubmit(e.target,"/api/account/login")};
qs("#customerRegister").onsubmit=e=>{e.preventDefault();accountSubmit(e.target,"/api/account/register")};
async function refreshCustomer(){try{const data=await apiFetch("/api/account/me");customer=data.customer;customerCsrf=data.csrfToken;favoriteIds=data.favorites||[];renderCustomer(data)}catch{} }
function renderCustomer(data){
  qsa(".account-form,.account-tabs").forEach(el=>el.style.display="none");qs("#customerProfile").classList.add("active");
  qs("#customerProfile h3 span").textContent=data.customer.name.split(" ")[0];qs(".profile-email").textContent=data.customer.email;
  qs("#favoriteCount").textContent=(data.favorites||[]).length;qs("#enquiryCount").textContent=(data.bookings||data.enquiries||[]).length;
  qs(".profile-button b").textContent=data.customer.name.split(" ")[0];
  const diary=data.bookings?.length?data.bookings:data.enquiries||[];
  qs(".profile-enquiries").innerHTML=diary.length?diary.map(x=>`<div><span>${safe(x.service)}${x.event_date?` · ${safe(x.event_date)} ${safe(x.event_time||"")}`:""}</span><b>${safe(x.status)}</b></div>`).join(""):"<div><span>No bookings yet</span></div>";
  const name=qs('#bookingForm [name="name"]'),contact=qs('#bookingForm [name="contact"]');if(name)name.value=data.customer.name;if(contact)contact.value=data.customer.phone||data.customer.email;
}
qs(".profile-logout").onclick=async()=>{try{await apiFetch("/api/account/logout",{method:"POST",headers:{"X-CSRF-Token":customerCsrf}})}finally{location.reload()}};
async function toggleFavorite(button){
  if(!customer){openAccount();return}
    const data = await apiFetch(`/api/account/favorites/${button.dataset.galleryId}`,{method:"POST",headers:{"X-CSRF-Token":customerCsrf}});
  button.classList.toggle("saved",data.favorite);button.textContent=data.favorite?"♥":"♡";await refreshCustomer();
}
function renderCustomer(data){
  qsa(".account-form,.account-tabs").forEach(el=>el.style.display="none");
  qs("#customerProfile").classList.add("active");
  qs(".google-login")?.remove();
  qs(".account-divider")?.remove();
  const firstName=data.customer.name.split(" ")[0];
  qs("#customerProfile h3 span").textContent=firstName;
  qs(".profile-email").textContent=data.customer.email;
  const avatar=qs("#profileAvatar");
  if(avatar){avatar.src=data.customer.avatar_url||"";avatar.classList.toggle("empty",!data.customer.avatar_url);avatar.alt=data.customer.avatar_url?`${data.customer.name} profile photo`:"";}
  qs("#favoriteCount").textContent=(data.favorites||[]).length;
  qs("#enquiryCount").textContent=(data.bookings||data.enquiries||[]).length;
  qs(".profile-button b").textContent=firstName;
  const diary=data.bookings?.length?data.bookings:data.enquiries||[];
  qs(".profile-enquiries").innerHTML=diary.length?diary.map(x=>`<div><span>${safe(x.service)}${x.event_date?` · ${safe(x.event_date)} ${safe(x.event_time||"")}`:""}</span><b>${safe(x.status)}</b></div>`).join(""):"<div><span>No bookings yet</span><b>Ready</b></div>";
  const name=qs('#bookingForm [name="name"]'),contact=qs('#bookingForm [name="contact"]');
  if(name)name.value=data.customer.name;
  if(contact)contact.value=data.customer.phone||data.customer.email;
}
