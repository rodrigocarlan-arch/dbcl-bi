/* V4: ferramentas de gestão. Os dados observados permanecem na base D. */
'use strict';
const $ = id=>document.getElementById(id);
const number = v=>Number(v)||0;
const sum = (rows,key)=>rows.reduce((n,r)=>n+number(r[key]),0);
const normalize = v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5000);}
function downloadJSON(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportProvenance(){downloadJSON('dbcl-v4-rastreabilidade.json',{publicacao:D.release,metadados:D.meta});}
function selectedMissingRates(){
  const history=D.meta.auditoria.cadastros?.tarifas_por_pessoa_mes;
  if(history)return D.hm.flatMap(p=>S.meses.filter(m=>(p.pm[m]?.tot||0)>0&&!(history[p.adv]?.[m]?.[S.rate]>0)).map(m=>({pessoa:p.adv,mes:m,h:p.pm[m].tot})));
  return (D.meta.auditoria.cobertura_tarifas?.registros||[]).filter(r=>S.meses.includes(r.mes));
}
function renderV4Context(){
  const h=sum(selectedMissingRates(),'h');
  const partial=(['quarter','semester','year'].includes(S.periodKind)&&S.meses.length!==({quarter:3,semester:6,year:12}[S.periodKind]));
  const old=(Date.now()-new Date(D.meta.ultima_data_horas+'T12:00:00').getTime())/86400000>45;
  $('v4-context').innerHTML=`<span>Receita <b>contratual cadastrada</b> · ${S.rate==='custo'?'custo interno':'valor técnico'} por cargo · status <b>atual</b> da carteira.</span><span>Horas gerais, times e áreas abrangem todas as carteiras.</span>${partial?'<strong>Período parcial: comparação suspensa.</strong>':''}${h?`<strong>${fmtH(h)}h sem tarifa: valores técnicos e margens incompletos.</strong>`:''}${old?'<strong>Fonte de horas com mais de 45 dias; revisar atualização.</strong>':''}<button onclick="go('confianca')">Ver regras e fontes →</button>`;
  document.querySelectorAll('.sb-btn[data-s]').forEach(b=>b.setAttribute('aria-current',b.dataset.s===S.screen?'page':'false'));
}
function metric(label,value,note='',tone=''){return `<div class="kc"><div class="kc-l">${esc(label)}</div><div class="kc-v ${tone}">${value}</div><div class="kc-s">${esc(note)}</div></div>`;}
function renderTrust(){
  const release=D.release,au=D.meta.auditoria,cv=au.codigo_venda_themis||{},ex=au.exclusao_time_administrativo||{};
  const source=cv.horas_por_mes_fonte||{};
  const tariffs=au.valores_pessoas?.tabela_por_cargo||{};
  const missing=selectedMissingRates();
  const classification=(D.work_dimensions.conferencia_classificacao||[]).filter(r=>S.meses.includes(r.m));
  const review=sum(classification.filter(r=>r.status==='Revisar'),'h');
  const selectedSource=S.meses.filter(m=>Object.hasOwn(source,m));
  const lines=selectedSource.map(m=>{const recovered=number(au.complemento_alocacao?.horas_por_mes?.[m]),raw=number(au.horas_themis_originais?.[m]),excluded=number(ex.horas_por_mes?.[m]),actual=number(D.kpm[m]?.h),diff=actual-(raw+recovered-excluded);return {m,raw,recovered,excluded,actual,diff};});
  const ok=lines.length&&lines.every(r=>Math.abs(r.diff)<=.051);
  $('trust-content').innerHTML=`<div class="kg kg4">${metric('Conciliação Themis',lines.length?(ok?'Conciliada':'Divergência'):'Não aplicável',lines.length?`${lines.length} meses do recorte`:'Recorte anterior ao Themis',ok?'g':'')}${metric('Horas sem tarifa',fmtH(sum(missing,'h'))+'h','Valor técnico não mensurado',missing.length?'a':'g')}${metric('Classificação a revisar',fmtH(review)+'h','Recorte selecionado',review?'a':'g')}${metric('Último dado de horas',fmtDate(D.meta.ultima_data_horas),'Data de corte da fonte')}</div>
  ${D.meta.auditoria.cadastros?`<div class="note"><b>Cadastro de pessoas e tarifas:</b> revisão ${D.meta.auditoria.cadastros.revision}, com cálculo por competência. Alterações posteriores precisam ser aplicadas ao BI.</div>`:''}<div class="note"><b>Durações na fonte:</b> ${au.duracoes_ausentes?.linhas||0} registros sem duração no Themis. ${au.complemento_alocacao?.registros?.length||0} receberam duração da Alocação por vínculo unívoco; ${au.complemento_alocacao?.linhas_sem_duracao_mensuravel||0} continuam sem duração mensurável. As quantidades abrangem toda a fonte. As linhas de origem estão no arquivo de rastreabilidade.</div><div class="trust-banner"><div><span class="eyebrow">INTEGRIDADE NÃO É COMPLETUDE</span><h2>${release?'Conciliações executadas nas três tabelas':'Manifesto V4 ausente'}</h2><p>Uma soma pode fechar mesmo com cadastros incompletos. As lacunas abaixo limitam a interpretação econômica.</p></div><button class="btn" onclick="go('auditoria')">Abrir fila de correções</button></div>
  <div class="g2"><div class="panel"><div class="ph2"><span class="t">Como ler os indicadores</span></div><div class="pb rule-list">${Object.entries(release?.regras||{}).map(([k,v])=>`<div><b>${esc(k)}</b><p>${esc(v)}</p></div>`).join('')}<div><b>Sem fonte disponível</b><p>Faturamento, recebimentos, impostos, despesas gerais, capacidade contratada, SLA e satisfação. A margem exibida não é lucro líquido.</p></div></div></div>
  <div class="panel"><div class="ph2"><span class="t">Tabela atual por cargo · R$/hora</span></div><div class="pb ow"><table class="t"><thead><tr><th>Cargo</th><th>Custo</th><th>Mensal</th><th>Pontual</th></tr></thead><tbody>${Object.entries(tariffs).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${fmt(v.custo)}</td><td>${fmt(v.mensal)}</td><td>${fmt(v.pontual)}</td></tr>`).join('')}</tbody></table><p class="note">${D.meta.auditoria.cadastros?'O cálculo usa o cargo e a tarifa da competência. A tabela acima mostra a referência atual; as vigências podem ser consultadas em Pessoas e tarifas. O legado importado permanece sem datas históricas confirmadas.':'O cálculo usa o cargo de cada pessoa. A tabela atual é aplicada ao histórico; não há série de tarifas por vigência.'}</p></div></div></div>
  <div class="panel"><div class="ph2"><span class="t">Themis + complemento da Alocação − exclusões = BI</span><span class="s">Tolerância: 0,051h de arredondamento</span></div><div class="pb ow"><table class="t"><thead><tr><th>Mês</th><th class="r">Themis original</th><th class="r">Complemento Alocação</th><th class="r">Time administrativo excluído</th><th class="r">BI jurídico</th><th class="r">Diferença</th></tr></thead><tbody>${lines.map(r=>`<tr><td>${mFullLbl(r.m)}</td><td class="tr">${fmtH(r.raw)}</td><td class="tr">${fmtH(r.recovered)}</td><td class="tr">${fmtH(r.excluded)}</td><td class="tr">${fmtH(r.actual)}</td><td class="tr">${r.diff.toFixed(3)}</td></tr>`).join('')||'<tr><td colspan="6">Este recorte usa o histórico Eleven. A conciliação acima se aplica ao Themis a partir de fevereiro/2026.</td></tr>'}</tbody></table></div></div>
  <div class="panel"><div class="ph2"><span class="t">Fontes utilizadas nesta geração</span><span class="s">${esc(release?.gerado_em||D.meta.gerado_em)}</span></div><div class="pb ow"><table class="t"><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Identificação SHA-256</th></tr></thead><tbody>${Object.entries(release?.bases||{}).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${(v.bytes/1024/1024).toFixed(2)} MB</td><td><code class="hash">${esc(v.sha256)}</code></td></tr>`).join('')}</tbody></table></div></div>
  <div class="g2"><div class="panel"><div class="ph2"><span class="t">Horas sem tarifa no período</span></div><div class="pb ow"><table class="t"><thead><tr><th>Pessoa na origem</th><th>Mês</th><th>Horas</th></tr></thead><tbody>${missing.map(r=>`<tr><td>${esc(r.pessoa)}</td><td>${esc(r.mes)}</td><td>${fmtH(r.h)}</td></tr>`).join('')||'<tr><td colspan="3">Nenhuma ausência de tarifa neste recorte.</td></tr>'}</tbody></table></div></div><div class="panel"><div class="ph2"><span class="t">Decisões locais · cópia de segurança</span></div><div class="pb"><p>Registros do navegador não são compartilhados automaticamente. Exporte uma cópia antes de trocar de computador ou limpar o navegador.</p><div class="tool-row"><button class="btn" onclick="backupDecisions()">Exportar decisões JSON</button><label class="btn">Importar cópia<input type="file" accept=".json,application/json" onchange="importDecisions(this)" hidden></label></div><p class="note">Importação combina registros por identificador. Decisões oficiais permanecem na base publicada. A V3 mantém seu armazenamento separado.</p></div></div></div>`;
}
function exploreRows(){
  const monthly=carteiraRows(mensalCalc());
  const clients=new Set([...Object.keys(D.cli_det),...monthly.map(m=>m.cli)]);
  let rows=[...clients].filter(cli=>S.carteira==='todos'||(S.carteira==='ativos'?clientIsActive(cli)||monthly.some(m=>m.cli===cli&&isActive(m)):!clientIsActive(cli))).map(cli=>{
    const detail=D.cli_det[cli]||{};
    const services=carteiraRows(detail.svcs||[]);
    const men=monthly.filter(m=>m.cli===cli);
    const recurringHours=sum(men,'_h'),hours=services.reduce((n,s)=>n+sumHoursByMonths(s.pm,S.meses),0)+(S.carteira==='todos'?sumHoursByMonths(detail.pm_sem_codigo,S.meses):0);
    return {cli,hours,recurringHours,revenue:sum(men,'_rec'),cost:sum(men,'_custo'),margin:sum(men,'_margem'),recurring:men.length>0,services:services.length,status:clientIsActive(cli)?'Ativo':'Inativo'};
  });
  const q=normalize($('explore-query').value);rows=rows.filter(r=>normalize(r.cli).includes(q));
  const sort=$('explore-sort').value;
  rows.sort((a,b)=>sort==='name'?a.cli.localeCompare(b.cli,'pt-BR'):sort==='margin'?(a.recurring===b.recurring?a.margin-b.margin:a.recurring?-1:1):b[sort]-a[sort]);
  return rows;
}
function renderExplore(){
  const rows=exploreRows();$('explore-count').textContent=`${rows.length} clientes · ${periodRangeLabel(S.meses)}`;
  $('explore-table').innerHTML='<thead><tr><th>Cliente</th><th>Status atual</th><th class="r">Horas vinculadas</th><th class="r">Receita recorrente</th><th class="r">Valor técnico recorrente</th><th class="r">Margem recorrente</th><th>Ação</th></tr></thead><tbody>'+rows.map((r,i)=>`<tr><td><b>${esc(r.cli)}</b><div class="tm">${r.services} serviços no cadastro</div></td><td>${r.status}</td><td class="tr">${fmtH(r.hours)}h</td><td class="tr">${r.recurring?fmt(r.revenue):'Não recorrente'}</td><td class="tr">${r.recurring?fmt(r.cost):'—'}</td><td class="tr ${r.margin<0?'negative':'positive'}">${r.recurring?fmt(r.margin):'—'}</td><td><button class="btn" data-explore="${i}">Cliente 360°</button></td></tr>`).join('')+(rows.length?'':'<tr><td colspan="7">Nenhum cliente corresponde à busca e à carteira selecionada.</td></tr>')+'</tbody>';
  $('explore-table').querySelectorAll('[data-explore]').forEach(b=>b.onclick=()=>openCliente(rows[Number(b.dataset.explore)].cli));
}
function exportExplore(){downloadCsv('carteira-dbcl-v4.csv',['Período','Tabela','Carteira','Cliente','Status atual','Horas vinculadas','Receita recorrente cadastrada','Valor técnico recorrente','Margem recorrente'],exploreRows().map(r=>[periodRangeLabel(S.meses),S.rate,S.carteira,r.cli,r.status,r.hours,r.recurring?r.revenue:'',r.recurring?r.cost:'',r.recurring?r.margin:'']));}
function exportExecutive(){
  const rows=carteiraRows(mensalCalc());
  downloadCsv('resumo-dbcl-v4.csv',['Período','Carteira atual','Tabela','Indicador','Valor','Unidade','Definição'],[
    ['Horas totais do escritório',S.meses.reduce((n,m)=>n+number(D.kpm[m]?.h),0),'h','Todas as carteiras; inclui horas internas jurídicas.'],
    ['Receita recorrente cadastrada',sum(rows,'_rec'),'BRL','Contrato por competência, não faturamento/recebimento.'],
    ['Valor técnico recorrente',sum(rows,'_custo'),'BRL','Horas vezes tarifa atual por cargo.'],
    ['Margem recorrente',sum(rows,'_margem'),'BRL','Receita cadastrada menos valor técnico; não lucro líquido.'],
    ['Horas sem tarifa',sum(selectedMissingRates(),'h'),'h','Custo não mensurado; todas as carteiras.']
  ].map(r=>[periodRangeLabel(S.meses),S.carteira,S.rate,...r]));
}
function renderSimulator(){
  const old=$('sim-client').value;
  const names=[...new Set(carteiraRows(mensalCalc()).map(r=>r.cli))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  $('sim-client').replaceChildren(new Option('Toda a carteira recorrente',''),...names.map(n=>new Option(n,n)));
  if(names.includes(old))$('sim-client').value=old;
  calculateSimulation();
}
function simulationData(){
  const rows=carteiraRows(mensalCalc()).filter(r=>!$('sim-client').value||r.cli===$('sim-client').value);
  const inputs=['sim-price','sim-hours','sim-target'];
  if(inputs.some(id=>$(id).value.trim()===''||!$(id).checkValidity()))throw Error('Preencha as premissas dentro dos limites indicados.');
  const revenue=sum(rows,'_rec'),cost=sum(rows,'_custo');
  return {rows,revenue,cost,result:DBCLCore.scenario(revenue,cost,...inputs.map(id=>Number($(id).value)))};
}
function calculateSimulation(){
  try{
    const {rows,revenue,cost,result:r}=simulationData();
    if(!rows.length){$('sim-results').innerHTML='<div class="note">Não há mensalistas na carteira selecionada.</div>';return;}
    $('sim-results').innerHTML=`<div class="scenario-tag">SIMULAÇÃO · ${esc(periodRangeLabel(S.meses))} · tabela ${esc(S.rate)}</div><h2 class="scenario-title">${esc($('sim-client').value||'Carteira recorrente')}</h2><div class="kg kg2">${metric('Margem simulada',fmt(r.margin),r.marginPct==null?'Sem receita no cenário':fmtP(r.marginPct)+' da receita',r.margin<0?'r':'g')}${metric('Variação da margem',fmt(r.delta),'Diferença em relação ao observado',r.delta<0?'r':'g')}${metric('Receita para a margem desejada',fmt(r.requiredRevenue),'Total do período; mix de cargos constante')}${metric('Receita média mensal necessária',fmt(r.requiredRevenue/S.meses.length),`${S.meses.length} meses disponíveis no recorte`)}</div><div class="panel"><div class="ph2"><span class="t">Observado e cenário</span></div><div class="pb"><table class="t"><thead><tr><th>Medida</th><th class="r">Observado</th><th class="r">Cenário</th></tr></thead><tbody><tr><td>Receita cadastrada</td><td class="tr">${fmt(revenue)}</td><td class="tr">${fmt(r.revenue)}</td></tr><tr><td>Valor técnico</td><td class="tr">${fmt(cost)}</td><td class="tr">${fmt(r.cost)}</td></tr><tr><td>Margem</td><td class="tr">${fmt(revenue-cost)}</td><td class="tr">${fmt(r.margin)}</td></tr></tbody></table></div></div><p class="note">O consumo altera o valor técnico proporcionalmente. A simulação não prevê demanda, recebimento ou despesas gerais. Uma base com tarifa ausente subestima o valor técnico; consulte Confiança e fontes.</p>`;
  }catch(e){$('sim-results').textContent=e.message;}
}
function resetSimulation(){$('sim-price').value=0;$('sim-hours').value=0;calculateSimulation();}
function exportSimulation(){try{const d=simulationData();downloadCsv('cenario-dbcl-v4.csv',['Cliente','Período','Tabela','Variação preço %','Variação horas %','Meta margem %','Receita simulada','Valor técnico simulado','Margem simulada','Receita necessária'],[[$('sim-client').value||'Toda a carteira',periodRangeLabel(S.meses),S.rate,$('sim-price').value,$('sim-hours').value,$('sim-target').value,d.result.revenue,d.result.cost,d.result.margin,d.result.requiredRevenue]]);}catch(e){toast(e.message);}}
const ENTITIES=[...Object.keys(D.cli_det).map(name=>({type:'Cliente',name,open:()=>openCliente(name)})),...D.hm.map(p=>({type:'Pessoa',name:p.adv,open:()=>openPessoa(p.adv)})),...Object.entries(D.servicos_det).map(([code,s])=>({type:'Serviço',name:`${code} · ${s.lbl||s.tipo||'Serviço'} · ${s.cli}`,open:()=>openServico(code)}))];
function openSearch(){$('global-search').showModal();$('global-query').value='';searchEntities();$('global-query').focus();}
function searchEntities(){const q=normalize($('global-query').value);const rows=q?ENTITIES.filter(r=>normalize(r.name).includes(q)).slice(0,40):[];$('global-results').replaceChildren();if(!rows.length){$('global-results').textContent=q?'Nenhum resultado. Tente parte do nome ou código.':'Busca em todo o cadastro. O detalhe respeita o período selecionado.';return;}rows.forEach(r=>{const b=document.createElement('button');b.className='search-result';const type=document.createElement('small');type.textContent=r.type;const name=document.createElement('span');name.textContent=r.name;b.append(type,name);b.onclick=()=>{$('global-search').close();r.open();};$('global-results').append(b);});}
function backupDecisions(){downloadJSON('dbcl-v4-decisoes.json',{schema:1,exportedAt:new Date().toISOString(),decisions:localStrategicDecisions()});}
async function importDecisions(input){
  try{
    const file=input.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('Arquivo acima de 2 MB.');
    const parsed=JSON.parse(await file.text());
    if(parsed.schema!==1||!Array.isArray(parsed.decisions))throw Error('Formato de cópia inválido.');
    const fields=['id','client','type','status','title','rationale','recommendation','potential','relationshipRisk','startMonth','endMonth','nextReview','successMetric','owner','source','updatedAt'];
    const imported=parsed.decisions.map(d=>{if(!d||typeof d.id!=='string'||!d.id.startsWith('local-')||typeof d.client!=='string'||typeof d.title!=='string'||!['active','monitoring','completed','cancelled'].includes(d.status))throw Error('Decisão inválida no arquivo.');const clean={};fields.forEach(k=>{if(d[k]!==undefined){if(typeof d[k]!=='string'||d[k].length>10000)throw Error('Campo inválido na decisão.');clean[k]=d[k];}});return clean;});
    const existing=localStrategicDecisions();const merged=new Map(imported.map(d=>[d.id,d]));existing.forEach(d=>merged.set(d.id,d));
    localStorage.setItem(STRATEGY_STORAGE_KEY,JSON.stringify([...merged.values()]));render();toast(`${merged.size-existing.length} decisões importadas. Registros já existentes foram preservados.`);
  }catch(e){toast('Importação não realizada: '+e.message);}finally{input.value='';}
}
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();}if(event.key==='Escape'){document.querySelectorAll('.overlay.open').forEach(el=>el.classList.remove('open'));document.body.classList.remove('nav-open');}});
// Keyboard access for drill-down elements inherited from V3.
const enhance=()=>{document.querySelectorAll('[onclick]:not(button):not(input):not(select):not(a)').forEach(el=>{if(!el.hasAttribute('tabindex')){el.tabIndex=0;el.setAttribute('role','button');el.addEventListener('keydown',e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();el.click();}});}});document.querySelectorAll('input:not([aria-label]):not([id])').forEach(el=>el.setAttribute('aria-label',el.placeholder||'Buscar'));};
let enhancePending=false;new MutationObserver(()=>{if(!enhancePending){enhancePending=true;queueMicrotask(()=>{enhance();enhancePending=false;});}}).observe(document.body,{childList:true,subtree:true});
try{boot();enhance();}catch(error){$('v4-context').textContent='Não foi possível iniciar o BI. Verifique os arquivos da V4 e execute ATUALIZAR_BI.command. '+error.message;console.error(error);}
