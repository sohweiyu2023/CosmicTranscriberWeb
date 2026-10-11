import https from 'node:https';
import http2 from 'node:http2';

// E2E-only transport. Preserve the exact same HTTPS origin, TLS certificate,
// handler, Secure/HttpOnly cookie and request assertions on both protocols.
// HTTP/2 multiplexes the ~18 imported modules on a single browser socket;
// Windows branded-browser runs otherwise intermittently exhaust socket
// buffers (net::ERR_NO_BUFFER_SPACE) before app bootstrap can execute.
// SafariDriver uses the original HTTP/1.1 mode unless explicitly opted in.
export function createE2eTlsServer(tlsOptions,requestHandler,{multiplex=false}={}){
  if(!tlsOptions?.key||!tlsOptions?.cert||typeof requestHandler!=='function')throw new TypeError('E2E TLS certificate and request handler are required');
  return multiplex
    ? http2.createSecureServer({...tlsOptions,allowHTTP1:true},requestHandler)
    : https.createServer(tlsOptions,requestHandler);
}
