"""Autenticação gerenciada: identidade conferida no provedor e acesso do proprietário."""
from __future__ import annotations
import json,os
from dataclasses import dataclass
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from urllib.parse import urlsplit

class AuthError(ValueError):pass
@dataclass(frozen=True)
class Identity:
    user_id:str
    email:str
    role:str='owner'

class Auth:
    def __init__(self,url=None,key=None,owner_email=None,transport=None):
        self.url=(url or os.environ.get('DBCL_SUPABASE_URL') or os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL','')).rstrip('/')
        self.key=key or os.environ.get('DBCL_SUPABASE_PUBLISHABLE_KEY') or os.environ.get('SUPABASE_PUBLISHABLE_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY','')
        self.owner=(owner_email or os.environ.get('DBCL_OWNER_EMAIL','')).strip().casefold()
        parsed=urlsplit(self.url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
            raise AuthError('Endereço de autenticação não configurado')
        if not self.key or not self.owner or '@' not in self.owner:raise AuthError('Acesso do proprietário não configurado')
        self.transport=transport or self._transport
    def _transport(self,path,payload=None,token=None):
        headers={'apikey':self.key,'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        body=json.dumps(payload).encode() if payload is not None else None
        request=Request(self.url+'/auth/v1/'+path,data=body,headers=headers)
        try:
            with urlopen(request,timeout=15) as response:
                data=response.read(1048577)
                if len(data)>1048576:raise AuthError('Resposta de autenticação inválida')
                return json.loads(data)
        except (HTTPError,URLError,TimeoutError,ValueError):
            raise AuthError('Não foi possível validar a sessão. Entre novamente.') from None
    def _identity(self,user):
        if not isinstance(user,dict):raise AuthError('Identidade inválida')
        email=user.get('email','')
        if not isinstance(email,str) or email.strip().casefold()!=self.owner or not user.get('email_confirmed_at') or user.get('is_anonymous') is True:
            raise AuthError('Conta sem acesso ao BI')
        if not isinstance(user.get('id'),str) or not user['id']:raise AuthError('Identidade inválida')
        return Identity(user['id'],email.strip().casefold())
    def authenticate(self,access_token):
        if not isinstance(access_token,str) or not access_token or len(access_token)>16384 or any(c.isspace() for c in access_token):raise AuthError('Sessão ausente ou inválida')
        # Nunca confiar no e-mail ou no papel enviados pelo navegador.
        return self._identity(self.transport('user',token=access_token))
    def request_code(self,email):
        if not isinstance(email,str) or email.strip().casefold()!=self.owner:raise AuthError('Conta sem acesso ao BI')
        # O proprietário precisa ser cadastrado no provedor; não há inscrição pública.
        self.transport('otp',{'email':self.owner,'create_user':False})
        return {'message':'Confira o código enviado ao seu e-mail.'}
    def verify_code(self,email,code):
        if not isinstance(email,str) or email.strip().casefold()!=self.owner:raise AuthError('Conta sem acesso ao BI')
        if not isinstance(code,str) or not code.isascii() or not code.isdigit() or not 6<=len(code)<=10:raise AuthError('Código inválido')
        session=self.transport('verify',{'email':self.owner,'token':code,'type':'email'})
        return self._session(session)
    def _session(self,session):
        if not isinstance(session,dict):raise AuthError('Sessão inválida')
        token=session.get('access_token');identity=self.authenticate(token)
        expiry=session.get('expires_in')
        if type(expiry) is not int or not 0<expiry<=86400:raise AuthError('Validade da sessão inválida')
        # O futuro handler coloca apenas access_token em cookie HttpOnly/Secure.
        # Expiração exige novo login neste primeiro fluxo; não persistir token no localStorage.
        return {'access_token':token,'expires_in':expiry,'identity':identity}
