#!/usr/bin/env python3
"""
dbcl Legal Ops BI — Pipeline de geração do data.js
Cobre: Eleven (2024-07 a 2026-01) + Alocação/Themis (2026-02 a 2026-05+)
"""

import pandas as pd
import re
import json
from datetime import datetime, date
from collections import defaultdict

# ── Configurações ────────────────────────────────────────────────────────────

BASE = "/mnt/user-data/uploads/"

EXCLUIR_MENSALISTAS = {"Solid Arquitetura", "Acti", "G4", "Yuool",
                        "G4 Educação", "G4 EDUCAÇÃO"}  # excluídos da análise

OITO_FIXO_RENOVACAO = {"Austral", "Brasil Paralelo", "GC Engenharia",
                        "Gestão DS", "Skin Pets", "Expermed",
                        "Happy House", "Under"}

SIN_MAP = {
    "Alta": "V", "ALTA - VERMELHA": "V", "VERMELHO - ALTA": "V",
    "Média": "A", "MÉDIA - AMARELA": "A", "AMARELO - MÉDIA": "A",
    "Baixa": "G", "BAIXA - VERDE": "G", "VERDE - BAIXA": "G",
}

# Mapeamento cargo → benchmarks sinaleira
BENCHMARKS = {
    "Sócio gestão/técnico": {"V": (20, None), "A": (10, None), "G": (None, None), "ADM": (None, None)},
    "Sócio técnico":        {"V": (35, None), "A": (20, None), "G": (None, 10),   "ADM": (None, 15)},
    "Sócio comercial":      {"V": (10, None), "A": (10, None), "G": (None, None), "ADM": (None, None)},
    "Coord. estratégico":   {"V": (70, None), "A": (None, 20), "G": (None, None), "ADM": (None, 10)},
    "Sênior estratégico":   {"V": (35, None), "A": (25, None), "G": (None, 10),   "ADM": (None, 5)},
    "Coord. trabalhista":   {"V": (20, None), "A": (30, None), "G": (None, 20),   "ADM": (None, 15)},
    "Júnior trabalhista":   {"V": (None, 10), "A": (30, None), "G": (35, None),   "ADM": (None, 10)},
    "Sênior":               {"V": (20, None), "A": (30, None), "G": (None, 20),   "ADM": (None, 15)},
    "Pleno":                {"V": (10, None), "A": (35, None), "G": (None, 30),   "ADM": (None, 10)},
    "Júnior":               {"V": (None, 10), "A": (30, None), "G": (35, None),   "ADM": (None, 10)},
    "Estagiário":           {"V": (None, None), "A": (None, 20), "G": (50, None), "ADM": (None, 30)},
    "Admin":                {"V": (None, None), "A": (None, None), "G": (None, None), "ADM": (None, None)},
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def norm_cod(v):
    if pd.isna(v): return None
    return str(v).strip().replace(".0", "").replace(" ", "")

def parse_hm(h):
    """Parse '00:08' ou float em horas decimais."""
    if pd.isna(h): return 0.0
    s = str(h).strip()
    m = re.match(r'^(\d+):(\d+)', s)
    if m: return int(m.group(1)) + int(m.group(2)) / 60
    try: return float(s)
    except: return 0.0

def parse_eleven_dur(s):
    """Parse '2 hora(s) e 15 minuto(s)' em float."""
    if pd.isna(s): return 0.0
    m = re.match(r'(\d+)\s*hora.*?(\d+)\s*minuto', str(s))
    if m: return int(m.group(1)) + int(m.group(2)) / 60
    m2 = re.match(r'(\d+)\s*hora', str(s))
    if m2: return float(m2.group(1))
    return 0.0

def to_mes(dt):
    """datetime → 'AAAA-MM'"""
    if pd.isna(dt): return None
    return dt.strftime("%Y-%m")

def map_sin(raw):
    if pd.isna(raw): return "G"
    return SIN_MAP.get(str(raw).strip(), "G")

def categoria_to_cat(cat):
    """Mapeia atividade/categoria → código interno."""
    if pd.isna(cat): return "O"
    c = str(cat).lower()
    if "elabora" in c: return "E"
    if "revis" in c: return "R"
    if "ajuste" in c: return "J"
    if "reuni" in c: return "M"
    if "evento" in c: return "V"
    if "audiência" in c or "audiencia" in c: return "M"
    return "O"  # Operação/outros

# ── 1. Time & Valores de Hora ─────────────────────────────────────────────────

def load_team():
    df = pd.read_excel(BASE + "TIME_E_VALORES_DE_HORA.xlsx", header=None)
    # Rows: 0=header, 1=blank, 2=col headers, 3+ = data until 'SAÍRAM DO ESCRITORIO'
    members = {}
    saiu_idx = None
    for i, row in df.iterrows():
        if str(row[0]).strip().upper().startswith("SAÍRAM"):
            saiu_idx = i
            break
    active_df = df.iloc[3:saiu_idx].copy()
    for _, row in active_df.iterrows():
        nome = str(row[0]).strip() if pd.notna(row[0]) else None
        if not nome or nome == "nan": continue
        cargo_time = str(row[1]).strip() if pd.notna(row[1]) else ""
        time_nome  = str(row[2]).strip() if pd.notna(row[2]) else ""
        # Valores/hora: col5=cargo_ref, col6=mensal, col7=pontual, col8=custo
        # Col 5 é o cargo de referência de valor
        v_mensal  = row[6] if pd.notna(row[6]) else 0
        v_pontual = row[7] if pd.notna(row[7]) else 0
        v_custo   = row[8] if pd.notna(row[8]) else 0
        members[nome.upper()] = {
            "nome": nome,
            "cargo": cargo_time,
            "time": time_nome,
            "v_mensal": float(v_mensal) if v_mensal else 0,
            "v_pontual": float(v_pontual) if v_pontual else 0,
            "v_custo": float(v_custo) if v_custo else 0,
            "ativo": True,
        }
    # Marcar ex-membros
    if saiu_idx:
        ex_df = df.iloc[saiu_idx+1:].copy()
        for _, row in ex_df.iterrows():
            nome = str(row[0]).strip() if pd.notna(row[0]) else None
            if not nome or nome == "nan": continue
            key = nome.upper()
            if key not in members:
                members[key] = {
                    "nome": nome,
                    "cargo": str(row[1]).strip() if pd.notna(row[1]) else "",
                    "time": str(row[2]).strip() if pd.notna(row[2]) else "",
                    "v_mensal": 0, "v_pontual": 0, "v_custo": 0,
                    "ativo": False,
                }
            else:
                members[key]["ativo"] = False
    # Valores de hora por nível (col 5 referencia cargo nível):
    # Sócio=600-750, Sênior=300, Pleno=250, Júnior=150, Estagiário=100, Admin=50
    # Preencher v_custo para quem não tem (ex-membros)
    cargo_custo = {
        "SÓCIO": 600, "ADVOGADO SÊNIOR": 300, "ADVOGADO PLENO": 250,
        "ADVOGADO JÚNIOR": 150, "ESTAGIÁRIO": 100, "ADMINISTRATIVO": 50,
    }
    for k, m in members.items():
        if m["v_custo"] == 0:
            c = m["cargo"].upper()
            for cargo_key, val in cargo_custo.items():
                if cargo_key in c:
                    m["v_custo"] = val
                    break
            if m["v_custo"] == 0:
                m["v_custo"] = 100  # fallback estagiário
    return members

# ── 2. CRM ────────────────────────────────────────────────────────────────────

def safe_float(v):
    if pd.isna(v): return 0
    try: return float(v)
    except: return 0

def load_crm():
    df = pd.read_excel(BASE + "crm.xlsx", header=1)
    df.columns = [str(c).strip() for c in df.columns]
    df['cod'] = df['Código contrato'].apply(norm_cod)
    df = df.dropna(subset=['cod'])
    df = df[df['cod'] != 'nan']

    # Baixado_em como data
    def parse_baixado(v):
        if pd.isna(v): return None
        try:
            return pd.to_datetime(str(v), dayfirst=False, errors='coerce')
        except:
            return None
    df['baixado_em'] = df['Ativo/baixado em'].apply(parse_baixado)

    crm = {}
    for _, row in df.iterrows():
        cod = row['cod']
        crm[cod] = {
            "cod": cod,
            "cli": str(row['Cliente']).strip() if pd.notna(row['Cliente']) else "",
            "tipo": str(row['Tipo de caso']).strip() if pd.notna(row['Tipo de caso']) else "",
            "cluster": str(row['Cluster']).strip() if pd.notna(row['Cluster']) else "",
            "nome": str(row['Nome do caso']).strip() if pd.notna(row['Nome do caso']) else "",
            "resp": str(row['Responsável']).strip() if pd.notna(row['Responsável']) else "",
            "area": str(row['Área principal']).strip() if pd.notna(row['Área principal']) else "",
            "ativo": pd.isna(row['Ativo/baixado em']),
            "baixado_em": row['baixado_em'],
            "incluso": str(row.get('Incluso mensal?', '')).strip().lower() == 'checked',
            "entrada": safe_float(row.get('Entrada/único')),
            "exito": safe_float(row.get('Êxito')),
            "exito_total": safe_float(row.get('Total hon. êxito')),
            "fixo": safe_float(row.get('Fixo')),
            "gen_sem_exito": safe_float(row.get('Geração sem êxito')),
            "gen_so_exito": safe_float(row.get('Geração só êxito')),
            "gen_total": safe_float(row.get('Geração comercial')),
        }
    return crm

# ── 3. Mensalistas ────────────────────────────────────────────────────────────

def load_mensalistas(crm):
    """Retorna dict: cod -> {cli, resp, meses: {AAAA-MM: valor}}"""
    df = pd.read_excel(BASE + "valores_mensalistas_-_BI.xlsx",
                       sheet_name="Valores Mensais", header=None)
    # Data starts at row 4 (index 4)
    data_df = df.iloc[4:].copy().reset_index(drop=True)

    result = {}
    for _, row in data_df.iterrows():
        cod = norm_cod(row.iloc[0])
        if not cod or cod == "nan": continue
        cli = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
        resp = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ""

        # Vigências: triplas a partir da coluna 3
        # Colunas: 3=inicio, 4=fim, 5=valor, 6=inicio, 7=fim, 8=valor, ...
        vigencias = []
        col = 3
        while col + 2 < len(row):
            inicio = row.iloc[col]
            fim    = row.iloc[col + 1]
            valor  = row.iloc[col + 2]
            col += 3
            if pd.isna(inicio) and pd.isna(valor): continue
            if pd.isna(valor): continue
            try:
                v = float(valor)
            except:
                continue
            # Parse inicio
            if pd.notna(inicio):
                try:
                    if isinstance(inicio, (datetime, date)):
                        dt_inicio = pd.Timestamp(inicio)
                    else:
                        dt_inicio = pd.to_datetime(str(inicio), format="%m/%Y", errors='coerce')
                        if pd.isna(dt_inicio):
                            dt_inicio = pd.to_datetime(str(inicio), errors='coerce')
                except:
                    dt_inicio = None
            else:
                dt_inicio = None
            # Parse fim
            if pd.notna(fim):
                try:
                    if isinstance(fim, (datetime, date)):
                        dt_fim = pd.Timestamp(fim)
                    else:
                        dt_fim = pd.to_datetime(str(fim), format="%m/%Y", errors='coerce')
                        if pd.isna(dt_fim):
                            dt_fim = pd.to_datetime(str(fim), errors='coerce')
                except:
                    dt_fim = None
            else:
                dt_fim = None

            vigencias.append((dt_inicio, dt_fim, v))

        if not vigencias: continue

        # Gerar meses cobertos
        meses_valor = {}
        all_months = pd.date_range("2024-01-01", "2026-12-01", freq="MS")
        for mes_dt in all_months:
            mes_str = mes_dt.strftime("%Y-%m")
            val = None
            for (ini, fim, v) in vigencias:
                if ini is None: continue
                ini_m = ini.to_period("M")
                fim_m = fim.to_period("M") if fim is not None else pd.Period("2099-12", "M")
                mes_p = mes_dt.to_period("M")
                if ini_m <= mes_p <= fim_m:
                    val = v
            if val is not None:
                meses_valor[mes_str] = val

        result[cod] = {"cli": cli, "resp": resp, "meses": meses_valor}

    return result

# ── 4. Carregar Alocação (2026) ───────────────────────────────────────────────

def load_alocacao():
    df = pd.read_excel(BASE + "alocacao.xlsx", header=0)
    df['dt'] = pd.to_datetime(df['Data'], dayfirst=True, errors='coerce')
    df['mes'] = df['dt'].apply(to_mes)
    df['h'] = df['Horas'].apply(parse_hm)
    df['cat'] = df['Atividade'].apply(categoria_to_cat)
    df['resp_up'] = df['Responsável'].str.strip().str.upper()
    df['cli'] = df['Cliente'].str.strip()
    df['pasta'] = df['Pasta'].fillna("")
    # Código venda: extrair do Pasta via mapeamento (será feito depois)
    return df

# ── 5. Carregar Eleven (2024-07 a 2026-01) ────────────────────────────────────

def load_eleven():
    df = pd.read_excel(BASE + "BACK_UP_ELEVEN_TRABALHOS.xlsx", header=0)
    df['dt'] = pd.to_datetime(df['Data de início'], dayfirst=True, errors='coerce')
    df['mes'] = df['dt'].apply(to_mes)
    df['h'] = df['Duração'].apply(parse_eleven_dur)
    df['cat'] = df['Categoria'].apply(categoria_to_cat)
    df['resp_up'] = df['Colaborador - Nome'].str.strip().str.upper()
    df['cli'] = df['Cliente - Nome'].str.strip()
    df['pasta'] = df['Pasta - Identificação (prefixo/número)'].fillna("")
    df['sin_raw'] = df['SINALEIRA DE RELEVÂNCIA - Pasta'].fillna("BAIXA - VERDE")
    df['sin'] = df['sin_raw'].apply(map_sin)
    # Excluir Jan/2026 (lacuna aceita) se já cobrimos no Alocação
    # Eleven vai de 2024-07 a 2025-12 apenas (excluímos 2026-01 que é overlap)
    df = df[df['mes'] < "2026-01"].copy()
    return df

# ── 6. Construir dicionário pasta → CRM cod ───────────────────────────────────

def build_pasta_cod_map(crm):
    """
    Usa o alocacao (Themis) que tem PASTA DO CASO + CODIGO VENDA CASO para mapear.
    Complementa com Eleven que usa mesmas pastas.
    """
    th = pd.read_excel(BASE + "themis.xlsx", header=0)
    th.columns = th.columns.str.strip()
    pasta_map = {}
    for _, row in th.iterrows():
        pasta = str(row['PASTA DO CASO']).strip() if pd.notna(row['PASTA DO CASO']) else None
        cod = norm_cod(row['CODIGO VENDA CASO'])
        if pasta and cod and cod not in ('0000', '0', 'nan', None):
            pasta_map[pasta] = cod
        pasta_p = str(row['PASTA DO PROCESSO']).strip() if pd.notna(row['PASTA DO PROCESSO']) else None
        cod_p = norm_cod(row['CODIGO VENDA PROCESSO'])
        if pasta_p and cod_p and cod_p not in ('0000', '0', 'nan', None):
            pasta_map[pasta_p] = cod_p
    return pasta_map

# ── 7. Normalizar nome de pessoa ──────────────────────────────────────────────

# Mapeamento de nomes como aparecem nos dados para a chave uppercase da tabela time
NOME_NORM = {
    "AILIME PUREUR MACEDO": "AILIME MACEDO",
    "AILIME MACEDO": "AILIME MACEDO",
    "ANA LAURA KUNRATH": "ANA KUNRATH",
    "ANA KUNRATH": "ANA KUNRATH",
    "GUSTAVO ANDRÉ SEGANFREDO ORO": "GUSTAVO ORO",
    "GUSTAVO ORO": "GUSTAVO ORO",
    "MARCUS VINICIUS HEIMERDINGER": "MARCUS HEIMERDINGER",
    "GERSON CAZOTTI BELINASO": "GERSON CAZZOTI BELINASO",
    "LARISSA MAZZUCCO TEIXEIRA": "LARISSA MAZZUCCO",
    "ISABELLE NUNES": "ISABELLE NUNES",
    "LUCAS CARVALHO": "LUCAS CARVALHO",
}

def norm_nome(raw):
    u = str(raw).strip().upper()
    return NOME_NORM.get(u, u)

# ── 8. Função principal ───────────────────────────────────────────────────────

def main():
    print("Carregando time...")
    team = load_team()

    print("Carregando CRM...")
    crm = load_crm()

    print("Carregando mensalistas...")
    mensalistas_rec = load_mensalistas(crm)

    print("Construindo mapa pasta→cod...")
    pasta_map = build_pasta_cod_map(crm)

    print("Carregando Alocação 2026...")
    aloc = load_alocacao()

    print("Carregando Eleven 2024-2025...")
    eleven = load_eleven()

    # ── Unificar fontes ─────────────────────────────────────────────────────
    # Para o Eleven, obter sin e cod via pasta_map
    eleven['cod'] = eleven['pasta'].map(pasta_map)
    # Para linhas sem pasta match, tentar via cliente → CRM (melhor esforço)
    # Alocação: pegar cod via Pasta mapeado do Themis
    aloc['cod'] = aloc['pasta'].map(pasta_map)

    # Adicionar sinaleira para alocação (via CRM)
    def get_sin_aloc(row):
        cod = row['cod']
        tipo = str(row.get('Tipo', '')).lower()
        area = str(row.get('Área/Tipo', '')).lower()
        # Admin: cliente dbcl ou tipo administrativo
        if 'dbcl' in str(row['cli']).lower():
            return "ADM"
        if 'admin' in str(row.get('Tipo', '')).lower():
            return "ADM"
        if cod and cod in crm:
            raw = crm[cod].get('cluster', '')
            s = map_sin(raw)
            if s: return s
        # Fallback pela pasta
        pasta = row.get('pasta', '')
        if 'sócios' in str(pasta).lower() or 'tarefas' in str(pasta).lower():
            return "ADM"
        return "G"

    aloc['sin'] = aloc.apply(get_sin_aloc, axis=1)

    # Adicionar cod para eleven onde está faltando via cliente match CRM
    # Build client→cod map (melhor esforço, pega o mais recente)
    cli_cod_map = {}
    for cod, info in crm.items():
        cli_key = info['cli'].strip().upper()
        if cli_key not in cli_cod_map:
            cli_cod_map[cli_key] = cod

    def fill_cod_eleven(row):
        if row['cod'] and row['cod'] != 'nan': return row['cod']
        cli_key = row['cli'].strip().upper()
        return cli_cod_map.get(cli_key)

    eleven['cod'] = eleven.apply(fill_cod_eleven, axis=1)

    # Sinaleira eleven já vem do arquivo (sin col)
    # Admin = dbcl advogados como cliente
    eleven['sin'] = eleven.apply(
        lambda r: "ADM" if 'dbcl' in str(r['cli']).lower() else r['sin'], axis=1
    )

    # Normalize resp names
    aloc['resp_key'] = aloc['resp_up'].apply(norm_nome)
    eleven['resp_key'] = eleven['resp_up'].apply(norm_nome)

    # Merge team info
    def get_team_info(resp_key, field, default=""):
        m = team.get(resp_key, {})
        return m.get(field, default)

    for df in [aloc, eleven]:
        df['cargo'] = df['resp_key'].apply(lambda k: get_team_info(k, 'cargo', ''))
        df['time_nome'] = df['resp_key'].apply(lambda k: get_team_info(k, 'time', ''))
        df['v_custo'] = df['resp_key'].apply(lambda k: get_team_info(k, 'v_custo', 100))

    # Calcular custo por linha
    aloc['custo'] = aloc['h'] * aloc['v_custo']
    eleven['custo'] = eleven['h'] * eleven['v_custo']

    # CRM info para alocação
    def get_crm_field(cod, field, default=""):
        if not cod or cod not in crm: return default
        return crm[cod].get(field, default)

    for df in [aloc, eleven]:
        df['crm_tipo'] = df['cod'].apply(lambda c: get_crm_field(c, 'tipo'))
        df['crm_cli']  = df['cod'].apply(lambda c: get_crm_field(c, 'cli'))
        df['crm_nome'] = df['cod'].apply(lambda c: get_crm_field(c, 'nome'))
        df['crm_area'] = df['cod'].apply(lambda c: get_crm_field(c, 'area'))
        df['crm_resp'] = df['cod'].apply(lambda c: get_crm_field(c, 'resp'))
        df['incluso']  = df['cod'].apply(lambda c: get_crm_field(c, 'incluso', False))
        df['crm_ativo']= df['cod'].apply(lambda c: get_crm_field(c, 'ativo', True))
        df['baixado_em']= df['cod'].apply(lambda c: get_crm_field(c, 'baixado_em'))

    # Combinar: Eleven 2024-07 a 2025-12 + Alocação 2026-02 a 2026-05
    combined = pd.concat([eleven, aloc], ignore_index=True)
    combined = combined[combined['mes'].notna()]
    combined = combined[combined['mes'] >= "2024-07"]

    print(f"Total linhas combinadas: {len(combined)}")
    print(f"Período: {combined['mes'].min()} → {combined['mes'].max()}")

    all_meses = sorted(combined['mes'].unique().tolist())
    print(f"Meses: {all_meses}")

    # ── KPIs globais ────────────────────────────────────────────────────────
    h_total = combined['h'].sum()
    h_admin = combined[combined['sin'] == 'ADM']['h'].sum()
    h_cli   = h_total - h_admin
    custo_tec = combined['custo'].sum()
    pessoas_ativas = combined['resp_key'].nunique()

    kpis = {
        "h_total": round(h_total, 1),
        "h_cli":   round(h_cli, 1),
        "h_admin": round(h_admin, 1),
        "custo_tec": round(custo_tec, 2),
        "pessoas_ativas": int(pessoas_ativas),
    }

    # ── KPM (horas por mês) ─────────────────────────────────────────────────
    kpm = {}
    for mes, grp in combined.groupby('mes'):
        kpm[mes] = {
            "h": round(grp['h'].sum(), 1),
            "hc": round(grp[grp['sin'] != 'ADM']['h'].sum(), 1),
            "n": int(grp['resp_key'].nunique()),
        }

    # ── Times ───────────────────────────────────────────────────────────────
    socios = {"RODRIGO TOLOSA CARLAN", "FELIPE MENEGOTTO DONADEL",
              "GERSON CAZZOTI BELINASO", "THOMAZ DE AZEVEDO CINEL",
              "BRUNO FARIA LOPES"}

    def get_case_time(row):
        """Retorna o time do caso (do Themis/Alocacao) ou time da pessoa."""
        # Alocação tem Área/Tipo que é o time do caso
        area = row.get('Área/Tipo', '') or row.get('time_caso', '')
        if pd.notna(area) and area:
            return str(area).strip()
        return row.get('time_nome', '')

    aloc['time_caso'] = aloc.get('Área/Tipo', aloc['time_nome'])
    eleven['time_caso'] = eleven['time_nome']  # Eleven não tem time do caso

    times_com = defaultdict(lambda: defaultdict(float))
    times_sem = defaultdict(lambda: defaultdict(float))

    for _, row in combined.iterrows():
        mes = row['mes']
        resp = row['resp_key']
        h = row['h']
        t = str(row.get('time_caso', '') or row.get('time_nome', '')).strip()
        if not t: t = "Outros"
        times_com[t][mes] = times_com[t].get(mes, 0) + h
        if resp not in socios:
            times_sem[t][mes] = times_sem[t].get(mes, 0) + h

    D_times = {
        "com_socios": {t: dict(v) for t, v in times_com.items()},
        "sem_socios": {t: dict(v) for t, v in times_sem.items()},
    }

    # ── HM (horas por membro) ────────────────────────────────────────────────
    hm = []
    for resp_key, grp in combined.groupby('resp_key'):
        t_info = team.get(resp_key, {})
        nome = t_info.get('nome', resp_key.title())
        cargo = t_info.get('cargo', '')
        time_n = t_info.get('time', '')
        ativo = t_info.get('ativo', True)

        total_h = grp['h'].sum()
        by_sin = grp.groupby('sin')['h'].sum().to_dict()
        v = by_sin.get('V', 0)
        a = by_sin.get('A', 0)
        g = by_sin.get('G', 0)
        adm = by_sin.get('ADM', 0)
        tot = v + a + g + adm

        # Por mês
        hm_mes = {}
        for mes, mg in grp.groupby('mes'):
            ms_sin = mg.groupby('sin')['h'].sum().to_dict()
            hm_mes[mes] = {
                "h": round(mg['h'].sum(), 2),
                "V": round(ms_sin.get('V', 0), 2),
                "A": round(ms_sin.get('A', 0), 2),
                "G": round(ms_sin.get('G', 0), 2),
                "ADM": round(ms_sin.get('ADM', 0), 2),
            }

        # Por time do caso (trbd)
        trbd = grp.groupby('time_caso')['h'].sum().to_dict() if 'time_caso' in grp.columns else {}
        trbd = {k: round(v, 2) for k, v in trbd.items() if k and str(k) != 'nan'}

        # Por categoria de atividade
        cat_atv = grp.groupby('cat')['h'].sum().to_dict()
        cat_atv = {k: round(v, 2) for k, v in cat_atv.items()}

        # Custo total
        custo_tot = grp['custo'].sum()

        # Benchmarks
        bench = None
        cargo_lower = cargo.lower()
        if resp_key in socios:
            if resp_key in ("RODRIGO TOLOSA CARLAN", "THOMAZ DE AZEVEDO CINEL"):
                bench = BENCHMARKS.get("Sócio gestão/técnico")
            elif resp_key == "GERSON CAZZOTI BELINASO":
                bench = BENCHMARKS.get("Sócio comercial")
            else:
                bench = BENCHMARKS.get("Sócio técnico")
        elif "coord" in cargo_lower and "trabalhista" in str(time_n).lower():
            bench = BENCHMARKS.get("Coord. trabalhista")
        elif "coord" in cargo_lower:
            bench = BENCHMARKS.get("Coord. estratégico")
        elif "sênior" in cargo_lower and "tributária" in str(time_n).lower():
            bench = BENCHMARKS.get("Sênior estratégico")
        elif "sênior" in cargo_lower:
            bench = BENCHMARKS.get("Sênior")
        elif "pleno" in cargo_lower:
            bench = BENCHMARKS.get("Pleno")
        elif "júnior" in cargo_lower and "trabalhista" in str(time_n).lower():
            bench = BENCHMARKS.get("Júnior trabalhista")
        elif "júnior" in cargo_lower:
            bench = BENCHMARKS.get("Júnior")
        elif "estagiário" in cargo_lower:
            bench = BENCHMARKS.get("Estagiário")
        elif "administrativo" in cargo_lower:
            bench = BENCHMARKS.get("Admin")
        else:
            bench = BENCHMARKS.get("Sênior")

        hm.append({
            "key": resp_key,
            "nome": nome,
            "cargo": cargo,
            "time": time_n,
            "ativo": ativo,
            "h": round(total_h, 2),
            "V": round(v, 2),
            "A": round(a, 2),
            "G": round(g, 2),
            "ADM": round(adm, 2),
            "custo": round(custo_tot, 2),
            "hm": hm_mes,
            "trbd": trbd,
            "cat_atv": cat_atv,
            "bench": bench,
        })

    # ── Serviços detail ──────────────────────────────────────────────────────
    servicos_det = {}
    for cod, info in crm.items():
        tipo = info['tipo']
        if not tipo: continue

        # Horas acumuladas deste serviço
        grp = combined[combined['cod'] == cod]
        h_tot = grp['h'].sum()
        c_tot = grp['custo'].sum()

        # Horas por mês
        h_mes = {}
        for mes, mg in grp.groupby('mes'):
            h_mes[mes] = round(mg['h'].sum(), 2)

        # Receita mensal (só para mensalistas)
        rec_mes = {}
        if cod in mensalistas_rec:
            rec_mes = mensalistas_rec[cod]['meses']

        # Identificar responsável (primeiro que aparece nos lançamentos ou CRM)
        resp_det = info.get('resp', '')
        if not resp_det and len(grp) > 0:
            resp_det = grp.iloc[0]['crm_resp']

        # Sinaleira do serviço
        sin_s = map_sin(info.get('cluster', ''))

        # Tipo simplificado
        tipo_s = "judicial" if "judicial" in tipo.lower() else \
                 "mensal" if "mensal" in tipo.lower() or "fixo" in tipo.lower() else \
                 "projeto" if "projeto" in tipo.lower() else "avulso"

        servicos_det[cod] = {
            "cod": cod,
            "cli": info['cli'],
            "lbl": info['nome'] or info['cli'],
            "tipo": tipo_s,
            "cluster": sin_s,
            "area": info.get('area', ''),
            "resp": resp_det,
            "ativo": info['ativo'],
            "baixado_em": info['baixado_em'].strftime("%Y-%m-%d") if info['baixado_em'] and not pd.isna(info['baixado_em']) else None,
            "incluso": info['incluso'],
            "h_tot": round(h_tot, 2),
            "c_tot": round(c_tot, 2),
            "h_mes": h_mes,
            "rec": info['gen_sem_exito'],
            "rec_mes": rec_mes,
            "e": info['entrada'],
            "x": info['exito_total'],
        }

    # ── Mensal (mensalistas) ─────────────────────────────────────────────────
    mensal = {}
    mensalistas_crm_cods = set(
        cod for cod, info in crm.items()
        if info['tipo'] in ('Mensal consultivo', 'Fixo renovação', 'Mensal judicial')
    )
    # Agrupar por cliente mensalista (base + renovações)
    cli_mensal = defaultdict(list)
    for cod in mensalistas_crm_cods:
        info = crm[cod]
        cli_mensal[info['cli']].append(cod)

    for cli_name, cods in cli_mensal.items():
        if cli_name in EXCLUIR_MENSALISTAS: continue

        # Base = Mensal consultivo ou Mensal judicial
        base_cods = [c for c in cods if crm[c]['tipo'] != 'Fixo renovação']
        ren_cods  = [c for c in cods if crm[c]['tipo'] == 'Fixo renovação']

        # Horas totais incluindo renovações
        grp = combined[combined['cod'].isin(cods)]
        h_tot = grp['h'].sum()
        c_tot = grp['custo'].sum()

        h_mes = {}
        c_mes = {}
        for mes, mg in grp.groupby('mes'):
            h_mes[mes] = round(mg['h'].sum(), 2)
            c_mes[mes] = round(mg['custo'].sum(), 2)

        # Receita mensal: somar base + renovações
        rec_mes = defaultdict(float)
        for cod in cods:
            if cod in mensalistas_rec:
                for m, v in mensalistas_rec[cod]['meses'].items():
                    rec_mes[m] += v

        # Inclusos: verificar se tem casos inclusos
        inclusos = [c for c in combined[combined['cod'].isin(cods)]['cod'].unique() if crm.get(c, {}).get('incluso')]

        # Resp: do CRM base
        resp_m = crm[base_cods[0]]['resp'] if base_cods else (crm[cods[0]]['resp'] if cods else "")

        mensal[cli_name] = {
            "cli": cli_name,
            "cods": cods,
            "resp": resp_m,
            "h_tot": round(h_tot, 2),
            "c_tot": round(c_tot, 2),
            "h_mes": h_mes,
            "c_mes": c_mes,
            "rec_mes": dict(rec_mes),
            "inclusos": inclusos,
            "ativo": any(crm[c]['ativo'] for c in cods),
        }

    # ── Projetos/Avulsos (LC) ────────────────────────────────────────────────
    lc = {}
    for cod, info in crm.items():
        if info['tipo'] not in ('Projeto consultivo', 'Avulso consultivo'): continue
        grp = combined[combined['cod'] == cod]
        h_tot = grp['h'].sum()
        c_tot = grp['custo'].sum()
        h_mes = {m: round(mg['h'].sum(), 2) for m, mg in grp.groupby('mes')}

        lc[cod] = {
            "cod": cod,
            "cli": info['cli'],
            "lbl": info['nome'] or info['cli'],
            "tipo": "projeto" if "projeto" in info['tipo'].lower() else "avulso",
            "cluster": map_sin(info.get('cluster', '')),
            "resp": info['resp'],
            "ativo": info['ativo'],
            "baixado_em": info['baixado_em'].strftime("%Y-%m-%d") if info['baixado_em'] and not pd.isna(info['baixado_em']) else None,
            "h_tot": round(h_tot, 2),
            "c_tot": round(c_tot, 2),
            "h_mes": h_mes,
            "rec": info['gen_sem_exito'],
            "area": info['area'],
        }

    # ── Judicial ─────────────────────────────────────────────────────────────
    jud = {}
    for cod, info in crm.items():
        if "judicial" not in info['tipo'].lower(): continue
        grp = combined[combined['cod'] == cod]
        h_tot = grp['h'].sum()
        c_tot = grp['custo'].sum()
        h_mes = {m: round(mg['h'].sum(), 2) for m, mg in grp.groupby('mes')}

        entrada = info['entrada']
        exito   = info['exito_total']
        breakeven = round(c_tot / entrada, 2) if entrada > 0 else None

        jud[cod] = {
            "cod": cod,
            "cli": info['cli'],
            "titulo": info['nome'],
            "cluster": map_sin(info.get('cluster', '')),
            "resp": info['resp'],
            "area": info['area'],
            "ativo": info['ativo'],
            "baixado_em": info['baixado_em'].strftime("%Y-%m-%d") if info['baixado_em'] and not pd.isna(info['baixado_em']) else None,
            "incluso": info['incluso'],
            "h_tot": round(h_tot, 2),
            "c_tot": round(c_tot, 2),
            "h_mes": h_mes,
            "e": entrada,
            "x": exito,
            "breakeven": breakeven,
        }

    # ── Pessoas detail ───────────────────────────────────────────────────────
    pessoas_det = {}
    for resp_key, grp in combined.groupby('resp_key'):
        casos = grp['cod'].dropna().unique().tolist()
        h_mes = {}
        for mes, mg in grp.groupby('mes'):
            ms_sin = mg.groupby('sin')['h'].sum().to_dict()
            h_mes[mes] = {
                "h": round(mg['h'].sum(), 2),
                "V": round(ms_sin.get('V', 0), 2),
                "A": round(ms_sin.get('A', 0), 2),
                "G": round(ms_sin.get('G', 0), 2),
                "ADM": round(ms_sin.get('ADM', 0), 2),
                "custo": round(mg['custo'].sum(), 2),
            }
        pessoas_det[resp_key] = {
            "casos": [c for c in casos if c],
            "h_mes": h_mes,
        }

    # ── Cliente detail ────────────────────────────────────────────────────────
    cli_det = {}
    for cli_name, grp in combined.groupby('cli'):
        h_tot = grp['h'].sum()
        servs = grp['cod'].dropna().unique().tolist()
        h_mes = {m: round(mg['h'].sum(), 2) for m, mg in grp.groupby('mes')}
        cli_det[cli_name] = {
            "h_tot": round(h_tot, 2),
            "servs": [c for c in servs if c],
            "h_mes": h_mes,
        }

    # ── Montar D ──────────────────────────────────────────────────────────────
    D = {
        "meta": {
            "periodo": f"{all_meses[0]} a {all_meses[-1]}",
            "nota": "Jan/2026 ausente (transição de sistemas). Dados Eleven: 2024-07 a 2025-12. Alocação: 2026-02 em diante.",
            "gerado_em": datetime.now().strftime("%Y-%m-%d %H:%M"),
        },
        "kpis": kpis,
        "kpm": kpm,
        "meses": all_meses,
        "hm": hm,
        "times": D_times,
        "lc": lc,
        "jud": jud,
        "mensal": mensal,
        "pessoas_det": pessoas_det,
        "cli_det": cli_det,
        "servicos_det": servicos_det,
    }

    return D

# ── Gerar data.js ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    D = main()

    # Serializar: datas vão como string
    def default_serial(obj):
        if isinstance(obj, (datetime, date, pd.Timestamp)):
            return str(obj)
        if isinstance(obj, float) and (obj != obj):  # NaN
            return None
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

    js_content = "const D = " + json.dumps(D, ensure_ascii=False, indent=2, default=default_serial) + ";\n"

    out_path = "/mnt/user-data/outputs/data.js"
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"\n✅ data.js gerado em {out_path}")
    print(f"   Período: {D['meta']['periodo']}")
    print(f"   Pessoas: {D['kpis']['pessoas_ativas']}")
    print(f"   Horas totais: {D['kpis']['h_total']}")
    print(f"   Horas clientes: {D['kpis']['h_cli']}")
    print(f"   Custo técnico: R$ {D['kpis']['custo_tec']:,.0f}")
    print(f"   Meses: {D['meses']}")
    print(f"   Mensalistas: {len(D['mensal'])}")
    print(f"   Judiciais: {len(D['jud'])}")
    print(f"   Projetos/Avulsos: {len(D['lc'])}")
    print(f"   Serviços total: {len(D['servicos_det'])}")

    # Validações rápidas
    print("\n── Horas por pessoa (amostra) ──")
    for p in sorted(D['hm'], key=lambda x: -x['h'])[:10]:
        print(f"   {p['nome']}: {p['h']}h  V={p['V']} A={p['A']} G={p['G']} ADM={p['ADM']}")

    print("\n── Meses cobertos ──")
    for m in D['meses']:
        k = D['kpm'].get(m, {})
        print(f"   {m}: {k.get('h',0)}h ({k.get('n',0)} pessoas)")
