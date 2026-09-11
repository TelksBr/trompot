/**
 * Remove device ID do JID (comportamento original do Rompot)
 * Formato: numero:deviceId@s.whatsapp.net → numero@s.whatsapp.net
 *
 * Também funciona com LID: numero:deviceId@lid → numero@lid
 */
export function fixID(id: string) {
  return id.replace(/:(.*)@/, "@");
}

export function getPhoneNumber(id: string): string {
  if (!id) return "";

  // Remove o device ID se existir (formato: numero:deviceId@s.whatsapp.net)
  // Extrai apenas a parte antes do ':' se houver
  let phonePart = id;
  if (id.includes(':')) {
    phonePart = id.split(':')[0];
  }

  // Remove todos os caracteres não numéricos da parte do número
  const phone = phonePart.replace(/\D+/g, "");
  // Se não encontrar números, retorna string vazia ao invés de "0"
  return phone || "";
}

/**
 * Obter o id de um número
 * Converte número de telefone para JID válido
 */
export function getID(id: string): string {
  id = String(`${id}`);

  if (!id.includes("@")) id = `${id}@s.whatsapp.net`;

  return id.trim();
}

/** Parte do usuário sem device e sem servidor (123:0@lid → 123) */
export function jidUser(id: string): string {
  if (!id) return "";
  return id.split("@")[0].split(":")[0];
}

export function isLidJid(id: string): boolean {
  return !!id && (id.endsWith("@lid") || id.endsWith("@hosted.lid"));
}

export function isPnJid(id: string): boolean {
  return !!id && (id.endsWith("@s.whatsapp.net") || id.endsWith("@hosted"));
}

/** Baileys rc10+ exige JID completo (`user@lid`) em getPNForLID / storeLIDPNMappings */
export function toLidJid(id: string): string {
  if (!id) return id;
  if (id.includes("@")) return id;
  return `${id}@lid`;
}

export function toPnJid(id: string): string {
  if (!id) return id;
  if (id.includes("@")) return id;
  return `${id}@s.whatsapp.net`;
}

/**
 * Prefere PN (`@s.whatsapp.net`) quando o Baileys envia LID + Alt.
 * remoteJidAlt / participantAlt / phoneNumber carregam o PN correspondente.
 */
export function preferPhoneJid(
  primary?: string | null,
  alt?: string | null,
  fallback: string = "",
): string {
  const candidates = [primary, alt, fallback].filter(
    (value): value is string => !!value,
  );
  const pn = candidates.find((jid) => isPnJid(jid));
  return fixID(pn || candidates[0] || "");
}
