import React from 'react';

import EditInvite from './EditInvite';
import VerticalBar from '../../../../../components/VerticalBar';

export default {
	title: 'room/contextualBar/RoomMembers/EditInvite',
	component: EditInvite,
};

export const Default = () => (
	<VerticalBar>
		<EditInvite
			onClickBack={alert}
			onClickClose={alert}
			onClickNewLink={alert}
			expirationDate={1}
			setExpirtaionDate={alert}
			maxUses={5}
			setMaxUses={alert}
		/>
	</VerticalBar>
);
