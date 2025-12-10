/**
 * Remove device ID do JID (comportamento original do Rompot)
 * Formato: numero:deviceId@s.whatsapp.net → numero@s.whatsapp.net
 * 
 * NOTA: Esta função NÃO trata LIDs. Use normalizeLIDJID() para normalizar LIDs.
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
