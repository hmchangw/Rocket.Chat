import { ExternalWatcherService } from './ExternalWatcherService';
import { ExternalWatcherConfig } from './ExternalWatcherConfig';
import { IExternalWatcherEvent, ExternalBroadcastCallback } from './ExternalWatcherAdapter';
// import { SystemLogger } from '../../../app/logger/server';
import mem from 'mem';
import { subscriptionFields } from './publishFields';

// Import the types we need for event processing
import { IMessage } from '../../../definition/IMessage';
import { ISubscription } from '../../../definition/ISubscription';
import { IRole } from '../../../definition/IRole';
import { IRoom } from '../../../definition/IRoom';
import { IUser } from '../../../definition/IUser';
import { ISetting } from '../../../definition/ISetting';
import { IPermission } from '../../../definition/IPermission';
import { IInquiry } from '../../../definition/IInquiry';
import { ILivechatDepartmentAgents } from '../../../definition/ILivechatDepartmentAgents';
import { IUserSession } from '../../../definition/IUserSession';
import { ILoginServiceConfiguration } from '../../../definition/ILoginServiceConfiguration';
import { IInstanceStatus } from '../../../definition/IInstanceStatus';
import { IIntegrationHistory } from '../../../definition/IIntegrationHistory';
import { IIntegration } from '../../../definition/IIntegration';
import { IEmailInbox } from '../../../definition/IEmailInbox';

// Cache functions similar to the internal watcher
const getUserNameCached = mem(async (userId: string): Promise<string | undefined> => {
	// This will need to be injected or imported from the actual Users model
	// For now, we'll return undefined and let the external service handle it
	return undefined;
}, { maxAge: 10000 });

const getSettingCached = mem(async (setting: string): Promise<any> => {
	// This will need to be injected or imported from the actual Settings model
	// For now, we'll return undefined and let the external service handle it
	return undefined;
}, { maxAge: 10000 });

export class ExternalWatcherIntegration {
	private watcherService: ExternalWatcherService;
	private config: ExternalWatcherConfig;
	private broadcastCallback: ExternalBroadcastCallback;
	private isInitialized = false;

	constructor(broadcastCallback: ExternalBroadcastCallback) {
		this.config = ExternalWatcherConfig.getInstance();
		this.broadcastCallback = broadcastCallback;
		this.watcherService = new ExternalWatcherService();
		
		this.setupEventHandlers();
	}

