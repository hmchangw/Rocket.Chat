import React, { memo } from 'react';

import UserStatus from './UserStatus';
import { usePresence } from '../../hooks/usePresence';

const ReactiveUserStatus = ({ uid, ...props }) => {
	const status = usePresence(uid);
	return <UserStatus status={status} {...props} />;
};

export default memo(ReactiveUserStatus);
