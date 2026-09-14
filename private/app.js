/* ════════════════════════════════════════════════════════════
   dbcl Legal Ops BI · app.js
   Estado global, helpers, todas as telas e drill-downs
   ════════════════════════════════════════════════════════════ */

/* ───────── ESTADO ───────── */
const EXCLUDED_MONTHS = new Set(['2026-01']);
const LAST_CLOSED_MONTH = D.meta?.ultimo_mes_horas || D.meses[D.meses.length-1];
const AVAILABLE_MONTHS = D.meses.filter(m=>m<=LAST_CLOSED_MONTH&&!EXCLUDED_MONTHS.has(m));
const S = {
  screen: 'painel',
  meses: [AVAILABLE_MONTHS[AVAILABLE_MONTHS.length-1]], // abre no último mês fechado
  periodKind: 'month',
  carteira: 'ativos',              // inativos só aparecem sob escolha explícita
  rate: 'mensal',                  // custo | mensal | pontual
  tmMode: 'sem',                   // times: sem/com sócios
  hmTime: 'todos', hmAtivo: 'ativo',
  mFilter: 'todos', mSortK: 'margem', mSortAsc: true,
  prFilter: 'todos', prSortK: 'm', prSortAsc: false,
  jFilter: 'horas', jSortK: 'ca', jSortAsc: false,
  decisionFilter: 'open',
  charts: {},
};
let AUDIT_QUEUE=[], AUDIT_DETAILS=[];

/* As três tabelas são calculadas por cargo no pipeline; C não estima tarifas. */
const RATE_FACTOR = { custo: 1, mensal: 1, pontual: 1 };
const RATE_LABEL = {
  custo: 'Custo interno por cargo e competência',
  mensal: 'Valor técnico pela tabela mensal da competência',
  pontual: 'Valor técnico pela tabela pontual da competência'
};

/* Contextos estratégicos: a base versionada é combinada com registros locais
   feitos no Cliente 360. O armazenamento local é deliberadamente identificado
   na interface, pois este site estático não possui banco de dados. */
const STRATEGY_STORAGE_KEY = 'dbcl-bi-v4-strategic-decisions';
function localStrategicDecisions(){
  try { const rows=JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY)||'[]'); return Array.isArray(rows)?rows.filter(d=>d&&typeof d.id==='string'&&typeof d.client==='string'):[]; }
  catch(_error){ return []; }
}
function strategicDecisions(){
  const official=(typeof DBCL_STRATEGIC_DECISIONS!=='undefined'&&DBCL_STRATEGIC_DECISIONS.decisions)||[];
  return [...localStrategicDecisions().map(d=>({...d,storage:'local'})),...official.map(d=>({...d,storage:'official'}))];
}
function strategicDecisionApplies(decision, months=S.meses){
  if(!decision||!['active','monitoring'].includes(decision.status)||!months.length) return false;
  const first=months[0], last=months[months.length-1];
  if(!decision.startMonth&&!decision.endMonth){
    const provisionalWindow=decision.durationMonths
      ? AVAILABLE_MONTHS.slice(-Math.max(1,Number(decision.durationMonths)))
      : [LAST_CLOSED_MONTH];
    return months.some(month=>provisionalWindow.includes(month));
  }
  return (!decision.startMonth||decision.startMonth<=last)&&(!decision.endMonth||decision.endMonth>=first);
}
function clientStrategicDecisions(name, applicableOnly=false){
  return strategicDecisions().filter(d=>String(d.client).trim().toLocaleLowerCase('pt-BR')===String(name).trim().toLocaleLowerCase('pt-BR')&&(!applicableOnly||strategicDecisionApplies(d)));
}
function activeClientDecision(name){ return clientStrategicDecisions(name,true)[0]||null; }
function strategicPeriodLabel(d){
  if(d.startMonth&&d.endMonth) return `${mLbl(d.startMonth)} ${d.startMonth.slice(0,4)} – ${mLbl(d.endMonth)} ${d.endMonth.slice(0,4)}`;
  if(d.startMonth) return `desde ${mLbl(d.startMonth)} ${d.startMonth.slice(0,4)}`;
  if(d.endMonth) return `até ${mLbl(d.endMonth)} ${d.endMonth.slice(0,4)}`;
  return d.durationMonths?`últimos ${d.durationMonths} meses disponíveis (janela provisória)`: `mês atual (datas a confirmar)`;
}
function saveStrategicDecision(event, client){
  event.preventDefault();
  const form=event.currentTarget, field=name=>form.elements[name];
  const record={
    id:`local-${Date.now()}`,client,type:field('type').value,status:field('status').value,
    title:field('title').value.trim(),rationale:field('rationale').value.trim(),
    recommendation:field('recommendation').value.trim(),potential:field('potential').value,
    relationshipRisk:field('relationshipRisk').value,startMonth:field('startMonth').value,
    endMonth:field('endMonth').value,nextReview:field('nextReview').value,
    successMetric:field('successMetric').value.trim(),owner:field('owner').value.trim()||'Não definido',
    source:'Registrado no Cliente 360',updatedAt:new Date().toISOString().slice(0,10)
  };
  if(!record.title||!record.rationale){ alert('Preencha o título e o contexto da decisão.'); return; }
  if(record.startMonth&&record.endMonth&&record.startMonth>record.endMonth){ alert('O mês inicial deve ser anterior ao mês final.'); return; }
  const rows=localStrategicDecisions(); rows.unshift(record);
  try { localStorage.setItem(STRATEGY_STORAGE_KEY,JSON.stringify(rows)); }
  catch(_error){ alert('O navegador não permitiu salvar este registro.'); return; }
  render(); openCliente(client);
}
function deleteStrategicDecision(id,client){
  const rows=localStrategicDecisions().filter(d=>d.id!==id);
  localStorage.setItem(STRATEGY_STORAGE_KEY,JSON.stringify(rows));
  render(); openCliente(client);
}
function setStrategicDecisionStatus(id,status,client){
  const rows=localStrategicDecisions().map(d=>d.id===id?{...d,status,updatedAt:new Date().toISOString().slice(0,10)}:d);
  localStorage.setItem(STRATEGY_STORAGE_KEY,JSON.stringify(rows));
  render();
  if(client) openCliente(client);
}
function decisionIsOpen(d){ return ['active','monitoring'].includes(d.status); }
function decisionIsOverdue(d){
  return decisionIsOpen(d)&&d.nextReview&&d.nextReview<new Date().toISOString().slice(0,10);
}
function decisionDueLabel(d){
  if(!d.nextReview) return 'revisão não definida';
  if(decisionIsOverdue(d)) return `atrasada desde ${fmtDate(d.nextReview)}`;
  return `revisar em ${fmtDate(d.nextReview)}`;
}
function downloadStrategicDecisions(){
  const rows=strategicDecisions().map(d=>[d.client,d.title,d.type,d.status,d.startMonth||'',d.endMonth||'',d.nextReview||'',d.owner||'',d.potential||'unknown',d.relationshipRisk||'unknown',d.rationale||'',d.recommendation||'',d.successMetric||'',d.storage==='official'?'Base oficial':'Navegador']);
  downloadCsv(`decisoes-estrategicas-dbcl-${new Date().toISOString().slice(0,10)}.csv`,['Cliente','Decisão','Tipo','Status','Início','Fim','Próxima revisão','Responsável','Potencial','Risco de relacionamento','Contexto','Recomendação','Critério de sucesso','Origem'],rows);
}

const monthDate = m => new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1);
const mLbl = m => monthDate(m).toLocaleDateString('pt-BR',{month:'short'}).replace('.','').replace(/^./,c=>c.toUpperCase());
const mFullLbl = m => monthDate(m).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());

/* ───────── HELPERS ───────── */
const F = RATE_FACTOR; 
const rf = () => F[S.rate];
const fmt = v => v==null ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const fmtK = v => v==null ? '—' : (Math.abs(v)>=1000 ? 'R$ '+(v/1000).toFixed(0)+'k' : fmt(v));
const fmtH = v => v==null ? '—' : v.toLocaleString('pt-BR',{maximumFractionDigits:1});
const fmtP = v => v==null ? '—' : v.toFixed(1).replace('.',',')+'%';
const fmtDate = iso => iso ? iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4) : '—';
const fmtDateTime = value => {
  if(!value) return '—';
  const [date,time] = value.split(' ');
  return `${fmtDate(date)}${time?` às ${time}`:''}`;
};
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const jsq = s => esc(String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'\\r').replace(/\n/g,'\\n'));
const cm = (v,inv) => v==null ? '' : (inv ? (v<0?'g':v>0?'r':'') : (v>0?'g':v<0?'r':''));

// custo ajustado pela tabela ativa
const C = v => (v||0) * rf();
// margem ajustada: receita - custo*fator
const M = (rec, custo) => (rec||0) - C(custo);

function isActive(item){
  const detail = item?.cod ? D.servicos_det[item.cod] : null;
  const source = item?.ativo_meses ? item : (detail || item);
  return S.meses.some(month=>DBCLCore.activeAt(source,month));
}
function carteiraRows(rows){
  if(S.carteira==='todos') return rows;
  return rows.filter(item=>S.carteira==='ativos' ? isActive(item) : !isActive(item));
}
function clientIsActive(name){
  const services = D.cli_det[name]?.svcs || [];
  return services.some(service=>isActive(service));
}
function carteiraDescription(){
  return S.carteira==='ativos' ? 'carteira ativa' : S.carteira==='inativos' ? 'histórico inativo' : 'ativos e inativos';
}

// soma pm de um objeto {mes:{h,c}} apenas nos meses ativos
function sumPM(pm, key){ let s=0; for(const m of S.meses){ if(pm && pm[m]) s += pm[m][key]||0; } return s; }
function pmVals(pm, key){ return S.meses.map(m => (pm && pm[m]) ? (pm[m][key]||0) : 0); }

// comparação usa uma janela anterior com o mesmo número de meses disponíveis
function comparisonHTML(current, previous, invert){
  if(previous==null) return '<span class="trend flat">sem base anterior</span>';
  if(previous===0 && current===0) return '<span class="trend flat">■ 0%</span>';
  if(previous===0) return '<span class="trend flat">nova base</span>';
  const d = ((current-previous)/Math.abs(previous))*100;
  const up = d>2, down = d<-2;
  const cls = invert ? (up?'down':down?'up':'flat') : (up?'up':down?'down':'flat');
  const arrow = up?'▲':down?'▼':'■';
  return `<span class="trend ${cls}">${arrow} ${Math.abs(d).toFixed(0)}%</span>`;
}
function previousComparableMonths(months){ return DBCLCore.previousMonths(months,AVAILABLE_MONTHS,S.periodKind); }

