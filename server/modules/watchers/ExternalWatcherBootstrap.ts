import { ExternalWatcherConfig } from './ExternalWatcherConfig';
import { ExternalWatcherIntegration } from './ExternalWatcherIntegration';
import { ExternalWatcherHealthCheck } from './ExternalWatcherHealthCheck';
import { initWatchers } from './watchers.module';

export interface IWatcherBootstrapOptions {
	models: any;
	broadcastCallback: any;
	meteorWatchFunction: any;
}

export class ExternalWatcherBootstrap {
	private static instance: ExternalWatcherBootstrap;
	private config: ExternalWatcherConfig;
	private externalWatcher: ExternalWatcherIntegration | null = null;
	private healthCheck: ExternalWatcherHealthCheck;
	private isInitialized = false;
	private usingExternalWatcher = false;

	private constructor() {
		this.config = ExternalWatcherConfig.getInstance();
		this.healthCheck = ExternalWatcherHealthCheck.getInstance();
	}

	public static getInstance(): ExternalWatcherBootstrap {
		if (!ExternalWatcherBootstrap.instance) {
			ExternalWatcherBootstrap.instance = new ExternalWatcherBootstrap();
		}
		return ExternalWatcherBootstrap.instance;
	}

	public async initialize(options: IWatcherBootstrapOptions): Promise<void> {
		if (this.isInitialized) {
			console.warn('ExternalWatcherBootstrap: Already initialized');
			return;
		}

		try {
			if (this.config.shouldUseExternalWatcher()) {
				console.log('ExternalWatcherBootstrap: Attempting to initialize external watcher...');
				await this.initializeExternalWatcher(options.broadcastCallback);
			} else {
				console.log('ExternalWatcherBootstrap: Using internal watcher (external watcher disabled)');
				this.initializeInternalWatcher(options);
			}

			this.isInitialized = true;
		} catch (error) {
			console.error('ExternalWatcherBootstrap: Failed to initialize:', error);
			throw error;
		}
	}

	private async initializeExternalWatcher(broadcastCallback: any): Promise<void> {
		try {
			// Validate configuration first
			const configErrors = this.config.validateConfig();
			if (configErrors.length > 0) {
				throw new Error(`Configuration validation failed: ${configErrors.join(', ')}`);
			}

			// Create and initialize external watcher
			this.externalWatcher = new ExternalWatcherIntegration(broadcastCallback);
			
			// Set a timeout for initialization
			const initTimeout = this.config.config.connectionTimeout || 30000;
			const initPromise = this.externalWatcher.initialize();
			
			await Promise.race([
				initPromise,
				new Promise((_, reject) => 
					setTimeout(() => reject(new Error(`External watcher initialization timeout after ${initTimeout}ms`)), initTimeout)
				)
			]);

			// Start health monitoring
			if (this.config.config.enableHealthCheck) {
				this.healthCheck.startPeriodicHealthCheck();
			}

			// Expose for debugging
			(global as any).externalDbWatcher = this.externalWatcher;
			
			this.usingExternalWatcher = true;
			console.log('ExternalWatcherBootstrap: External watcher initialized successfully');

		} catch (error) {
			console.error('ExternalWatcherBootstrap: External watcher failed, falling back to internal watcher:', error);
			
			// Clean up partial initialization
			if (this.externalWatcher) {
				try {
					await this.externalWatcher.shutdown();
				} catch (shutdownError) {
					console.error('ExternalWatcherBootstrap: Error during cleanup:', shutdownError);
				}
				this.externalWatcher = null;
			}

			// Don't throw here - fallback to internal watcher instead
			throw error;
		}
	}

	private initializeInternalWatcher(options: IWatcherBootstrapOptions): void {
		console.log('ExternalWatcherBootstrap: Initializing internal watcher');
		initWatchers(options.models, options.broadcastCallback, options.meteorWatchFunction);
		this.usingExternalWatcher = false;
		console.log('ExternalWatcherBootstrap: Internal watcher initialized successfully');
	}

	public async shutdown(): Promise<void> {
		if (!this.isInitialized) {
			return;
		}

		try {
			if (this.externalWatcher) {
				console.log('ExternalWatcherBootstrap: Shutting down external watcher...');
				await this.externalWatcher.shutdown();
				this.externalWatcher = null;
			}

			// Clean up global reference
			if ((global as any).externalDbWatcher) {
				delete (global as any).externalDbWatcher;
			}

			this.isInitialized = false;
			this.usingExternalWatcher = false;
			console.log('ExternalWatcherBootstrap: Shutdown complete');
		} catch (error) {
			console.error('ExternalWatcherBootstrap: Error during shutdown:', error);
			throw error;
		}
	}

	public getStatus() {
		return {
			isInitialized: this.isInitialized,
			usingExternalWatcher: this.usingExternalWatcher,
			externalWatcherEnabled: this.config.shouldUseExternalWatcher(),
			externalWatcherConnected: this.externalWatcher?.isConnected() ?? false,
			healthStatus: this.usingExternalWatcher ? this.externalWatcher?.getHealthStatus() : null,
			configurationDebug: this.config.getDebugInfo(),
		};
	}

	public async performHealthCheck() {
		if (!this.usingExternalWatcher) {
			return {
				status: 'healthy',
				message: 'Using internal watcher',
				timestamp: Date.now(),
			};
		}

		return await this.healthCheck.performHealthCheck();
	}

	public isUsingExternalWatcher(): boolean {
		return this.usingExternalWatcher;
	}

	public getExternalWatcher(): ExternalWatcherIntegration | null {
		return this.externalWatcher;
	}
}