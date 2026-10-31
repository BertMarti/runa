# Despliegue

## Con Docker Compose (recomendado)

```bash
git clone https://github.com/BertMarti/runa.git
cd runa
docker compose up -d
```

RUNA queda en `http://127.0.0.1:8484`, accesible solo desde la propia máquina. **Para usarlo desde fuera necesitas HTTPS**: Web Crypto solo funciona en contextos seguros (HTTPS o `localhost`).

También puedes usar la imagen publicada (amd64 y arm64, con SBOM y procedencia):

```bash
docker run -d --name runa -p 127.0.0.1:8484:8080 \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -v runa-data:/data ghcr.io/bertmarti/runa:latest
```

## HTTPS con Caddy

```caddyfile
secretos.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8484
}
```

Y en `compose.yaml`:

```yaml
environment:
  TRUST_PROXY: "172.16.0.0/12"   # la pasarela de Docker: ver la nota de abajo
  HSTS: "true"
```

`TRUST_PROXY` hace que el límite de peticiones use la IP real del cliente (`X-Forwarded-For`) **solo** si la petición viene de ese proxy. No lo pongas a `true` si el puerto de RUNA es accesible directamente: cualquiera podría falsear su IP.

> **Ojo con `127.0.0.1`.** Aunque Caddy conecte a `127.0.0.1:8484`, dentro del contenedor la conexión llega
> desde la **pasarela de Docker** (p. ej. `172.17.0.1`), no desde `127.0.0.1` (comprobado). Con
> `TRUST_PROXY: "127.0.0.1"` RUNA no reconocería al proxy y todos los clientes compartirían un único límite.
> Usa la red de Docker (`172.16.0.0/12`) o, si el proxy está en la misma red de Compose, su red.

Si tu proxy no es Cloudflare, haz que borre `Cf-Connecting-IP`: con `TRUST_CF_FROM` vacío RUNA ya la ignora,
pero así nadie depende de esa configuración.

