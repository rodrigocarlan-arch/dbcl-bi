'use strict';
(()=>{
 const form=document.getElementById('login-form'),email=document.getElementById('email'),code=document.getElementById('code'),step=document.getElementById('code-step'),button=document.getElementById('submit'),message=document.getElementById('message');let verifying=false,busy=false;
 document.getElementById('change-email').onclick=()=>{if(busy)return;verifying=false;step.hidden=true;email.readOnly=false;code.required=false;code.value='';button.textContent='Receber código';message.textContent='';email.focus();};
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!form.checkValidity())return;busy=true;button.disabled=true;message.dataset.error='false';message.textContent=verifying?'Validando acesso…':'Enviando código…';
  try{const response=await fetch(verifying?'/api/login/verify':'/api/login/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value.trim(),...(verifying?{code:code.value.trim()}:{})})});const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível entrar. Tente novamente.');
   if(verifying){location.replace('/');return;}
   verifying=true;step.hidden=false;email.readOnly=true;code.required=true;button.textContent='Entrar';message.textContent=data.message||'Confira o código no seu e-mail.';code.focus();
  }catch(error){message.dataset.error='true';message.textContent=error.message||'Não foi possível conectar. Tente novamente.';}
  finally{busy=false;button.disabled=false;}
 };
})();