function sumPMMonths(pm, months, key){
  return months.reduce((sum,month)=>sum+(pm?.[month]?.[key]||0),0);
}
function activeMonths(item, months){
  const detail=item?.cod ? D.servicos_det[item.cod] : null;
  const source=item?.ativo_meses ? item : (detail || item);
  return months.filter(month=>DBCLCore.activeAt(source,month));
}
function sumFinancialPM(item, months, key){
  return sumPMMonths(item.pm,activeMonths(item,months),key);
}
function sumHoursByMonths(pm, months){
  return months.reduce((sum,month)=>sum+(pm?.[month]||0),0);
}
function officialHomeTeam(raw){
  const value=String(raw||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(value.includes('trabalh')) return 'Trabalhista';
  if(value.includes('contenc')) return 'Contencioso';
  if(value.includes('consult')||value.includes('tribut')) return 'Consultivo';
  if(value.includes('socio')) return 'Transversal';
  return 'Não classificado';
}
function sparkHTML(vals, neg){
  const mx = Math.max(...vals.map(Math.abs), 1);
  return '<span class="spark">' + vals.map(v=>`<i style="height:${Math.max(2,Math.abs(v)/mx*20)}px" class="${(neg&&v<0)?'neg':''}"></i>`).join('') + '</span>';
}

function destroyChart(id){ if(S.charts[id]){ S.charts[id].destroy(); delete S.charts[id]; } }
function mkChart(id, cfg){ destroyChart(id); const el=document.getElementById(id); if(!el) return; S.charts[id]=new Chart(el, cfg); }

Chart.defaults.font.family = "'Inter',system-ui,sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#6B6A62';
Chart.defaults.plugins.legend.labels.boxWidth = 10;

/* ───────── DADOS DERIVADOS (recalculados por período/tabela) ───────── */
function mensalCalc(){
  return D.mensal.map(m => {
    const months=activeMonths(m,S.meses);
    const hb = sumPMMonths(m.pm,months,'h'), hp = sumPMMonths(m.pm,months,'hp'), hi = sumPMMonths(m.pm,months,'hi');
    const h = hb + hi;
    const cRaw = sumPMMonths(m.pm,months,'c'), rec = sumPMMonths(m.pm,months,'r');
    const custo = C(cRaw), margem = rec - custo;
    const mpct = rec>0 ? margem/rec*100 : null;
    return {...m, ativo:isActive(m), _h:h,_hb:hb,_hp:hp,_hi:hi,_cRaw:cRaw,_custo:custo,_rec:rec,_margem:margem,_mpct:mpct,_recM:rec/Math.max(1,months.length)};
  });
}
function lcCalc(){
  return D.lc.map(p => {
    const h = sumFinancialPM(p,S.meses,'h'), cRaw = sumFinancialPM(p,AVAILABLE_MONTHS,'c');
    const custo = C(cRaw), margem = (p.rec||0) - custo;
    return {...p, ativo:isActive(p), _h:h,_cRaw:cRaw,_custo:custo,_margem:margem,_mp:p.rec>0?margem/p.rec*100:null,_rph:h>0?(p.rec||0)/h:null};
  });
}
function judCalc(){
  return D.jud.map(j => {
    const h = sumFinancialPM(j,S.meses,'h'), cRaw = sumFinancialPM(j,AVAILABLE_MONTHS,'c');
    const ca = C(cRaw);
    const mse = (j.e||0) - ca;
    const be = Math.max(0, ca - (j.e||0));
    const mt = (j.e||0) + (j.x||0) - ca;
    const status = mse>=0 ? 'ok' : (mt>=0 ? 'ganhar' : 'inviavel');
    return {...j, ativo:isActive(j), _h:h,_ca:ca,_mse:mse,_be:be,_mt:mt,_status:status};
  });
}
function hmCalc(){
  return D.hm.map(p => {
    let tot=0,v=0,a=0,g=0,adm=0;
    for(const m of S.meses){ const pm=p.pm[m]; if(pm){tot+=pm.tot;v+=pm.v;a+=pm.a;g+=pm.g;adm+=pm.adm;} }
    const pct = tot>0 ? {v:v/tot*100,a:a/tot*100,g:g/tot*100,adm:adm/tot*100} : {v:0,a:0,g:0,adm:0};
    return {...p, _time:officialHomeTeam(p.time),_tot:tot,_h:{v,a,g,adm},_pct:pct};
  });
}

/* ───────── ALERTAS DO PAINEL ───────── */
function buildAlerts(){
  const alerts = [];
  const men = carteiraRows(mensalCalc());
  const recTot = men.reduce((s,m)=>s+m._rec,0);

  // 1. Concentração
  const sorted = men.filter(m=>m._rec>0).sort((a,b)=>b._rec-a._rec);
  if(sorted.length && recTot>0){
    const top = sorted[0], share = top._rec/recTot*100;
    if(share>=25) alerts.push({sev:'r',ico:'⚠️',tit:`${top.cli} concentra ${share.toFixed(0)}% da receita de mensalistas`,act:`<b>Ação:</b> diversificar carteira ou proteger o contrato — risco de dependência crítica`,go:()=>go('portfolio')});
  }
  // 2. Mensalistas negativos
  const neg = men.filter(m=>m._rec>0 && m._margem<0).sort((a,b)=>a._margem-b._margem);
  if(neg.length){
    const pior = neg[0];
    alerts.push({sev:'r',ico:'🔻',tit:`${neg.length} mensalista${neg.length>1?'s':''} com margem negativa · pior: ${pior.cli} (${fmt(pior._margem)})`,act:`<b>Ação:</b> renegociar valor, reduzir escopo ou rever alocação do time nesses clientes`,go:()=>{S.mFilter='neg';go('mensalistas');}});
  }
  // 3. Judiciais inviáveis
  const jud = carteiraRows(judCalc()).filter(j=>j._h>0);
  const inv = jud.filter(j=>j._status==='inviavel');
  if(inv.length){
    const custoInv = inv.reduce((s,j)=>s+j._ca,0);
    alerts.push({sev:'a',ico:'⚖️',tit:`${inv.length} processos inviáveis — mesmo ganhando, o êxito não cobre o custo (${fmt(custoInv)} acumulado)`,act:`<b>Ação:</b> avaliar acordo, redução de dedicação ou repactuação de honorários caso a caso`,go:()=>{S.jFilter='inviavel';go('judicial');}});
  }
  // 4. Sem receita cadastrada
  const semRec = men.filter(m=>m._rec===0 && m._h>0);
  const semRecSemContexto=semRec.filter(m=>!activeClientDecision(m.cli));
  const semRecComContexto=semRec.filter(m=>activeClientDecision(m.cli));
  if(semRecSemContexto.length){
    const custoSR = semRecSemContexto.reduce((s,m)=>s+m._custo,0);
    alerts.push({sev:'a',ico:'📋',tit:`${semRecSemContexto.length} clientes com horas e receita zero sem explicação (${fmt(custoSR)} de custo)`,act:`<b>Ação:</b> financeiro corrige a receita ou os sócios registram a decisão que explica a ausência de faturamento`,go:()=>go('portfolio')});
  }
  if(semRecComContexto.length){
    const custoSR=semRecComContexto.reduce((s,m)=>s+m._custo,0);
    alerts.push({sev:'g',ico:'🎯',tit:`${semRecComContexto.length} investimento${semRecComContexto.length===1?'':'s'} estratégico${semRecComContexto.length===1?'':'s'} documentado${semRecComContexto.length===1?'':'s'} sem receita (${fmt(custoSR)} de custo)`,act:`<b>Ação:</b> acompanhar prazo, consumo de horas e contrapartida esperada`,go:()=>openCliente(semRecComContexto[0].cli)});
  }
  // 5. Projetos vendidos sem execução
  const lc = carteiraRows(lcCalc());
  const parados = lc.filter(p=>(p.rec||0)>=10000 && p._h===0);
  if(parados.length){
    const recPar = parados.reduce((s,p)=>s+p.rec,0);
    alerts.push({sev:'g',ico:'💤',tit:`${parados.length} projetos vendidos (${fmtK(recPar)}) sem horas no período selecionado`,act:`<b>Ação:</b> confirmar se já iniciaram — receita boa, mas execução parada pode virar problema de prazo`,go:()=>{S.prFilter='sem_h';go('projetos');}});
  }
  // 6. Mensalista saudável destaque (positivo)
  const top3 = men.filter(m=>m._rec>0&&m._mpct!=null&&m._mpct>40&&m._h>5).sort((a,b)=>b._margem-a._margem);
  if(top3.length){
    alerts.push({sev:'g',ico:'✅',tit:`${top3.length} mensalistas com margem acima de 40% — carteira saudável a preservar`,act:`<b>Ação:</b> nenhuma — manter nível de serviço; são os contratos que financiam o resto`,go:()=>go('mensalistas')});
  }
  return alerts;
}

/* ───────── NAVEGAÇÃO ───────── */
function go(screen){
  if(!document.getElementById('screen-'+screen))return;
  S.screen = screen;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+screen).classList.add('active');
  document.querySelectorAll('.sb-btn[data-s]').forEach(b=>b.classList.toggle('active', b.dataset.s===screen));
  render();
  document.body.classList.remove('nav-open');
  window.scrollTo(0,0);
}
function toggleList(id){ document.getElementById(id).classList.toggle('open'); }
function filterList(id, q){
  q = q.toLowerCase();
  document.querySelectorAll('#'+id+'-items .sb-list-item').forEach(el=>{
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function closeOv(t){ document.getElementById('ov-'+t).classList.remove('open'); }

/* ───────── PERÍODO ───────── */
let PERIOD_GROUPS = {};

function periodRangeLabel(months){
  if(months.length===1) return mFullLbl(months[0]);
  const first=months[0], last=months[months.length-1];
  const fy=first.slice(0,4), ly=last.slice(0,4);
  return fy===ly ? `${mLbl(first)}–${mLbl(last)} ${fy}` : `${mLbl(first)} ${fy}–${mLbl(last)} ${ly}`;
}
function periodGroups(kind){
  const grouped = new Map();
  AVAILABLE_MONTHS.forEach(month=>{
    const year=month.slice(0,4), number=Number(month.slice(5,7));
    let key, label;
    if(kind==='month'){key=month;label=mFullLbl(month);}
    if(kind==='quarter'){
      const quarter=Math.ceil(number/3);key=`${year}-Q${quarter}`;label=`${quarter}º trimestre de ${year}`;
    }
    if(kind==='semester'){
      const semester=number<=6?1:2;key=`${year}-S${semester}`;label=`${semester}º semestre de ${year}`;
    }
    if(kind==='year'){key=year;label=year;}
    if(!grouped.has(key)) grouped.set(key,{key,label,months:[]});
    grouped.get(key).months.push(month);
  });
  return [...grouped.values()].reverse();
}
function applyPeriod(months,label){
  S.meses=months.slice();
  document.getElementById('period-note').textContent=label || periodRangeLabel(S.meses);
  render();
}
function buildPeriodBar(){
  const options=AVAILABLE_MONTHS.map(m=>`<option value="${m}">${mFullLbl(m)}</option>`).join('');
  document.getElementById('period-start').innerHTML=options;
  document.getElementById('period-end').innerHTML=options;
  setPeriodKind('month');
}
function setPeriodKind(kind){
  S.periodKind=kind;
  document.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('active',b.dataset.kind===kind));
  const selector=document.getElementById('period-select');
  const custom=document.getElementById('custom-period');
  custom.classList.toggle('open',kind==='custom');
  selector.style.display=kind==='custom'?'none':'';

  if(kind==='custom'){
    document.getElementById('period-start').value=S.meses[0]||AVAILABLE_MONTHS[AVAILABLE_MONTHS.length-1];
    document.getElementById('period-end').value=S.meses[S.meses.length-1]||AVAILABLE_MONTHS[AVAILABLE_MONTHS.length-1];
    applyCustomPeriod();
    return;
  }
  if(kind==='all'){
    selector.innerHTML='<option>Todo o histórico disponível</option>';
    applyPeriod(AVAILABLE_MONTHS,periodRangeLabel(AVAILABLE_MONTHS));
    return;
  }
  const groups=periodGroups(kind);
  PERIOD_GROUPS=Object.fromEntries(groups.map(group=>[group.key,group]));
  selector.innerHTML=groups.map(group=>`<option value="${group.key}">${group.label}</option>`).join('');
  const anchor=S.meses[S.meses.length-1] || D.meta?.ultimo_mes_horas;
  selector.value=(groups.find(group=>group.months.includes(anchor)) || groups[0]).key;
  applyPeriodChoice();
}
function applyPeriodChoice(){
  const group=PERIOD_GROUPS[document.getElementById('period-select').value];
  if(group) applyPeriod(group.months,S.periodKind==='month' ? group.label : `${group.label} · ${periodRangeLabel(group.months)}`);
}
function applyCustomPeriod(){
  const start=document.getElementById('period-start').value;
  const end=document.getElementById('period-end').value;
  const low=Math.min(AVAILABLE_MONTHS.indexOf(start),AVAILABLE_MONTHS.indexOf(end));
  const high=Math.max(AVAILABLE_MONTHS.indexOf(start),AVAILABLE_MONTHS.indexOf(end));
  if(low<0||high<0) return;
  const months=AVAILABLE_MONTHS.slice(low,high+1);
  applyPeriod(months,periodRangeLabel(months));
}
function setCarteira(value){
  S.carteira=value;
  document.querySelectorAll('[data-carteira]').forEach(b=>b.classList.toggle('active',b.dataset.carteira===value));
  buildSidebarLists();
  render();
}
function setRate(r){
  DBCLCore.applyRate(D,r,S.rate);
  S.rate = r;
  document.querySelectorAll('.rt-btn').forEach(b=>b.classList.toggle('active', b.dataset.rt===r));
  document.getElementById('rt-note').textContent = 'Tabela de hora ativa: ' + RATE_LABEL[r];
  render();
}

function auditSummary(){
  const au=D.meta?.auditoria||{}, cv=au.codigo_venda_themis||{}, crm=au.cadastro_crm||{};
  const fonte=cv.horas_por_mes_fonte||{};
  const admExcluido=au.exclusao_time_administrativo?.horas_por_mes||{};
  const fonteMeses=Object.keys(fonte);
  const reconciliado=fonteMeses.length>0&&fonteMeses.every(m=>Math.abs((D.kpm[m]?.h||0)-((fonte[m]||0)-(admExcluido[m]||0)))<=.051);
  const mensalSem=mensalCalc().filter(m=>m.ativo!==false&&m._rec===0&&m._h>0&&!activeClientDecision(m.cli));
  const groups=[
    !reconciliado,
    (cv.linhas_sem_codigo_crm||0)>0,
    (au.themis_alocacao?.linhas_possivelmente_duplicadas||0)>0,
    mensalSem.length>0,
    (crm.registros_incompletos||[]).length>0,
    (crm.valores_financeiros_nao_confirmados||[]).length>0,
    (au.valores_pessoas?.registros||[]).length>0,
    (au.mapa_pastas?.registros_ambiguos||[]).length>0,
    (au.pessoas_themis?.nao_cadastradas||[]).length>0,
  ].filter(Boolean).length;
  return {groups,reconciliado,mensalSem};
}
function renderContextBar(){
  const el=document.getElementById('global-context');
  if(!el) return;
  const period=periodRangeLabel(S.meses);
  const selection=document.getElementById("analysis-selection");
  if(selection)selection.textContent=`${period} · ${carteiraDescription()} · tabela ${S.rate}`;
  const cut=D.meta?.ultima_data_horas ? fmtDate(D.meta.ultima_data_horas) : mFullLbl(LAST_CLOSED_MONTH);
  const audit=auditSummary();
  const pendingRevenue=(D.meta?.auditoria?.mensalistas_fonte?.pendencias_valores||[]).some(p=>!p.month||S.meses.includes(p.month));
  el.innerHTML=`
    <span class="context-chip"><b>Período:</b> ${esc(period)}</span>
    <span class="context-chip"><b>Carteira:</b> ${esc(carteiraDescription())}</span>
    <span class="context-chip"><b>Custo:</b> tabela ${esc(S.rate)}</span>
    <span class="context-meta"><strong>Dados até ${esc(cut)}</strong> · gerado em ${esc(fmtDateTime(D.meta?.gerado_em))}</span>
    <button class="context-audit" onclick="go('auditoria')">${audit.groups?`⚠ ${audit.groups} frente${audit.groups===1?'':'s'} de correção`:'✓ Base sem pendências cadastrais'} →</button>
    ${pendingRevenue?'<button class="context-audit" onclick="go(&quot;contratos&quot;)">⚠ Receita incompleta: conferir mensalidades</button>':''}
    <button class="context-reset" onclick="resetGlobalFilters()" title="Voltar para o último mês fechado, carteira ativa e tabela mensal">Limpar filtros</button>`;
}
function resetGlobalFilters(){
  S.meses=[AVAILABLE_MONTHS[AVAILABLE_MONTHS.length-1]];
  S.carteira='ativos';
  DBCLCore.applyRate(D,'mensal',S.rate);
  S.rate='mensal';
  document.querySelectorAll('[data-carteira]').forEach(b=>b.classList.toggle('active',b.dataset.carteira==='ativos'));
  document.querySelectorAll('.rt-btn').forEach(b=>b.classList.toggle('active',b.dataset.rt==='mensal'));
  document.getElementById('rt-note').textContent='Tabela de hora ativa: '+RATE_LABEL.mensal;
  buildSidebarLists();
  setPeriodKind('month');
}

/* ───────── PAINEL GERAL ───────── */
function renderPainel(){
  const men = carteiraRows(mensalCalc()), lc = carteiraRows(lcCalc()), jud = carteiraRows(judCalc());
  const auditState=auditSummary();
  const previousMonths=previousComparableMonths(S.meses);
  // KPIs
  const hVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].h:0);
  const hcVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].hc:0);
  const hTot = hVals.reduce((a,b)=>a+b,0);
  const recM = men.reduce((s,m)=>s+m._rec,0);
  const cusM = men.reduce((s,m)=>s+m._custo,0);
  const margM = recM-cusM;
  const margVals = S.meses.map(mo=>{
    let r=0,c=0; men.forEach(m=>{ if(m.pm[mo]){r+=m.pm[mo].r||0;c+=C(m.pm[mo].c||0);} }); return r-c;
  });
  const negN = men.filter(m=>m._rec>0&&m._margem<0).length;
  const projM = lc.reduce((s,p)=>s+p._margem,0);
  const invN = jud.filter(j=>j._h>0&&j._status==='inviavel').length;
  const pessoasPeriodo = carteiraRows(hmCalc()).filter(p=>p._tot>0.5).length;
  const previousHours=previousMonths.length===S.meses.length
    ? previousMonths.reduce((sum,m)=>sum+(D.kpm[m]?.h||0),0) : null;
  const previousRevenue=previousMonths.length===S.meses.length
    ? men.reduce((sum,m)=>sum+sumFinancialPM(m,previousMonths,'r'),0) : null;
  const previousMargin=previousMonths.length===S.meses.length
    ? men.reduce((sum,m)=>sumFinancialPM(m,previousMonths,'r')-C(sumFinancialPM(m,previousMonths,'c'))+sum,0) : null;
  const comparisonLabel=previousMonths.length===S.meses.length ? `vs. ${periodRangeLabel(previousMonths)}` : 'sem período anterior equivalente';

  const recSorted=men.filter(m=>m._rec>0).sort((a,b)=>b._rec-a._rec);
  const topClient=recSorted[0];
  const concentration=topClient&&recM>0?topClient._rec/recM*100:0;
  const people=hmCalc().filter(p=>p._tot>0);
  const partnerHours=people.filter(p=>String(p.fn).toLocaleLowerCase('pt-BR').includes('sócio')).reduce((sum,p)=>sum+p._tot,0);
  const partnerShare=hTot>0?partnerHours/hTot*100:0;
  const clientHours=hcVals.reduce((a,b)=>a+b,0);
  const clientShare=hTot>0?clientHours/hTot*100:0;
  const marginPct=recM>0?margM/recM*100:null;
  const semReceita=men.filter(m=>m._rec===0&&m._h>0);
  const semReceitaSemContexto=semReceita.filter(m=>!activeClientDecision(m.cli));
  const investimentosAtivos=semReceita.filter(m=>activeClientDecision(m.cli)).sort((a,b)=>b._custo-a._custo);
  const dataReady=auditState.reconciliado;
  document.getElementById('pg-saud').textContent='Visão dos sócios';
  document.getElementById('pg-sub').textContent=`${periodRangeLabel(S.meses)} · ${carteiraDescription()} · ${pessoasPeriodo} pessoas do cadastro selecionado com horas.`;
  document.getElementById('pg-health').innerHTML=`<i style="background:${dataReady?'var(--neon)':'#ff8d82'}"></i><span>${dataReady?'Fonte conciliada':`Base com divergência`} · ${auditState.groups} frente${auditState.groups===1?'':'s'} aberta${auditState.groups===1?'':'s'}</span>`;
  document.getElementById('pg-kpis').innerHTML = `
    <div class="command-metric" onclick="go('pessoas')"><div class="l">Horas do escritório · todas as carteiras</div><div class="v">${fmtH(hTot)}h</div><div class="s">${comparisonHTML(hTot,previousHours)} · ${fmtP(clientShare)} em clientes</div></div>
    <div class="command-metric" onclick="go('mensalistas')"><div class="l">Receita recorrente cadastrada</div><div class="v">${fmtK(recM)}</div><div class="s">${comparisonHTML(recM,previousRevenue)} ${comparisonLabel}</div></div>
    <div class="command-metric" onclick="go('mensalistas')"><div class="l">Margem recorrente</div><div class="v ${margM<0?'bad':'good'}">${fmtK(margM)}</div><div class="s">${comparisonHTML(margM,previousMargin)} · ${marginPct==null?'sem base':fmtP(marginPct)} · ${negN} negativos</div></div>
    <div class="command-metric" onclick="go('judicial')"><div class="l">Risco judicial</div><div class="v ${invN?'bad':'good'}">${invN}</div><div class="s">processos economicamente inviáveis</div></div>`;

  const worstMonthly=men.filter(m=>m._rec>0&&m._margem<0).sort((a,b)=>a._margem-b._margem)[0];
  const missingRevenue=semReceitaSemContexto.slice().sort((a,b)=>b._custo-a._custo)[0];
  const worstJudicial=jud.filter(j=>j._h>0&&j._status==='inviavel').sort((a,b)=>a._mt-b._mt)[0];
  const decisions=[];
  if(investimentosAtivos[0]){
    const investment=investimentosAtivos[0], context=activeClientDecision(investment.cli);
    decisions.push({level:'medium',title:`Acompanhar ${context?.title||'decisão estratégica'} · ${investment.cli}`,why:`Receita zero está explicada; ${fmtH(investment._h)}h e ${fmtK(investment._custo)} foram tratados como investimento no período.`,value:fmtK(investment._custo),label:'investimento',go:()=>openCliente(investment.cli)});
  }
  if(worstMonthly) decisions.push({level:'high',title:`Reprecificar ou redesenhar ${worstMonthly.cli}`,why:`Maior destruição de margem recorrente entre os contratos ativos no período.`,value:fmtK(worstMonthly._margem),label:'margem',go:()=>openCliente(worstMonthly.cli)});
  if(missingRevenue) decisions.push({level:'high',title:`Regularizar receita de ${missingRevenue.cli}`,why:`Há ${fmtH(missingRevenue._h)}h trabalhadas sem receita cadastrada; a rentabilidade não é conclusiva.`,value:fmtK(missingRevenue._custo),label:'custo invisível',go:()=>openCliente(missingRevenue.cli)});
  if(worstJudicial) decisions.push({level:'medium',title:`Revisar ${worstJudicial.lbl||worstJudicial.cli}`,why:`Mesmo com o êxito estimado, o caso permanece abaixo do ponto de equilíbrio.`,value:fmtK(worstJudicial._mt),label:'margem total',go:()=>openServico(worstJudicial.cod)});
  if(!decisions.length) decisions.push({level:'',title:'Nenhuma decisão econômica crítica detectada',why:'Manter a rotina de acompanhamento e preservar os contratos saudáveis.',value:'Estável',label:'situação',go:()=>go('portfolio')});
  window._decisions=decisions;
  document.getElementById('pg-decisions').innerHTML=decisions.slice(0,3).map((d,i)=>`<div class="decision ${d.level}" onclick="window._decisions[${i}].go()"><div class="decision-rank">0${i+1}</div><div><div class="decision-title">${esc(d.title)}</div><div class="decision-why">${esc(d.why)}</div></div><div class="decision-value">${esc(d.value)}<small>${esc(d.label)}</small></div></div>`).join('');

  const theses=[
    {name:'Subir',value:topClient?fmtP(concentration):'—',sub:topClient?`Maior exposição: ${topClient.cli}. Quanto menor a concentração, maior a liberdade estratégica.`:'Sem receita recorrente no período.',width:Math.min(100,concentration),tone:concentration>=25?'bad':concentration>=15?'warn':'',go:()=>go('portfolio')},
    {name:'Aprofundar',value:marginPct==null?'—':fmtP(marginPct),sub:`Margem da carteira recorrente. Rentabilidade é condição para aprofundar valor, não apenas volume.`,width:Math.min(100,Math.abs(marginPct||0)),tone:(marginPct||0)<0?'bad':(marginPct||0)<20?'warn':'',go:()=>go('mensalistas')},
    {name:'Industrializar',value:fmtP(clientShare),sub:`Parcela das horas em clientes; sócios respondem por ${fmtP(partnerShare)} do esforço total.`,width:Math.min(100,clientShare),tone:clientShare<60?'warn':'',go:()=>go('pessoas')}
  ];
  window._theses=theses;
  document.getElementById('pg-exec').innerHTML=theses.map((t,i)=>`<div class="thesis" onclick="window._theses[${i}].go()"><div class="thesis-top"><div class="thesis-name">${esc(t.name)}</div><div class="thesis-index">${esc(t.value)}</div></div><div class="thesis-sub">${esc(t.sub)}</div><div class="thesis-track"><div class="thesis-fill ${t.tone}" style="width:${t.width}%"></div></div></div>`).join('');

  // Alertas
  const alerts = buildAlerts();
  const badge = document.getElementById('sb-alert-n');
  const crit = alerts.filter(a=>a.sev==='r').length;
  badge.style.display = crit>0 ? '' : 'none';
  badge.textContent = crit;
  window._alerts = alerts;
  document.getElementById('pg-alerts').innerHTML = alerts.map((a,i)=>
    `<div class="al sev-${a.sev}" onclick="window._alerts[${i}].go()"><span class="al-ico">${a.ico}</span><div><div class="al-tit">${a.tit}</div><div class="al-act">${a.act}</div></div><span class="al-go">abrir →</span></div>`).join('') || '<div class="note">Nenhum alerta no período. Carteira sob controle.</div>';

  // Chart horas
  mkChart('c-pg-horas', {type:'line',data:{labels:S.meses.map(mLbl),datasets:[
    {label:'Total',data:hVals,borderColor:'#0F6E56',backgroundColor:'rgba(15,110,86,.08)',fill:true,tension:.3},
    {label:'Em clientes',data:hcVals,borderColor:'#C47A00',tension:.3}
  ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});

  // Chart margem mensalistas
  const recVals = S.meses.map(mo=>{let r=0;men.forEach(m=>{if(m.pm[mo])r+=m.pm[mo].r||0});return r;});
  const cusVals = S.meses.map(mo=>{let c=0;men.forEach(m=>{if(m.pm[mo])c+=C(m.pm[mo].c||0)});return c;});
  mkChart('c-pg-marg', {type:'bar',data:{labels:S.meses.map(mLbl),datasets:[
    {label:'Receita',data:recVals,backgroundColor:'#0F6E56'},
    {label:'Custo ('+S.rate+')',data:cusVals,backgroundColor:'#C0392B'}
  ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}}}});

  // Concentração top 10
  const sorted = men.filter(m=>m._rec>0).sort((a,b)=>b._rec-a._rec).slice(0,10);
  const recTot = men.reduce((s,m)=>s+m._rec,0);
  document.getElementById('pg-conc').innerHTML = sorted.map(m=>{
    const pct = m._rec/recTot*100;
    return `<div class="conc-row" onclick="openCliente('${jsq(m.cli)}')"><div class="conc-nm">${esc(m.cli)}</div><div class="conc-bar"><div class="conc-fill" style="width:${pct}%;${pct>=25?'background:var(--red)':''}"></div></div><div class="conc-val">${fmtK(m._rec)} · ${pct.toFixed(0)}%</div></div>`;
  }).join('');

  // Worst margins
  const worst = men.filter(m=>m._rec>0).sort((a,b)=>a._margem-b._margem).slice(0,6);
  document.getElementById('pg-worst').innerHTML = `<thead><tr><th>Cliente</th><th class="r">Receita</th><th class="r">Custo</th><th class="r">Margem</th><th class="r">%</th></tr></thead><tbody>` +
    worst.map(m=>`<tr onclick="openCliente('${jsq(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td class="tr">${fmtK(m._rec)}</td><td class="tr">${fmtK(m._custo)}</td><td class="tr" style="color:${m._margem<0?'var(--red)':'var(--g2)'};font-weight:600">${fmtK(m._margem)}</td><td class="tr">${fmtP(m._mpct)}</td></tr>`).join('') + '</tbody>';
}

