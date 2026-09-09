/* Cadastro de mensalistas: parcelas independentes, vigências e valores pendentes. */
'use strict';
let CONTRACTS={snapshot:null,status:null,catalog:[],editing:null,poll:null};
function revenueFor(row,months){
  let amount=0,pending=false;
  for(const c of row.components){
    if(!c.periods.length)pending=true;
    for(const month of months){const p=c.periods.find(p=>p.start<=month&&(!p.end||p.end>=month));if(p){if(p.amount===null)pending=true;else amount+=p.amount;}}
  }
  return {amount,pending};
}
function revenueText(v){return `${fmt(v.amount)}${v.pending?' + valor pendente':''}`;}
async function renderContractRegistry(){
  const box=$('contract-registry');
  if(location.protocol==='file:'){box.innerHTML='<div class="note">Abra <b>ABRIR_BI.command</b> para editar o cadastro persistente de mensalistas.</div>';return;}
  box.textContent='Carregando contratos…';
  try{[CONTRACTS.snapshot,CONTRACTS.status,CONTRACTS.catalog]=await Promise.all([adminAPI('cadastros'),adminAPI('status'),adminAPI('crm')]);drawContractRegistry();}catch(e){box.textContent=e.message;}
}
function drawContractRegistry(){
  const s=CONTRACTS.status;const rows=CONTRACTS.snapshot.contracts||[];
  $('contract-registry').innerHTML=`<div class="note"><b>${s.contracts_enabled?'Fonte de mensalidades: cadastro do BI.':'Importação de mensalistas ainda não ativada.'}</b> ${s.pending?'Há alterações não aplicadas aos indicadores.':'A revisão salva corresponde à última geração.'} Salvar registra; aplicar ao BI recalcula e valida.</div><div class="admin-toolbar"><button class="btn" id="contract-new">Cadastrar contrato</button><button class="btn" id="contract-log">Histórico</button><button class="btn" id="contract-csv">Exportar conferência CSV</button><button class="btn" id="contract-apply" ${!s.contracts_enabled||s.job.state==='running'?'disabled':''}>${s.job.state==='running'?'Atualizando…':'Aplicar cadastros ao BI'}</button></div><div class="tool-row"><label>Buscar cliente ou código<input type="search" id="contract-search" placeholder="Cliente, componente ou código"></label><label>Mostrar<select id="contract-filter"><option value="all">Todos os contratos</option><option value="pending">Valores a confirmar</option><option value="active">Ativos no CRM</option><option value="inactive">Inativos no CRM</option></select></label><span id="contract-count"></span></div><p class="note">O período selecionado no topo define a receita desta conferência. Valores contratados não equivalem a faturamento ou recebimento. Componentes com valor desconhecido permanecem pendentes.</p><div class="panel ow"><table class="t" id="contract-table"></table></div><p class="note" role="status">${esc(s.job.message||'')}</p>`;
  $('contract-search').oninput=drawContractRows;$('contract-filter').onchange=drawContractRows;$('contract-new').onclick=()=>editContractRegistry(null);$('contract-log').onclick=showAdminHistory;$('contract-csv').onclick=exportContracts;
  $('contract-apply').onclick=async()=>{try{await adminAPI('rebuild',{});await renderContractRegistry();}catch(e){toast(e.message);}};
  drawContractRows();if(s.job.state==='running')pollContracts();
}
function selectedContracts(){
  const q=normalize($('contract-search').value),filter=$('contract-filter').value;
  return (CONTRACTS.snapshot.contracts||[]).filter(r=>{
    const active=CONTRACTS.catalog.find(c=>c.code===r.code)?.active;
    return normalize(r.name+' '+r.code+' '+r.components.map(c=>c.name).join(' ')).includes(q)&&(filter==='all'||filter==='pending'&&revenueFor(r,S.meses).pending||filter==='active'&&active===true||filter==='inactive'&&active===false);
  }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
function drawContractRows(){
  const rows=selectedContracts();$('contract-count').textContent=`${rows.length} contratos · ${periodRangeLabel(S.meses)}`;
  $('contract-table').innerHTML=`<thead><tr><th>Cliente e código</th><th>Componentes</th><th>Responsável</th><th class="r">Receita cadastrada no período</th><th>Conferência</th><th>Ação</th></tr></thead><tbody>${rows.map((r,i)=>{const v=revenueFor(r,S.meses),crm=CONTRACTS.catalog.find(c=>c.code===r.code);return `<tr><td><b>${esc(r.name)}</b><div class="tm">${esc(r.code)} · ${crm?crm.active?'ativo no CRM':'inativo no CRM':'vínculo CRM a revisar'}</div></td><td>${r.components.map(c=>esc(c.name)).join('<br>')}</td><td>${esc(r.owner||'Não informado')}</td><td class="tr">${v.pending?`${fmt(v.amount)}<div class="tm">+ valor não confirmado</div>`:fmt(v.amount)}</td><td>${v.pending?'<span class="badge ba">Pendente</span>':'Valores informados'}<div class="tm">Revisão ${r.revision}</div></td><td><button class="btn" data-contract-edit="${i}">Editar</button></td></tr>`;}).join('')||'<tr><td colspan="6">Nenhum contrato neste filtro.</td></tr>'}</tbody>`;
  $('contract-table').querySelectorAll('[data-contract-edit]').forEach(b=>b.onclick=()=>editContractRegistry(rows[Number(b.dataset.contractEdit)]));
}
function exportContracts(){downloadCsv('cadastro-mensalistas-dbcl.csv',['Código','Cliente','Responsável','Período','Componente','Início','Fim','Valor mensal','Pendência','Linhas da planilha original'],selectedContracts().flatMap(r=>r.components.flatMap(c=>c.periods.length?c.periods.map(p=>[r.code,r.name,r.owner,periodRangeLabel(S.meses),c.name,p.start,p.end||'',p.amount===null?'':p.amount,p.note,c.source_rows.join(', ')]):[[r.code,r.name,r.owner,periodRangeLabel(S.meses),c.name,'','','','Sem vigência',c.source_rows.join(', ')]])));}
function editContractRegistry(row){
  CONTRACTS.editing=row?structuredClone(row):{name:'',code:'',owner:'',origin:'manual',components:[]};
  $('contract-editor-title').textContent=row?'Editar '+row.name:'Cadastrar contrato mensalista';
  const used=new Set((CONTRACTS.snapshot.contracts||[]).map(c=>c.code));
  $('contract-form-body').innerHTML=`<label>Código do contrato no CRM<select name="code" id="contract-code" required ${row?'disabled':''}><option value="">Selecione o contrato</option>${row?`<option selected value="${esc(row.code)}">${esc(row.code)} · ${esc(row.name)}</option>`:CONTRACTS.catalog.filter(c=>!used.has(c.code)).map(c=>`<option value="${esc(c.code)}">${esc(c.code)} · ${esc(c.name)} · ${esc(c.service)}</option>`).join('')}</select></label><label>Cliente<input name="name" readonly required value="${esc(row?.name||'')}"></label><label>Responsável pelo cadastro<input name="owner" maxlength="200" value="${esc(row?.owner||'')}"></label><div id="contract-components"></div><button class="btn" type="button" id="contract-add-component">Adicionar componente da mensalidade</button><label>Motivo da alteração<textarea name="reason" required maxlength="1000" rows="2" placeholder="Ex.: reajuste aprovado ou confirmação de valor pendente"></textarea></label><div class="note" id="contract-impact"></div><p role="alert" id="contract-error"></p>`;
  $('contract-code').onchange=()=>{const c=CONTRACTS.catalog.find(c=>c.code===$('contract-code').value);if(c){const f=$('contract-form');f.elements.name.value=c.name;f.elements.owner.value=c.owner||'';CONTRACTS.editing.code=c.code;CONTRACTS.editing.name=c.name;}};
  $('contract-add-component').onclick=()=>{readContractComponents();CONTRACTS.editing.components.push({id:crypto.randomUUID(),name:'',periods:[],source_rows:[],source_notes:[]});drawContractComponents();};
  drawContractComponents();$('contract-editor').showModal();
}
function drawContractComponents(){
  $('contract-components').innerHTML=CONTRACTS.editing.components.map((c,i)=>`<fieldset data-component="${i}"><legend>Componente ${i+1}</legend><label>Empresa ou parcela da mensalidade<input data-component-name required maxlength="200" value="${esc(c.name)}"></label>${c.source_rows.length?`<p class="tm">Origem: linha${c.source_rows.length>1?'s':''} ${c.source_rows.join(', ')} da planilha importada.</p>`:''}${c.source_notes.length?`<details><summary>Observações da importação</summary><p class="note">${c.source_notes.map(esc).join('<br>')}</p></details>`:''}<div>${c.periods.map((p,j)=>`<fieldset data-revenue-period="${j}"><legend>Vigência ${j+1}</legend><div class="admin-fields"><label>Início<input data-revenue="start" type="month" required value="${p.start}"></label><label>Término (opcional)<input data-revenue="end" type="month" value="${p.end||''}"></label><label>Mensalidade (R$)<input data-revenue="amount" type="number" min="0" max="1000000000" step="0.01" value="${p.amount===null?'':p.amount}" placeholder="Não confirmado"></label><label>Observação / motivo do valor pendente<input data-revenue="note" maxlength="1000" value="${esc(p.note)}"></label></div></fieldset>`).join('')||'<p class="note">Sem vigência: este componente não gera receita calculada.</p>'}</div><button class="btn" type="button" data-add-revenue="${i}">Adicionar vigência / reajuste</button>${!CONTRACTS.snapshot.contracts?.find(r=>r.id===CONTRACTS.editing.id)?.components.some(old=>old.id===c.id)?`<button class="btn" type="button" data-remove-component="${i}">Remover componente não salvo</button>`:''}</fieldset>`).join('');
  document.querySelectorAll('[data-add-revenue]').forEach(b=>b.onclick=()=>{readContractComponents();const c=CONTRACTS.editing.components[Number(b.dataset.addRevenue)],last=c.periods.at(-1);let start=new Date().toLocaleDateString('sv-SE').slice(0,7);if(last?.start&&last.start>=start)start=DBCLCore.shiftMonth(last.start,1);if(last&&!last.end)last.end=DBCLCore.shiftMonth(start,-1);c.periods.push({start,end:null,amount:last?.amount??null,note:last?.amount==null?'Valor ainda não confirmado':''});drawContractComponents();});
  document.querySelectorAll('[data-remove-component]').forEach(b=>b.onclick=()=>{readContractComponents();CONTRACTS.editing.components.splice(Number(b.dataset.removeComponent),1);drawContractComponents();});
  $('contract-components').oninput=()=>{readContractComponents();contractImpact();};contractImpact();
}
function readContractComponents(){
  for(const field of document.querySelectorAll('[data-component]')){
    const c=CONTRACTS.editing.components[Number(field.dataset.component)];c.name=field.querySelector('[data-component-name]').value.trim();
    for(const f of field.querySelectorAll('[data-revenue-period]')){const p=c.periods[Number(f.dataset.revenuePeriod)];for(const input of f.querySelectorAll('[data-revenue]')){const k=input.dataset.revenue;p[k]=k==='amount'?(input.value===''?null:Number(input.value)):k==='end'?input.value||null:input.value;}}
  }
}
function contractImpact(){
  const row=CONTRACTS.editing;const before=CONTRACTS.snapshot.contracts?.find(r=>r.id===row.id);const value=revenueFor(row,S.meses),old=before?revenueFor(before,S.meses):{amount:0,pending:false};
  $('contract-impact').textContent=`No período ${periodRangeLabel(S.meses)}: ${revenueText(old)} → ${revenueText(value)}. Alterações retroativas podem recalcular períodos já exibidos. Valor vazio significa não confirmado; valor zero significa mensalidade informada como zero.`;
}
async function saveContractRegistry(event){
  event.preventDefault();readContractComponents();const form=event.currentTarget,row=CONTRACTS.editing;
  const record={name:form.elements.name.value.trim(),code:row.code,owner:form.elements.owner.value.trim(),origin:row.origin,components:row.components};
  $('contract-save').disabled=true;
  try{await adminAPI('save',{kind:'contracts',id:row.id||null,revision:row.revision||0,reason:form.elements.reason.value.trim(),record});$('contract-editor').close();await renderContractRegistry();toast('Contrato salvo. Aplique os cadastros ao BI para recalcular.');}catch(e){$('contract-error').textContent=e.message;}finally{$('contract-save').disabled=false;}
}
function pollContracts(){clearTimeout(CONTRACTS.poll);CONTRACTS.poll=setTimeout(async()=>{try{CONTRACTS.status=await adminAPI('status');if(S.screen==='contratos')drawContractRegistry();else if(CONTRACTS.status.job.state==='running')pollContracts();if(CONTRACTS.status.job.state==='done')toast('BI atualizado. Recarregue a página para ver os novos indicadores.');}catch(e){toast(e.message);}},5000);}
