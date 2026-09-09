/* Edição por formulário, revisão otimista e atualização explícita do BI. */
'use strict';
let ADMIN={snapshot:null,status:null,kind:'people',editing:null,timer:null};
async function adminAPI(path,body){
  const response=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir');return data;
}
async function renderCadastros(){
  const box=document.getElementById('cadastro-content');
  if(location.protocol==='file:'){box.innerHTML='<div class="note">Para editar os cadastros, abra <b>ABRIR_BI.command</b>. A visualização direta do arquivo continua disponível, mas não permite salvar no banco.</div>';return;}
  box.innerHTML='<p>Carregando cadastros…</p>';
  try{[ADMIN.snapshot,ADMIN.status]=await Promise.all([adminAPI('cadastros'),adminAPI('status')]);drawCadastros();}catch(e){box.textContent=e.message;}
}
function drawCadastros(){
  const s=ADMIN.status,snap=ADMIN.snapshot;
  document.getElementById('cadastro-content').innerHTML=`<div class="note"><b>Edição: ${esc(s.owner)} · neste computador.</b> ${s.enabled?'O cadastro do BI é a fonte de pessoas e tarifas.':'Importação disponível para conferência; ativação do cálculo pendente.'} ${s.pending?'<b>Há cadastros ainda não refletidos na base exibida.</b>':'A base exibida corresponde à revisão salva.'}</div>
  <div class="admin-toolbar"><div class="toggle-group"><button class="tgl ${ADMIN.kind==='people'?'active':''}" id="admin-people">Pessoas e times (${snap.people.length})</button><button class="tgl ${ADMIN.kind==='rates'?'active':''}" id="admin-rates">Tarifas por cargo (${snap.rates.length})</button></div><button class="btn" id="admin-new">${ADMIN.kind==='people'?'Cadastrar pessoa':'Cadastrar cargo e tarifas'}</button><button class="btn" id="admin-history">Histórico de alterações</button><button class="btn" id="admin-backup">Criar backup</button><button class="btn" id="admin-rebuild" ${!s.enabled||s.job.state==='running'?'disabled':''}>${s.job.state==='running'?'Atualizando…':'Aplicar cadastros ao BI'}</button></div><p class="note" id="admin-job" role="status">${esc(s.job.message||'Salvar registra a alteração. Aplicar cadastros ao BI recalcula e valida a base antes de disponibilizá-la.')}</p>
  <label class="admin-search">Buscar ${ADMIN.kind==='people'?'pessoa ou time':'cargo'}<input id="admin-search" type="search" placeholder="Digite para filtrar"></label><div class="panel ow"><table class="t" id="admin-table"></table></div><p class="note">Tarifas e vínculos importados sem datas históricas estão identificados como legado. Uma vigência nova preserva o passado; uma correção de legado pode recalcular todo o histórico.</p>`;
  document.getElementById('admin-people').onclick=()=>{ADMIN.kind='people';drawCadastros();};document.getElementById('admin-rates').onclick=()=>{ADMIN.kind='rates';drawCadastros();};
  document.getElementById('admin-new').onclick=()=>editCadastro(null);
  document.getElementById('admin-search').oninput=drawAdminRows;document.getElementById('admin-history').onclick=showAdminHistory;
  document.getElementById('admin-backup').onclick=async()=>{try{const r=await adminAPI('backup',{});toast(r.message);}catch(e){toast(e.message);}};
  document.getElementById('admin-rebuild').onclick=async()=>{try{await adminAPI('rebuild',{});await renderCadastros();pollAdminJob();}catch(e){toast(e.message);}};
  drawAdminRows();if(s.job.state==='running')pollAdminJob();
}
function periodLabel(p){return `${p.start||'Legado sem data confirmada'} → ${p.end||'sem término'}`;}
function adminPeriod(periods){const month=new Date().toLocaleDateString('sv-SE').slice(0,7);return periods.find(p=>(!p.start||p.start<=month)&&(!p.end||p.end>=month));}
function drawAdminRows(){
  const q=normalize(document.getElementById('admin-search').value);const rows=ADMIN.snapshot[ADMIN.kind].filter(r=>normalize(r.name+' '+r.periods.map(p=>p.team||'').join(' ')).includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const table=document.getElementById('admin-table');const people=ADMIN.kind==='people';
  table.innerHTML=`<thead><tr><th>${people?'Pessoa':'Cargo'}</th>${people?'<th>Time atual</th><th>Cargo atual</th><th>Situação atual</th>':'<th>Custo interno/h</th><th>Mensal/h</th><th>Pontual/h</th>'}<th>Vigências</th><th>Ação</th></tr></thead><tbody>${rows.map((r,i)=>{const p=adminPeriod(r.periods);return `<tr><td><b>${esc(r.name)}</b><div class="tm">Revisão ${r.revision}</div></td>${people?`<td>${esc(p?.team||'Sem vínculo vigente')}</td><td>${esc(p?.cargo||'—')}</td><td>${p?p.active?'Ativo':'Inativo':'Sem vigência'}</td>`:`<td>${p?fmt(p.custo):'—'}</td><td>${p?fmt(p.mensal):'—'}</td><td>${p?fmt(p.pontual):'—'}</td>`}<td>${r.periods.length}<div class="tm">${p?esc(periodLabel(p)):'Sem vigência atual'}</div></td><td><button class="btn" data-edit="${i}">Editar</button></td></tr>`;}).join('')||'<tr><td colspan="7">Nenhum cadastro encontrado.</td></tr>'}</tbody>`;
  table.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editCadastro(rows[Number(b.dataset.edit)]));
}
function newPeriod(people){return people?{start:new Date().toLocaleDateString('sv-SE').slice(0,7),end:null,cargo:ADMIN.snapshot.rates[0]?.name||'',team:'Consultivo',active:true}:{start:new Date().toLocaleDateString('sv-SE').slice(0,7),end:null,custo:0,mensal:0,pontual:0};}
function editCadastro(row){
  const people=ADMIN.kind==='people';ADMIN.editing={kind:ADMIN.kind,row:row?structuredClone(row):null,periods:row?structuredClone(row.periods):[newPeriod(people)]};
  const modal=document.getElementById('cadastro-editor');
  document.getElementById('cadastro-editor-title').textContent=row?'Editar '+row.name:people?'Cadastrar pessoa':'Cadastrar cargo e tarifas';
  document.getElementById('cadastro-form-content').innerHTML=`<label>${people?'Nome da pessoa':'Nome do cargo'}<input name="name" maxlength="200" required ${!people&&row?'readonly':''} value="${esc(row?.name||'')}"></label>${people?`<label>Outros nomes usados nas fontes (um por linha)<textarea name="aliases" rows="2">${esc((row?.aliases||[]).join('\n'))}</textarea></label>`:''}<div id="admin-periods"></div><button class="btn" id="admin-add-period" type="button">Adicionar vigência</button><label>Motivo da alteração<textarea name="reason" rows="2" maxlength="1000" required placeholder="Ex.: reajuste aprovado a partir de setembro"></textarea></label><div class="note" id="admin-impact">Confira início e término de cada vigência. Períodos não podem se sobrepor.</div><p id="admin-form-error" role="alert"></p>`;
  document.getElementById('admin-add-period').onclick=()=>{readPeriodForm();const periods=ADMIN.editing.periods;const latest=periods.at(-1);const next={...latest,start:new Date().toLocaleDateString('sv-SE').slice(0,7),end:null};if(latest.start&&latest.start>=next.start)next.start=DBCLCore.shiftMonth(latest.start,1);if(!latest.end)latest.end=DBCLCore.shiftMonth(next.start,-1);periods.push(next);drawPeriodForm();};
  drawPeriodForm();modal.showModal();
}
function drawPeriodForm(){
  const people=ADMIN.editing.kind==='people';const originalCount=ADMIN.editing.row?.periods.length||0;
  document.getElementById('admin-periods').innerHTML=ADMIN.editing.periods.map((p,i)=>`<fieldset data-period="${i}"><legend>Vigência ${i+1}${p.start===null?' · legado importado':''}</legend><div class="admin-fields"><label>Início<input data-field="start" type="month" value="${p.start||''}" ${p.start===null&&i<originalCount?'disabled':''} ${p.start!==null?'required':''}></label><label>Término (opcional)<input data-field="end" type="month" value="${p.end||''}"></label>${people?`<label>Cargo<select data-field="cargo">${[...new Set([p.cargo,...ADMIN.snapshot.rates.map(r=>r.name)])].map(name=>`<option value="${esc(name)}" ${name===p.cargo?'selected':''}>${esc(name||'Não informado')}</option>`).join('')}</select></label><label>Time<select data-field="team">${[...new Set([p.team,'Trabalhista','Contencioso','Consultivo','Sócios','Administrativo'])].map(name=>`<option value="${esc(name)}" ${name===p.team?'selected':''}>${esc(name||'Não informado')}</option>`).join('')}</select></label><label>Situação<select data-field="active"><option value="true" ${p.active?'selected':''}>Ativo</option><option value="false" ${!p.active?'selected':''}>Inativo</option></select></label>`:['custo','mensal','pontual'].map(k=>`<label>${{custo:'Custo interno',mensal:'Tabela mensal',pontual:'Tabela pontual'}[k]} (R$/h)<input data-field="${k}" type="number" min="0" max="1000000" step="0.01" required value="${p[k]}"></label>`).join('')}</div>${i>=originalCount&&i>0?`<button class="btn" type="button" data-remove-period="${i}">Remover vigência não salva</button>`:''}</fieldset>`).join('');
  document.querySelectorAll('[data-remove-period]').forEach(b=>b.onclick=()=>{readPeriodForm();ADMIN.editing.periods.splice(Number(b.dataset.removePeriod),1);drawPeriodForm();});
  document.getElementById('admin-periods').oninput=()=>{document.getElementById('admin-impact').textContent='Salvar preserva a versão anterior no histórico. Ao aplicar ao BI, competências alcançadas por esta alteração serão recalculadas. Corrigir um valor do legado afeta todo o histórico coberto por ele.';};
}
function readPeriodForm(){
  for(const fieldset of document.querySelectorAll('[data-period]')){const p=ADMIN.editing.periods[Number(fieldset.dataset.period)];for(const input of fieldset.querySelectorAll('[data-field]')){const k=input.dataset.field;p[k]=k==='active'?input.value==='true':['custo','mensal','pontual'].includes(k)?Number(input.value):['start','end'].includes(k)?input.value||null:input.value;}}
}
async function saveCadastro(event){
  event.preventDefault();readPeriodForm();const form=event.currentTarget;const e=ADMIN.editing,row=e.row;const name=form.elements.name.value.trim();const record={name,origin:row?.origin||'manual',periods:e.periods};
  if(e.kind==='people'){record.key=row?.key||name.toUpperCase();record.aliases=form.elements.aliases.value.split('\n').map(x=>x.trim()).filter(Boolean);}
  const button=document.getElementById('admin-save');button.disabled=true;
  try{await adminAPI('save',{kind:e.kind,id:row?.id||null,revision:row?.revision||0,reason:form.elements.reason.value.trim(),record});document.getElementById('cadastro-editor').close();await renderCadastros();toast('Cadastro salvo. Aplique ao BI para recalcular os indicadores.');}
  catch(error){document.getElementById('admin-form-error').textContent=error.message;}finally{button.disabled=false;}
}
async function showAdminHistory(){
  try{const rows=await adminAPI('history');const box=document.getElementById('cadastro-history-body');box.replaceChildren();for(const r of rows){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`${r.at} · ${r.actor} · ${r.after_json?.name||r.record_id} · ${r.reason}`;const pre=document.createElement('pre');pre.textContent=JSON.stringify({antes:r.before_json,depois:r.after_json},null,2);details.append(summary,pre);box.append(details);}document.getElementById('cadastro-history').showModal();}catch(e){toast(e.message);}
}
function pollAdminJob(){clearTimeout(ADMIN.timer);ADMIN.timer=setTimeout(async()=>{try{ADMIN.status=await adminAPI('status');if(S.screen==='cadastros')drawCadastros();else if(ADMIN.status.job.state==='running')pollAdminJob();if(ADMIN.status.job.state==='done')toast('Atualização concluída. Recarregue para ver os indicadores atualizados.');}catch(e){toast(e.message);}},5000);}
