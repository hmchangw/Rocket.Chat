import { EventEmitter } from 'events';
import { IExternalWatcherEvent } from './ExternalWatcherAdapter';

// NATS client interface for external integration
// This will work with the NATS.js client when installed
export interface INatsConnection {
	close(): Promise<void>;
	isClosed(): boolean;
	subscribe(subject: string, opts?: any): any;
}

export interface INatsMessage {
	data: Uint8Array;
	reply?: string;
	subject: string;
	respond(data?: any): boolean;
}

export class NatsClient extends EventEmitter {
	private connection: INatsConnection | null = null;
	private subscription: any = null;
	private config: {
		url: string;
		subject: string;
		connectionTimeout: number;
		retryAttempts: number;
		retryDelay: number;
	};
	private retryCount = 0;
	private isConnecting = false;

	constructor(config: {
		url: string;
		subject: string;
		connectionTimeout?: number;
		retryAttempts?: number;
		retryDelay?: number;
	}) {
		super();
		this.config = {
			connectionTimeout: 10000,
			retryAttempts: 5,
			retryDelay: 2000,
			...config,
		};
	}

	async connect(): Promise<void> {
		if (this.isConnecting || this.isConnected()) {
			return;
		}

		this.isConnecting = true;

		try {
			// Dynamic import for NATS client
			const { connect } = await import('nats');
			
			this.connection = await connect({
				servers: [this.config.url],
				timeout: this.config.connectionTimeout,
				maxReconnectAttempts: this.config.retryAttempts,
				reconnectTimeWait: this.config.retryDelay,
				verbose: false,
			});

			// Subscribe to the aggregated events subject
			this.subscription = this.connection.subscribe(this.config.subject);
			this.processMessages();

			this.retryCount = 0;
			this.isConnecting = false;
			this.emit('connected');
		} catch (error) {
			this.isConnecting = false;
			this.emit('error', error);
			
			if (this.retryCount < this.config.retryAttempts) {
				this.retryCount++;
				setTimeout(() => this.connect(), this.config.retryDelay);
			} else {
				throw new Error(`Failed to connect to NATS after ${this.config.retryAttempts} attempts: ${error.message}`);
			}
		}
	}

	private async processMessages(): Promise<void> {
		if (!this.subscription) {
			return;
		}

		try {
			for await (const message of this.subscription) {
				try {
					const event = this.parseMessage(message);
					if (event) {
						this.emit('event', event);
					}
				} catch (error) {
					this.emit('error', new Error(`Failed to process message: ${error.message}`));
				}
			}
		} catch (error) {
			this.emit('error', error);
		}
	}

	private parseMessage(message: INatsMessage): IExternalWatcherEvent | null {
		try {
			const textDecoder = new TextDecoder();
			const jsonString = textDecoder.decode(message.data);
			const event = JSON.parse(jsonString) as IExternalWatcherEvent;
			
			// Validate event structure
			if (!event.collection || !event.action || !event.id) {
				throw new Error('Invalid event format: missing required fields');
			}

			return event;
		} catch (error) {
			throw new Error(`Failed to parse NATS message: ${error.message}`);
		}
	}

	isConnected(): boolean {
		return this.connection !== null && !this.connection.isClosed();
	}

	async disconnect(): Promise<void> {
		if (this.subscription) {
			this.subscription.unsubscribe();
			this.subscription = null;
		}

		if (this.connection && !this.connection.isClosed()) {
			await this.connection.close();
			this.connection = null;
		}

		this.emit('disconnected');
	}

	getStats() {
		return {
			connected: this.isConnected(),
			retryCount: this.retryCount,
			isConnecting: this.isConnecting,
		};
	}
}