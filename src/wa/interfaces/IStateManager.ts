import { BotStatus } from '../../bot/BotStatus';
import { ConnectionState } from '@whiskeysockets/baileys';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting';

export interface BotState {
  id: string;
  status: BotStatus;
  phoneNumber: string;
  name: string;
  profileUrl: string;
  connectionStatus: ConnectionStatus;
  lastConnectionUpdateDate: number;
  lastDisconnectError?: number;
  connectionState?: Partial<ConnectionState>;
}

/**
 * Interface para gerenciamento de estado
 */
export interface IStateManager {
  // Getters
  readonly id: string;
  readonly status: BotStatus;
  readonly phoneNumber: string;
  readonly name: string;
  readonly profileUrl: string;
  readonly connectionStatus: ConnectionStatus;
  readonly lastConnectionUpdateDate: number;
  readonly lastDisconnectError: number | undefined;
  readonly connectionState: Partial<ConnectionState> | undefined;
  readonly fullState: BotState;

  // Setters
  setId(id: string): void;
  setStatus(status: BotStatus): void;
  setPhoneNumber(phoneNumber: string): void;
  setName(name: string): void;
  setProfileUrl(profileUrl: string): void;
  setConnectionStatus(status: ConnectionStatus): void;
  setLastConnectionUpdateDate(date: number): void;
  setLastDisconnectError(error?: number): void;
  updateConnectionState(state: Partial<ConnectionState>): void;

  // Observers
  observe(observer: (state: BotState) => void): () => void;
  clearObservers(): void;
  reset(): void;
}

