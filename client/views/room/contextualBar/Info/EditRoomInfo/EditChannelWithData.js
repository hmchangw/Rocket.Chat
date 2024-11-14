import React from 'react';

import EditChannel from './EditChannel';
import { useUserRoom } from '../../../hooks/useUserRoom';
import { useTabBarClose } from '../../../providers/ToolboxProvider';

function EditChannelWithData({ rid, onClickBack }) {
	const room = useUserRoom(rid);
	const onClickClose = useTabBarClose();

	return (
		<EditChannel
			onClickClose={onClickClose}
			onClickBack={onClickBack}
			room={{ type: room?.t, ...room }}
		/>
	);
}

export default EditChannelWithData;
