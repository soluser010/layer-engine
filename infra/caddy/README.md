# Caddy development edge

`Caddyfile.development` exposes the Node runtime through plain localhost HTTP on port `8080` and locally trusted HTTPS on port `8443`. Both listeners proxy to `127.0.0.1:8787`, apply browser security headers, bound header/body timing, and enforce the same `256 KiB` body limit as the application runtime. Streaming responses use immediate proxy flush and no global write deadline; Node heartbeats and per-operation limits remain responsible for detecting stalled clients.

The profile requires Caddy 2.10 or newer because it uses the `request_body` directive. Validate it before local use:

```text
caddy validate --config infra/caddy/Caddyfile.development
```

The internal certificate is for local development only. A production deployment must use a real hostname and Caddy automatic HTTPS; it must not add a public cleartext API fallback.

`Caddyfile.production.example` is a reviewed starting point, not a drop-in deployment secret. Set `LAYER_DOMAIN` and the private Node `LAYER_PORT`, validate it with the exact production Caddy version, and place the origin behind the external CDN/WAF described in the production runbook. If automatic HTTPS cannot obtain or renew a certificate, privileged application traffic remains unavailable; it never downgrades to HTTP.
