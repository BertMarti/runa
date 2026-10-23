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
  TRUST_PROXY: "127.0.0.1"   # o la red de Docker de tu proxy, p. ej. "172.16.0.0/12"
  HSTS: "true"
```

`TRUST_PROXY` hace que el límite de peticiones use la IP real del cliente (`X-Forwarded-For`) **solo** si la petición viene de ese proxy. No lo pongas a `true` si el puerto de RUNA es accesible directamente: cualquiera podría falsear su IP.

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
| `HSTS` | `false` | Envía `Strict-Transport-Security` (solo detrás de HTTPS). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` o `silent`. |
| `PUBLIC_DIR` | `apps/web/dist` | Web compilada; `none` para servir solo la API. |

### Carpeta local en vez de volumen

La imagen se ejecuta como el usuario `nonroot` (uid 65532). Si montas una carpeta en lugar de un volumen con nombre, dale antes ese propietario o el servidor no podrá crear la base de datos:

```bash
mkdir -p ./data && sudo chown 65532:65532 ./data
docker run … -v "$PWD/data":/data ghcr.io/bertmarti/runa:latest
```

### HSTS

`HSTS=true` envía `Strict-Transport-Security: max-age=63072000; includeSubDomains` (2 años). No incluye `preload`: añadir tu dominio a la lista de precarga de los navegadores es difícil de deshacer y debe ser una decisión tuya.

## Raspberry Pi

La imagen es multiarquitectura (arm64). En una Raspberry Pi 5, RUNA usa unos 75 MB de RAM en reposo (medido: 73 MB). Si no quieres exponerlo a Internet, publícalo solo a través de una VPN como [HEIMDALL](https://github.com/BertMarti/HEIMDALL).

## Copias de seguridad

**No hagas copias de seguridad de `/data`.** Los secretos son efímeros por diseño: una copia los conservaría más allá de su caducidad.
