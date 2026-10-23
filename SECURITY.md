# Política de seguridad

## Versiones con soporte

| Versión | Soporte |
|---|---|
| 0.1.x | ✅ |

## Cómo informar de una vulnerabilidad

**No abras un issue público.** Usa el informe privado de GitHub:
**Security → Report a vulnerability** en <https://github.com/BertMarti/runa/security/advisories/new>.

Incluye, si puedes: versión o commit, pasos para reproducirlo, impacto y una propuesta de arreglo.

- Acuse de recibo: en 72 horas.
- Primera evaluación: en 7 días.
- Arreglo y aviso público coordinados contigo; te daremos crédito si lo deseas.

## Alcance

Dentro: el protocolo criptográfico, la API, la web, la imagen Docker y los workflows de GitHub.
Fuera: ataques que requieran un dispositivo ya comprometido, ingeniería social, denegación de servicio volumétrica y los riesgos aceptados de [docs/MODELO_DE_AMENAZAS.md](docs/MODELO_DE_AMENAZAS.md#fuera-de-alcance-riesgos-aceptados).

## Medidas en vigor

Resumen; el detalle está en el [modelo de amenazas](docs/MODELO_DE_AMENAZAS.md) y en el [protocolo](docs/PROTOCOLO.md).

- Cifrado de extremo a extremo en el navegador (AES-256-GCM), clave solo en el fragmento `#`.
- Dos pruebas derivadas de la clave del enlace: con solo el id no se puede leer, destruir, agotar intentos ni saber si se leyó.
- 5 intentos de contraseña y el secreto se destruye.
- CSP estricta con Trusted Types, COOP/COEP/CORP, `no-referrer`, sin recursos externos.
- Límites por IP, por tamaño y de almacenamiento total.
- SQLite con `secure_delete`, sentencias preparadas y transacciones.
- Imagen distroless `nonroot`, solo lectura, sin capacidades; SBOM y procedencia.
- CI con CodeQL, gitleaks, `npm audit`, Grype, OpenSSF Scorecard y Dependabot; actions fijadas por SHA.
