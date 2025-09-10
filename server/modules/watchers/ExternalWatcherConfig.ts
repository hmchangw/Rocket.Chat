import { IExternalWatcherConfig, ICollectionMapping, DEFAULT_COLLECTION_MAPPINGS } from './ExternalWatcherAdapter';

export class ExternalWatcherConfig {
	private static instance: ExternalWatcherConfig;
	
	public readonly isEnabled: boolean;
	public readonly config: IExternalWatcherConfig;
	public readonly collectionMappings: ICollectionMapping;

	private constructor() {
		// Check if external watcher is enabled - this overrides DISABLE_DB_WATCH
		this.isEnabled = this.getEnvBoolean('USE_EXTERNAL_DBWATCHER', false);
		
		this.config = {
			natsUrl: process.env.EXTERNAL_WATCHER_NATS_URL || 'nats://localhost:4222',
			websocketServiceUrl: process.env.EXTERNAL_WATCHER_WS_URL || 'ws://localhost:8080',
			aggregatedEventsSubject: process.env.EXTERNAL_WATCHER_NATS_SUBJECT || 'rocketchat.events.aggregated',
			connectionTimeout: parseInt(process.env.EXTERNAL_WATCHER_CONNECTION_TIMEOUT || '10000', 10),
			retryAttempts: parseInt(process.env.EXTERNAL_WATCHER_RETRY_ATTEMPTS || '5', 10),
			retryDelay: parseInt(process.env.EXTERNAL_WATCHER_RETRY_DELAY || '2000', 10),
			enableHealthCheck: this.getEnvBoolean('EXTERNAL_WATCHER_ENABLE_HEALTH_CHECK', true),
			healthCheckInterval: parseInt(process.env.EXTERNAL_WATCHER_HEALTH_CHECK_INTERVAL || '30000', 10),
		};

		// Load custom collection mappings if provided
		this.collectionMappings = this.loadCollectionMappings();
	}

	public static getInstance(): ExternalWatcherConfig {
		if (!ExternalWatcherConfig.instance) {
			ExternalWatcherConfig.instance = new ExternalWatcherConfig();
		}
		return ExternalWatcherConfig.instance;
	}

	private getEnvBoolean(key: string, defaultValue: boolean): boolean {
		const value = process.env[key];
		if (!value) return defaultValue;
		return ['true', 'yes', '1'].includes(value.toLowerCase());
	}

	private loadCollectionMappings(): ICollectionMapping {
		try {
			const customMappings = process.env.EXTERNAL_WATCHER_COLLECTION_MAPPINGS;
			if (customMappings) {
				const parsed = JSON.parse(customMappings);
				return { ...DEFAULT_COLLECTION_MAPPINGS, ...parsed };
			}
		} catch (error) {
			console.warn('Failed to parse EXTERNAL_WATCHER_COLLECTION_MAPPINGS, using defaults:', error.message);
		}
		
		return DEFAULT_COLLECTION_MAPPINGS;
	}

	public getCollectionMapping(internalCollectionName: string): { externalName: string; requiresFullDocument: boolean; fieldMapping?: Record<string, string> } | null {
		return this.collectionMappings[internalCollectionName] || null;
	}

	public shouldUseExternalWatcher(): boolean {
		return this.isEnabled;
	}

	public shouldDisableInternalWatcher(): boolean {
		// When external watcher is enabled, we completely disable internal watcher
		// regardless of DISABLE_DB_WATCH setting
		return this.isEnabled;
	}

	public validateConfig(): string[] {
		const errors: string[] = [];

		if (!this.config.natsUrl) {
			errors.push('EXTERNAL_WATCHER_NATS_URL is required when USE_EXTERNAL_DBWATCHER is enabled');
		}

		if (!this.config.websocketServiceUrl) {
			errors.push('EXTERNAL_WATCHER_WS_URL is required when USE_EXTERNAL_DBWATCHER is enabled');
		}

		if (!this.config.aggregatedEventsSubject) {
			errors.push('EXTERNAL_WATCHER_NATS_SUBJECT is required when USE_EXTERNAL_DBWATCHER is enabled');
		}

		if (this.config.connectionTimeout < 1000) {
			errors.push('EXTERNAL_WATCHER_CONNECTION_TIMEOUT must be at least 1000ms');
		}

		if (this.config.retryAttempts < 1) {
			errors.push('EXTERNAL_WATCHER_RETRY_ATTEMPTS must be at least 1');
		}

		if (this.config.retryDelay < 100) {
			errors.push('EXTERNAL_WATCHER_RETRY_DELAY must be at least 100ms');
		}

		return errors;
	}

	public getDebugInfo(): Record<string, any> {
		return {
			isEnabled: this.isEnabled,
			config: {
				...this.config,
				// Don't expose sensitive URLs in full for security
				natsUrl: this.config.natsUrl.replace(/\/\/.*@/, '//***@'),
				websocketServiceUrl: this.config.websocketServiceUrl.replace(/\/\/.*@/, '//***@'),
			},
			collectionMappings: Object.keys(this.collectionMappings),
			environmentVariables: {
				USE_EXTERNAL_DBWATCHER: process.env.USE_EXTERNAL_DBWATCHER,
				DISABLE_DB_WATCH: process.env.DISABLE_DB_WATCH,
				EXTERNAL_WATCHER_NATS_URL: process.env.EXTERNAL_WATCHER_NATS_URL ? '[SET]' : '[NOT SET]',
				EXTERNAL_WATCHER_WS_URL: process.env.EXTERNAL_WATCHER_WS_URL ? '[SET]' : '[NOT SET]',
			},
		};
	}
}