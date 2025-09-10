import { EventEmitter } from 'events';
import {
	IExternalWatcherAdapter,
	IExternalWatcherEvent,
} from './ExternalWatcherAdapter';
import { NatsClient } from './NatsClient';
import { ExternalWatcherConfig } from './ExternalWatcherConfig';
import { SystemLogger } from '../../../app/logger/server';

export class ExternalWatcherService extends EventEmitter implements IExternalWatcherAdapter {
	private natsClient: NatsClient;
	private config: ExternalWatcherConfig;
	private connected = false;
	private healthStatus = {
		natsConnected: false,
		websocketConnected: false,
		lastEventReceived: null as number | null,
		eventsProcessed: 0,
	};
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private eventCallback: ((event: IExternalWatcherEvent) => void) | null = null;

	constructor() {
		super();
		this.config = ExternalWatcherConfig.getInstance();
		
		// Validate configuration before initializing
		const configErrors = this.config.validateConfig();
		if (configErrors.length > 0) {
			throw new Error(`External Watcher configuration errors: ${configErrors.join(', ')}`);
		}

		// Initialize NATS client
		this.natsClient = new NatsClient({
			url: this.config.config.natsUrl,
			subject: this.config.config.aggregatedEventsSubject,
			connectionTimeout: this.config.config.connectionTimeout,
			retryAttempts: this.config.config.retryAttempts,
			retryDelay: this.config.config.retryDelay,
		});

		this.setupNatsEventHandlers();
	}

	private setupNatsEventHandlers(): void {
		this.natsClient.on('connected', () => {
			console.log('External Watcher: Connected to NATS server');
			this.healthStatus.natsConnected = true;
			this.checkConnectionStatus();
		});

		this.natsClient.on('disconnected', () => {
			console.warn('External Watcher: Disconnected from NATS server');
			this.healthStatus.natsConnected = false;
			this.connected = false;
			this.emit('disconnected');
		});

		this.natsClient.on('error', (error) => {
			console.error('External Watcher: NATS client error:', error);
			this.emit('error', error);
		});

		this.natsClient.on('event', (event: IExternalWatcherEvent) => {
			this.handleExternalEvent(event);
		});
	}

	private checkConnectionStatus(): void {
		const wasConnected = this.connected;
		this.connected = this.healthStatus.natsConnected;

		if (this.connected && !wasConnected) {
			console.log('External Watcher: Service is now connected and ready');
			this.emit('connected');
		}
	}

	private handleExternalEvent(event: IExternalWatcherEvent): void {
		try {
			this.healthStatus.lastEventReceived = Date.now();
			this.healthStatus.eventsProcessed++;

			// Log event for debugging (can be controlled by log level)
			console.debug('External Watcher: Received event', {
				collection: event.collection,
				action: event.action,
				id: event.id,
			});

			// Call the registered event callback
			if (this.eventCallback) {
				this.eventCallback(event);
			}

			this.emit('event', event);
		} catch (error) {
			console.error('External Watcher: Error handling event:', error, { event });
			this.emit('error', error);
		}
	}

	async connect(): Promise<void> {
		try {
			console.log('External Watcher: Connecting to external services...');
			
			// Connect to NATS
			await this.natsClient.connect();

			// Start health check if enabled
			if (this.config.config.enableHealthCheck) {
				this.startHealthCheck();
			}

			console.log('External Watcher: Connection process initiated');
		} catch (error) {
			console.error('External Watcher: Failed to connect:', error);
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		try {
			console.log('External Watcher: Disconnecting from external services...');

			// Stop health check
			if (this.healthCheckInterval) {
				clearInterval(this.healthCheckInterval);
				this.healthCheckInterval = null;
			}

			// Disconnect NATS client
			await this.natsClient.disconnect();

			this.connected = false;
			this.healthStatus.natsConnected = false;

			console.log('External Watcher: Disconnected successfully');
		} catch (error) {
			console.error('External Watcher: Error during disconnect:', error);
			throw error;
		}
	}

	onEvent(callback: (event: IExternalWatcherEvent) => void): void {
		this.eventCallback = callback;
	}

	isConnected(): boolean {
		return this.connected;
	}

	getHealthStatus() {
		return {
			...this.healthStatus,
			uptime: process.uptime(),
			memoryUsage: process.memoryUsage(),
			natsStats: this.natsClient.getStats(),
		};
	}

	private startHealthCheck(): void {
		this.healthCheckInterval = setInterval(() => {
			const status = this.getHealthStatus();
			
			// Log health status periodically
			console.debug('External Watcher: Health check', status);

			// Check if we haven't received events for too long (configurable threshold)
			const noEventsThreshold = 60000; // 1 minute
			const timeSinceLastEvent = status.lastEventReceived 
				? Date.now() - status.lastEventReceived 
				: Infinity;

			if (timeSinceLastEvent > noEventsThreshold && status.eventsProcessed > 0) {
				console.warn(`External Watcher: No events received for ${timeSinceLastEvent}ms`);
			}

			// Emit health status for monitoring
			this.emit('healthCheck', status);
		}, this.config.config.healthCheckInterval);
	}

	// Method to get debug information
	getDebugInfo() {
		return {
			config: this.config.getDebugInfo(),
			healthStatus: this.getHealthStatus(),
			isConnected: this.connected,
			hasEventCallback: this.eventCallback !== null,
		};
	}
}