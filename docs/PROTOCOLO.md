# Protocolo criptográfico RUNA v1

> Documento técnico. Para una explicación sin tecnicismos, ver el [README](../README.md).

## Objetivo

Que **el servidor no pueda leer ningún secreto**, ni siquiera si lo controla un atacante, y que **solo quien tiene el enlace completo** (y la contraseña, si la hay) pueda abrirlo o destruirlo.

## Primitivas

Todas son nativas del navegador (Web Crypto API), sin librerías criptográficas de terceros:

| Uso | Primitiva |
|---|---|
| Cifrado autenticado | AES-256-GCM, IV aleatorio de 96 bits |
| Derivación de claves | HKDF-SHA-256 |
| Estiramiento de la contraseña | PBKDF2-SHA-256, 600 000 iteraciones (OWASP 2023) |
| Verificador del token | SHA-256 |
| Aleatoriedad | `crypto.getRandomValues` (CSPRNG) |

## Derivación

```text
K       ← 32 bytes aleatorios                         (clave del enlace)
salt    = HKDF(ikm=K, salt=∅, info="runa/v1/salt")[0..16]
P       = PBKDF2-SHA256(NFC(contraseña), salt, 600 000, 32 B)   ← solo si hay contraseña
ikm     = K ‖ P        (o solo K)
kEnc    = HKDF(ikm, salt, info="runa/v1/enc")   → clave AES-256-GCM no exportable
token   = HKDF(ikm, salt, info="runa/v1/auth")  → 32 bytes  (prueba de contraseña)
link    = HKDF(K,   salt, info="runa/v1/link")  → 32 bytes  (prueba de enlace)
verif   = SHA-256(token)
linkVer = SHA-256(link)
```

- `salt` depende de `K`, que es única por secreto: no hace falta guardarla ni enviarla.
- `kEnc` y `token` salen de la misma entrada con etiquetas `info` distintas (separación de dominios): conocer el token no ayuda a obtener la clave de cifrado.
- `link` depende **solo de K**: demuestra que se tiene el enlace completo aunque la contraseña sea incorrecta. Así el servidor distingue «alguien con el enlace se equivoca de contraseña» (cuenta el intento) de «alguien que solo conoce el id» (404 y no cuenta nada).

## Formato del texto en claro (envoltorio)

```text
u32 big-endian: longitud de la cabecera
cabecera JSON:  { "text": "...", "file"?: { "name", "type", "size" } }
bytes del archivo (opcional)
ceros hasta el bloque siguiente: 1 KiB, 4 KiB, 16 KiB, 64 KiB, 256 KiB, 1 MiB o 4 MiB
```

El relleno (padding) hace que un secreto de 8 caracteres y otro de 900 produzcan **el mismo tamaño cifrado**: el servidor no puede deducir la longitud de una contraseña.

## Cifrado

```text
iv          ← 12 bytes aleatorios
aad         = "runa/v1|p"  (con contraseña)  o  "runa/v1|-"  (sin ella)
ciphertext  = iv ‖ AES-GCM(kEnc, iv, envoltorio, aad)      → base64url
```

El AAD liga el cifrado a la versión del protocolo y a si lleva contraseña: quitar la marca `.p` del enlace no sirve para nada.

## El enlace

```text
https://runa.example/s/<id>#v1.<K en base64url>[.p]
```

- `<id>`: 16 bytes aleatorios generados **por el servidor** (128 bits, imposibles de adivinar).
- Lo que va tras `#` es el **fragmento**: según el estándar HTTP ([RFC 9110 §4.2.4](https://www.rfc-editor.org/rfc/rfc9110#section-4.2.4)) el navegador **nunca lo envía** al servidor ni en la petición ni en la cabecera `Referer`.
- `.p` indica que hace falta contraseña (solo para mostrar el campo; la seguridad no depende de ella).

## Intercambio con el servidor

| Paso | Cliente → servidor | El servidor guarda / responde |
|---|---|---|
| Crear | `{ ciphertext, verifier, linkVerifier, ttl, views }` | Comprueba que el cifrado mide exactamente un bloque + 28 bytes. Guarda cifrado, ambos verificadores, caducidad y vistas. Responde `{ id, expiresAt }`. |
| Abrir | `POST /api/secrets/:id/open { link, token }` | 1) Si `SHA-256(link) ≠ linkVer`: **404, sin contar nada**. 2) Si `SHA-256(token) ≠ verif`: 403 y suma un intento fallido; al 5.º lo borra. 3) Si no: entrega el cifrado, descuenta una vista (a 0 lo borra) y reinicia los intentos fallidos. Comparaciones en tiempo constante. |
| Destruir | `POST /api/secrets/:id/burn { link, token }` | Igual que abrir, pero borra sin entregar. |

### Por qué dos pruebas y no solo el id

El id es lo que ven los intermediarios: registros de un proxy o una CDN, bots de vista previa de mensajería, el historial del navegador. Con solo el id:

