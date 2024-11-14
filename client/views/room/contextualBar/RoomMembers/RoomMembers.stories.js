import React from 'react';

import RoomMembers from './List/RoomMembers';
import VerticalBar from '../../../../components/VerticalBar';

export default {
	title: 'room/contextualBar/RoomMembers',
	component: RoomMembers,
};

export const Default = () => (
	<VerticalBar>
		<RoomMembers
			onClickBack={alert}
			onClickClose={alert}
			onClickSave={alert}
			value={[]}
			errors={{}}
			type='all'
		/>
	</VerticalBar>
);
