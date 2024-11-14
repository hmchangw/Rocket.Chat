import { useEffect } from 'react';

import { AsyncState } from './useAsyncState';
import { useMethodData } from './useMethodData';
import { ServerMethods } from '../contexts/ServerContext';

export const usePolledMethodData = <T>(
	methodName: keyof ServerMethods,
	args: any[] = [],
	intervalMs: number,
): AsyncState<T> & { reload: () => void } => {
	const { reload, ...state } = useMethodData<T>(methodName, args);

	useEffect(() => {
		const timer = setInterval(() => {
			reload();
		}, intervalMs);

		return (): void => {
			clearInterval(timer);
		};
	}, [reload, intervalMs]);

	return {
		...state,
		reload,
	};
};
