import { ExternalWatcherBootstrap } from './ExternalWatcherBootstrap';
import { ExternalWatcherConfig } from './ExternalWatcherConfig';

export class ExternalWatcherAPI {
	private static instance: ExternalWatcherAPI;
	private bootstrap: ExternalWatcherBootstrap;
	private config: ExternalWatcherConfig;

	private constructor() {
		this.bootstrap = ExternalWatcherBootstrap.getInstance();
		this.config = ExternalWatcherConfig.getInstance();
	}

	public static getInstance(): ExternalWatcherAPI {
		if (!ExternalWatcherAPI.instance) {
			ExternalWatcherAPI.instance = new ExternalWatcherAPI();
		}
		return ExternalWatcherAPI.instance;
	}

	// Status endpoint
	public async getStatus() {
		try {
			const bootstrapStatus = this.bootstrap.getStatus();
			const healthCheck = await this.bootstrap.performHealthCheck();

			return {
				status: 'success',
				data: {
					...bootstrapStatus,
					healthCheck,
					timestamp: Date.now(),
				}
			};
		} catch (error) {
			return {
				status: 'error',
				error: error.message,
				timestamp: Date.now(),
			};
		}
	}

	// Configuration endpoint
	public getConfiguration() {
		return {
			status: 'success',
			data: this.config.getDebugInfo(),
		};
	}

	// Health check endpoint
	public async getHealthCheck() {
		try {
			const result = await this.bootstrap.performHealthCheck();
			return {
				status: 'success',
				data: result,
			};
		} catch (error) {
			return {
				status: 'error',
				error: error.message,
				timestamp: Date.now(),
			};
		}
	}

	// Detailed status with all information
	public async getDetailedStatus() {
		try {
			const [status, healthCheck] = await Promise.all([
				this.bootstrap.getStatus(),
				this.bootstrap.performHealthCheck(),
			]);

			const externalWatcher = this.bootstrap.getExternalWatcher();
			
			return {
				status: 'success',
				data: {
					bootstrap: status,
					healthCheck,
					configuration: this.config.getDebugInfo(),
					externalWatcherDetails: externalWatcher ? externalWatcher.getDebugInfo() : null,
					systemInfo: {
						nodeVersion: process.version,
						platform: process.platform,
						arch: process.arch,
						uptime: process.uptime(),
						memoryUsage: process.memoryUsage(),
					},
					environment: {
						USE_EXTERNAL_DBWATCHER: process.env.USE_EXTERNAL_DBWATCHER,
						DISABLE_DB_WATCH: process.env.DISABLE_DB_WATCH,
						EXTERNAL_WATCHER_NATS_URL: process.env.EXTERNAL_WATCHER_NATS_URL ? '[SET]' : '[NOT SET]',
						EXTERNAL_WATCHER_WS_URL: process.env.EXTERNAL_WATCHER_WS_URL ? '[SET]' : '[NOT SET]',
					},
					timestamp: Date.now(),
				}
			};
		} catch (error) {
			return {
				status: 'error',
				error: error.message,
				stack: error.stack,
				timestamp: Date.now(),
			};
		}
	}

	// Force restart external watcher (for debugging)
	public async restartExternalWatcher() {
		try {
			if (!this.config.shouldUseExternalWatcher()) {
				return {
					status: 'error',
					error: 'External watcher is not enabled',
				};
			}

			await this.bootstrap.shutdown();
			
			// Give it a moment to clean up
			await new Promise(resolve => setTimeout(resolve, 1000));
			
			// Re-initialize
			await this.bootstrap.initialize({
				models: (global as any).watcherModels || {},
				broadcastCallback: (global as any).watcherBroadcast || (() => {}),
				meteorWatchFunction: (global as any).watcherMeteorFunction || (() => {}),
			});

			return {
				status: 'success',
				message: 'External watcher restarted successfully',
				timestamp: Date.now(),
			};
		} catch (error) {
			return {
				status: 'error',
				error: error.message,
				timestamp: Date.now(),
			};
		}
	}

	// Get metrics/statistics
	public getMetrics() {
		const bootstrap = this.bootstrap.getStatus();
		const externalWatcher = this.bootstrap.getExternalWatcher();
		
		return {
			status: 'success',
			data: {
				watcherType: bootstrap.usingExternalWatcher ? 'external' : 'internal',
				isConnected: bootstrap.externalWatcherConnected,
				uptime: process.uptime(),
				memoryUsage: process.memoryUsage(),
				healthStatus: bootstrap.healthStatus,
				eventsProcessed: bootstrap.healthStatus?.eventsProcessed || 0,
				lastEventReceived: bootstrap.healthStatus?.lastEventReceived || null,
				timestamp: Date.now(),
			}
		};
	}
}

// Export a function to register API endpoints
export function registerExternalWatcherEndpoints() {
	const api = ExternalWatcherAPI.getInstance();
	
	// These would typically be registered with your REST API framework
	const endpoints = {
		'/api/external-watcher/status': api.getStatus.bind(api),
		'/api/external-watcher/config': api.getConfiguration.bind(api),
		'/api/external-watcher/health': api.getHealthCheck.bind(api),
		'/api/external-watcher/detailed': api.getDetailedStatus.bind(api),
		'/api/external-watcher/metrics': api.getMetrics.bind(api),
		'/api/external-watcher/restart': api.restartExternalWatcher.bind(api),
	};

	// Expose endpoints for manual testing/debugging
	(global as any).externalWatcherAPI = {
		api,
		endpoints,
		// Quick access functions for console debugging
		status: api.getStatus.bind(api),
		health: api.getHealthCheck.bind(api),
		detailed: api.getDetailedStatus.bind(api),
		restart: api.restartExternalWatcher.bind(api),
	};

	return endpoints;
}