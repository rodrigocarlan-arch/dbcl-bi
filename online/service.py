"""Contrato HTTP da edição online, independente do servidor local e do navegador."""
from __future__ import annotations
from http.cookies import SimpleCookie,CookieError
from urllib.parse import urlsplit
from cadastros.store import Conflict
from .auth import AuthError
COOKIE='__Host-dbcl_session'
class Service:
    def __init__(self,auth,store,origin,catalog=None,publication=None):
        parsed=urlsplit(origin)
        if parsed.scheme!='https' or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:raise ValueError('Origem HTTPS exata obrigatória')
        self.auth=auth;self.store=store;self.origin=origin;self.host=parsed.netloc;self.catalog=catalog;self.publication=publication
    def handle(self,method,path,headers,body=None):
        h={k.lower():v for k,v in headers.items()}
        response={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'}
        def result(status,value):return status,response,value
        if h.get('host')!=self.host:return result(403,{'error':'Host não permitido'})
        if method not in ('GET','POST'):return result(405,{'error':'Método não permitido'})
        if method=='POST' and h.get('origin')!=self.origin:return result(403,{'error':'Origem não permitida'})
        if method=='POST' and not isinstance(body,dict):return result(400,{'error':'Corpo JSON inválido'})
        try:
            if method=='POST' and path=='/api/login/request':return result(200,self.auth.request_code(body.get('email')))
            if method=='POST' and path=='/api/login/verify':
                session=self.auth.verify_code(body.get('email'),body.get('code'))
                response['Set-Cookie']=f"{COOKIE}={session['access_token']}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age={session['expires_in']}"
                return result(200,{'ok':True})
            if method=='POST' and path=='/api/logout':
                response['Set-Cookie']=f'{COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
                return result(200,{'ok':True})
            cookies=SimpleCookie();cookies.load(h.get('cookie',''))
            identity=self.auth.authenticate(cookies[COOKIE].value if COOKIE in cookies else None)
            if method=='GET' and path=='/api/status' and self.publication is not None:
                snap=self.store.snapshot();published=self.publication()
                return result(200,{'owner':identity.email,'local_only':False,'ready':published is not None,'enabled':bool(snap['settings'].get('enabled')),'contracts_enabled':bool(snap['settings'].get('contracts_enabled')),'revision':snap['revision'],'published_revision':published['revision'] if published else None,'publication_id':published['id'] if published else None,'pending':not published or published['revision']!=snap['revision'],'job':{'state':'unavailable','message':'A regeneração online ainda não está conectada. Alterações salvas exigem nova geração dos indicadores.'}})
            if method=='GET' and path=='/api/cadastros':return result(200,self.store.snapshot())
            if method=='GET' and path=='/api/history':return result(200,self.store.history())
            if method=='POST' and path=='/api/backup':
                from .backup import export
                backup=export(self.store)
                return result(200,{'backup':backup,'filename':'dbcl-cadastros-'+backup['sha256'][:12]+'.json','message':'Backup dos cadastros e histórico preparado. Guarde o arquivo em local privado.'})
            if method=='GET' and path=='/api/crm':
                if self.catalog is None:return result(503,{'error':'Catálogo CRM online ainda não publicado'})
                return result(200,self.catalog())
            if method=='POST' and path=='/api/save':
                if body.get('kind')=='contracts':
                    record=body.get('record');code=record.get('code') if isinstance(record,dict) else None
                    previous=next((r for r in self.store.snapshot()['contracts'] if r['id']==body.get('id')),None)
                    if not previous or previous['code']!=code:
                        if self.catalog is None:return result(503,{'error':'Catálogo CRM online ainda não publicado'})
                        if not any(r['code']==code for r in self.catalog()):return result(400,{'error':'Contrato não encontrado no catálogo CRM'})
                value=self.store.save(body.get('kind'),body.get('id'),body.get('record'),body.get('revision'),body.get('reason'),actor=identity.email)
                return result(200,value)
            if path in ('/api/rebuild','/api/backup','/api/status','/api/data'):
                return result(503,{'error':'Publicação e operação online ainda em configuração; nenhuma atualização foi confirmada'})
            return result(404,{'error':'Rota não encontrada'})
        except (AuthError,CookieError):return result(401,{'error':'Sessão inválida ou conta sem acesso'})
        except Conflict as e:return result(409,{'error':str(e)})
        except (ValueError,TypeError,KeyError):return result(400,{'error':'Cadastro inválido; confira os campos e as vigências'})
        except Exception:return result(503,{'error':'Serviço indisponível; nenhuma alteração foi confirmada'})
