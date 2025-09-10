import { ExternalWatcherConfig } from './ExternalWatcherConfig';
// import { SystemLogger } from '../../../app/logger/server';

export interface IHealthCheckResult {
	status: 'healthy' | 'unhealthy' | 'degraded';
	timestamp: number;
	checks: {
		externalWatcherEnabled: boolean;
		externalWatcherConnected?: boolean;
		natsConnected?: boolean;
		websocketConnected?: boolean;
		lastEventReceived?: number | null;
		eventsProcessed?: number;
		errors?: string[];
	};
}

export class ExternalWatcherHealthCheck {
	private static instance: ExternalWatcherHealthCheck;
	private config: ExternalWatcherConfig;

	private constructor() {
		this.config = ExternalWatcherConfig.getInstance();
	}

	public static getInstance(): ExternalWatcherHealthCheck {
		if (!ExternalWatcherHealthCheck.instance) {
			ExternalWatcherHealthCheck.instance = new ExternalWatcherHealthCheck();
		}
		return ExternalWatcherHealthCheck.instance;
	}

	public async performHealthCheck(): Promise<IHealthCheckResult> {
		const timestamp = Date.now();
		const result: IHealthCheckResult = {
			status: 'healthy',
			timestamp,
			checks: {
				externalWatcherEnabled: this.config.shouldUseExternalWatcher(),
				errors: [],
			},
		};

		// If external watcher is not enabled, return healthy status
		if (!this.config.shouldUseExternalWatcher()) {
			return result;
		}

		try {
			// Check if external watcher is available in global scope
			const externalWatcher = (global as any).externalDbWatcher;
			
			if (!externalWatcher) {
				result.status = 'unhealthy';
				result.checks.errors?.push('External watcher instance not found');
				return result;
			}

			// Get health status from external watcher
			const healthStatus = externalWatcher.getHealthStatus();
			
			result.checks.externalWatcherConnected = externalWatcher.isConnected();
			result.checks.natsConnected = healthStatus.natsConnected;
			result.checks.websocketConnected = healthStatus.websocketConnected;
			result.checks.lastEventReceived = healthStatus.lastEventReceived;
			result.checks.eventsProcessed = healthStatus.eventsProcessed;

			// Determine overall status
			if (!result.checks.externalWatcherConnected) {
				result.status = 'unhealthy';
				result.checks.errors?.push('External watcher not connected');
			} else if (!result.checks.natsConnected) {
				result.status = 'degraded';
				result.checks.errors?.push('NATS connection unavailable');
			}

			// Check if we haven't received events for too long (if we've processed any events)
			if (result.checks.eventsProcessed && result.checks.eventsProcessed > 0) {
				const noEventsThreshold = 300000; // 5 minutes
				const timeSinceLastEvent = result.checks.lastEventReceived 
					? timestamp - result.checks.lastEventReceived 
					: Infinity;

				if (timeSinceLastEvent > noEventsThreshold) {
					result.status = result.status === 'healthy' ? 'degraded' : result.status;
					result.checks.errors?.push(`No events received for ${Math.round(timeSinceLastEvent / 1000)}s`);
				}
			}

		} catch (error) {
			result.status = 'unhealthy';
			result.checks.errors?.push(`Health check error: ${error.message}`);
			console.error('External Watcher Health Check failed:', error);
		}

		return result;
	}

	public async getDetailedStatus(): Promise<Record<string, any>> {
		const healthCheck = await this.performHealthCheck();
		
		const detailedStatus: Record<string, any> = {
			healthCheck,
			configuration: this.config.getDebugInfo(),
		};

		// Add detailed watcher info if available
		if (this.config.shouldUseExternalWatcher()) {
			const externalWatcher = (global as any).externalDbWatcher;
			if (externalWatcher && typeof externalWatcher.getDebugInfo === 'function') {
				detailedStatus.watcherDetails = externalWatcher.getDebugInfo();
			}
		}

		return detailedStatus;
	}

	public startPeriodicHealthCheck(intervalMs: number = 60000): void {
		if (!this.config.shouldUseExternalWatcher()) {
			return;
		}

		setInterval(async () => {
			try {
				const result = await this.performHealthCheck();
				
				if (result.status === 'unhealthy') {
					console.error('External Watcher Health Check - UNHEALTHY:', result);
				} else if (result.status === 'degraded') {
					console.warn('External Watcher Health Check - DEGRADED:', result);
				} else {
					console.debug('External Watcher Health Check - HEALTHY:', result);
				}
			} catch (error) {
				console.error('Periodic health check failed:', error);
			}
		}, intervalMs);
	}
}