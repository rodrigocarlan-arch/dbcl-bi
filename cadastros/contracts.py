"""Contratos recorrentes, componentes e valores por competência."""
from __future__ import annotations
from datetime import date
from decimal import Decimal
import hashlib,math,re
from .store import canonical,text,period_at,encode

MONTH_RE=re.compile(r'(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])')
def shift(month,delta):
    y,m=map(int,month.split('-'));n=y*12+m-1+delta;return f'{n//12:04d}-{n%12+1:02d}'
def validate_contract(p):
    if not isinstance(p,dict) or set(p)!={'name','code','owner','origin','components'}:raise ValueError('Campos do contrato inválidos')
    text(p['name'],'Cliente');text(p['code'],'Código de venda',80)
    if not isinstance(p['owner'],str) or len(p['owner'])>200:raise ValueError('Responsável inválido')
    if p['origin'] not in ('manual','legacy'):raise ValueError('Origem inválida')
    components=p['components']
    if not isinstance(components,list) or not 1<=len(components)<=100:raise ValueError('Informe pelo menos um componente do contrato')
    ids=set();names=set()
    for c in components:
        if not isinstance(c,dict) or set(c)!={'id','name','periods','source_rows','source_notes'}:raise ValueError('Componente inválido')
        text(c['id'],'Identificador',80);text(c['name'],'Nome do componente')
        if c['id'] in ids or canonical(c['name']) in names:raise ValueError('Componente duplicado no contrato')
        ids.add(c['id']);names.add(canonical(c['name']))
        if not isinstance(c['source_rows'],list) or any(type(i)is not int or i<1 for i in c['source_rows']):raise ValueError('Referência de origem inválida')
        if not isinstance(c['source_notes'],list) or any(not isinstance(v,str) or len(v)>2000 for v in c['source_notes']):raise ValueError('Notas de origem inválidas')
        periods=c['periods']
        if not isinstance(periods,list) or len(periods)>100 or (not periods and p['origin']!='legacy'):raise ValueError('Informe a vigência do componente')
        for v in periods:
            if not isinstance(v,dict) or set(v)!={'start','end','amount','note'}:raise ValueError('Vigência de mensalidade inválida')
            if not isinstance(v['start'],str) or not MONTH_RE.fullmatch(v['start']):raise ValueError('Competência inicial obrigatória: AAAA-MM')
            if v['end'] is not None and (not isinstance(v['end'],str) or not MONTH_RE.fullmatch(v['end']) or v['end']<v['start']):raise ValueError('Competência final inválida')
            amount=v['amount']
            if amount is not None and (type(amount) not in (int,float) or not math.isfinite(amount) or not 0<=amount<=1000000000 or abs(amount*100-round(amount*100))>.00001):raise ValueError('Mensalidade deve ter até duas casas decimais e não pode ser negativa')
            if not isinstance(v['note'],str) or len(v['note'])>1000:raise ValueError('Observação inválida')
            if amount is None:text(v['note'],'Motivo do valor não confirmado',1000)
        ordered=sorted(periods,key=lambda v:v['start'])
        if any(a['end'] is None or a['end']>=b['start'] for a,b in zip(ordered,ordered[1:])):raise ValueError('Vigências sobrepostas no mesmo componente')
    return p

def schedule(components,start='2024-01',end=None):
    end=end or f'{date.today().year}-12';result={};pending=[];month=start
    while month<=end:
        total=Decimal('0');known=False
        for c in components:
            v=period_at(c['periods'],month)
            if v:
                if v['amount'] is None:pending.append({'component':c['name'],'month':month,'reason':v['note']})
                else:known=True;total+=Decimal(str(v['amount']))
        if known:result[month]=float(total)
        month=shift(month,1)
    return result,pending

def from_snapshot(snapshot,crm,audit):
    result={};pending=[];multi=[]
    for r in snapshot.get('contracts',[]):
        months,issues=schedule(r['components'])
        pending.extend({'code':r['code'],'client':r['name'],**v} for v in issues)
        for c in r['components']:
            if not c['periods']:pending.append({'code':r['code'],'client':r['name'],'component':c['name'],'month':None,'reason':'Componente sem vigência cadastrada'})
        # A wholly unknown component does not invent a zero-valued contract in the model.
        if not months:continue
        names=[c['name'] for c in r['components'] if any(p['amount'] is not None for p in c['periods'])]
        result[r['code']]={'cli':crm.get(r['code'],{}).get('cli') or r['name'],'resp':crm.get(r['code'],{}).get('resp') or r['owner'],'meses':months,'componentes':names}
        if len(names)>1:multi.append({'codigo':r['code'],'componentes':names})
    audit['mensalistas_fonte']={'codigos_com_multiplos_componentes':multi,'linhas_duplicadas_ignoradas':snapshot['settings'].get('contracts_import',{}).get('duplicates',[]),'origem':'Cadastro do BI por competência','pendencias_valores':pending,'contratos_cadastrados':len(snapshot.get('contracts',[]))}
    return result

