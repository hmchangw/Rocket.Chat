import { EventSignatures } from '../../sdk/lib/Events';

export interface IExternalWatcherConfig {
	natsUrl: string;
	websocketServiceUrl: string;
	aggregatedEventsSubject: string;
	connectionTimeout: number;
	retryAttempts: number;
	retryDelay: number;
	enableHealthCheck: boolean;
	healthCheckInterval: number;
}

export interface IExternalWatcherEvent<T = any> {
	collection: string;
	action: 'insert' | 'update' | 'remove';
	clientAction: 'inserted' | 'updated' | 'removed';
	id: string;
	data?: T;
	diff?: Record<string, any>;
	unset?: Record<string, number>;
	timestamp: number;
	operationType: string;
}

export interface IExternalWatcherAdapter {
	isConnected(): boolean;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	onEvent(callback: (event: IExternalWatcherEvent) => void): void;
	getHealthStatus(): {
		natsConnected: boolean;
		websocketConnected: boolean;
		lastEventReceived: number | null;
		eventsProcessed: number;
	};
}

export type ExternalBroadcastCallback = <T extends keyof EventSignatures>(
	event: T,
	...args: Parameters<EventSignatures[T]>
) => Promise<void>;

export interface ICollectionMapping {
	[internalName: string]: {
		externalName: string;
		fieldMapping?: Record<string, string>;
		requiresFullDocument: boolean;
	};
}

// Default collection mappings
export const DEFAULT_COLLECTION_MAPPINGS: ICollectionMapping = {
	'messages': {
		externalName: 'messages',
		requiresFullDocument: false,
	},
	'subscriptions': {
		externalName: 'subscriptions',
		requiresFullDocument: true,
	},
	'users': {
		externalName: 'users',
		requiresFullDocument: false,
	},
	'settings': {
		externalName: 'settings',
		requiresFullDocument: true,
	},
	'permissions': {
		externalName: 'permissions',
		requiresFullDocument: true,
	},
	'roles': {
		externalName: 'roles',
		requiresFullDocument: true,
	},
	'rooms': {
		externalName: 'rooms',
		requiresFullDocument: false,
	},
	'livechat-inquiry': {
		externalName: 'livechatInquiry',
		requiresFullDocument: true,
	},
	'livechat-department-agents': {
		externalName: 'livechatDepartmentAgents',
		requiresFullDocument: true,
	},
	'users-sessions': {
		externalName: 'usersSessions',
		requiresFullDocument: true,
	},
	'meteor_accounts_loginServiceConfiguration': {
		externalName: 'loginServiceConfiguration',
		requiresFullDocument: true,
	},
	'rocketchat_instance_status': {
		externalName: 'instanceStatus',
		requiresFullDocument: false,
	},
	'rocketchat_integration_history': {
		externalName: 'integrationHistory',
		requiresFullDocument: true,
	},
	'rocketchat_integrations': {
		externalName: 'integrations',
		requiresFullDocument: true,
	},
	'rocketchat_email_inbox': {
		externalName: 'emailInbox',
		requiresFullDocument: true,
	},
};