```caddyfile
secretos.example.com {
  reverse_proxy 127.0.0.1:8484 {
    header_up -Cf-Connecting-IP
  }
}
```

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto de escucha. |
| `HOST` | `127.0.0.1` (`0.0.0.0` en Docker) | Interfaz de escucha. |
| `DATA_DIR` | `./data` (`/data` en Docker) | Carpeta de la base de datos. |
| `MAX_STORAGE_MB` | `512` | Tope de espacio cifrado entre todos los secretos (responde 507 al llenarse). |
| `RATE_LIMIT_CREATE` | `20` | Secretos creados por minuto y por IP. |
| `RATE_LIMIT_OPEN` | `30` | Aperturas o destrucciones por minuto y por IP. |
| `TRUST_PROXY` | `false` | `true`, o lista de IP/CIDR de proxies de confianza. |
| `TRUST_CF_FROM` | (vacío: nunca) | IP/CIDR de los conectores de **Cloudflare Tunnel** cuya cabecera `Cf-Connecting-IP` se cree para los límites. Solo si RUNA está detrás de `cloudflared`; detrás de cualquier otro proxy, déjalo vacío. |
| `CREATE_QUOTA_MB` | `64` | MB cifrados que un mismo cliente puede guardar por hora (429 al superarlo). Evita que una sola IP llene `MAX_STORAGE_MB`. |
| `METRICS_TOKEN` | (vacío: sin métricas) | Activa `GET /api/metrics` para **Prometheus**, solo con `Authorization: Bearer <token>`. Al menos 32 caracteres (`openssl rand -hex 32`). Ver [Métricas](#métricas). |
| `HSTS` | `false` | Envía `Strict-Transport-Security` (solo detrás de HTTPS). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` o `silent`. |
| `CREATE_FROM` | (vacío: desde cualquier sitio) | IP o CIDR desde las que se pueden **crear** secretos, p. ej. `172.16.0.0/12,192.168.0.0/16`. Leer siempre se puede. Con esta opción, todo lo que llega por Cloudflare (`Cf-Connecting-IP`/`Cf-Ray`) se trata como externo. |
| `PUBLIC_URL` | (vacío: el de la página) | Origen de los enlaces que genera la web, p. ej. `https://runa.example.com`. Útil si creas desde casa y compartes con gente de fuera. |
| `PUBLIC_DIR` | `apps/web/dist` | Web compilada; `none` para servir solo la API. |

### Carpeta local en vez de volumen

La imagen se ejecuta como el usuario `nonroot` (uid 65532). Si montas una carpeta en lugar de un volumen con nombre, dale antes ese propietario o el servidor no podrá crear la base de datos:

```bash
mkdir -p ./data && sudo chown 65532:65532 ./data
docker run … -v "$PWD/data":/data ghcr.io/bertmarti/runa:latest
```

### HSTS

`HSTS=true` envía `Strict-Transport-Security: max-age=63072000; includeSubDomains` (2 años). No incluye `preload`: añadir tu dominio a la lista de precarga de los navegadores es difícil de deshacer y debe ser una decisión tuya.

## Leer desde fuera, crear solo desde casa

El caso habitual en un homelab: quien recibe el enlace está **fuera** de casa, pero no quieres que cualquiera de
Internet use tu RUNA para alojar secretos o archivos con tu dominio.

1. Publica RUNA por un túnel (p. ej. Cloudflare Tunnel: `runa.example.com` → `http://runa:8080`). **Sin**
   Cloudflare Access: quien recibe el enlace no tiene cuenta.
2. En RUNA:

   ```yaml
   environment:
     TRUST_PROXY: "172.16.0.0/12"            # la red de Docker donde está el conector del túnel
     TRUST_CF_FROM: "172.16.0.0/12"          # el conector del túnel: su Cf-Connecting-IP es la IP real
     CREATE_FROM: "172.16.0.0/12,192.168.0.0/16"
     PUBLIC_URL: "https://runa.example.com"
   ```

   Si en esa misma red hay otro proxy (p. ej. un Caddy para la LAN), haz que borre `Cf-Connecting-IP`
   (`header_up -Cf-Connecting-IP`): si no, un cliente de la LAN podría inventarse su IP.

Resultado:

- desde casa (o desde una aplicación de la red de Docker, como ARIA) se crean secretos, y sus enlaces llevan el dominio público;
- desde fuera solo se abren: crear da 403 y la web lo explica;
- los límites de lectura y de «destruir» van por la IP real de cada cliente (`Cf-Connecting-IP`, gracias a `TRUST_CF_FROM`).

Si algún día Cloudflare queda bloqueado en tu red o tu país, los enlaces públicos no abrirán hasta que se
levante el bloqueo.

## Métricas

Con `METRICS_TOKEN`, RUNA publica en `/api/metrics` (formato de texto de Prometheus) **solo recuentos**:

| Métrica | Qué es |
|---|---|
| `runa_secrets_active` | Secretos guardados que aún no se han leído ni han caducado. |
| `runa_requests_active{state}` | Peticiones de secreto vivas: `waiting` (sin rellenar) o `filled`. |
| `runa_storage_used_bytes` / `runa_storage_limit_bytes` | Espacio cifrado usado y tope (`MAX_STORAGE_MB`). |
| `runa_http_responses_total{route,status}` | Respuestas de la API por **patrón** de ruta (`/api/secrets/:id/open`) y código. |
| `runa_build_info{version}`, `runa_start_time_seconds` | Versión y arranque. |

Nunca llevan ids, IP, tamaños de un secreto concreto ni nada de un cuerpo. Sin el token (o con uno incorrecto,
comparado en tiempo constante) la respuesta es 401; sin `METRICS_TOKEN`, la ruta no existe. Ten en cuenta que
quien lea las métricas ve **cuándo** se crean y se abren secretos (no cuáles): dales el mismo trato que a los
registros del proxy.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: runa
    metrics_path: /api/metrics
    authorization:
      credentials_file: /etc/prometheus/runa-token   # el mismo valor que METRICS_TOKEN
    static_configs:
      - targets: ['runa:8080']
```

Alertas útiles: `runa_storage_used_bytes / runa_storage_limit_bytes > 0.8` (se acerca el 507) y un aumento de
`runa_http_responses_total{status="429"}` (alguien choca con los límites).

## Raspberry Pi

La imagen es multiarquitectura (arm64). En una Raspberry Pi 5, RUNA usa menos de 80 MB de RAM en reposo (medido: 43 MB con la imagen distroless Debian 13). Si no quieres exponerlo a Internet, publícalo solo a través de una VPN como [HEIMDALL](https://github.com/BertMarti/HEIMDALL).

## Copias de seguridad

**No hagas copias de seguridad de `/data`.** Los secretos son efímeros por diseño: una copia los conservaría más allá de su caducidad.