/* ───────── TIMES ───────── */
function tmTgl(mode, btn){
  S.tmMode = mode;
  btn.parentElement.querySelectorAll('.tgl').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderTimes();
}
function renderTimes(){
  const td = D.times[S.tmMode==='sem'?'sem_socios':'com_socios'];
  const names = ['Trabalhista','Contencioso','Consultivo'];
  const previousMonths=previousComparableMonths(S.meses);
  // KPIs from filtered months
  let hTot=0, hCli=0, pessoas = new Set();
  names.forEach(n=>{ for(const m of S.meses){ const pm=td[n].pm[m]; if(pm){ hTot+=pm.tot; hCli+=pm.v+pm.a+pm.g; } } });
  const hmAll = hmCalc();
  const ct = hmAll.reduce((s,p)=>s+0,0);
  document.getElementById('t-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Horas classificadas</div><div class="kc-v">${fmtH(hTot)}</div><div class="kc-s">${comparisonHTML(hTot,previousMonths.length===S.meses.length?names.reduce((sum,n)=>sum+previousMonths.reduce((s,m)=>s+(td[n]?.pm?.[m]?.tot||0),0),0):null)}</div></div>
    <div class="kc"><div class="kc-l">% em clientes</div><div class="kc-v g">${hTot>0?fmtP(hCli/hTot*100):'—'}</div></div>
    <div class="kc"><div class="kc-l">Times oficiais</div><div class="kc-v">${names.length}</div></div>
    <div class="kc"><div class="kc-l">Pessoas no período</div><div class="kc-v">${carteiraRows(hmAll).filter(p=>p._tot>0.5).length}</div></div>`;

  // Stacked bar by month
  const colors = {'Trabalhista':'#64B5F6','Contencioso':'#EF9A9A','Consultivo':'#80CBC4'};
  mkChart('c-tm',{type:'bar',data:{labels:S.meses.map(mLbl),datasets:names.map(n=>({label:n,data:S.meses.map(m=>td[n].pm[m]?td[n].pm[m].tot:0),backgroundColor:colors[n]||'#999'}))},
    options:{maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});

  // Composition bars
  document.getElementById('t-bars').innerHTML = names.map(n=>{
    let v=0,a=0,g=0,adm=0,t=0;
    for(const m of S.meses){ const pm=td[n].pm[m]; if(pm){v+=pm.v;a+=pm.a;g+=pm.g;adm+=pm.adm;t+=pm.tot;} }
    if(t===0) return '';
    return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><b>${n}</b><span class="tm">${fmtH(t)}h</span></div>
      <div class="sbar"><div class="sv" style="width:${v/t*100}%"></div><div class="sa" style="width:${a/t*100}%"></div><div class="sg" style="width:${g/t*100}%"></div><div class="sd" style="width:${adm/t*100}%"></div></div></div>`;
  }).join('');

  // Table
  let html = `<thead><tr><th>Time</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Total</th><th class="r">Vs. anterior</th><th class="r">🔴%</th><th class="r">🟡%</th><th class="r">🟢%</th><th class="r">⬜%</th></tr></thead><tbody>`;
  names.forEach(n=>{
    let v=0,a=0,g=0,adm=0,t=0; const cells = S.meses.map(m=>{const pm=td[n].pm[m];const tt=pm?pm.tot:0;if(pm){v+=pm.v;a+=pm.a;g+=pm.g;adm+=pm.adm;t+=pm.tot;}return `<td class="tr">${fmtH(tt)}</td>`;}).join('');
    const prior=previousMonths.length===S.meses.length?previousMonths.reduce((sum,m)=>sum+(td[n]?.pm?.[m]?.tot||0),0):null;
    html += `<tr><td><b>${n}</b></td>${cells}<td class="tr"><b>${fmtH(t)}</b></td><td class="tr">${comparisonHTML(t,prior)}</td><td class="tr">${t>0?fmtP(v/t*100):'—'}</td><td class="tr">${t>0?fmtP(a/t*100):'—'}</td><td class="tr">${t>0?fmtP(g/t*100):'—'}</td><td class="tr">${t>0?fmtP(adm/t*100):'—'}</td></tr>`;
  });
  document.getElementById('t-table').innerHTML = html + '</tbody>';
}

/* ───────── ÁREAS & CLUSTERS ───────── */
function frontAuditRows(){
  const query=(document.getElementById('ar-audit-search')?.value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const status=document.getElementById('ar-audit-filter')?.value||'todos';
  return (D.work_dimensions?.conferencia_classificacao||[]).filter(row=>{
    if(!S.meses.includes(row.m)) return false;
    if(status!=='todos'&&row.status!==status) return false;
    if(!query) return true;
    return [row.cliente,row.servico,row.codigo,row.pasta,row.fonte,row.registro,row.natureza,row.area_crm,row.area,row.frente,row.status]
      .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query);
  }).sort((a,b)=>(b.h||0)-(a.h||0));
}
function frontAuditSourceLabel(value){
  return ({
    themis_registro:'Themis · Caso/Processo',crm_tipo:'CRM · tipo da venda',
    area_tipo_fonte:'Themis · área/tipo',eleven_tag:'Eleven · TAG',
    eleven_pasta:'Eleven · pasta',eleven_time_pessoa:'Eleven · time da pessoa',
    pendente:'Pendente'
  })[value]||value||'—';
}
function frontAuditAreaSourceLabel(value){
  return ({crm:'CRM',themis_explicito:'Themis · termo explícito',pendente:'Pendente',interno:'Interno DBCL'})[value]||value||'—';
}
function frontAuditBadge(status){
  const cls=status==='Revisar'?'br':status==='Legado'||status==='Assistido'?'ba':status==='Confirmado'?'bg':'bc';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}
