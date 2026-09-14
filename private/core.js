/* Regras puras, compartilhadas pela interface e pelos testes de regressão. */
(function(root){
'use strict';
const shiftMonth=(month,n)=>{const [y,m]=month.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+n,1));return d.toISOString().slice(0,7);};
function previousMonths(months,available,kind='custom'){
  if(!months.length) return [];
  const span=kind==='quarter'?3:kind==='semester'?6:kind==='year'?12:months.length;
  // Não comparar frações de trimestre/semestre/ano nem atravessar lacunas.
  if(months.length!==span||months.some((m,i)=>m!==shiftMonth(months[0],i)))return [];
  const previous=months.map(m=>shiftMonth(m,-span));
  return previous.every(m=>available.includes(m))?previous:[];
}
function activeAt(item,month){
  const calendar=item?.ativo_meses;
  if(calendar&&Object.prototype.hasOwnProperty.call(calendar,month)) return calendar[month]===true;
  if(typeof item?.ativo==='boolean') return item.ativo;
  if(typeof item?.ok==='boolean') return item.ok;
  return true;
}
function applyRate(data,mode,previous='mensal'){
  if(!['mensal','custo','pontual'].includes(mode))throw Error('Tabela inválida');
  const apply=(rows,col)=>{for(const row of rows||[]){let obj=data;for(const key of row[0].slice(0,-1))obj=obj[key];obj[row[0].at(-1)]=row[col];}};
  if(previous!=='mensal')apply(data.rate_variants?.[previous],1);
  if(mode!=='mensal'){
    if(!data.rate_variants?.[mode])throw Error('Tabela indisponível. Atualize a base V4.');
    apply(data.rate_variants[mode],2);
  }
  data.meta.tabela_calculo=mode;
}
function scenario(revenue,cost,pricePct,hoursPct,targetPct){
  if(![revenue,cost,pricePct,hoursPct,targetPct].every(Number.isFinite)||revenue<0||cost<0||pricePct < -100||hoursPct < -100||targetPct<0||targetPct>=100)throw Error('Premissas inválidas');
  const r=revenue*(1+pricePct/100),c=cost*(1+hoursPct/100);
  return {revenue:r,cost:c,margin:r-c,marginPct:r>0?(r-c)/r*100:null,requiredRevenue:c/(1-targetPct/100),delta:(r-c)-(revenue-cost)};
}
const api={shiftMonth,previousMonths,activeAt,applyRate,scenario};
root.DBCLCore=api;
if(typeof module!=='undefined')module.exports=api;
})(globalThis);