- **No se puede leer** (falta K para descifrar y para derivar las pruebas).
- **No se puede quemar** ni **agotar los intentos**: sin la prueba de enlace el servidor responde 404 y no cuenta nada.
- **No se sabe si ya se leyó**: inexistente, caducado, leído y «prueba de enlace incorrecta» dan la misma respuesta.

> Versión inicial corregida tras la auditoría: la primera implementación contaba como fallido cualquier token incorrecto, así que bastaban 5 peticiones con el id para destruir un secreto ajeno. La prueba de enlace cierra ese ataque (test `con solo el id no se puede agotar los intentos ni quemar el secreto`).

### Por qué la contraseña no se puede atacar por fuerza bruta

- **Sin conexión, imposible**: el cifrado solo sale del servidor a cambio del token correcto, y el token depende de la contraseña.
- **En línea, limitado**: cada intento fallido cuenta; al quinto el secreto se destruye. Solo cuenta quien tiene el enlace completo. Además, hay límite de peticiones por IP (por /64 en IPv6).
- Incluso el propio servidor, que sí tiene el cifrado, necesitaría `K` (256 bits aleatorios) para empezar a probar contraseñas.

## Lo que el servidor **nunca** ve

`K`, la contraseña, `P`, `kEnc` y el contenido. `token` y `link` solo llegan al abrir o destruir, y no permiten derivar nada de lo anterior.

## Pedir un secreto

Flujo inverso: quien **pide** (P) genera un enlace para que otra persona (E) le **envíe** un secreto que solo P
puede abrir. Útil para pedir credenciales a un cliente sin que viajen en claro por el correo o el chat.

### Primitivas añadidas

| Uso | Primitiva |
|---|---|
| Acuerdo de claves | X25519 (Web Crypto), clave efímera por envío |
| Derivación | HKDF-SHA-256 con sal `E ‖ A` |
| Cifrado | AES-256-GCM, AAD `runa/v1|req` |

### Claves y enlaces

```text
(a, A)     ← par X25519 generado en el navegador de P
sendProof  = HKDF(A,           info="runa/v1/req-send")   → el servidor guarda SHA-256(sendProof)
openProof  = HKDF(PKCS#8 de a, info="runa/v1/req-open")   → el servidor guarda SHA-256(openProof)

envío      https://runa.example/r/<id>#v1.<A en base64url>          (43 caracteres, para E)
recogida   https://runa.example/p/<id>#v1.<a en PKCS#8 base64url>   (64 caracteres, solo para P)
```

### Envío (E)

```text
(e, E)  ← par X25519 efímero
z       = X25519(e, A)                       (Web Crypto rechaza claves de orden pequeño: z ≠ 0)
kEnc    = HKDF(z, salt = E ‖ A, info="runa/v1/req-enc") → AES-256-GCM
cifrado = iv ‖ AES-GCM(kEnc, iv, envoltorio, aad="runa/v1|req")      (mismo envoltorio con relleno)
→ POST /api/requests/:id/fill { proof: sendProof, ciphertext, ephemeral: E }
```

### Recogida (P)

P importa `a` (la clave pública `A` sale del JWK de la privada), deriva `openProof` y pide el cifrado; con
`z = X25519(a, E)` obtiene la misma `kEnc`.

### Servidor

| Paso | Petición | Comportamiento |
|---|---|---|
| Crear | `POST /api/requests { sendVerifier, openVerifier, ttl }` | Mismas reglas que crear un secreto (`CREATE_FROM` incluido). |
| Rellenar | `POST /api/requests/:id/fill` | Sin `sendProof` correcta: **404** (nada que aprender). **Una sola vez** (409 después). Mismos tamaños de bloque, cuota y tope de almacenamiento. Contenido de más de 1 MiB: caduca como mucho en 1 día. Se permite desde fuera de `CREATE_FROM`: es para quien no está en casa, y solo rellena una petición que ya creó alguien autorizado. |
| Recoger | `POST /api/requests/:id/open { proof }` | Sin `openProof` correcta: 404. Si aún no hay nada: `waiting`. Si lo hay: lo entrega y **lo borra**. |
| Cancelar | `POST /api/requests/:id/cancel { proof }` | Borra la petición (y lo enviado). |

### Propiedades

- El servidor nunca ve `a`, `A`, `e`, `z` ni el contenido.
- **El enlace de envío no sirve para leer**: tiene la clave pública, no la privada. Si alguien lo intercepta, como mucho
  puede rellenar la petición antes que E (P lo notaría porque recibe algo que no esperaba, y E vería «ya recibió un secreto»).
- **El enlace de recogida es la llave**: quien lo tenga puede leer lo enviado. P no debe compartirlo.
- No hay contraseña: la seguridad la da la clave privada (256 bits), que solo existe en el enlace de recogida.
- Cada envío usa una clave efímera nueva.

## Versionado

El prefijo `v1` del fragmento y de las etiquetas `info` permite introducir `v2` (p. ej. Argon2id cuando haya soporte nativo) sin romper los enlaces existentes.
