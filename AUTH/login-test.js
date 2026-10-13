(async()=>{
const C=window.YODAWY_AUTH_CONFIG,API='https://api.github.com/repos/'+C.OWNER+'/';
const get=async(u,t)=>{const r=await fetch(u,{headers:{Authorization:'Bearer '+t,Accept:'application/vnd.github+json'}});if(!r.ok)throw Error(r.status);return r.json()};
const dec=d=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(d.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
try{
const users=dec(await get(API+C.DASHBOARD+'/contents/CONFIG/users.json',C.DASH_TOKEN));
const u=users.users.find(x=>x.id===C.ID&&x.status==='Active');if(!u)throw Error('INVALID');
const s=dec(await get(API+u.repository+'/contents/DASHBOARD/dashboard-settings.json',C.PERSONAL_TOKEN));
if(s.id!==u.id||s.repository!==u.repository)throw Error('INVALID');
alert('VALID: '+u.id+' — '+u.name);
}catch(e){alert(['401','INVALID'].includes(e.message)?'INVALID ID OR PASSWORD':'ACCESS / NETWORK ERROR: '+e.message)}
})();
