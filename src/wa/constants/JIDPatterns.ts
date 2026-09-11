/**
 * Padrões de JID (Jabber ID) do WhatsApp
 */
export const JID_PATTERNS = {
  /** JID de usuário (contém @s.whatsapp.net) */
  USER: '@s',
  /** JID LID (Linked Identity) */
  LID: '@lid',
  /** JID de grupo (contém @g.us) */
  GROUP: '@g',
  /** JID de broadcast */
  BROADCAST: 'status@broadcast',
} as const;

/**
 * Verifica se um JID é de usuário PN
 */
export function isUserJID(jid: string): boolean {
  return jid.includes(JID_PATTERNS.USER);
}

/**
 * Verifica se um JID é LID (WhatsApp 7.x)
 */
export function isLidJID(jid: string): boolean {
  return jid.includes(JID_PATTERNS.LID);
}

/**
 * Verifica se um JID é de grupo
 */
export function isGroupJID(jid: string): boolean {
  return jid.includes(JID_PATTERNS.GROUP);
}

/**
 * Verifica se um JID é válido para operações
 * Baileys 7 aceita LID e PN para envio/recebimento
 */
export function isValidJID(jid: string | undefined | null): boolean {
  if (!jid) return false;
  return isUserJID(jid) || isGroupJID(jid) || isLidJID(jid);
}