	private setupEventHandlers(): void {
		this.watcherService.on('connected', () => {
			console.log('External Watcher Integration: Successfully connected');
		});

		this.watcherService.on('disconnected', () => {
			console.warn('External Watcher Integration: Disconnected');
		});

		this.watcherService.on('error', (error) => {
			console.error('External Watcher Integration: Error:', error);
		});

		this.watcherService.onEvent((event) => {
			this.processExternalEvent(event);
		});
	}

	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			console.log('External Watcher Integration: Initializing...');
			await this.watcherService.connect();
			this.isInitialized = true;
			console.log('External Watcher Integration: Initialized successfully');
		} catch (error) {
			console.error('External Watcher Integration: Failed to initialize:', error);
			throw error;
		}
	}

	async shutdown(): Promise<void> {
		if (!this.isInitialized) {
			return;
		}

		try {
			console.log('External Watcher Integration: Shutting down...');
			await this.watcherService.disconnect();
			this.isInitialized = false;
			console.log('External Watcher Integration: Shutdown complete');
		} catch (error) {
			console.error('External Watcher Integration: Error during shutdown:', error);
			throw error;
		}
	}

	private async processExternalEvent(event: IExternalWatcherEvent): Promise<void> {
		try {
			// Map external collection names to internal collection names and process
			const mapping = this.config.getCollectionMapping(event.collection);
			if (!mapping) {
				console.debug(`External Watcher: No mapping found for collection: ${event.collection}`);
				return;
			}

			// Process the event based on collection type
			switch (event.collection) {
				case 'messages':
					await this.processMessageEvent(event as IExternalWatcherEvent<IMessage>);
					break;
				case 'subscriptions':
					await this.processSubscriptionEvent(event as IExternalWatcherEvent<ISubscription>);
					break;
				case 'users':
					await this.processUserEvent(event as IExternalWatcherEvent<IUser>);
					break;
				case 'settings':
					await this.processSettingEvent(event as IExternalWatcherEvent<ISetting>);
					break;
				case 'permissions':
					await this.processPermissionEvent(event as IExternalWatcherEvent<IPermission>);
					break;
				case 'roles':
					await this.processRoleEvent(event as IExternalWatcherEvent<IRole>);
					break;
				case 'rooms':
					await this.processRoomEvent(event as IExternalWatcherEvent<IRoom>);
					break;
				case 'livechatInquiry':
					await this.processLivechatInquiryEvent(event as IExternalWatcherEvent<IInquiry>);
					break;
				case 'livechatDepartmentAgents':
					await this.processLivechatDepartmentAgentsEvent(event as IExternalWatcherEvent<ILivechatDepartmentAgents>);
					break;
				case 'usersSessions':
					await this.processUserSessionEvent(event as IExternalWatcherEvent<IUserSession>);
					break;
				case 'loginServiceConfiguration':
					await this.processLoginServiceConfigurationEvent(event as IExternalWatcherEvent<ILoginServiceConfiguration>);
					break;
				case 'instanceStatus':
					await this.processInstanceStatusEvent(event as IExternalWatcherEvent<IInstanceStatus>);
					break;
				case 'integrationHistory':
					await this.processIntegrationHistoryEvent(event as IExternalWatcherEvent<IIntegrationHistory>);
					break;
				case 'integrations':
					await this.processIntegrationEvent(event as IExternalWatcherEvent<IIntegration>);
					break;
				case 'emailInbox':
					await this.processEmailInboxEvent(event as IExternalWatcherEvent<IEmailInbox>);
					break;
				default:
					console.debug(`External Watcher: Unhandled collection: ${event.collection}`);
			}
		} catch (error) {
			console.error('External Watcher Integration: Error processing event:', error, { event });
		}
	}

	// Event processors for each collection type
	private async processMessageEvent(event: IExternalWatcherEvent<IMessage>): Promise<void> {
		if (!event.data || (event.data._hidden === true || event.data.imported != null)) {
			return;
		}

		await this.broadcastCallback('watch.messages', { 
			clientAction: event.clientAction, 
			message: event.data 
		});
	}

	private async processSubscriptionEvent(event: IExternalWatcherEvent<ISubscription>): Promise<void> {
		if (event.clientAction === 'removed') {
			const subscription = event.data || { _id: event.id };
			await this.broadcastCallback('watch.subscriptions', { 
				clientAction: event.clientAction, 
				subscription 
			});
			return;
		}

		if (!event.data) {
			return;
		}

		// Project only the required fields similar to internal watcher
		const subscription = this.projectSubscriptionFields(event.data);
		await this.broadcastCallback('watch.subscriptions', { 
			clientAction: event.clientAction, 
			subscription 
		});
	}

	private async processUserEvent(event: IExternalWatcherEvent<IUser>): Promise<void> {
		await this.broadcastCallback('watch.users', { 
			clientAction: event.clientAction, 
			data: event.data, 
			diff: event.diff, 
			unset: event.unset, 
			id: event.id 
		});
	}

	private async processSettingEvent(event: IExternalWatcherEvent<ISetting>): Promise<void> {
		if (!event.data) {
			return;
		}

		await this.broadcastCallback('watch.settings', { 
			clientAction: event.clientAction, 
			setting: event.data 
		});
	}

	private async processPermissionEvent(event: IExternalWatcherEvent<IPermission>): Promise<void> {
		const data = event.clientAction === 'removed' 
			? { _id: event.id, roles: [] } 
			: event.data;

		if (!data) {
			return;
		}

		await this.broadcastCallback('permission.changed', { 
			clientAction: event.clientAction, 
			data 
		});
	}

	private async processRoleEvent(event: IExternalWatcherEvent<IRole>): Promise<void> {
		const role = event.clientAction === 'removed'
			? { _id: event.id, name: event.id }
			: event.data;

		if (!role) {
			return;
		}

		await this.broadcastCallback('watch.roles', {
			clientAction: event.clientAction !== 'removed' ? 'changed' : event.clientAction,
			role,
		});
	}

	private async processRoomEvent(event: IExternalWatcherEvent<IRoom>): Promise<void> {
		if (event.clientAction === 'removed') {
			await this.broadcastCallback('watch.rooms', { 
				clientAction: event.clientAction, 
				room: { _id: event.id } 
			});
			return;
		}

		if (!event.data) {
			return;
		}

		await this.broadcastCallback('watch.rooms', { 
			clientAction: event.clientAction, 
			room: event.data 
		});
	}

	private async processLivechatInquiryEvent(event: IExternalWatcherEvent<IInquiry>): Promise<void> {
		if (!event.data) {
			return;
		}

		await this.broadcastCallback('watch.inquiries', { 
			clientAction: event.clientAction, 
			inquiry: event.data, 
			diff: event.diff 
		});
	}

	private async processLivechatDepartmentAgentsEvent(event: IExternalWatcherEvent<ILivechatDepartmentAgents>): Promise<void> {
		if (!event.data) {
			return;
		}

		await this.broadcastCallback('watch.livechatDepartmentAgents', { 
			clientAction: event.clientAction, 
			id: event.id, 
			data: event.data, 
			diff: event.diff 
		});
	}

	private async processUserSessionEvent(event: IExternalWatcherEvent<IUserSession>): Promise<void> {
		const data = event.clientAction === 'removed' 
			? { _id: event.id } 
			: event.data;

		if (!data) {
			return;
		}

		await this.broadcastCallback('watch.userSessions', { 
			clientAction: event.clientAction, 
			userSession: data 
		});
	}

	private async processLoginServiceConfigurationEvent(event: IExternalWatcherEvent<ILoginServiceConfiguration>): Promise<void> {
		if (!event.data) {
			return;
		}

		await this.broadcastCallback('watch.loginServiceConfiguration', { 
			clientAction: event.clientAction, 
			data: event.data, 
			id: event.id 
		});
	}

	private async processInstanceStatusEvent(event: IExternalWatcherEvent<IInstanceStatus>): Promise<void> {
		await this.broadcastCallback('watch.instanceStatus', { 
			clientAction: event.clientAction, 
			data: event.data, 
			diff: event.diff, 
			id: event.id 
		});
	}

	private async processIntegrationHistoryEvent(event: IExternalWatcherEvent<IIntegrationHistory>): Promise<void> {
		if (!event.data) {
			return;
		}

		await this.broadcastCallback('watch.integrationHistory', { 
			clientAction: event.clientAction, 
			data: event.data, 
			diff: event.diff, 
			id: event.id 
		});
	}

	private async processIntegrationEvent(event: IExternalWatcherEvent<IIntegration>): Promise<void> {
		const data = event.clientAction === 'removed' 
			? { _id: event.id } 
			: event.data;

		if (!data) {
			return;
		}

		await this.broadcastCallback('watch.integrations', { 
			clientAction: event.clientAction, 
			data, 
			id: event.id 
		});
	}

	private async processEmailInboxEvent(event: IExternalWatcherEvent<IEmailInbox>): Promise<void> {
		const data = event.clientAction === 'removed' 
			? { _id: event.id } 
			: event.data;

		if (!data) {
			return;
		}

		await this.broadcastCallback('watch.emailInbox', { 
			clientAction: event.clientAction, 
			data, 
			id: event.id 
		});
	}

	// Helper method to project subscription fields
	private projectSubscriptionFields(subscription: ISubscription): Partial<ISubscription> {
		const result: Partial<ISubscription> = {};
		
		// Apply the same field projection as the internal watcher
		Object.keys(subscriptionFields).forEach(field => {
			if (field in subscription) {
				(result as any)[field] = (subscription as any)[field];
			}
		});

		return result;
	}

	// Status and debugging methods
	isConnected(): boolean {
		return this.watcherService.isConnected();
	}

	getHealthStatus() {
		return this.watcherService.getHealthStatus();
	}

	getDebugInfo() {
		return {
			integration: {
				isInitialized: this.isInitialized,
				isConnected: this.isConnected(),
			},
			watcher: this.watcherService.getDebugInfo(),
		};
	}
}