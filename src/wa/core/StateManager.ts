import { BotStatus } from '../../bot/BotStatus';
import { ConnectionState } from '@whiskeysockets/baileys';
import { LoggerService } from '../services/LoggerService';

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

export class StateManager {
  private state: BotState = {
    id: '',
    status: BotStatus.Offline,
    phoneNumber: '',
    name: '',
    profileUrl: '',
    connectionStatus: 'disconnected',
    lastConnectionUpdateDate: Date.now(),
  };

  private observers: Set<(state: BotState) => void> = new Set();
  private logger?: LoggerService;

  constructor(logger?: LoggerService) {
    this.logger = logger;
  }

  /**
   * Atualiza o estado e notifica observadores
   */
  private updateState(updates: Partial<BotState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyObservers();
  }

  /**
   * Notifica todos os observadores
   */
  private notifyObservers(): void {
    this.observers.forEach(observer => {
      try {
        observer(this.state);
      } catch (error) {
        // Ignora erros nos observadores para não quebrar o fluxo
        if (this.logger) {
          this.logger.error('Erro ao notificar observador', error);
        }
        // Removido console.error - sempre usa logger se disponível
      }
    });
  }

  // Getters
  get id(): string {
    return this.state.id;
  }

  get status(): BotStatus {
    return this.state.status;
  }

  get phoneNumber(): string {
    return this.state.phoneNumber;
  }

  get name(): string {
    return this.state.name;
  }

  get profileUrl(): string {
    return this.state.profileUrl;
  }

  get connectionStatus(): ConnectionStatus {
    return this.state.connectionStatus;
  }

  get lastConnectionUpdateDate(): number {
    return this.state.lastConnectionUpdateDate;
  }

  get lastDisconnectError(): number | undefined {
    return this.state.lastDisconnectError;
  }

  get connectionState(): Partial<ConnectionState> | undefined {
    return this.state.connectionState;
  }

  get fullState(): BotState {
    return { ...this.state };
  }

  // Setters
  setId(id: string): void {
    this.updateState({ id });
  }

  setStatus(status: BotStatus): void {
    this.updateState({ status });
  }

  setPhoneNumber(phoneNumber: string): void {
    this.updateState({ phoneNumber });
  }

  setName(name: string): void {
    this.updateState({ name });
  }

  setProfileUrl(profileUrl: string): void {
    this.updateState({ profileUrl });
  }

  setConnectionStatus(status: ConnectionStatus): void {
    this.updateState({ connectionStatus: status });
  }

  setLastConnectionUpdateDate(date: number): void {
    this.updateState({ lastConnectionUpdateDate: date });
  }

  setLastDisconnectError(error?: number): void {
    this.updateState({ lastDisconnectError: error });
  }

  updateConnectionState(state: Partial<ConnectionState>): void {
    this.updateState({ connectionState: { ...this.state.connectionState, ...state } });
  }

  /**
   * Reseta o estado para valores iniciais
   */
  reset(): void {
    this.state = {
      id: '',
      status: BotStatus.Offline,
      phoneNumber: '',
      name: '',
      profileUrl: '',
      connectionStatus: 'disconnected',
      lastConnectionUpdateDate: Date.now(),
    };
    this.notifyObservers();
  }

  /**
   * Registra um observador para mudanças de estado
   */
  observe(observer: (state: BotState) => void): () => void {
    this.observers.add(observer);
    
    // Retorna função de cleanup
    return () => {
      this.observers.delete(observer);
    };
  }

  /**
   * Remove todos os observadores
   */
  clearObservers(): void {
    this.observers.clear();
  }
}

