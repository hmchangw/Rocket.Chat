import { memo } from 'react';

import Action from './Action';
import Avatar from './Avatar';
import UserInfoWithData from './UserInfoWithData';
import Username from './Username';
import InfoPanel from '../../../InfoPanel';

export default Object.assign(memo(UserInfoWithData), {
	Action,
	Avatar,
	Info: InfoPanel.Text,
	Label: InfoPanel.Label,
	Username,
});