function renderFrontAudit(){
  const table=document.getElementById('ar-audit-table');
  if(!table) return;
  const rows=frontAuditRows(), shown=rows.slice(0,250);
  const hours=rows.reduce((sum,row)=>sum+(row.h||0),0);
  document.getElementById('ar-audit-status').textContent=`${rows.length.toLocaleString('pt-BR')} grupos · ${fmtH(hours)}h${rows.length>250?' · exibindo os 250 maiores':''}`;
  table.innerHTML=`<thead><tr><th>Status</th><th>Mês</th><th>Cliente / serviço</th><th>Código / pasta</th><th>Natureza e origem</th><th>Área CRM → área usada</th><th>Frente resultante</th><th class="r">Horas</th><th class="r">Pessoas</th></tr></thead><tbody>${shown.map(row=>`<tr><td>${frontAuditBadge(row.status)}</td><td>${mLbl(row.m)}/${row.m.slice(2,4)}</td><td><b>${esc(row.cliente||'Sem cliente')}</b><div class="tm">${esc(row.servico||row.pasta||'Sem serviço identificado')}</div></td><td>${row.codigo?`<b>${esc(row.codigo)}</b>`:'<span class="br badge">sem código</span>'}<div class="tm">${esc(row.pasta||'—')}</div></td><td><b>${esc(row.registro||row.natureza)}</b><div class="tm">${esc(row.natureza)} · ${esc(frontAuditSourceLabel(row.natureza_origem))}</div></td><td>${esc(row.area_crm||'—')} → <b>${esc(row.area)}</b><div class="tm">${esc(frontAuditAreaSourceLabel(row.area_origem))}</div></td><td><b>${esc(row.frente)}</b></td><td class="tr"><b>${fmtH(row.h)}</b></td><td class="tr">${row.pessoas||0}</td></tr>`).join('')}</tbody>`;
}
function downloadFrontAudit(){
  const rows=frontAuditRows();
  downloadCsv(`conferencia-frentes-dbcl-${S.meses[0]}-a-${S.meses[S.meses.length-1]}.csv`,
    ['Status','Mês','Fonte','Cliente','Serviço','Código de venda','Pasta','Registro','Natureza','Origem da natureza','Área no CRM','Área utilizada','Origem da área','Frente resultante','Horas','Linhas','Pessoas'],
    rows.map(row=>[row.status,row.m,row.fonte,row.cliente,row.servico,row.codigo,row.pasta,row.registro,row.natureza,frontAuditSourceLabel(row.natureza_origem),row.area_crm,row.area,frontAuditAreaSourceLabel(row.area_origem),row.frente,row.h,row.linhas,row.pessoas]));
}
function renderAreas(){
  const wd=D.work_dimensions;
  if(!wd){ document.getElementById('ar-rule').textContent='A base ainda não contém as dimensões de trabalho.'; return; }
  const previousMonths=previousComparableMonths(S.meses);
  const periodTotal=S.meses.reduce((sum,m)=>sum+(wd.pm?.[m]?.total||0),0);
  const previousTotal=previousMonths.length===S.meses.length?previousMonths.reduce((sum,m)=>sum+(wd.pm?.[m]?.total||0),0):null;
  const clientHours=S.meses.reduce((sum,m)=>sum+(wd.pm?.[m]?.horas_clientes??wd.pm?.[m]?.total??0),0);
  const internalHours=S.meses.reduce((sum,m)=>sum+(wd.pm?.[m]?.horas_internas||0),0);
  const areaClassified=S.meses.reduce((sum,m)=>sum+(wd.pm?.[m]?.area_cliente_classificada??wd.pm?.[m]?.area_classificada??0),0);
  const natureClassified=S.meses.reduce((sum,m)=>sum+(wd.pm?.[m]?.natureza_classificada||0),0);
  const areas=Object.entries(wd.areas||{}).map(([name,item])=>({name,item,total:sumHoursByMonths(item.pm,S.meses),prior:previousMonths.length===S.meses.length?sumHoursByMonths(item.pm,previousMonths):null})).sort((a,b)=>b.total-a.total);
  const topArea=areas.find(row=>!['Não classificado','Interno DBCL'].includes(row.name)&&!row.name.startsWith('Multidisciplinar')&&row.total>0);
  const excluded=S.meses.reduce((sum,m)=>sum+(D.meta?.auditoria?.exclusao_time_administrativo?.horas_por_mes?.[m]||0),0);
  document.getElementById('ar-rule').innerHTML=`Regra: pasta <b>Processo</b> = contencioso; pasta <b>Caso</b> = consultivo. Área vem do CRM ou de termo jurídico explícito no Themis. Trabalho interno de advogados aparece separado como <b>Interno DBCL</b>. <b>${fmtH(excluded)}h</b> do time Administrativo foram excluídas.`;
  document.getElementById('ar-kpis').innerHTML=`
    <div class="kc"><div class="kc-l">Horas no período</div><div class="kc-v">${fmtH(periodTotal)}</div><div class="kc-s">${comparisonHTML(periodTotal,previousTotal)} vs. período anterior</div></div>
    <div class="kc"><div class="kc-l">Área dos clientes identificada</div><div class="kc-v g">${clientHours?fmtP(areaClassified/clientHours*100):'—'}</div><div class="kc-s">${fmtH(Math.max(0,clientHours-areaClassified))}h de clientes a classificar</div></div>
    <div class="kc"><div class="kc-l">Com natureza identificada</div><div class="kc-v g">${periodTotal?fmtP(natureClassified/periodTotal*100):'—'}</div><div class="kc-s">Caso ou Processo</div></div>
    <div class="kc"><div class="kc-l">Maior área específica</div><div class="kc-v" style="font-size:18px">${esc(topArea?.name||'—')}</div><div class="kc-s">${topArea?fmtH(topArea.total)+'h':'sem dados'} · ${fmtH(internalHours)}h internas</div></div>`;

  const chartAreas=areas.filter(row=>!['Não classificado','Interno DBCL'].includes(row.name)&&row.total>0).slice(0,8);
  const palette=['#0F6E56','#64B5F6','#C47A00','#CE93D8','#EF9A9A','#80CBC4','#7E57C2','#546E7A'];
  mkChart('c-ar-evo',{type:'bar',data:{labels:S.meses.map(mLbl),datasets:chartAreas.map((row,i)=>({label:row.name,data:S.meses.map(m=>row.item.pm?.[m]||0),backgroundColor:palette[i%palette.length]}))},options:{maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});

  const fronts=Object.entries(wd.frentes||{}).map(([name,item])=>({name,total:sumHoursByMonths(item.pm,S.meses)})).filter(row=>row.total>0&&row.name!=='Não classificado').sort((a,b)=>b.total-a.total);
  mkChart('c-ar-front',{type:'bar',data:{labels:fronts.map(row=>row.name),datasets:[{label:'Horas',data:fronts.map(row=>row.total),backgroundColor:fronts.map(row=>row.name.startsWith('Trabalhista')?'#64B5F6':row.name.startsWith('Contencioso')?'#EF9A9A':'#80CBC4')}]},options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{autoSkip:false}}}}});

  const economics=Object.entries(wd.economia_frentes||{}).map(([name,item])=>{
    const h=sumPMMonths(item.pm,S.meses,'h'), hr=sumPMMonths(item.pm,S.meses,'hr');
    const r=sumPMMonths(item.pm,S.meses,'r'), c=C(sumPMMonths(item.pm,S.meses,'cr'));
    return {name,h,hr,r,c,m:r-c};
  }).filter(row=>row.name!=='Não classificado'&&(row.h||row.r)).sort((a,b)=>b.hr-a.hr);
  const econTotal=economics.reduce((t,row)=>({h:t.h+row.h,hr:t.hr+row.hr,r:t.r+row.r,c:t.c+row.c,m:t.m+row.m}),{h:0,hr:0,r:0,c:0,m:0});
  document.getElementById('ar-profit').innerHTML=`<thead><tr><th>Frente</th><th class="r">Horas totais</th><th class="r">Horas recorrentes</th><th class="r">Receita recorrente</th><th class="r">Custo recorrente</th><th class="r">Margem</th><th class="r">%</th></tr></thead><tbody>${economics.map(row=>`<tr><td><b>${esc(row.name)}</b></td><td class="tr">${fmtH(row.h)}</td><td class="tr">${fmtH(row.hr)}</td><td class="tr">${fmtK(row.r)}</td><td class="tr">${fmtK(row.c)}</td><td class="tr ${cm(row.m)}"><b>${fmtK(row.m)}</b></td><td class="tr ${cm(row.m)}">${row.r?fmtP(row.m/row.r*100):'—'}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th class="tr">${fmtH(econTotal.h)}</th><th class="tr">${fmtH(econTotal.hr)}</th><th class="tr">${fmtK(econTotal.r)}</th><th class="tr">${fmtK(econTotal.c)}</th><th class="tr">${fmtK(econTotal.m)}</th><th class="tr">${econTotal.r?fmtP(econTotal.m/econTotal.r*100):'—'}</th></tr></tfoot>`;
  renderFrontAudit();

  let html='<thead><tr><th>Área / cluster de prioridade</th><th class="r">Horas</th><th class="r">% do total</th><th class="r">Período anterior</th><th class="r">Variação</th></tr></thead><tbody>';
  const tableAreas=[...areas.filter(area=>area.total>0&&!['Não classificado','Interno DBCL'].includes(area.name)),...areas.filter(area=>area.total>0&&area.name==='Não classificado'),...areas.filter(area=>area.total>0&&area.name==='Interno DBCL')];
  tableAreas.forEach(area=>{
    html+=`<tr><td><b>${esc(area.name)}</b></td><td class="tr"><b>${fmtH(area.total)}</b></td><td class="tr">${periodTotal?fmtP(area.total/periodTotal*100):'—'}</td><td class="tr">${area.prior==null?'—':fmtH(area.prior)}</td><td class="tr">${comparisonHTML(area.total,area.prior)}</td></tr>`;
    Object.entries(area.item.clusters||{}).map(([name,item])=>({name,total:sumHoursByMonths(item.pm,S.meses),prior:previousMonths.length===S.meses.length?sumHoursByMonths(item.pm,previousMonths):null})).filter(row=>row.total>0).sort((a,b)=>b.total-a.total).forEach(cluster=>{
      html+=`<tr><td class="tm" style="padding-left:28px">↳ ${esc(cluster.name)}</td><td class="tr">${fmtH(cluster.total)}</td><td class="tr">${area.total?fmtP(cluster.total/area.total*100):'—'} da área</td><td class="tr">${cluster.prior==null?'—':fmtH(cluster.prior)}</td><td class="tr">${comparisonHTML(cluster.total,cluster.prior)}</td></tr>`;
    });
  });
  document.getElementById('ar-table').innerHTML=html+'</tbody>';
}

/* ───────── SÓCIOS NAS FRENTES ───────── */
function renderSocios(){
  const wd=D.work_dimensions, sd=wd?.socios;
  if(!sd){ document.getElementById('so-note').textContent='A base ainda não contém a visão separada dos sócios.'; return; }
  const total=S.meses.reduce((sum,m)=>sum+(wd.pm?.[m]?.total||0),0);
  const partnerH=sumPMMonths(sd.pm,S.meses,'h'), partnerC=C(sumPMMonths(sd.pm,S.meses,'c'));
  const previousMonths=previousComparableMonths(S.meses);
  const previousH=previousMonths.length===S.meses.length?sumPMMonths(sd.pm,previousMonths,'h'):null;
  document.getElementById('so-note').innerHTML='Participação dos sócios nas quatro frentes. A natureza vem do <b>Caso/Processo no Themis</b>; a separação Trabalhista vem da <b>Área principal no CRM</b>.';
  document.getElementById('so-kpis').innerHTML=`
    <div class="kc"><div class="kc-l">Horas dos sócios</div><div class="kc-v">${fmtH(partnerH)}</div><div class="kc-s">${comparisonHTML(partnerH,previousH)} vs. período anterior</div></div>
    <div class="kc"><div class="kc-l">Participação no escritório</div><div class="kc-v ${partnerH/Math.max(total,1)>.25?'r':'g'}">${total?fmtP(partnerH/total*100):'—'}</div><div class="kc-s">sobre ${fmtH(total)}h totais</div></div>
    <div class="kc"><div class="kc-l">Horas da equipe</div><div class="kc-v">${fmtH(Math.max(0,total-partnerH))}</div><div class="kc-s">sem os sócios</div></div>
    <div class="kc"><div class="kc-l">Valor das horas dos sócios</div><div class="kc-v">${fmtK(partnerC)}</div><div class="kc-s">${RATE_LABEL[S.rate]}</div></div>`;

  mkChart('c-so-evo',{type:'bar',data:{labels:S.meses.map(mLbl),datasets:[
    {label:'Sócios',data:S.meses.map(m=>sd.pm?.[m]?.h||0),backgroundColor:'#0F6E56'},
    {label:'Equipe',data:S.meses.map(m=>Math.max(0,(wd.pm?.[m]?.total||0)-(sd.pm?.[m]?.h||0))),backgroundColor:'#B8C8C2'}
  ]},options:{maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});

  const fronts=Object.entries(wd.frentes||{}).map(([name,item])=>{
    const h=sumHoursByMonths(item.pm,S.meses), sh=sumPMMonths(sd.frentes?.[name]?.pm,S.meses,'h');
    const sc=C(sumPMMonths(sd.frentes?.[name]?.pm,S.meses,'c'));
    return {name,h,sh,team:Math.max(0,h-sh),sc};
  }).filter(row=>row.name!=='Não classificado'&&row.h>0).sort((a,b)=>b.h-a.h);
  mkChart('c-so-front',{type:'bar',data:{labels:fronts.map(row=>row.name),datasets:[
    {label:'Sócios',data:fronts.map(row=>row.sh),backgroundColor:'#0F6E56'},
    {label:'Equipe',data:fronts.map(row=>row.team),backgroundColor:'#B8C8C2'}
  ]},options:{indexAxis:'y',maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true,ticks:{autoSkip:false}}},plugins:{legend:{position:'bottom'}}}});
  document.getElementById('so-front-table').innerHTML=`<thead><tr><th>Frente</th><th class="r">Total</th><th class="r">Sócios</th><th class="r">Participação</th><th class="r">Valor horas sócios</th></tr></thead><tbody>${fronts.map(row=>`<tr><td><b>${esc(row.name)}</b></td><td class="tr">${fmtH(row.h)}</td><td class="tr">${fmtH(row.sh)}</td><td class="tr">${row.h?fmtP(row.sh/row.h*100):'—'}</td><td class="tr">${fmtK(row.sc)}</td></tr>`).join('')}</tbody>`;

  const people=Object.entries(sd.pessoas||{}).map(([name,item])=>({name,h:sumPMMonths(item.pm,S.meses,'h'),c:C(sumPMMonths(item.pm,S.meses,'c'))})).filter(row=>row.h>0).sort((a,b)=>b.h-a.h);
  document.getElementById('so-person-table').innerHTML=`<thead><tr><th>Sócio</th><th class="r">Horas</th><th class="r">% das horas dos sócios</th><th class="r">Valor das horas</th></tr></thead><tbody>${people.map(row=>`<tr onclick="openPessoa('${jsq(row.name)}')"><td class="lk"><b>${esc(row.name)}</b></td><td class="tr">${fmtH(row.h)}</td><td class="tr">${partnerH?fmtP(row.h/partnerH*100):'—'}</td><td class="tr">${fmtK(row.c)}</td></tr>`).join('')}</tbody>`;
}

/* ───────── HEATMAP ───────── */
function hmF(t,b){S.hmTime=t;b.parentElement.querySelectorAll('[data-g="t"]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderHeatmap();}
function hmA(a,b){S.hmAtivo=a;b.parentElement.querySelectorAll('[data-g="a"]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderHeatmap();}
function buildHmFilters(){
  const times = ['todos',...new Set(D.hm.map(p=>officialHomeTeam(p.time)))];
  document.getElementById('hm-filters').innerHTML =
    `<span class="fb-lbl">Time:</span>` + times.map(t=>`<button class="fb-btn ${t===S.hmTime?'active':''}" data-g="t" onclick="hmF('${t}',this)">${t==='todos'?'Todos':t}</button>`).join('') +
    `<span class="fb-lbl" style="margin-left:8px">Status:</span>
     <button class="fb-btn ${S.hmAtivo==='ativo'?'active':''}" data-g="a" onclick="hmA('ativo',this)">Ativos</button>
     <button class="fb-btn ${S.hmAtivo==='todos'?'active':''}" data-g="a" onclick="hmA('todos',this)">Todos</button>`;
}
const HM_COLORS = {v:'192,57,43',a:'196,122,0',g:'46,125,50',adm:'84,110,122'};
function hcell(pct, dev, key){
  const op = Math.min(.85, .08 + pct/100*.9);
  const arrow = dev==='low'?'<sup>⬇</sup>':dev==='high'?'<sup>⬆</sup>':'';
  return `<td style="text-align:center"><span class="hcell" style="background:rgba(${HM_COLORS[key]},${op});color:${pct>35?'#fff':'#333'}">${pct.toFixed(0)}%${arrow}</span></td>`;
}
function renderHeatmap(){
  buildHmFilters();
  let rows = hmCalc().filter(p=>p._tot>0.5);
  if(S.hmTime!=='todos') rows = rows.filter(p=>p._time===S.hmTime);
  if(S.hmAtivo==='ativo') rows = rows.filter(p=>p.ativo);
  // group by time
  const byTime = {};
  rows.forEach(p=>{ (byTime[p._time]=byTime[p._time]||[]).push(p); });
  let html = '';
  Object.keys(byTime).forEach(t=>{
    html += `<tr class="grow"><td colspan="8">${t}</td></tr>`;
    byTime[t].sort((a,b)=>b._tot-a._tot).forEach(p=>{
      const t2=p._tot;
      html += `<tr onclick="openPessoa('${jsq(p.adv)}')">
        <td class="lk">${esc(p.adv)}${p.ativo?'':' <span class="badge bc">saiu</span>'}</td>
        <td class="tm">${p.fn} · ${p.cargo}</td>
        <td style="text-align:center"><b>${fmtH(t2)}</b></td>
        ${hcell(p._pct.v,p.dev.v,'v')}${hcell(p._pct.a,p.dev.a,'a')}${hcell(p._pct.g,p.dev.g,'g')}${hcell(p._pct.adm,p.dev.adm,'adm')}
        <td><div class="sbar"><div class="sv" style="width:${p._pct.v}%"></div><div class="sa" style="width:${p._pct.a}%"></div><div class="sg" style="width:${p._pct.g}%"></div><div class="sd" style="width:${p._pct.adm}%"></div></div></td>
      </tr>`;
    });
  });
  document.getElementById('hm-body').innerHTML = html;
}

/* ───────── PESSOAS ───────── */
function renderPessoas(){
  const pessoasPeriodo = carteiraRows(hmCalc().filter(p=>p._tot>0.5));
  const rows = pessoasPeriodo.slice().sort((a,b)=>b._tot-a._tot).slice(0,15);
  mkChart('c-p-rank',{type:'bar',data:{labels:rows.map(p=>p.adv.split(' ')[0]+' '+(p.adv.split(' ')[1]||'').slice(0,1)+'.'),datasets:[
    {label:'Vermelho',data:rows.map(p=>p._h.v),backgroundColor:'#C0392B'},
    {label:'Amarelo',data:rows.map(p=>p._h.a),backgroundColor:'#C47A00'},
    {label:'Verde',data:rows.map(p=>p._h.g),backgroundColor:'#2E7D32'},
    {label:'Admin',data:rows.map(p=>p._h.adm),backgroundColor:'#546E7A'}
  ]},options:{indexAxis:'y',maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true,ticks:{autoSkip:false}}},plugins:{legend:{position:'bottom'},tooltip:{callbacks:{title:items=>rows[items[0].dataIndex].adv}}},onClick:(e,el)=>{if(el.length)openPessoa(rows[el[0].index].adv);}}});

  const hVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].h:0);
  const hcVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].hc:0);
  const nVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].n:0);
  mkChart('c-p-evo',{data:{labels:S.meses.map(mLbl),datasets:[
    {type:'bar',label:'Horas totais',data:hVals,backgroundColor:'rgba(15,110,86,.25)',yAxisID:'y'},
    {type:'bar',label:'Em clientes',data:hcVals,backgroundColor:'#0F6E56',yAxisID:'y'},
    {type:'line',label:'Pessoas lançando',data:nVals,borderColor:'#C47A00',yAxisID:'y2',tension:.3}
  ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{position:'left'},y2:{position:'right',grid:{display:false}}}}});

  let html = `<thead><tr><th>Colaborador</th><th>Time</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Total</th><th class="r">Média/mês</th></tr></thead><tbody>`;
  pessoasPeriodo.slice().sort((a,b)=>b._tot-a._tot).forEach(p=>{
    const cells = S.meses.map(m=>`<td class="tr">${fmtH(p.pm[m]?p.pm[m].tot:0)}</td>`).join('');
    const nm = S.meses.filter(m=>p.pm[m]&&p.pm[m].tot>0).length||1;
    html += `<tr onclick="openPessoa('${jsq(p.adv)}')"><td class="lk">${esc(p.adv)}${p.ativo?'':' <span class="badge bc">saiu</span>'}</td><td class="tm">${p._time}</td>${cells}<td class="tr"><b>${fmtH(p._tot)}</b></td><td class="tr">${fmtH(p._tot/nm)}</td></tr>`;
  });
  document.getElementById('p-table').innerHTML = html + '</tbody>';
}

/* ───────── MENSALISTAS ───────── */
function mF(f,b){S.mFilter=f;b.parentElement.querySelectorAll('.fb-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderMensalistas();}
function mSort(k){ if(S.mSortK===k){S.mSortAsc=!S.mSortAsc;}else{S.mSortK=k;S.mSortAsc=(k==='margem'||k==='mpct');} renderMensalistas(); }
function buildMFilters(){
  const opts=[['todos','Todos'],['com_rec','Com receita'],['neg','Negativos'],['sem_rec','Sem receita'],['inc','Com inclusos']];
  document.getElementById('m-filters').innerHTML = `<span class="fb-lbl">Ver:</span>`+opts.map(([k,l])=>`<button class="fb-btn ${k===S.mFilter?'active':''}" onclick="mF('${k}',this)">${l}</button>`).join('');
}
function renderMensalistas(){
  let warning=document.getElementById('monthly-pending-warning');
  if(!warning){warning=document.createElement('div');warning.id='monthly-pending-warning';warning.className='note';document.getElementById('m-kpis').before(warning);}
  const pending=(D.meta.auditoria.mensalistas_fonte?.pendencias_valores||[]).filter(p=>!p.month||S.meses.includes(p.month));
  warning.textContent=pending.length?`Receitas incompletas: ${new Set(pending.map(p=>p.code)).size} contrato(s) com valores não confirmados neste período. Receitas e margens abaixo consideram somente valores conhecidos. Consulte Cadastro de mensalistas.`:'';
  buildMFilters();
  let rows = carteiraRows(mensalCalc());
  const all = rows;
  if(S.mFilter==='com_rec') rows=rows.filter(m=>m._rec>0);
  if(S.mFilter==='neg') rows=rows.filter(m=>m._rec>0&&m._margem<0);
  if(S.mFilter==='sem_rec') rows=rows.filter(m=>m._rec===0&&m._h>0);
  if(S.mFilter==='inc') rows=rows.filter(m=>m.n_inc>0);

  const recT=all.reduce((s,m)=>s+m._rec,0), cusT=all.reduce((s,m)=>s+m._custo,0);
  const negN=all.filter(m=>m._rec>0&&m._margem<0).length;
  const semN=all.filter(m=>m._rec===0&&m._h>0).length;
  document.getElementById('m-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Receita total</div><div class="kc-v">${fmtK(recT)}</div></div>
    <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(cusT)}</div></div>
    <div class="kc"><div class="kc-l">Margem</div><div class="kc-v ${recT-cusT>=0?'g':'r'}">${fmtK(recT-cusT)}</div><div class="kc-s">${recT>0?fmtP((recT-cusT)/recT*100):''}</div></div>
    <div class="kc click" onclick="S.mFilter='neg';renderMensalistas()"><div class="kc-l">Negativos / Sem receita</div><div class="kc-v ${negN>0?'r':'g'}">${negN} <span style="font-size:14px;color:var(--c3)">/ ${semN}</span></div></div>`;

  // Extremos legíveis: todos os clientes comprimiam e desalinhavam os nomes.
  const elegiveis = all.filter(m=>m._rec>0).sort((a,b)=>a._margem-b._margem);
  const extremos = [...new Map([...elegiveis.slice(0,10),...elegiveis.slice(-10)].map(m=>[m.cli,m])).values()]
    .sort((a,b)=>a._margem-b._margem);
  const rankLabel = nome => nome.length>35 ? nome.slice(0,34)+'…' : nome;
  mkChart('c-m-rank',{type:'bar',data:{labels:extremos.map(m=>rankLabel(m.cli)),datasets:[
    {label:'Margem',data:extremos.map(m=>m._margem),backgroundColor:extremos.map(m=>m._margem<0?'#C0392B':'#0F6E56')}
  ]},options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>extremos[items[0].dataIndex].cli,label:c=>`${fmt(c.raw)} de margem`}}},scales:{y:{ticks:{autoSkip:false}},x:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}},onClick:(e,el)=>{if(el.length)openCliente(extremos[el[0].index].cli);}}});

  // Scatter
  const sc = all.filter(m=>m._rec>0||m._custo>0);
  mkChart('c-m-scat',{type:'bubble',data:{datasets:[{label:'Clientes',data:sc.map(m=>({x:m._rec,y:m._custo,r:Math.max(4,Math.min(18,Math.sqrt(m._h)*1.6)),cli:m.cli})),
    backgroundColor:sc.map(m=>m._margem>=0?'rgba(15,110,86,.55)':'rgba(192,57,43,.6)')}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.cli}: rec ${fmtK(c.raw.x)} · custo ${fmtK(c.raw.y)}`}}},
    scales:{x:{title:{display:true,text:'Receita'},ticks:{callback:v=>'R$'+(v/1000)+'k'}},y:{title:{display:true,text:'Custo'},ticks:{callback:v=>'R$'+(v/1000)+'k'}}},
    onClick:(e,el)=>{if(el.length)openCliente(sc[el[0].index].cli);}}});

  // Table
  rows.sort((a,b)=>{const va=a['_'+S.mSortK]??a[S.mSortK]??0, vb=b['_'+S.mSortK]??b[S.mSortK]??0; return S.mSortAsc?(va-vb):(vb-va);});
  document.getElementById('m-body').innerHTML = rows.map(m=>{
    const margVals = S.meses.map(mo=>{const pm=m.pm[mo];return pm?(pm.r||0)-C(pm.c||0):0;});
    return `<tr onclick="openCliente('${jsq(m.cli)}')">
      <td class="lk">${esc(m.cli)}${m.n_inc>0?` <span class="badge bg">${m.n_inc} inc</span>`:''}</td>
      <td class="tm">${m.resp||''}</td>
      <td class="tr">${fmtK(m._recM)}</td><td class="tr">${fmtK(m._rec)}</td>
      <td class="tr"><b>${fmtH(m._h)}</b></td><td class="tr tm">${fmtH(m._hb)}</td><td class="tr tm">${fmtH(m._hi)}</td>
      <td class="tr">${fmtK(m._custo)}</td>
      <td class="tr" style="font-weight:600;color:${m._margem<0?'var(--red)':'var(--g2)'}">${fmtK(m._margem)}</td>
      <td class="tr">${fmtP(m._mpct)}</td>
      <td>${sparkHTML(margVals,true)}</td>
    </tr>`;
  }).join('');
}

/* ───────── PROJETOS ───────── */
function prF(f,b){S.prFilter=f;b.parentElement.querySelectorAll('.fb-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderProjetos();}
function prSort(k){ if(S.prSortK===k){S.prSortAsc=!S.prSortAsc;}else{S.prSortK=k;S.prSortAsc=false;} renderProjetos(); }
function buildPrFilters(){
  const opts=[['todos','Todos'],['com_h','Com horas'],['sem_h','Sem horas'],['neg','Negativos']];
  document.getElementById('pr-filters').innerHTML = `<span class="fb-lbl">Ver:</span>`+opts.map(([k,l])=>`<button class="fb-btn ${k===S.prFilter?'active':''}" onclick="prF('${k}',this)">${l}</button>`).join('');
}
function renderProjetos(){
  buildPrFilters();
  const all = carteiraRows(lcCalc());
  let rows = all;
  if(S.prFilter==='com_h') rows=rows.filter(p=>p._h>0);
  if(S.prFilter==='sem_h') rows=rows.filter(p=>p._h===0);
  if(S.prFilter==='neg') rows=rows.filter(p=>p._margem<0);

  const recT=all.reduce((s,p)=>s+(p.rec||0),0), cusT=all.reduce((s,p)=>s+p._custo,0);
  const semH=all.filter(p=>p._h===0).length, negN=all.filter(p=>p._margem<0).length;
  document.getElementById('pr-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Receita contratada</div><div class="kc-v">${fmtK(recT)}</div></div>
    <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(cusT)}</div></div>
    <div class="kc"><div class="kc-l">Margem</div><div class="kc-v g">${fmtK(recT-cusT)}</div></div>
    <div class="kc"><div class="kc-l">Sem horas / Negativos</div><div class="kc-v ${negN>0?'a':''}">${semH} <span style="font-size:14px;color:var(--c3)">/ ${negN}</span></div></div>`;

  const top = all.filter(p=>p._h>0).sort((a,b)=>b._margem-a._margem).slice(0,12);
  mkChart('c-pr-top',{type:'bar',data:{labels:top.map(p=>p.lbl.slice(0,20)),datasets:[{label:'Margem',data:top.map(p=>p._margem),backgroundColor:top.map(p=>p._margem<0?'#C0392B':'#0F6E56')}]},
    options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>top[items[0].dataIndex].lbl}}},scales:{y:{ticks:{autoSkip:false}},x:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}},onClick:(e,el)=>{if(el.length)openServico(top[el[0].index].cod);}}});

  const sc = all.filter(p=>p._h>0);
  mkChart('c-pr-scat',{type:'bubble',data:{datasets:[{data:sc.map(p=>({x:p.rec||0,y:p._custo,r:Math.max(4,Math.min(16,Math.sqrt(Math.abs(p._margem))/20)),lbl:p.lbl,cli:p.cli})),
    backgroundColor:sc.map(p=>p._margem>=0?'rgba(15,110,86,.55)':'rgba(192,57,43,.6)')}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.cli} · ${c.raw.lbl}`}}},
    scales:{x:{title:{display:true,text:'Receita'},ticks:{callback:v=>'R$'+(v/1000)+'k'}},y:{title:{display:true,text:'Custo'},ticks:{callback:v=>'R$'+(v/1000)+'k'}}},
    onClick:(e,el)=>{if(el.length)openServico(sc[el[0].index].cod);}}});

  rows = rows.slice().sort((a,b)=>{const va=a['_'+S.prSortK]??a[S.prSortK]??0,vb=b['_'+S.prSortK]??b[S.prSortK]??0;return S.prSortAsc?va-vb:vb-va;});
  document.getElementById('pr-body').innerHTML = rows.map(p=>`<tr onclick="openServico('${p.cod}')">
    <td class="lk">${esc(p.lbl)}</td><td><span class="lk" onclick="event.stopPropagation();openCliente('${jsq(p.cli)}')">${esc(p.cli)}</span></td>
    <td class="tm">${p.resp||''}</td><td><span class="badge bc">${p.area||''}</span></td>
    <td class="tr">${fmtK(p.rec)}</td><td class="tr">${fmtK(p._custo)}</td>
    <td class="tr" style="font-weight:600;color:${p._margem<0?'var(--red)':'var(--g2)'}">${fmtK(p._margem)}</td>
    <td class="tr">${fmtP(p._mp)}</td><td class="tr">${fmtH(p._h)}</td><td class="tr tm">${p._rph?fmtK(p._rph):'—'}</td>
  </tr>`).join('');
}

/* ───────── JUDICIAL ───────── */
function jF(f,b){S.jFilter=f;b.parentElement.querySelectorAll('.fb-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderJudicial();}
function jSort(k){ if(S.jSortK===k){S.jSortAsc=!S.jSortAsc;}else{S.jSortK=k;S.jSortAsc=false;} renderJudicial(); }
function buildJFilters(){
  const opts=[['horas','Com horas'],['deficit','Custo > entrada'],['ok','Entrada cobre'],['ganhar','Viável c/ êxito'],['inviavel','Inviável']];
  document.getElementById('j-filters').innerHTML = `<span class="fb-lbl">Ver:</span>`+opts.map(([k,l])=>`<button class="fb-btn ${k===S.jFilter?'active':''}" onclick="jF('${k}',this)">${l}</button>`).join('');
}
const J_STATUS = {ok:['Entrada cobre','bg'],ganhar:['Viável c/ êxito','ba'],inviavel:['Inviável','br']};
function renderJudicial(){
  buildJFilters();
  const all = carteiraRows(judCalc()).filter(j=>j._h>0);
  let rows = all;
  if(S.jFilter==='deficit') rows=rows.filter(j=>j._mse<0);
  if(S.jFilter==='ok') rows=rows.filter(j=>j._status==='ok');
  if(S.jFilter==='ganhar') rows=rows.filter(j=>j._status==='ganhar');
  if(S.jFilter==='inviavel') rows=rows.filter(j=>j._status==='inviavel');

  const eT=all.reduce((s,j)=>s+(j.e||0),0), caT=all.reduce((s,j)=>s+j._ca,0), xT=all.reduce((s,j)=>s+(j.x||0),0);
  const invN=all.filter(j=>j._status==='inviavel').length;
  document.getElementById('j-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Entradas (não contingente)</div><div class="kc-v">${fmtK(eT)}</div></div>
    <div class="kc"><div class="kc-l">Custo acumulado (${S.rate})</div><div class="kc-v">${fmtK(caT)}</div></div>
    <div class="kc"><div class="kc-l">Êxito estimado total</div><div class="kc-v g">${fmtK(xT)}</div></div>
    <div class="kc click" onclick="S.jFilter='inviavel';renderJudicial()"><div class="kc-l">Inviáveis</div><div class="kc-v ${invN>0?'r':'g'}">${invN}</div></div>`;

  const top = all.slice().sort((a,b)=>b._ca-a._ca).slice(0,20);
  mkChart('c-j-top',{type:'bar',data:{labels:top.map(j=>(j.cli+' · '+j.lbl).slice(0,24)),datasets:[
    {label:'Custo acum.',data:top.map(j=>j._ca),backgroundColor:'#C0392B'},
    {label:'Entrada',data:top.map(j=>j.e||0),backgroundColor:'#0F6E56'}
  ]},options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{position:'bottom'},tooltip:{callbacks:{title:items=>`${top[items[0].dataIndex].cli} · ${top[items[0].dataIndex].lbl}`}}},scales:{y:{ticks:{autoSkip:false}},x:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}},onClick:(e,el)=>{if(el.length)openServico(top[el[0].index].cod);}}});

  const stColor = {ok:'rgba(15,110,86,.6)',ganhar:'rgba(196,122,0,.65)',inviavel:'rgba(192,57,43,.65)'};
  mkChart('c-j-scat',{type:'scatter',data:{datasets:[{data:all.map(j=>({x:j.e||0,y:j._ca,lbl:j.lbl,cli:j.cli})),
    backgroundColor:all.map(j=>stColor[j._status]),pointRadius:5,pointHoverRadius:7}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.cli} · ${c.raw.lbl}`}}},
    scales:{x:{title:{display:true,text:'Entrada'},ticks:{callback:v=>'R$'+(v/1000)+'k'}},y:{title:{display:true,text:'Custo acum.'},ticks:{callback:v=>'R$'+(v/1000)+'k'}}},
    onClick:(e,el)=>{if(el.length)openServico(all[el[0].index].cod);}}});

  rows = rows.slice().sort((a,b)=>{const va=a['_'+S.jSortK]??a[S.jSortK]??0,vb=b['_'+S.jSortK]??b[S.jSortK]??0;return S.jSortAsc?va-vb:vb-va;});
  document.getElementById('j-body').innerHTML = rows.map(j=>{
    const [lbl,cls]=J_STATUS[j._status];
    return `<tr onclick="openServico('${j.cod}')">
      <td class="lk">${esc(j.lbl)}</td><td><span class="lk" onclick="event.stopPropagation();openCliente('${jsq(j.cli)}')">${esc(j.cli)}</span></td><td class="tm">${j.resp||''}</td>
      <td class="tr">${fmtK(j.e)}</td><td class="tr">${fmtK(j._ca)}</td>
      <td class="tr" style="color:${j._mse<0?'var(--red)':'var(--g2)'}">${fmtK(j._mse)}</td>
      <td class="tr">${j._be>0?fmtK(j._be):'—'}</td><td class="tr">${fmtK(j.x)}</td>
      <td class="tr" style="font-weight:600;color:${j._mt<0?'var(--red)':'var(--g2)'}">${fmtK(j._mt)}</td>
      <td><span class="badge ${cls}">${lbl}</span></td>
    </tr>`;
  }).join('');
}

/* ───────── PORTFOLIO ───────── */
function renderPortfolio(){
  const men = carteiraRows(mensalCalc());
  const recT = men.reduce((s,m)=>s+m._rec,0);
  const sorted = men.filter(m=>m._rec>0).sort((a,b)=>b._rec-a._rec);
  const top1 = sorted[0], top3 = sorted.slice(0,3).reduce((s,m)=>s+m._rec,0);
  const neg = men.filter(m=>m._rec>0&&m._margem<0).sort((a,b)=>a._margem-b._margem);
  const idle = men.filter(m=>m._rec>0&&m._h<1);
  const norec = men.filter(m=>m._rec===0&&m._h>0).sort((a,b)=>b._custo-a._custo);
  const norecExplained=norec.filter(m=>activeClientDecision(m.cli));
  const norecUnknown=norec.filter(m=>!activeClientDecision(m.cli));
  const partnerNames=new Set(D.hm.filter(p=>String(p.fn).toLocaleLowerCase('pt-BR').includes('sócio')).map(p=>String(p.adv).toLocaleUpperCase('pt-BR')));
  const volumeReference=[...men].map(m=>m._h).sort((a,b)=>a-b)[Math.floor(men.length*.75)]||0;
  const profiles=men.map(m=>{
    const cd=D.cli_det[m.cli], contributors=new Map();
    let hSemCodigo=0;
    if(cd){
      hSemCodigo=S.meses.reduce((sum,month)=>sum+(cd.pm_sem_codigo?.[month]||0),0);
      cd.svcs.forEach(svc=>(D.servicos_det[svc.cod]?.por_pessoa||[]).forEach(person=>{
        const hours=S.meses.reduce((sum,month)=>sum+(person.pm?.[month]||0),0);
        if(hours) contributors.set(person.adv,(contributors.get(person.adv)||0)+hours);
      }));
    }
    const people=[...contributors].map(([name,hours])=>({name,hours,partner:partnerNames.has(String(name).toLocaleUpperCase('pt-BR'))})).sort((a,b)=>b.hours-a.hours);
    const identifiedHours=people.reduce((sum,p)=>sum+p.hours,0);
    const leadShare=identifiedHours>0?(people[0]?.hours||0)/identifiedHours*100:0;
    const partnerShare=identifiedHours>0?people.filter(p=>p.partner).reduce((sum,p)=>sum+p.hours,0)/identifiedHours*100:0;
    const context=activeClientDecision(m.cli);
    const strategic=clientStrategicDecisions(m.cli).find(d=>d.potential&&d.potential!=='unknown')||context;
    let risk=0; const reasons=[];
    if(leadShare>=50){const points=Math.min(35,Math.round((leadShare-45)*.7));risk+=points;reasons.push(`${fmtP(leadShare)} na pessoa líder`);}
    if(partnerShare>=25){const points=Math.min(25,Math.round((partnerShare-20)*.5));risk+=points;reasons.push(`${fmtP(partnerShare)} das horas com sócios`);}
    if(hSemCodigo>.05){risk+=20;reasons.push(`${fmtH(hSemCodigo)}h sem código`);}
    if(m._rec===0&&m._h>0){risk+=context?12:35;reasons.push(context?'receita zero explicada':'receita zero sem explicação');}
    if(volumeReference&&m._h>=volumeReference){risk+=10;reasons.push('alto volume de horas');}
    if(strategic?.relationshipRisk==='high'){risk+=25;reasons.push('risco relacional alto informado');}
    if(strategic?.relationshipRisk==='medium'){risk+=12;reasons.push('risco relacional médio informado');}
    risk=Math.min(100,risk);
    const quadrant=m._margem>=0?(risk>=45?'fortify':'protect'):(risk>=45?'recover':'reassess');
    const priority=risk+(m._margem<0?Math.min(60,Math.abs(m._margem)/1000):0);
    return {...m,risk,quadrant,priority,reasons,leadShare,partnerShare,hSemCodigo,potential:strategic?.potential||'unknown'};
  });
  const quadrantInfo={
    protect:{label:'Proteger e crescer',sub:'margem positiva · menor atenção'},
    fortify:{label:'Fortalecer',sub:'margem positiva · maior atenção'},
    recover:{label:'Recuperar',sub:'margem negativa · maior atenção'},
    reassess:{label:'Reavaliar',sub:'margem negativa · menor atenção operacional'}
  };
  const matrixRows=profiles.filter(p=>p._h>0||p._rec>0);

  document.getElementById('pf-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Maior cliente</div><div class="kc-v ${top1&&top1._rec/recT>.25?'r':''}">${top1?fmtP(top1._rec/recT*100):'—'}</div><div class="kc-s">${top1?esc(top1.cli):''}</div></div>
    <div class="kc"><div class="kc-l">Top 3 concentram</div><div class="kc-v ${top3/recT>.5?'a':''}">${fmtP(top3/recT*100)}</div><div class="kc-s">da receita de mensalistas</div></div>
    <div class="kc"><div class="kc-l">Margem negativa</div><div class="kc-v ${neg.length>0?'r':'g'}">${neg.length}</div><div class="kc-s">consumo: ${fmtK(neg.reduce((s,m)=>s+m._margem,0))}</div></div>
    <div class="kc"><div class="kc-l">Receita zero com contexto</div><div class="kc-v ${norecExplained.length?'a':''}">${norecExplained.length}</div><div class="kc-s">${norecUnknown.length} sem explicação estratégica</div></div>`;

  document.getElementById('pf-quadrants').innerHTML=Object.entries(quadrantInfo).map(([key,info])=>{
    const rows=matrixRows.filter(p=>p.quadrant===key);
    return `<div class="pf-quadrant ${key}"><div class="l">${info.label}</div><div class="n">${rows.length}</div><div class="s">${info.sub}</div></div>`;
  }).join('');
  mkChart('c-pf-matrix',{type:'scatter',data:{datasets:Object.entries(quadrantInfo).map(([key,info])=>({label:info.label,data:matrixRows.filter(p=>p.quadrant===key).map(p=>({x:p._margem,y:p.risk,client:p.cli,hours:p._h,revenue:p._rec})),backgroundColor:key==='protect'?'#2E7D32':key==='fortify'?'#C47A00':key==='recover'?'#C0392B':'#546E7A',pointRadius:6,pointHoverRadius:8}))},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'},tooltip:{callbacks:{title:items=>items[0].raw.client,label:item=>[`Margem: ${fmt(item.raw.x)}`,`Atenção: ${item.raw.y}/100`,`Horas: ${fmtH(item.raw.hours)}`]}}},scales:{x:{title:{display:true,text:'Margem recorrente no período'},ticks:{callback:v=>'R$'+Math.round(v/1000)+'k'},grid:{color:c=>c.tick.value===0?'#6B6A62':'#e9e8e2'}},y:{min:0,max:100,title:{display:true,text:'Índice de atenção operacional'},grid:{color:c=>c.tick.value===45?'#C47A00':'#e9e8e2'}}},onClick:(event,elements,chart)=>{if(!elements.length)return;const hit=elements[0],point=chart.data.datasets[hit.datasetIndex].data[hit.index];openCliente(point.client);}}});
  const potentialLabels={high:'Alto',medium:'Médio',low:'Baixo',unknown:'Não avaliado'};
  document.getElementById('pf-priority').innerHTML='<thead><tr><th>Cliente</th><th>Posição</th><th class="r">Margem</th><th class="r">Atenção</th><th>Principais fatores</th><th>Potencial</th></tr></thead><tbody>'+matrixRows.slice().sort((a,b)=>b.priority-a.priority).slice(0,20).map(p=>`<tr onclick="openCliente('${jsq(p.cli)}')"><td class="lk">${esc(p.cli)}</td><td>${esc(quadrantInfo[p.quadrant].label)}</td><td class="tr" style="color:${p._margem<0?'var(--red)':'var(--g2)'};font-weight:650">${fmtK(p._margem)}</td><td class="tr"><b>${p.risk}</b>/100</td><td class="risk-reasons">${esc(p.reasons.slice(0,3).join(' · ')||'sem sinal operacional relevante')}</td><td><span class="potential-tag ${p.potential}">${potentialLabels[p.potential]||'Não avaliado'}</span></td></tr>`).join('')+'</tbody>';

  document.getElementById('pf-conc').innerHTML = sorted.slice(0,15).map(m=>{
    const pct = m._rec/recT*100;
    return `<div class="conc-row" onclick="openCliente('${jsq(m.cli)}')"><div class="conc-nm">${esc(m.cli)}</div><div class="conc-bar"><div class="conc-fill" style="width:${pct}%;${pct>=25?'background:var(--red)':pct>=15?'background:var(--amb)':''}"></div></div><div class="conc-val">${fmtK(m._rec)} · ${pct.toFixed(1)}%</div></div>`;
  }).join('');

  document.getElementById('pf-neg').innerHTML = `<thead><tr><th>Cliente</th><th class="r">Receita</th><th class="r">Custo</th><th class="r">Margem</th><th class="r">H</th></tr></thead><tbody>`+
    neg.map(m=>`<tr onclick="openCliente('${jsq(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td class="tr">${fmtK(m._rec)}</td><td class="tr">${fmtK(m._custo)}</td><td class="tr" style="color:var(--red);font-weight:600">${fmtK(m._margem)}</td><td class="tr">${fmtH(m._h)}</td></tr>`).join('')+'</tbody>';

  document.getElementById('pf-idle').innerHTML = `<thead><tr><th>Cliente</th><th class="r">Receita período</th><th class="r">Horas</th></tr></thead><tbody>`+
    (idle.length?idle.map(m=>`<tr onclick="openCliente('${jsq(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td class="tr">${fmtK(m._rec)}</td><td class="tr">${fmtH(m._h)}</td></tr>`).join(''):'<tr><td colspan="3" class="tm">Nenhum.</td></tr>')+'</tbody>';

  document.getElementById('pf-norec').innerHTML = `<thead><tr><th>Cliente</th><th>Leitura</th><th class="r">Horas</th><th class="r">Custo</th></tr></thead><tbody>`+
    (norec.length?norec.map(m=>{const context=activeClientDecision(m.cli);return `<tr onclick="openCliente('${jsq(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td>${context?`<span class="badge strategy">decisão registrada</span> ${esc(context.title)}`:'<span class="badge ba">sem explicação</span>'}</td><td class="tr">${fmtH(m._h)}</td><td class="tr" style="color:var(--amb);font-weight:600">${fmtK(m._custo)}</td></tr>`}).join(''):'<tr><td colspan="4" class="tm">Nenhum.</td></tr>')+'</tbody>';
}

/* ───────── CENTRAL DE DECISÕES ───────── */
function setDecisionFilter(filter,button){
  S.decisionFilter=filter;
  button?.parentElement.querySelectorAll('.fb-btn').forEach(b=>b.classList.toggle('active',b===button));
  renderDecisoes();
}
function renderDecisoes(){
  const all=strategicDecisions();
  const open=all.filter(decisionIsOpen);
  const overdue=open.filter(decisionIsOverdue);
  const undated=open.filter(d=>!d.startMonth||!d.endMonth||!d.nextReview);
  const completed=all.filter(d=>['completed','cancelled'].includes(d.status));
  const inPeriod=open.filter(d=>strategicDecisionApplies(d));
  document.getElementById('dc-kpis').innerHTML=`
    <div class="kc"><div class="kc-l">Decisões abertas</div><div class="kc-v">${open.length}</div><div class="kc-s">${inPeriod.length} afetam o período selecionado</div></div>
    <div class="kc"><div class="kc-l">Revisões atrasadas</div><div class="kc-v ${overdue.length?'r':'g'}">${overdue.length}</div><div class="kc-s">com data de revisão vencida</div></div>
    <div class="kc"><div class="kc-l">Cadastro incompleto</div><div class="kc-v ${undated.length?'a':'g'}">${undated.length}</div><div class="kc-s">sem vigência ou próxima revisão</div></div>
    <div class="kc"><div class="kc-l">Encerradas</div><div class="kc-v">${completed.length}</div><div class="kc-s">concluídas ou canceladas</div></div>`;
  const groups={all,open,overdue,undated,completed};
  const rows=(groups[S.decisionFilter]||open).slice().sort((a,b)=>{
    const ao=decisionIsOverdue(a)?0:1,bo=decisionIsOverdue(b)?0:1;
    return ao-bo||String(a.nextReview||'9999').localeCompare(String(b.nextReview||'9999'))||String(b.updatedAt||'').localeCompare(String(a.updatedAt||''));
  });
  const statusLabels={active:'Ativa',monitoring:'Acompanhando',completed:'Concluída',cancelled:'Cancelada'};
  const typeLabels={bonus:'Bonificação',pricing:'Preço',scope:'Escopo',relationship:'Relacionamento',expansion:'Expansão',exit:'Saída',other:'Outro'};
  const potentialLabels={high:'Alto',medium:'Médio',low:'Baixo',unknown:'Não avaliado'};
  document.getElementById('dc-count').textContent=`${rows.length} de ${all.length} registros`;
  document.getElementById('dc-table').innerHTML='<thead><tr><th>Cliente e decisão</th><th>Status</th><th>Vigência</th><th>Próxima revisão</th><th>Responsável</th><th>Potencial</th><th>Origem</th><th>Ação</th></tr></thead><tbody>'+
    (rows.length?rows.map(d=>`<tr onclick="openCliente('${jsq(d.client)}')"><td><div class="dc-client lk">${esc(d.client)}</div><div class="dc-title">${esc(d.title)}</div><div class="dc-type">${esc(typeLabels[d.type]||d.type||'Outro')}</div></td><td><span class="dc-status ${decisionIsOverdue(d)?'overdue':d.status}">${esc(statusLabels[d.status]||d.status)}</span>${strategicDecisionApplies(d)?'<div class="dc-applies">afeta o período</div>':''}</td><td>${esc(strategicPeriodLabel(d))}</td><td class="${decisionIsOverdue(d)?'r':''}">${esc(decisionDueLabel(d))}</td><td>${esc(d.owner||'Não definido')}</td><td>${esc(potentialLabels[d.potential]||'Não avaliado')}</td><td><span class="source-tag">${d.storage==='official'?'Base oficial':'Este navegador'}</span></td><td>${d.storage==='local'&&decisionIsOpen(d)?`<button class="dc-action" onclick="event.stopPropagation();setStrategicDecisionStatus('${jsq(d.id)}','completed')">Concluir</button>`:'<span class="tm">abrir cliente →</span>'}</td></tr>`).join(''):'<tr><td colspan="8" class="tm">Nenhuma decisão neste filtro.</td></tr>')+'</tbody>';
}

/* ───────── AUDITORIA DA BASE ───────── */
function scrollAudit(id){
  document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function csvCell(value){
  const raw=String(value??'');
  const safe=typeof value==='string'&&/^[\s]*[=+\-@]/.test(raw)?`'${raw}`:raw;
  return `"${safe.replace(/"/g,'""')}"`;
}
function downloadCsv(filename,columns,rows){
  const lines=[columns,...rows];
  const blob=new Blob(['\ufeff'+lines.map(row=>row.map(csvCell).join(';')).join('\n')],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=filename;
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(link.href);
}
function downloadAuditQueue(){
  const columns=['Prioridade','Problema','Volume','Responsável sugerido','Onde corrigir','Próxima ação','Impacto'];
  downloadCsv(`auditoria-dbcl-${S.meses[0]}-a-${S.meses[S.meses.length-1]}.csv`,columns,AUDIT_QUEUE.map(q=>[q.label,q.issue,q.volume,q.owner,q.source,q.action,q.impact]));
}
function downloadAuditDetails(){
  const columns=['Categoria','Escopo','Prioridade','Código ou chave','Cliente ou pessoa','Pasta ou descrição','Linhas','Horas','Responsável sugerido','Onde corrigir','Próxima ação'];
  downloadCsv(`auditoria-detalhada-dbcl-${S.meses[0]}-a-${S.meses[S.meses.length-1]}.csv`,columns,AUDIT_DETAILS);
}
function filterAuditDetails(value){
  const term=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  let visible=0,total=0;
  document.querySelectorAll('.audit-detail-table tbody tr').forEach(row=>{
    if(row.classList.contains('audit-empty'))return;
    total++;
    const text=row.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const show=!term||text.includes(term);row.style.display=show?'':'none';if(show)visible++;
  });
  const status=document.getElementById('au-filter-status');
  if(status)status.textContent=term?`${visible} de ${total} registros visíveis`:`${total} registros detalhados`;
}
function clearAuditFilter(){
  const input=document.getElementById('au-search');if(input)input.value='';filterAuditDetails('');
}
function renderAuditoria(){
  const au=D.meta?.auditoria||{}, cv=au.codigo_venda_themis||{}, crm=au.cadastro_crm||{};
  const fonte=cv.horas_por_mes_fonte||{};
  const admExcluido=au.exclusao_time_administrativo?.horas_por_mes||{};
  const mesesThemis=S.meses.filter(m=>fonte[m]!=null);
  const hFonte=mesesThemis.reduce((s,m)=>s+(fonte[m]||0),0);
  const hAdmExcluido=mesesThemis.reduce((s,m)=>s+(admExcluido[m]||0),0);
  const hFonteJuridica=hFonte-hAdmExcluido;
  const hBi=mesesThemis.reduce((s,m)=>s+(D.kpm[m]?.h||0),0);
  const hVinc=S.meses.reduce((s,m)=>s+Object.values(D.servicos_det).reduce((a,sv)=>a+(sv.pm?.[m]?.h||0),0),0);
  const hEscritorio=S.meses.reduce((s,m)=>s+(D.kpm[m]?.h||0),0);
  const hSem=Math.max(0,hEscritorio-hVinc);
  const mensalSemTodos=mensalCalc().filter(m=>m.ativo!==false&&m._rec===0&&m._h>0).sort((a,b)=>b._h-a._h);
  const mensalSem=mensalSemTodos.filter(m=>!activeClientDecision(m.cli));
  const mensalComContexto=mensalSemTodos.filter(m=>activeClientDecision(m.cli));
  const pend=(cv.pendencias||[]);
  const duplicados=(au.themis_alocacao?.duplicidades||[]).filter(r=>{
    const parts=String(r.data||'').split('/');
    return parts.length===3&&S.meses.includes(`${parts[2]}-${parts[1].padStart(2,'0')}`);
  });
  const incompletos=crm.registros_incompletos||[];
  const financeirosPendentes=crm.valores_financeiros_nao_confirmados||[];
  const semValores=au.valores_pessoas?.registros||[];
  const ambiguas=au.mapa_pastas?.registros_ambiguos||[];
  const pessoasOrfas=au.pessoas_themis?.nao_cadastradas||[];
  const dif=Math.round((hBi-hFonteJuridica)*100)/100;
  const reconciliado=mesesThemis.every(m=>Math.abs((D.kpm[m]?.h||0)-((fonte[m]||0)-(admExcluido[m]||0)))<=.051);
  const difVisual=reconciliado?0:dif;
  const openGroups=[
    !reconciliado,
    (cv.linhas_sem_codigo_crm||0)>0,
    duplicados.length>0,
    mensalSem.length>0,
    incompletos.length>0,
    financeirosPendentes.length>0,
    semValores.length>0,
    ambiguas.length>0,
    pessoasOrfas.length>0,
  ].filter(Boolean).length;
  const cadastroGroups=[incompletos.length,financeirosPendentes.length,semValores.length,ambiguas.length,pessoasOrfas.length].filter(Boolean).length;

  document.getElementById('au-summary').innerHTML=`
    <div class="audit-stat"><div class="l">Integridade dos totais</div><div class="n ${reconciliado?'g':'r'}">${reconciliado?'Aprovada':'Bloqueada'}</div><div class="s">${reconciliado?'fonte e BI fecham mês a mês':'há divergência que impede publicação confiável'}</div></div>
    <div class="audit-stat"><div class="l">Frentes abertas</div><div class="n ${openGroups?'a':'g'}">${openGroups}</div><div class="s">priorizadas abaixo por impacto e tipo de correção</div></div>
    <div class="audit-stat"><div class="l">Qualidade cadastral</div><div class="n ${cadastroGroups?'a':'g'}">${cadastroGroups}</div><div class="s">categorias com ajustes de CRM, pessoas ou pastas</div></div>
    <div class="audit-stat"><div class="l">Acompanhamentos</div><div class="n ${mensalComContexto.length?'a':'g'}">${mensalComContexto.length}</div><div class="s">decisões estratégicas que explicam exceções da base</div></div>`;
  document.getElementById('au-kpis').innerHTML=`
    <div class="kc"><div class="kc-l">Horas da fonte jurídica</div><div class="kc-v">${mesesThemis.length?fmtH(hFonteJuridica):'—'}</div><div class="kc-s">fonte bruta ${fmtH(hFonte)}h − time Administrativo ${fmtH(hAdmExcluido)}h</div></div>
    <div class="kc"><div class="kc-l">Horas publicadas no BI</div><div class="kc-v ${reconciliado?'g':'r'}">${mesesThemis.length?fmtH(hBi):'—'}</div><div class="kc-s">diferença mensal: ${mesesThemis.length?fmtH(difVisual):'—'}h</div></div>
    <div class="kc"><div class="kc-l">Horas vinculadas a serviços</div><div class="kc-v">${fmtH(hVinc)}</div><div class="kc-s">${hEscritorio?fmtP(hVinc/hEscritorio*100):'—'} do escritório no período</div></div>
    <div class="kc"><div class="kc-l">Horas fora de serviços CRM</div><div class="kc-v ${hSem>.05?'a':'g'}">${fmtH(hSem)}</div><div class="kc-s">inclui atividades internas e lançamentos sem venda no período</div></div>`;
  document.getElementById('au-status').innerHTML=mesesThemis.length
    ? (reconciliado?`<b>✓ Total conciliado:</b> cada mês fecha após excluir somente o time Administrativo; horas ADM dos advogados e sócios permanecem.`:`<b>⚠ Divergência de ${fmtH(Math.abs(dif))}h:</b> a publicação deve ser bloqueada até a correção.`)
    : '<b>Informação:</b> o período selecionado pertence ao histórico Eleven; a conciliação Themis começa em 2026.';

  const queue=[];
  if(!reconciliado) queue.push({priority:'block',label:'Bloqueante',issue:'Conciliação mensal da fonte',volume:`${fmtH(Math.abs(dif))}h de diferença`,owner:'Dados / BI',source:'Themis e pipeline',action:'Interromper a publicação e reconciliar o mês divergente.',impact:'Nenhuma decisão deve usar o BI antes da correção.',target:null});
  if((cv.linhas_sem_codigo_crm||0)>0) queue.push({priority:'high',label:'Alta',issue:'Lançamentos sem código CRM',volume:`${fmtH(hSem)}h no período · ${(cv.linhas_sem_codigo_crm||0).toLocaleString('pt-BR')} linhas na base`,owner:'Operações jurídicas',source:'Themis / CRM',action:'Preencher ou corrigir código de venda e pasta na origem.',impact:'Horas ficam fora do detalhe correto de cliente e serviço.',target:'au-sec-codigos'});
  if(mensalSem.length) queue.push({priority:'high',label:'Alta',issue:'Receita zerada sem explicação',volume:`${mensalSem.length} cliente${mensalSem.length===1?'':'s'} no período`,owner:'Financeiro + sócio responsável',source:'Mensalistas / Cliente 360',action:'Cadastrar receita ou registrar a decisão que explica a gratuidade.',impact:'A margem desses clientes não é conclusiva.',target:'au-sec-mensal'});
  if(duplicados.length) queue.push({priority:'high',label:'Conferir',issue:'Possíveis lançamentos duplicados',volume:`${duplicados.length} lançamentos · ${fmtH(duplicados.reduce((s,r)=>s+Number(r.horas||0),0))}h no período`,owner:'Operações jurídicas',source:'Themis',action:'Conferir data, pessoa, descrição e duração; corrigir somente na origem.',impact:'Podem superestimar horas e custo; não são excluídos automaticamente.',target:'au-sec-duplicados'});
  if(semValores.length) queue.push({priority:'high',label:'Alta',issue:'Pessoas sem valor de hora',volume:`${semValores.length} pessoa${semValores.length===1?'':'s'}`,owner:'Gestão de pessoas',source:'Pessoas e valores',action:'Preencher cargo e tabelas mensal, pontual e custo.',impact:'Impede custo e margem confiáveis.',target:'au-sec-pessoas'});
  if(incompletos.length) queue.push({priority:'data',label:'Cadastro',issue:'Campos essenciais vazios no CRM',volume:`${incompletos.length} contrato${incompletos.length===1?'':'s'} ativo${incompletos.length===1?'':'s'}`,owner:'Comercial / contratos',source:'CRM',action:'Completar cliente, responsável, tipo e vigência indicados.',impact:'Prejudica agrupamentos e responsáveis.',target:'au-sec-crm'});
  if(financeirosPendentes.length) queue.push({priority:'high',label:'Alta',issue:'Valor financeiro não confirmado no CRM',volume:`${financeirosPendentes.length} campo${financeirosPendentes.length===1?'':'s'} com texto ou formato inválido`,owner:'Comercial / financeiro',source:'CRM',action:'Converter a condição comercial em valor numérico confirmado ou manter o campo financeiro em branco.',impact:'O campo não é tratado como zero; indicadores dependentes ficam incompletos.',target:null});
  if(ambiguas.length) queue.push({priority:'data',label:'Cadastro',issue:'Pastas associadas a múltiplos códigos',volume:`${ambiguas.length} pasta${ambiguas.length===1?'':'s'}`,owner:'Operações jurídicas',source:'Themis / CRM',action:'Separar ou padronizar a pasta para identificar uma única venda.',impact:'A pasta não pode ser usada para inferir a venda.',target:'au-sec-pastas'});
  if(pessoasOrfas.length) queue.push({priority:'data',label:'Cadastro',issue:'Pessoas do Themis sem cadastro',volume:`${pessoasOrfas.length} pessoa${pessoasOrfas.length===1?'':'s'}`,owner:'Gestão de pessoas',source:'Themis / Pessoas',action:'Conciliar grafia do nome e situação do cadastro.',impact:'Horas não entram corretamente nas visões de equipe.',target:'au-sec-orfas'});
  if(mensalComContexto.length) queue.push({priority:'ok',label:'Acompanhar',issue:'Receita zerada por decisão registrada',volume:`${mensalComContexto.length} cliente${mensalComContexto.length===1?'':'s'} · ${fmtK(mensalComContexto.reduce((s,m)=>s+m._custo,0))}`,owner:'Sócio responsável',source:'Cliente 360',action:'Acompanhar prazo, consumo de horas e retorno esperado.',impact:'Não é erro de receita; é investimento estratégico documentado.',target:'au-sec-mensal'});
  AUDIT_QUEUE=queue;
  AUDIT_DETAILS=[
    ...pend.map(p=>['Código de venda','Histórico completo','Alta',p.codigo||'vazio/000',p.cliente||'',p.pasta||'',p.linhas||0,p.horas||0,'Operações jurídicas','Themis / CRM','Corrigir código/pasta na origem ou cadastrar a venda no CRM']),
    ...duplicados.map(r=>['Possível duplicidade','Período selecionado','Conferir',r.data||'',r.pessoa||'',`${r.cliente||''} · ${r.descricao||''}`,1,r.horas||0,'Operações jurídicas','Themis','Conferir na origem antes de excluir']),
    ...mensalSemTodos.map(m=>['Receita zero','Período selecionado',activeClientDecision(m.cli)?'Acompanhar':'Alta',m.cli,m.cli,activeClientDecision(m.cli)?.title||'Sem explicação registrada',1,m._h,'Financeiro + sócio responsável','Mensalistas / Cliente 360',activeClientDecision(m.cli)?'Acompanhar prazo e retorno':'Cadastrar receita ou registrar decisão']),
    ...incompletos.map(r=>['Cadastro CRM','Contratos ativos','Cadastro',r.codigo||'',r.cliente||'',(r.campos||[]).join(', '),1,'','Comercial / contratos','CRM','Completar os campos essenciais']),
    ...financeirosPendentes.map(r=>['Valor financeiro CRM','Histórico completo','Alta',r.codigo||'', '', `${r.campo||''}: ${r.valor||''} · linha ${r.linha_origem||'—'}`,1,'','Comercial / financeiro','CRM','Converter para valor numérico confirmado']),
    ...semValores.map(r=>['Valor de hora','Cadastro atual','Alta',r.pessoa||'',r.pessoa||'',(r.campos||[]).join(', '),1,'','Gestão de pessoas','Pessoas e valores','Preencher cargo e tabelas de valor']),
    ...ambiguas.map(r=>['Pasta ambígua','Histórico completo','Cadastro',r.pasta||'','', (r.codigos||[]).join(', '),r.codigos?.length||0,'','Operações jurídicas','Themis / CRM','Padronizar a pasta para uma única venda']),
    ...pessoasOrfas.map(r=>['Pessoa não conciliada','Histórico completo','Cadastro',r.pessoa_origem||'',r.pessoa_origem||'',`Último mês: ${r.ultimo_mes||'—'}`,1,r.horas||0,'Gestão de pessoas','Themis / Pessoas','Conciliar nome e situação cadastral']),
  ];
  document.getElementById('au-queue').innerHTML=`<thead><tr><th>Prioridade</th><th>Problema</th><th>Volume</th><th>Responsável sugerido</th><th>Onde corrigir</th><th>Próxima ação</th></tr></thead><tbody>`+
    (queue.length?queue.map(q=>`<tr ${q.target?`onclick="scrollAudit('${q.target}')"`:''}><td><span class="priority ${q.priority}">${q.label}</span></td><td class="${q.target?'lk':''}">${esc(q.issue)}</td><td>${esc(q.volume)}</td><td>${esc(q.owner)}</td><td><span class="source-tag">${esc(q.source)}</span></td><td class="audit-action">${esc(q.action)}</td></tr>`).join(''):'<tr><td colspan="6" class="tm">Nenhuma correção ou acompanhamento pendente no período.</td></tr>')+'</tbody>';

  const empty=(n,msg)=>`<tbody><tr class="audit-empty"><td colspan="${n}" class="tm">${msg}</td></tr></tbody>`;
  document.getElementById('au-codigos').innerHTML=`<thead><tr><th>Código informado</th><th>Pasta</th><th>Cliente na origem</th><th class="r">Linhas</th><th class="r">Horas</th></tr></thead>`+
    (pend.length?`<tbody>${pend.map(p=>`<tr><td>${!p.codigo||/^0+$/.test(p.codigo)?'<span class="badge br">vazio/000</span>':esc(p.codigo)}</td><td>${esc(p.pasta)||'—'}</td><td>${esc(p.cliente)}</td><td class="tr">${p.linhas}</td><td class="tr"><b>${fmtH(p.horas)}</b></td></tr>`).join('')}</tbody>`:empty(5,'Nenhum código pendente.'));
  document.getElementById('au-duplicados').innerHTML=`<thead><tr><th>Data</th><th>Pessoa</th><th>Cliente</th><th>Descrição</th><th class="r">Horas</th></tr></thead>`+
    (duplicados.length?`<tbody>${duplicados.map(r=>`<tr><td>${esc(r.data)}</td><td>${esc(r.pessoa)}</td><td>${esc(r.cliente)}</td><td>${esc(r.descricao)}</td><td class="tr"><b>${fmtH(r.horas)}</b></td></tr>`).join('')}</tbody>`:empty(5,'Nenhuma duplicidade potencial encontrada.'));
  document.getElementById('au-mensal').innerHTML=`<thead><tr><th>Cliente</th><th>Situação</th><th class="r">Horas</th><th class="r">Receita</th></tr></thead>`+
    (mensalSemTodos.length?`<tbody>${mensalSemTodos.map(m=>{const context=activeClientDecision(m.cli);return `<tr onclick="openCliente('${jsq(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td>${context?`<span class="badge strategy">explicado</span> ${esc(context.title)}`:'<span class="badge br">corrigir/explicar</span>'}</td><td class="tr">${fmtH(m._h)}</td><td class="tr"><b>${fmtK(m._rec)}</b></td></tr>`}).join('')}</tbody>`:empty(4,'Nenhum mensalista ativo sem valor no período.'));
  document.getElementById('au-crm').innerHTML=`<thead><tr><th>Código</th><th>Cliente</th><th>Células vazias</th></tr></thead>`+
    (incompletos.length?`<tbody>${incompletos.map(r=>`<tr ${D.servicos_det[r.codigo]?`onclick="openServico('${r.codigo}')"`:''}><td class="lk">${esc(r.codigo)}</td><td>${esc(r.cliente)||'—'}</td><td>${esc((r.campos||[]).join(', '))}</td></tr>`).join('')}</tbody>`:empty(3,'Nenhuma célula essencial vazia em contratos ativos.'));
  document.getElementById('au-pessoas').innerHTML=`<thead><tr><th>Pessoa</th><th>Valores ausentes na origem</th></tr></thead>`+
    (semValores.length?`<tbody>${semValores.map(r=>`<tr onclick="openPessoa('${jsq(r.pessoa)}')"><td class="lk">${esc(r.pessoa)}</td><td>${esc((r.campos||[]).join(', '))}</td></tr>`).join('')}</tbody>`:empty(2,'Todos os valores de hora estão preenchidos.'));
  document.getElementById('au-pastas').innerHTML=`<thead><tr><th>Pasta</th><th>Códigos encontrados</th></tr></thead>`+
    (ambiguas.length?`<tbody>${ambiguas.map(r=>`<tr><td>${esc(r.pasta)}</td><td>${esc((r.codigos||[]).join(', '))}</td></tr>`).join('')}</tbody>`:empty(2,'Nenhuma pasta ambígua.'));
  document.getElementById('au-pessoas-orfas').innerHTML=`<thead><tr><th>Nome na origem</th><th>Último mês</th><th class="r">Horas históricas</th></tr></thead>`+
    (pessoasOrfas.length?`<tbody>${pessoasOrfas.map(r=>`<tr><td>${esc(r.pessoa_origem)}</td><td>${esc(r.ultimo_mes)}</td><td class="tr"><b>${fmtH(r.horas)}</b></td></tr>`).join('')}</tbody>`:empty(3,'Todas as pessoas estão conciliadas com o cadastro.'));

  const badge=document.getElementById('sb-audit-n');
  badge.textContent=openGroups;badge.style.display=openGroups?'':'none';
  filterAuditDetails(document.getElementById('au-search')?.value||'');
}

/* ───────── OVERLAY: PESSOA ───────── */
function openPessoa(nome){
  const p = D.hm.find(x=>x.adv===nome);
  if(!p) return;
  const calc = hmCalc().find(x=>x.adv===nome);
  const periodText=document.getElementById('period-note').textContent;
  document.getElementById('ovp-title').textContent = nome;
  document.getElementById('ovp-sub').textContent = `${p.fn} · ${p.cargo} · Equipe-base ${officialHomeTeam(p.time)} · ${periodText}${p.ativo?'':' · desligado'}`;
  const det = D.pessoas_det[nome];
  let html = `<div class="period-context"><b>Período analisado:</b> ${esc(periodText)}</div><div class="kg kg4">
    <div class="kc"><div class="kc-l">Horas no período</div><div class="kc-v">${fmtH(calc._tot)}</div></div>
    <div class="kc"><div class="kc-l">🔴 Vermelho</div><div class="kc-v">${fmtP(calc._pct.v)}</div><div class="kc-s">${fmtH(calc._h.v)}h ${p.dev.v==='low'?'⬇ abaixo do benchmark':p.dev.v==='high'?'⬆ acima':''}</div></div>
    <div class="kc"><div class="kc-l">🟡 Amarelo</div><div class="kc-v">${fmtP(calc._pct.a)}</div><div class="kc-s">${fmtH(calc._h.a)}h</div></div>
    <div class="kc"><div class="kc-l">⬜ Admin</div><div class="kc-v">${fmtP(calc._pct.adm)}</div><div class="kc-s">${fmtH(calc._h.adm)}h ${p.dev.adm==='high'?'⬆ acima do máximo':''}</div></div>
  </div>
  <div class="panel"><div class="ph2"><span class="t">Evolução mensal por sinaleira</span></div><div class="pb"><div class="cw"><canvas id="c-ovp"></canvas></div></div></div>`;

  if(det){
    const casos = (det.casos||[]).filter(c=>c.nm).map(c=>({...c,_ph:S.meses.reduce((s,m)=>s+(c.pm?.[m]||0),0)})).filter(c=>c._ph>0);
    const hSemCodigo = S.meses.reduce((s,m)=>s+(det.pm_sem_codigo?.[m]||0),0);
    const totalCasos = casos.reduce((s,c)=>s+c._ph,0)+hSemCodigo;
    html += `<div class="panel"><div class="ph2"><span class="t">Casos e processos trabalhados</span><span class="s">${casos.length} itens no período · clique para abrir</span></div><div class="pb ow"><table class="t">
      <thead><tr><th>Caso</th><th>Cliente</th><th>Tipo</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Total h</th></tr></thead><tbody>`+
      casos.sort((a,b)=>b._ph-a._ph).map(c=>`<tr onclick="openServico('${c.cod}')">
        <td class="lk">${esc(c.nm)}</td>
        <td><span class="lk" onclick="event.stopPropagation();openCliente('${jsq(c.cli)}')">${esc(c.cli)}</span></td>
        <td><span class="badge bc">${c.tp||''}</span>${c.ativo===false&&c.tp?' <span class="badge br">baixado</span>':''}</td>
        ${S.meses.map(m=>`<td class="tr tm">${fmtH(c.pm&&c.pm[m]?c.pm[m]:0)}</td>`).join('')}
        <td class="tr"><b>${fmtH(c._ph)}</b></td></tr>`).join('')+
      (hSemCodigo?`<tr><td><i class="tm">Atividades sem código de serviço</i></td><td></td><td><span class="badge ba">revisar origem</span></td>${S.meses.map(m=>`<td class="tr tm">${fmtH(det.pm_sem_codigo?.[m]||0)}</td>`).join('')}<td class="tr"><b>${fmtH(hSemCodigo)}</b></td></tr>`:'')+
      `</tbody><tfoot><tr><th colspan="3">Total conciliado</th>${S.meses.map(m=>`<th class="tr">${fmtH(det.h_mes?.[m]?.h||0)}</th>`).join('')}<th class="tr">${fmtH(totalCasos)}</th></tr></tfoot></table></div></div>`;
  }
  document.getElementById('ovp-body').innerHTML = html;
  document.getElementById('ov-pessoa').classList.add('open');
  setTimeout(()=>{
    mkChart('c-ovp',{type:'bar',data:{labels:S.meses.map(mLbl),datasets:[
      {label:'Vermelho',data:S.meses.map(m=>p.pm[m]?p.pm[m].v:0),backgroundColor:'#C0392B'},
      {label:'Amarelo',data:S.meses.map(m=>p.pm[m]?p.pm[m].a:0),backgroundColor:'#C47A00'},
      {label:'Verde',data:S.meses.map(m=>p.pm[m]?p.pm[m].g:0),backgroundColor:'#2E7D32'},
      {label:'Admin',data:S.meses.map(m=>p.pm[m]?p.pm[m].adm:0),backgroundColor:'#546E7A'}
    ]},options:{maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});
  },50);
}

/* ───────── OVERLAY: CLIENTE ───────── */
function openCliente(nome){
  const cd = D.cli_det[nome];
  const men = mensalCalc().find(m=>m.cli===nome);
  document.getElementById('ovc-title').textContent = nome;
  const periodText=document.getElementById('period-note').textContent;
  document.getElementById('ovc-sub').textContent = `Cliente 360° · ${men?'recorrente':'projetos e serviços'} · ${periodText}`;
  let html = `<div class="period-context"><b>Período analisado:</b> ${esc(periodText)}</div>`;
  const hSemCodigo = cd ? S.meses.reduce((s,m)=>s+(cd.pm_sem_codigo?.[m]||0),0) : 0;
  const periodServices = cd ? cd.svcs.map(svc=>({
    ...svc,
    _ph:S.meses.reduce((s,m)=>s+(svc.pm?.[m]||0),0),
    _pc:S.meses.reduce((s,m)=>s+(svc.pcm?.[m]||0),0),
  })) : [];
  const hServicos = periodServices.reduce((total,svc)=>total+svc._ph,0);
  const hCliente = hServicos + hSemCodigo;
  const custoCliente=C(periodServices.reduce((s,svc)=>s+svc._pc,0));
  const ativos=periodServices.filter(s=>s.ativo);
  const baixados=periodServices.filter(s=>!s.ativo);
  const activeAreas=new Set(ativos.map(s=>D.servicos_det[s.cod]?.area).filter(Boolean));
  const activeTypes=new Set(ativos.map(s=>s.tp).filter(Boolean));
  const partnerNames=new Set(D.hm.filter(p=>String(p.fn).toLocaleLowerCase('pt-BR').includes('sócio')).map(p=>String(p.adv).toLocaleUpperCase('pt-BR')));
  const contributors=new Map();
  periodServices.forEach(svc=>(D.servicos_det[svc.cod]?.por_pessoa||[]).forEach(p=>{
    const hours=S.meses.reduce((sum,m)=>sum+(p.pm?.[m]||0),0);
    if(!hours) return;
    const key=String(p.adv||'Não identificado');
    contributors.set(key,(contributors.get(key)||0)+hours);
  }));
  const people=[...contributors].map(([name,hours])=>({name,hours,partner:partnerNames.has(name.toLocaleUpperCase('pt-BR'))})).sort((a,b)=>b.hours-a.hours);
  const partnerHours=people.filter(p=>p.partner).reduce((s,p)=>s+p.hours,0);
  const partnerShare=hCliente>0?partnerHours/hCliente*100:0;
  const leadResponsible=men?.resp||ativos.map(s=>D.servicos_det[s.cod]?.resp).find(Boolean)||'não identificado';
  const totalRecurring=carteiraRows(mensalCalc()).reduce((s,m)=>s+m._rec,0);
  const revenueShare=men&&totalRecurring>0?men._rec/totalRecurring*100:null;
  const auditState=auditSummary();
  const recMissing=!!(men&&men._h>0&&men._rec===0);
  const strategyRecords=clientStrategicDecisions(nome);
  const activeStrategy=activeClientDecision(nome);
  const marginPct=men&&men._rec>0?men._margem/men._rec*100:null;
  const priorMonths=previousComparableMonths(S.meses);
  const priorMargin=men&&priorMonths.length===S.meses.length
    ? sumFinancialPM(men,priorMonths,'r')-C(sumFinancialPM(men,priorMonths,'c')) : null;
  let stance='MONITORAR', confidence='média', headline='Leitura econômica ainda parcial', rationale='A base atual permite acompanhar esforço e custo, mas não contém todos os sinais comerciais e relacionais do cliente.', decision='Validar contexto comercial antes de ampliar ou reduzir a exposição.';
  if(recMissing&&activeStrategy){
    stance='DECISÃO REGISTRADA'; confidence=activeStrategy.startMonth&&activeStrategy.endMonth?'alta':'média'; headline='Receita zero explicada por contexto estratégico';
    rationale=`${activeStrategy.title}. No período, a decisão absorveu ${fmtH(men._h)}h e ${fmtK(men._custo)} de custo do escopo.`;
    decision=activeStrategy.recommendation||'Acompanhar prazo, consumo de horas e contrapartida esperada antes de encerrar a decisão.';
  }else if(recMissing){
    stance='VALIDAR DADOS'; confidence='baixa'; headline='A decisão econômica está bloqueada';
    rationale=`Existem ${fmtH(men._h)}h no escopo recorrente e nenhuma receita cadastrada no período.`;
    decision='Financeiro deve corrigir ou confirmar a receita antes de qualquer decisão de preço, expansão ou continuidade.';
  }else if(men&&men._margem<0){
    stance='RECUPERAR MARGEM'; confidence=auditState.reconciliado&&hSemCodigo===0?'alta':'média'; headline='O contrato consome mais valor do que captura';
    rationale=`A margem recorrente é ${fmtK(men._margem)} (${fmtP(marginPct)}), com ${fmtH(men._h)}h no escopo.`;
    decision=`Revisar preço, escopo e composição da equipe. O preço de equilíbrio no período é ${fmtK(men._custo)}; a margem-alvo ainda precisa ser aprovada.`;
  }else if(men&&marginPct>=30){
    stance='PROTEGER'; confidence=auditState.reconciliado&&hSemCodigo===0?'alta':'média'; headline='Conta economicamente saudável no período';
    rationale=`Margem recorrente de ${fmtP(marginPct)} e ${revenueShare==null?'participação não calculável':fmtP(revenueShare)+' da receita recorrente ativa'}.`;
    decision=`Preservar nível de serviço e validar potencial de expansão além das ${activeAreas.size||0} área${activeAreas.size===1?'':'s'} atualmente identificada${activeAreas.size===1?'':'s'}.`;
  }else if(men){
    stance='MONITORAR'; confidence=auditState.reconciliado&&hSemCodigo===0?'alta':'média'; headline='Conta positiva, mas sem folga ampla';
    rationale=`Margem recorrente de ${marginPct==null?'—':fmtP(marginPct)} no período.`;
    decision='Acompanhar consumo de escopo e tendência antes do próximo ciclo de reajuste.';
  }
  const gapChips=[
    hSemCodigo>0?`<span class="gap-chip warn">${fmtH(hSemCodigo)}h sem código de venda</span>`:'',
    recMissing&&!activeStrategy?'<span class="gap-chip bad">receita recorrente sem explicação</span>':'',
    activeStrategy&&(!activeStrategy.startMonth||!activeStrategy.endMonth)?'<span class="gap-chip warn">confirmar início e fim da decisão</span>':'',
    '<span class="gap-chip">classe A–E/ICP não cadastrada</span>',
    '<span class="gap-chip">renovação, NPS e churn sem fonte</span>'
  ].filter(Boolean).join('');
  html += `<div class="c360-hero"><div class="c360-top"><div><div class="c360-label">Diagnóstico calculado · não substitui deliberação</div><div class="c360-title">${esc(headline)}</div><div class="c360-text">${esc(rationale)}</div></div><div class="c360-status"><div class="l">Prioridade sugerida</div><div class="v">${esc(stance)}</div><div class="s">confiança ${esc(confidence)}</div></div></div></div>`;
  if(men){
    const hOutros = Math.max(0,hServicos-men._hb-men._hi);
    const codsEscopo = new Set([...(men.cods||[]),...(men.inclusos_cods||[])]);
    const custoOutros = C(periodServices.filter(s=>!codsEscopo.has(String(s.cod))).reduce((s,svc)=>s+svc._pc,0));
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">Receita no período</div><div class="kc-v">${fmtK(men._rec)}</div></div>
      <div class="kc"><div class="kc-l">Custo do escopo (${S.rate})</div><div class="kc-v">${fmtK(men._custo)}</div></div>
      <div class="kc"><div class="kc-l">Margem</div><div class="kc-v ${men._margem>=0?'g':'r'}">${fmtK(men._margem)}</div><div class="kc-s">${fmtP(men._mpct)}</div></div>
      <div class="kc"><div class="kc-l">Horas totais do cliente</div><div class="kc-v">${fmtH(hCliente)}</div><div class="kc-s">${fmtH(men._h)} no escopo recorrente</div></div>
    </div>
    ${hOutros>.05||hSemCodigo>.05?`<div class="note"><b>Fora da margem recorrente:</b> ${fmtH(hOutros)}h e ${fmtK(custoOutros)} de outros serviços${hSemCodigo>.05?` · mais ${fmtH(hSemCodigo)}h sem código de venda`:''}. O custo total do cliente no período é ${fmtK(custoCliente)}.</div>`:''}`;
  } else if(cd){
    const custo = C(periodServices.reduce((s,svc)=>s+svc._pc,0));
    const receitaContratada = periodServices.reduce((s,svc)=>s+(svc.rec||0),0);
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">Receita contratada</div><div class="kc-v">${fmtK(receitaContratada)}</div></div>
      <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(custo)}</div></div>
      <div class="kc"><div class="kc-l">Saldo vs. custo do período</div><div class="kc-v ${receitaContratada-custo>=0?'g':'r'}">${fmtK(receitaContratada-custo)}</div></div>
      <div class="kc"><div class="kc-l">Horas no período</div><div class="kc-v">${fmtH(hCliente)}</div></div>
    </div>`;
  }
  html += `<div class="c360-brief">
    <div class="c360-card"><h3>Brief de decisão</h3>
      <div class="c360-line"><div class="k">Fato</div><div class="v">${esc(rationale)}</div></div>
      <div class="c360-line"><div class="k">Decisão</div><div class="v"><b>${esc(decision)}</b></div></div>
      <div class="c360-line"><div class="k">Verificação</div><div class="v">${men?`Margem recorrente, horas do escopo e tendência no próximo período comparável.`:`Horas, custo e avanço de cada serviço; receita contratada não é tratada como faturamento do período.`}</div></div>
    </div>
    <div class="c360-card"><h3>Posição na carteira</h3>
      <div class="c360-line"><div class="k">Responsável</div><div class="v">${esc(leadResponsible)}</div></div>
      <div class="c360-line"><div class="k">Cobertura</div><div class="v">${activeAreas.size} área${activeAreas.size===1?'':'s'} · ${activeTypes.size} tipo${activeTypes.size===1?'':'s'} de serviço · ${ativos.length} serviço${ativos.length===1?'':'s'} ativo${ativos.length===1?'':'s'}</div></div>
      <div class="c360-line"><div class="k">Sócios</div><div class="v">${fmtH(partnerHours)}h · ${fmtP(partnerShare)} das horas identificadas do cliente</div></div>
      <div class="c360-line"><div class="k">Tendência</div><div class="v">${men&&priorMargin!=null?`${comparisonHTML(men._margem,priorMargin)} margem vs. ${periodRangeLabel(priorMonths)}`:'sem período anterior equivalente para a margem'}</div></div>
    </div>
  </div><div class="c360-card" style="margin-bottom:14px"><h3>Lacunas que limitam a recomendação</h3><div class="c360-gaps">${gapChips}</div></div>`;
  const strategyTypeLabels={bonus:'Bonificação',pricing:'Preço',scope:'Escopo',relationship:'Relacionamento',expansion:'Expansão',exit:'Saída',other:'Outro'};
  const strategyStatusLabels={active:'Ativa',monitoring:'Em acompanhamento',completed:'Concluída',cancelled:'Cancelada'};
  html += `<div class="c360-card" style="margin-bottom:14px"><h3>Decisões e contextos estratégicos</h3>
    ${strategyRecords.length?strategyRecords.map(d=>`<div class="strategy-record"><div class="strategy-record-head"><div><div class="strategy-record-title">${esc(d.title)}</div><div class="strategy-record-meta">${esc(strategyTypeLabels[d.type]||d.type)} · ${esc(strategyStatusLabels[d.status]||d.status)} · ${esc(strategicPeriodLabel(d))} · ${esc(decisionDueLabel(d))} · responsável: ${esc(d.owner||'—')} · ${d.storage==='official'?'base oficial':'salvo neste navegador'}</div></div>${d.storage==='local'?`<div class="strategy-record-buttons">${decisionIsOpen(d)?`<button onclick="setStrategicDecisionStatus('${jsq(d.id)}','completed',decodeURIComponent('${encodeURIComponent(nome).replace(/'/g,'%27')}'))">concluir</button>`:`<button onclick="setStrategicDecisionStatus('${jsq(d.id)}','monitoring',decodeURIComponent('${encodeURIComponent(nome).replace(/'/g,'%27')}'))">reabrir</button>`}<button onclick="deleteStrategicDecision('${jsq(d.id)}',decodeURIComponent('${encodeURIComponent(nome).replace(/'/g,'%27')}'))">excluir</button></div>`:''}</div><div class="strategy-record-text">${esc(d.rationale)}</div>${d.recommendation?`<div class="strategy-record-action">Recomendação assimilada: ${esc(d.recommendation)}</div>`:''}${d.successMetric?`<div class="strategy-record-success">Critério de sucesso: ${esc(d.successMetric)}</div>`:''}</div>`).join(''):'<div class="tm">Nenhuma decisão estratégica registrada para este cliente.</div>'}
    <form class="strategy-form" onsubmit="saveStrategicDecision(event,decodeURIComponent('${encodeURIComponent(nome).replace(/'/g,'%27')}'))">
      <div><label>Tipo</label><select name="type"><option value="bonus">Bonificação / gratuidade</option><option value="pricing">Preço</option><option value="scope">Escopo</option><option value="relationship">Relacionamento</option><option value="expansion">Expansão</option><option value="exit">Saída</option><option value="other">Outro</option></select></div>
      <div><label>Status</label><select name="status"><option value="active">Ativa</option><option value="monitoring">Em acompanhamento</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></div>
      <div class="full"><label>Título da decisão</label><input name="title" required placeholder="Ex.: bonificação comercial por 3 meses"></div>
      <div><label>Início (opcional)</label><input name="startMonth" type="month"></div><div><label>Fim (opcional)</label><input name="endMonth" type="month"></div>
      <div><label>Próxima revisão</label><input name="nextReview" type="date"></div><div><label>Responsável</label><input name="owner" placeholder="Sócio ou responsável"></div>
      <div class="full"><label>Contexto / motivo</label><textarea name="rationale" required placeholder="O que foi decidido e por quê"></textarea></div>
      <div class="full"><label>Recomendação para o painel</label><textarea name="recommendation" placeholder="Como o BI deve orientar os sócios enquanto a decisão estiver vigente"></textarea></div>
      <div class="full"><label>Critério de sucesso</label><textarea name="successMetric" placeholder="Como saberemos que a decisão funcionou"></textarea></div>
      <div><label>Potencial comercial</label><select name="potential"><option value="unknown">Não avaliado</option><option value="high">Alto</option><option value="medium">Médio</option><option value="low">Baixo</option></select></div>
      <div><label>Risco de relacionamento</label><select name="relationshipRisk"><option value="unknown">Não avaliado</option><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto</option></select></div>
      <div class="strategy-form-actions"><span class="strategy-help">O registro novo fica neste navegador até ser consolidado na base oficial.</span><button class="strategy-save" type="submit">Registrar decisão</button></div>
    </form></div>`;
  if(hSemCodigo>0){
    html += `<div class="note">⚠ ${fmtH(hSemCodigo)}h no período vieram do Themis sem código de venda. Elas estão no total do cliente, mas não foram atribuídas silenciosamente a um serviço.</div>`;
  }
  if(men) html += `<div class="panel"><div class="ph2"><span class="t">Economia recorrente · evolução mensal</span><span class="s">receita, custo e horas apenas do escopo mensal</span></div><div class="pb"><div class="cw"><canvas id="c-ovc"></canvas></div></div></div>`;
  // serviços
  if(cd && cd.svcs && cd.svcs.length){
    html += `<div class="panel"><div class="ph2"><span class="t">Serviços ativos · no período</span><span class="s">${ativos.filter(s=>s._ph>0).length} com horas · ${ativos.length} ativos</span></div><div class="pb ow"><table class="t">
      <thead><tr><th>Serviço</th><th>Área</th><th>Tipo</th><th class="r">Horas</th><th class="r">% cliente</th><th class="r">Custo</th></tr></thead><tbody>`+
      (ativos.length?ativos.sort((a,b)=>b._ph-a._ph).map(s=>`<tr onclick="openServico('${s.cod}')"><td class="lk">${esc(s.nm)||'<i>cód. '+s.cod+'</i>'}${s.inc?' <span class="badge bg">incluso mensal</span>':''}</td><td>${esc(D.servicos_det[s.cod]?.area||'—')}</td><td><span class="badge bc">${s.tp||''}</span></td><td class="tr">${fmtH(s._ph)}</td><td class="tr">${hCliente?fmtP(s._ph/hCliente*100):'—'}</td><td class="tr">${fmtK(C(s._pc))}</td></tr>`).join(''):'<tr><td colspan="6" class="tm">Nenhum.</td></tr>')+'</tbody></table></div></div>';
    if(baixados.length){
      html += `<div class="panel"><div class="ph2"><span class="t">Histórico encerrado</span><span class="s">${baixados.length}</span></div><div class="pb ow"><table class="t"><tbody>`+
        baixados.slice(0,30).map(s=>`<tr onclick="openServico('${s.cod}')"><td class="lk tm">${esc(s.nm)||'cód. '+s.cod}</td><td><span class="badge bc">${s.tp||''}</span></td><td class="tr tm">${fmtH(s._ph)}h</td></tr>`).join('')+'</tbody></table></div></div>';
    }
  }
  html += `<div class="c360-team"><div class="c360-card"><h3>Quem sustenta a conta · no período</h3>${people.length?people.slice(0,8).map(p=>`<div class="person-row" onclick="openPessoa('${jsq(p.name)}')"><div><div class="n lk">${esc(p.name)}</div><div class="m">${p.partner?'sócio':'equipe'} · ${hCliente?fmtP(p.hours/hCliente*100):'—'} do cliente</div></div><div class="h">${fmtH(p.hours)}h</div></div>`).join(''):'<div class="tm">Sem pessoas identificadas no período.</div>'}</div>
    <div class="c360-card"><h3>Leitura de dependência</h3><div class="c360-line"><div class="k">Pessoa líder</div><div class="v">${people[0]?`${esc(people[0].name)} · ${fmtH(people[0].hours)}h`:'não identificada'}</div></div><div class="c360-line"><div class="k">Concentração</div><div class="v">${people[0]&&hCliente?fmtP(people[0].hours/hCliente*100)+' das horas na pessoa líder':'—'}</div></div><div class="c360-line"><div class="k">Uso de sócios</div><div class="v">${fmtP(partnerShare)} · indicador observado, sem meta aprovada</div></div><div class="c360-line"><div class="k">Próximo dado</div><div class="v">Registrar interlocutores, renovação, satisfação e oportunidade comercial no CRM.</div></div></div></div>`;
  // inclusos detail for mensalista
  if(men && men.inc && men.inc.length){
    const withH = periodServices.filter(i=>i.inc&&i._ph>0);
    if(withH.length) html += `<div class="panel"><div class="ph2"><span class="t">Serviços inclusos no mensal · com horas</span><span class="s">${withH.length} de ${men.inc.length}</span></div><div class="pb ow"><table class="t"><tbody>`+
      withH.sort((a,b)=>b._ph-a._ph).map(i=>`<tr onclick="openServico('${i.cod}')"><td class="lk">${esc(i.nm)||'cód. '+i.cod}</td><td><span class="badge bg">${i.tp}</span></td><td class="tr">${fmtH(i._ph)}h</td><td class="tr">${fmtK(C(i._pc))}</td></tr>`).join('')+'</tbody></table></div></div>';
  }
  document.getElementById('ovc-body').innerHTML = html || '<div class="note">Sem dados detalhados para este cliente no período.</div>';
  document.getElementById('ov-cliente').classList.add('open');
  if(men) setTimeout(()=>{
    mkChart('c-ovc',{data:{labels:S.meses.map(mLbl),datasets:[
      {type:'bar',label:'Receita',data:S.meses.map(m=>men.pm[m]?men.pm[m].r||0:0),backgroundColor:'#0F6E56'},
      {type:'bar',label:'Custo',data:S.meses.map(m=>men.pm[m]?C(men.pm[m].c||0):0),backgroundColor:'#C0392B'},
      {type:'line',label:'Horas do escopo mensal',data:S.meses.map(m=>(men.pm[m]?.h||0)+(men.pm[m]?.hi||0)),borderColor:'#C47A00',yAxisID:'y2',tension:.3}
    ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{ticks:{callback:v=>'R$'+(v/1000)+'k'}},y2:{position:'right',grid:{display:false}}}}});
  },50);
}

/* ───────── OVERLAY: SERVIÇO ───────── */
function openServico(cod){
  const sd = D.servicos_det[cod];
  if(!sd){ return; }
  const jud = judCalc().find(j=>j.cod===String(cod));
  const periodText=document.getElementById('period-note').textContent;
  document.getElementById('ovs-title').textContent = sd.lbl || ('Serviço '+cod);
  document.getElementById('ovs-sub').innerHTML = `${sd.tipo||''} · <span class="lk" style="color:#fff;text-decoration:underline;cursor:pointer" onclick="closeOv('servico');openCliente('${jsq(sd.cli)}')">${esc(sd.cli)}</span> · cód. ${cod} · ${periodText}${sd.ativo?'':' · BAIXADO'}${sd.incluso?' · incluso no mensal':''}`;
  const h = sumPM(sd.pm,'h'), cRaw = sumPM(sd.pm,'c'), custo = C(cRaw);
  const isMensal=['Mensal consultivo','Mensal judicial','Fixo renovação'].includes(sd.tipo);
  const receitaPeriodo=sumPM(sd.pm,'r');
  const receitaExibida=isMensal?receitaPeriodo:(sd.rec||0);
  let html = `<div class="period-context"><b>Período das horas:</b> ${esc(periodText)}</div>${!isMensal?'<div class="note">Economia: valores contratuais versus valor técnico de todo o histórico disponível. As atividades e horas abaixo mostram o período selecionado. Não é resultado financeiro realizado.</div>':''}`;
  if(jud){
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">Entrada</div><div class="kc-v">${fmtK(jud.e)}</div></div>
      <div class="kc"><div class="kc-l">Valor técnico · histórico disponível</div><div class="kc-v">${fmtK(jud._ca)}</div></div>
      <div class="kc"><div class="kc-l">Break-even de êxito</div><div class="kc-v ${jud._be>0?'a':'g'}">${jud._be>0?fmtK(jud._be):'coberto'}</div></div>
      <div class="kc"><div class="kc-l">Margem total estimada</div><div class="kc-v ${jud._mt>=0?'g':'r'}">${fmtK(jud._mt)}</div><div class="kc-s">êxito est. ${fmtK(jud.x)}</div></div>
    </div>`;
  } else {
    const economicCost=isMensal?custo:sumPMMonths(sd.pm,AVAILABLE_MONTHS,'c');
    const margem = receitaExibida - economicCost;
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">${isMensal?'Receita no período':'Receita contratada'}</div><div class="kc-v">${fmtK(receitaExibida)}</div></div>
      <div class="kc"><div class="kc-l">${isMensal?'Valor técnico no período':'Valor técnico histórico'} (${S.rate})</div><div class="kc-v">${fmtK(economicCost)}</div></div>
      <div class="kc"><div class="kc-l">${isMensal?'Margem do período':'Saldo vs. histórico disponível'}</div><div class="kc-v ${margem>=0?'g':'r'}">${fmtK(margem)}</div></div>
      <div class="kc"><div class="kc-l">Horas no período</div><div class="kc-v">${fmtH(h)}</div></div>
    </div>`;
  }
  html += `<div class="panel"><div class="ph2"><span class="t">Evolução de horas e custo</span></div><div class="pb"><div class="cw"><canvas id="c-ovs"></canvas></div></div></div>`;
  if(sd.por_pessoa && sd.por_pessoa.length){
    const pessoas=sd.por_pessoa.map(p=>({...p,
      _ph:S.meses.reduce((s,m)=>s+(p.pm?.[m]||0),0),
      _pc:S.meses.reduce((s,m)=>s+(p.pcm?.[m]||0),0),
    })).filter(p=>p._ph>0).sort((a,b)=>b._ph-a._ph);
    html += `<div class="panel"><div class="ph2"><span class="t">Quem trabalhou · no período</span><span class="s">${pessoas.length} pessoas · ${fmtH(pessoas.reduce((s,p)=>s+p._ph,0))}h</span></div><div class="pb ow"><table class="t">
      <thead><tr><th>Colaborador</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Horas</th><th class="r">Custo</th></tr></thead><tbody>`+
      pessoas.map(p=>`<tr onclick="closeOv('servico');openPessoa('${jsq(p.adv)}')"><td class="lk">${esc(p.adv)}</td>${S.meses.map(m=>`<td class="tr tm">${fmtH(p.pm&&p.pm[m]?p.pm[m]:0)}</td>`).join('')}<td class="tr"><b>${fmtH(p._ph)}</b></td><td class="tr">${fmtK(C(p._pc))}</td></tr>`).join('')+`</tbody><tfoot><tr><th>Total</th>${S.meses.map(m=>`<th class="tr">${fmtH(sd.pm?.[m]?.h||0)}</th>`).join('')}<th class="tr">${fmtH(h)}</th><th class="tr">${fmtK(custo)}</th></tr></tfoot></table></div></div>`;
  }
  const lancamentos=(sd.lancamentos||[]).filter(l=>S.meses.includes(l.m));
  if(lancamentos.length){
    const hLanc=lancamentos.reduce((s,l)=>s+l.h,0), cLanc=lancamentos.reduce((s,l)=>s+l.c,0);
    html += `<div class="panel"><div class="ph2"><span class="t">Atividades realizadas</span><span class="s">${lancamentos.length} lançamentos agrupados · ${fmtH(hLanc)}h</span></div><div class="pb ow"><table class="t">
      <thead><tr><th>Data</th><th>Colaborador</th><th>Atividade</th><th class="r">Horas</th><th class="r">Custo</th></tr></thead><tbody>`+
      lancamentos.map(l=>`<tr><td class="tm">${fmtDate(l.d)}</td><td>${esc(l.a)}</td><td>${esc(l.t)}</td><td class="tr"><b>${fmtH(l.h)}</b></td><td class="tr">${fmtK(C(l.c))}</td></tr>`).join('')+
      `</tbody><tfoot><tr><th colspan="3">Total do período</th><th class="tr">${fmtH(hLanc)}</th><th class="tr">${fmtK(C(cLanc))}</th></tr></tfoot></table></div></div>`;
  }
  document.getElementById('ovs-body').innerHTML = html;
  document.getElementById('ov-servico').classList.add('open');
  setTimeout(()=>{
    mkChart('c-ovs',{data:{labels:S.meses.map(mLbl),datasets:[
      {type:'bar',label:'Custo',data:S.meses.map(m=>sd.pm[m]?C(sd.pm[m].c||0):0),backgroundColor:'#C0392B'},
      {type:'line',label:'Horas',data:S.meses.map(m=>sd.pm[m]?sd.pm[m].h||0:0),borderColor:'#0F6E56',yAxisID:'y2',tension:.3}
    ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{ticks:{callback:v=>'R$'+(v/1000)+'k'}},y2:{position:'right',grid:{display:false}}}}});
  },50);
}

/* ───────── SIDEBAR LISTS ───────── */
function buildSidebarLists(){
  document.getElementById('pl-items').innerHTML = carteiraRows(D.hm).slice().sort((a,b)=>a.adv.localeCompare(b.adv)).map(p=>`<button class="sb-list-item" onclick="openPessoa('${jsq(p.adv)}')">${esc(p.adv)}</button>`).join('');
  const clientes = Object.keys(D.cli_det).filter(name=>{
    if(!name.trim()) return false;
    if(S.carteira==='todos') return true;
    return S.carteira==='ativos' ? clientIsActive(name) : !clientIsActive(name);
  }).sort((a,b)=>a.localeCompare(b));
  document.getElementById('cl-items').innerHTML = clientes.map(c=>`<button class="sb-list-item" onclick="openCliente('${jsq(c)}')">${esc(c)}</button>`).join('');
  const svcs = carteiraRows(Object.values(D.servicos_det)).filter(s=>s.lbl).sort((a,b)=>(a.lbl||'').localeCompare(b.lbl||''));
  document.getElementById('sl-items').innerHTML = svcs.map(s=>`<button class="sb-list-item" onclick="openServico('${s.cod}')">${esc(s.lbl)} · ${esc(s.cli)}</button>`).join('');
}

/* ───────── RENDER MASTER ───────── */
function render(){
  renderContextBar();
  if(typeof renderV4Context==='function')renderV4Context();
  switch(S.screen){
    case 'painel': renderPainel(); break;
    case 'times': renderTimes(); break;
    case 'areas': renderAreas(); break;
    case 'socios': renderSocios(); break;
    case 'heatmap': renderHeatmap(); break;
    case 'pessoas': renderPessoas(); break;
    case 'mensalistas': renderMensalistas(); break;
    case 'projetos': renderProjetos(); break;
    case 'judicial': renderJudicial(); break;
    case 'decisoes': renderDecisoes(); break;
    case 'portfolio': renderPortfolio(); break;
    case 'auditoria': renderAuditoria(); break;
    case 'confianca': renderTrust(); break;
    case 'cadastros': renderCadastros(); break;
    case 'contratos': renderContractRegistry(); break;
    case 'explorar': renderExplore(); break;
    case 'simular': renderSimulator(); break;
  }
}

/* ───────── INIT ───────── */
function boot(){
 buildPeriodBar();
 document.getElementById('sb-per').textContent = 'V4 · '+(D.meta.periodo || '');
 buildSidebarLists();
 renderAuditoria();
 go('painel');
}
