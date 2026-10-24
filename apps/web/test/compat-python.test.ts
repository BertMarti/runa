import { describe, expect, it } from 'vitest';
import { accessProof, openSecret, parseFragment } from '../src/crypto';

/**
 * Secretos cifrados por la implementación en Python del módulo de ARIA (modulos/runa/protocolo.py en
 * github.com/BertMarti/ARIA). Si un cambio del protocolo rompe esta prueba, también rompe ARIA.
 */
const DESDE_PYTHON = [
  {
    "nombre": "py-pass",
    "texto": "Contraseña: Ñu-77",
    "contrasena": "fiordo azul",
    "ciphertext": "PrIYN7GDcfao27BUJyWsNHm96RmCHmfdwymF0HFlN53JlEU6vVLm2SJC3WdfUjq_8qnOmftcwpBUTI-rgOuQHGmS2h2LG-5Srgr-KivXNmkBD29rrK-TM3NI7u8-2AI87JeU1WM90Z5oP4Rt99WPyeQBfHc3T8mjKb2vnlUzbpOANF_Y5ZeKo8cH7iAuTmy5DBWiwEYQS6s0bcDgShK1RQbP-IO1aZL9G9jqTHG352CabT94QHHIYs2T958GdKGdYeK_YcMtB5B2fCQsYT2gYgB6CF3ons8NAbMlDJjYhAe3sx0i95N9IITfGS4kLuuSOo-D-ouPSsmg-wElS6ZBj9wpzadMWERG3dkZ-x3TxXKkK6zWETpbsfXa0KBwuOfkfsuPnb0F2gtEs-4aS_4N9t30V6LtdzdPYzfIBw1EMPfxB7lS3WKO3tomC3oQHKlRmPNGFMK9hPeTy5V24hGfIEdFouMzT4ovUiXdh5kvk6tCRWiiF0lhzRook0KSxGN-WPXaXTbnEEhKpgkmSM7i9xjlx94EVRewUeCxj1IK57wKlmejQ_KSNAxo0cAKHkbVGI8Cmpe4QdvAZi43WCGRxZ4msrU4PCczUMgr_K5f0LkameD3WAzqsGu3b3xjhx9Q0muQpjIaYeOmHy9GzupDwxiyrjJxRi7BOboORNilrO6QNwJO5acB6gR86BwqOnUYUUcE9rG4_ozysEihuNcc4b4yADK-_Rx0632hAHDQ5y-rN2EWVYzzEdjuy4CkCYQpN0lr5iccnn9whkLN1r3GDGigqHGbhdJ_Q01ToPTR1YLD1ovcVfCvhjWX2l16I6pL9wFBnbWf12_-VuF_WYscUNx_lGc2moQDbrTRe4Il9OOW_9O5eX2tU2YuvFz9Uhp-k7Z4QPVwt8ZQiRBzVcFYDmylgJeD4-Jx1iAzaalK6XHpD3l1A61q_ia5nN4qhpQxNvmEWRH4SL8eT65QDUjFW4ZLAdk5RLLJ4mX28cLU3_C25ZV3mJG2XlvOPtq3E47kvsYyTQ0XQFViYEUihXh5lt-F0MNEV8o8VAdFpilSPwMKQJlrYyEm3lV5X7mdNQUYDlqwWeO8DPoLMfHYsW8xudLgh8uD9XlDzvqMeTT3-xzQkhG6aV9A0wDjxPetYvRHmmuzncWtofMHQRgkYmjjXpqYVpJMfKE8jZiivDFoGZdNydxQ6lrgFIavCZ_my5948wKerpY_CUVCODoeG3vuLQwKJw9sog7KDAvwdr9DMhvORG4aNrrNt_CuuyU5L-BrgzC82WX6tFXoy1mqNBjwU0t_oz_Low0Mp7kqpBr3iKU_h-dWUS3kzH-uzooPhCJQIPnHZCIulH5Tnao9s164osal8xrPRdaIWelEKvc_UXmH8ARv3QI01Y7Gk-s",
    "fragmento": "v1.woxQsxAmcqYaJRwnrgm-IcT3TFasWs1JAkThUdnTmys.p",
    "verifier": "42cde4916cca4efdb9674663287af86157868ef792e878af7acc4754031ad565",
    "linkVerifier": "3c41efd7e88da0591c24c7d93a5b2677cfd90e4e29c8f5eab278aa01ad6dfa61"
  },
  {
    "nombre": "py-archivo",
    "texto": "con adjunto",
    "contrasena": null,
    "ciphertext": "p1XWMfA4n95WiaSz6x3sYb_7wxJ37JjI8SASKWjVHDC8NMdJ4Qz85Vm-UjXFqkwHphRnA7Sd8juGmwIJTnDjGgEaUOBIOHXflB8gS4CPfoIy0m_6tYAp27PZnpxm6g9gF3yvnfAy9iv2C9O3JVEU_Q52rLipxVTMIIwtxlMPxi126jeuUX2DoE7M1rFEy3gJuPrWXdZIMEUZsPDRN47xMm3i7yjWbDLANNfvQn-ynhdgbNmY2AZhe2JPodtoB5kymq9USY091klspHBLU0n6-6fag9WrvVLMpiHLOC53dzIkdBEWuwOPoCZOaLBZ3Ew9TYvR_l_T2GY6sxTBsJT9kpDu_Bx1M5Su99eK_2dnZxU21fm4MeOMsS0Q4di974YIYJY5ZzNSUXxB2J8D-l-XmICLeFqRQkl3pW-pDBrRTC3Xnsrjdoa76NFzV2b9PiwXDR6mWjpOthlA9jR9tsJKcswiKpc7cVAPmHDw9yxZJA19XFlSTQLud9o87vMNPg1rORVSgrIKB_PbopLQp_L82KhPQ_LhN-kU69WDCrluUhUsAj_ZSUKpYowzWCHpSuzcr2pwSaYDgVXA7KvIZ7yyGXkMGnbl7___02PLN_A0w6pauXsi-i7HeqCD9BMXOmHfkvA4Sia_nlku3EX_VDGqRoDZLeQcBfB5yMmlfaIsBJnG_Ya3KjfEg-HdH9R-tTFKyK3tufRVnKhMcxvb2cPImH9_73YE3083i25IoBafoHek2ubLyX2DVM9xsFur5NfLXyxsFRh4b9_KMn-G_8o3Tyb18bd4GsckKAgWqlIbTmUpkPqF4qP8hzdQEJLCp2_OGYAbxFfAcMfP9MNRU3ZxCd1JYfiJejNf4uux4TMlHIEQqk9fPNTRGU8DF3QIYrQDqBNLIv9BjJ_t6R3XTWh1GHB8w0NUEfZc7fN_FOOVJxwk8hNtkX8qjlILt1vAcjN9nRjg5JiguXosiCXe8_HIZ5IJkhCOoNrF3UlmJsW-C3vKxu-Kj336twr2SYqZLp-46JcEmvF2oJzHAm4Y953RHZh1uxmnof5NC1EYSMzhKPsvVvno3G2VlJuN9mBKx-JGccWhbxKJuWTRBHtFTTMMHoGmCjfwuirHtDQ4SstYzcq7bZeQqNzn9f9dboZanTMWTN03w98u0Cz73cm-94d5jbuIFMVAKyqktTHqKX0rIlqk3L4Is-3s2qgRvk06tD5Jen5fTTUBfGiUjFQSn0iUmJxnJpGeoqpeYT7f3OIHzP99vQ0ISHnXuCKR4ZAv4LjFk-P-7l425dTAZEnRHstqxE-6DiAgy3npGjDxEXZfCL-VfslbzKe-mmAJFysQNWCBkUPfjGMKE34u9RdR_7fwnH_clzlyTqnp_JlhX2LA9yFDt0viwRAjaw-Y_7k",
    "fragmento": "v1.McVoTNhBuW0Okp-T1QCGBTU8Jwf_GCdjRfBIKE1e3kc",
    "verifier": "bf30f1b1d4dcf4029d2c11710863c7d58d343985026afe720d573ff74179883c",
    "linkVerifier": "65614faf6c024ee868a3549b1e2e629cc084ad45d8f3720b9a3d5ae440c76d73"
  }
] as const;

async function sha256Hex(hex: string): Promise<string> {
  const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('compatibilidad con el módulo de ARIA (Python)', () => {
  it.each(DESDE_PYTHON)('abre $nombre', async (v) => {
    const link = parseFragment(v.fragmento)!;
    const pass = v.contrasena ?? undefined;
    const opened = await openSecret(v.ciphertext, link, pass);
    expect(opened.text).toBe(v.texto);
    const proof = await accessProof(link, pass);
    expect(await sha256Hex(proof.token)).toBe(v.verifier);
    expect(await sha256Hex(proof.link)).toBe(v.linkVerifier);
  });

  it('el adjunto cifrado en Python llega intacto', async () => {
    const v = DESDE_PYTHON.find((x) => x.nombre === 'py-archivo')!;
    const opened = await openSecret(v.ciphertext, parseFragment(v.fragmento)!);
    expect(opened.file?.name).toBe('clave.pem');
    expect(new TextDecoder().decode(opened.file!.data)).toBe('-----BEGIN-----\n');
  });
});