def normalize_periods(periods):
    """Resolve sobreposições do legado pela precedência de colunas da planilha."""
    if not periods:return []
    boundaries=sorted({v['start'] for v in periods}|{shift(v['end'],1) for v in periods if v['end'] and v['end']<'2199-12'})
    result=[]
    for i,start in enumerate(boundaries):
        found=[p for p in periods if p['start']<=start and (not p['end'] or p['end']>=start)]
        if not found:continue
        # The previous Excel reader ignores malformed amounts rather than overriding valid amounts.
        valid=[p for p in found if p['amount'] is not None];selected=(valid or found)[-1]
        end=shift(boundaries[i+1],-1) if i+1<len(boundaries) else selected['end']
        v={**selected,'start':start,'end':end}
        if result and result[-1]['end'] and shift(result[-1]['end'],1)==start and (result[-1]['amount'],result[-1]['note'])==(v['amount'],v['note']):result[-1]['end']=end
        else:result.append(v)
    return result

def read_workbook(path,crm):
    import pandas as pd
    from pipeline_dbcl import valid_cod,norm_client_key
    df=pd.read_excel(path,sheet_name='Valores Mensais',header=None);contracts={};duplicates=[];notes=[];seen={}
    def month(v):
        if pd.isna(v):return None
        d=pd.to_datetime(v,format='%m/%Y',errors='coerce') if isinstance(v,str) else pd.Timestamp(v)
        if pd.isna(d):d=pd.to_datetime(v,errors='coerce')
        if pd.isna(d):raise ValueError('Data inválida')
        return d.strftime('%Y-%m')
    for i,row in df.iloc[4:].iterrows():
        code=valid_cod(row.iloc[0])
        if not code:continue
        if not code.isdigit():
            notes.append(f'Linha {i+1}: anotação da planilha, sem código numérico; não importada')
            continue
        name=str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else f'Código {code}'
        periods=[];issues=[]
        for col in range(3,len(row)-2,3):
            rawstart,rawend,rawamount=row.iloc[col:col+3]
            if pd.isna(rawstart) and pd.isna(rawamount):continue
            if pd.isna(rawamount):
                issues.append(f'Linha {i+1}, coluna {col+3}: valor ausente');amount=None
            else:
                try:
                    amount=float(rawamount)
                    if not math.isfinite(amount) or amount<0:raise ValueError()
                    if abs(amount*100-round(amount*100))>.00001:raise ValueError()
                except (TypeError,ValueError):
                    amount=None;issues.append(f'Linha {i+1}, coluna {col+3}: valor não confirmado ({rawamount})')
            try:start=month(rawstart);end=month(rawend)
            except ValueError:
                issues.append(f'Linha {i+1}, coluna {col+1}: data inválida');continue
            if start is None or end and end<start:
                issues.append(f'Linha {i+1}: vigência ausente ou invertida');continue
            periods.append({'start':start,'end':end,'amount':amount,'note':issues[-1] if amount is None else ''})
        effective=normalize_periods(periods)
        signature=(code,norm_client_key(name),encode(effective))
        if signature in seen:
            seen[signature]['source_rows'].append(i+1);duplicates.append({'codigo':code,'cliente':name,'linha':i+1});continue
        component={'id':f'origem-{i+1}','name':name,'periods':effective,'source_rows':[i+1],'source_notes':issues}
        seen[signature]=component
        record=contracts.setdefault(code,{'name':crm.get(code,{}).get('cli') or name,'code':code,'owner':crm.get(code,{}).get('resp') or (str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ''),'origin':'legacy','components':[]})
        record['components'].append(component)
        notes.extend(issues)
    for r in contracts.values():validate_contract(r)
    return list(contracts.values()),{'duplicates':duplicates,'issues':notes,'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
