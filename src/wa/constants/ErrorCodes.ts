/**
 * Códigos de erro HTTP e de desconexão
 */
export const ErrorCodes = {
  /** Erro interno do servidor (padrão) */
  INTERNAL_SERVER_ERROR: 500,
  /** Logged out - Sessão foi morta do WhatsApp */
  LOGGED_OUT: 401,
  /** Logged out (alternativo) */
  LOGGED_OUT_ALT: 421,
  /** Connection Closed - Geralmente temporário */
  CONNECTION_CLOSED: 402,
  /** Request Timeout - Requisição expirou (geralmente temporário) */
  REQUEST_TIMEOUT: 408,
  /** Connection Terminated - Erro temporário de conexão (permite reconexão) */
  CONNECTION_TERMINATED: 428,
} as const;

/**
 * Mensagens de erro padrão
 */
export const ErrorMessages = {
  LOGGED_OUT: (code: number) => 
    `Sessão desconectada do WhatsApp (${code}). A sessão foi limpa automaticamente. Chame connect() novamente para gerar um novo QR code.`,
  CONNECTION_CLOSED: 'Conexão fechada (402). O Baileys tentará reconectar automaticamente.',
  REQUEST_TIMEOUT: 'Request Timeout (408) - Requisição expirou. O Baileys tentará reconectar automaticamente.',
  INTERNAL_SERVER_ERROR_MSG: 'Erro interno do servidor (500). A biblioteca tentará reconectar automaticamente.',
  CONNECTION_TERMINATED: 'Connection Terminated (428) - Erro temporário de conexão. O Baileys tentará reconectar automaticamente.',
  RECONNECTION_CANCELLED: (code: number) => 
    `Reconexão cancelada: Erro ${code} detectado. Limpe a pasta de sessão e faça login novamente.`,
} as const;


